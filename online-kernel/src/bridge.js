/*
 * 心跳桥(内核侧):与 DSH 插件之间的本地 HTTP 通道。
 * 内核每 ~700ms 向插件 POST {token, state, events},响应里取回命令队列。
 * 桥地址与 token 来自安装内核时写入的 nnk-bridge.json(无该文件 = 待机,不轮询)。
 */
(function() {
	var nnk = window.__nnk__;

	var cfg = null;
	var timer = null;
	var failures = 0;
	var seq = 0;
	var events = [];
	var backlog = [];   /* 保存尚未确认送达的事件，下次心跳继续发送；应答异常时保留队列，确保邀请码等内容可重试送达。 */
	var stopped = false, epoch = 0, controller = null, configControllers = new Set(), initializing = false, commandOverride = null, ordinaryOperations = null;
	var confirmedTransferLimitMB = nnk.modules.config && nnk.modules.config.get("transferLimitMB");
	var confirmedAutoTransfer = nnk.modules.config && nnk.modules.config.get("autoTransfer");
	var commandQueue = [], commandRunner = null, maxPendingCommands = 64, bindingGeneration = 0, configReadSequence = 0, acceptedConfigRead = 0;
	var polling = false;   /* 串行化:0.7 秒一拍比一次请求快时,不让两轮并发 */
	var state = { phase: "idle", ts: Date.now() };

	function confirmConfig(type, data) {
		if (type === "config_applied" && data && data.key === "transferLimitMB" && Number.isSafeInteger(data.value) && data.value >= 1 && data.value <= 1024) confirmedTransferLimitMB = data.value;
		if (type === "config_applied" && data && data.key === "autoTransfer" && typeof data.value === "boolean") confirmedAutoTransfer = data.value;
	}

	function emit(type, data) {
		confirmConfig(type, data);
		seq++;
		events.push({ seq: seq, type: type, data: data || null, ts: Date.now() });
		if (events.length > 100) {
			events.splice(0, events.length - 100);
		}
	}

	function setPhase(phase, extra) {
		state = Object.assign({ phase: phase, ts: Date.now() }, extra || {});
	}

	/* Contexts belong to the initiating binding generation, including A -> B -> A. */
	function captureContext() {
		var contextEpoch = epoch, generation = bindingGeneration;
		var current = function() { return !stopped && contextEpoch === epoch && generation === bindingGeneration; };
		return { isCurrent: current, emit: function(type, data) { confirmConfig(type, data); if (current()) emit(type, data); }, setPhase: function(phase, extra) { if (current()) setPhase(phase, extra); } };
	}

	function observeBinding(value) {
		if (!sameBinding(cfg, value)) {
			bindingGeneration++;
			/* Already-produced events may follow the same owner to its new local port. */
			if (cfg && cfg.token !== value.token) { events = []; backlog = []; }
		}
		cfg = value;
	}

	function readBridgeConfig() {
		var readEpoch = epoch, readSequence = ++configReadSequence;
		var url = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/nnk-bridge.json";
		var abort = new AbortController();
		configControllers.add(abort);
		var deadline = setTimeout(function() { abort.abort(); }, 2500);
		return fetch(url, { cache: "no-store", signal: abort.signal })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(value) {
				if (!value || typeof value.token !== "string" || !value.token || typeof value.baseUrl !== "string") return null;
				var endpoint = new URL(value.baseUrl);
				if (endpoint.protocol !== "http:" || ["127.0.0.1", "localhost", "[::1]"].indexOf(endpoint.hostname) < 0 || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
				if (stopped || readEpoch !== epoch) return null;
				/* A delayed earlier read cannot roll back a newer observed binding. */
				if (readSequence < acceptedConfigRead) return cfg;
				acceptedConfigRead = readSequence; observeBinding(value);
				return value;
			})
			.catch(function() { return null; })
			.finally(function() { clearTimeout(deadline); configControllers.delete(abort); });
	}

	function sameBinding(a, b) {
		return !!a && !!b && a.baseUrl === b.baseUrl && a.token === b.token;
	}

	async function dispatch(cmd, context) {
		var emit = context.emit, setPhase = context.setPhase;
		if (commandOverride) return await commandOverride(cmd, context);
		if (cmd.action === "batch_request") throw Error("请在双方连接的插件房间中重新申请补传。");
		if (nnk.keepaliveEntry && ["create_room", "join_room", "join_invite"].indexOf(cmd.action) >= 0) return await nnk.keepaliveEntry.beginCarrier(cmd, context);
		if (["set_config", "set_identity", "clear_quarantine", "manifest_recheck", "transfer_pack", "batch_decision", "batch_cancel", "batch_reload", "batch_retry"].indexOf(cmd.action) >= 0 && nnk.keepaliveEntry) {
			if (!ordinaryOperations) {
				var operations = await import("../keepalive/engine-operation-port.js");
				if (stopped || !context.isCurrent()) throw Error("旧文档操作已失效");
				var operationEpoch = epoch;
				ordinaryOperations = operations.createEngineOperationPort(nnk, { isCurrent: function () { return !stopped && operationEpoch === epoch; }, scope: nnk.keepaliveEntry.scope || null, onEvent: function(type, data) { confirmConfig(type, data); } });
			}
			return await ordinaryOperations.execute(cmd.action, cmd.args || {}, emit);
		}
		var host = nnk.modules.host;
		var guest = nnk.modules.guest;
		var args = cmd.args || {};
		switch (cmd.action) {
			case "create_room":
				return await host.createInternetRoom(args.mode, args.signaling);
				break;
			case "restart_room":
				return await host.restartRoom(args.mode);
				break;
			case "set_mode":
				return await host.setRoomMode(args.mode);
				break;
			case "join_room":
				return await guest.joinByRoomCode(args.code);
				break;
			case "invite_refresh":
				/* kind="invite"=生成一张新码(可多张);kind="cancel"=作废第 id 张;
				 * 不带 kind=换房号 */
				return await host.refreshInvite(args.kind, args.id);
				break;
			case "accept_answer":
				/* id=列表行号(旧客户端不带:当最新那张待用码) */
				return await host.acceptAnswer(args.id, args.code);
				break;
			case "join_invite":
				return await guest.joinByInvite(args.code);
				break;
			case "transfer_pack":
				if (nnk.modules.transfer) {
					nnk.modules.transfer.start(args.name);
				}
				break;
			case "batch_decision":
				if (nnk.modules.consent && !nnk.modules.consent.decide(args)) emit("error", { message: "提议已失效，授权未生效。" });
				break;
			case "batch_cancel":
				if (nnk.modules.batch && nnk.modules.batch.cancel) nnk.modules.batch.cancel(args);
				else if (nnk.modules.consent) nnk.modules.consent.cancel(args);
				break;
			case "batch_reload":
				if (nnk.modules.batch && !nnk.modules.batch.reload(args)) emit("error", { message: "整批启用尚未完成或当前对局不允许重启。" });
				break;
			case "batch_retry":
				if (nnk.modules.batch) Promise.resolve(nnk.modules.batch.retry(args)).then(function(ok){if(!ok)emit("error",{message:"本批文件已提交、结果待确认或提议不允许重新补传；不会重新下载。"});}).catch(function(err){emit("error",{message:"重新补传未启动："+err.message});});
				break;
            case "manifest_recheck":
                if (nnk.modules.manifest) nnk.modules.manifest.recheck();
                break;
			case "clear_quarantine":
				if (nnk.modules.compat) {
					nnk.modules.compat.clearQuarantine();
				}
				break;
			case "set_config": {
				if (args.key === "transferLimitMB" || args.key === "autoTransfer") {
					if (args.key === "autoTransfer" && typeof args.value !== "boolean") throw Error("自动补传开关必须为布尔值");
					if (args.key === "transferLimitMB" && (!Number.isSafeInteger(args.value) || args.value < 1 || args.value > 1024)) throw Error("补传容量须为 1 至 1024 MiB 的整数");
					if (!ordinaryOperations) {
						var limitOperations = await import("../keepalive/engine-operation-port.js");
						if (stopped || !context.isCurrent()) throw Error("旧文档操作已失效");
						var limitEpoch = epoch;
						ordinaryOperations = limitOperations.createEngineOperationPort(nnk, { isCurrent: function () { return !stopped && limitEpoch === epoch; }, scope: null, onEvent: function(type, data) { confirmConfig(type, data); } });
					}
					return await ordinaryOperations.execute("set_config", { key: args.key, value: args.value }, emit);
				}
				/* 只放行允许工坊改的内核配置键,值按类型强转 */
				var allowed = { unlockUIExtensions: "boolean", autoUnlockExtensions: "boolean", mqttUrl: "string" };
				if (allowed.hasOwnProperty(args.key)) {
					if (allowed[args.key] === "string") {
						var strVal = String(args.value == null ? "" : args.value).slice(0, 200);
						if (args.key === "mqttUrl" && strVal && !/^wss?:\/\//i.test(strVal)) {
							emit("error", { message: "信令地址必须是 ws:// 或 wss:// 开头的 WebSocket 地址: " + strVal });
							break;
						}
						/* 空值 = 恢复默认(空串存进去会让 config.get 绕过 DEFAULTS) */
						nnk.modules.config.set(args.key, strVal || nnk.modules.config.defaults[args.key]);
					} else {
						nnk.modules.config.set(args.key, args.value === true);
					}
				} else {
					emit("error", { message: "不允许修改的配置: " + args.key });
				}
				break;
			}
			case "set_identity": {
				/* 人物标识:名字截 12 字(引擎同款),头像必须是本机存在的武将 id
				 * (不存在的话引擎会渲染成默认灰头像,不如当场拦下告诉工坊) */
				var compat = nnk.modules.compat;
				var name2 = String(args.name || "").slice(0, 12);
				var avatar2 = String(args.avatar || "").slice(0, 24);
				if (avatar2 && !compat.hasCharacter(avatar2)) {
					emit("error", { message: "头像武将「" + avatar2 + "」本机没有(扩展未装或未启用)——先选本机已有的武将,或在游戏里启用对应扩展" });
					break;
				}
				nnk.modules.config.set("onlineName", name2);
				nnk.modules.config.set("onlineAvatar", avatar2);
				compat.applyIdentity();
				emit("identity_applied", {
					name: name2,
					avatar: avatar2 && nnk.env.lib.translate[avatar2] ? nnk.env.lib.translate[avatar2] : avatar2
				});
				break;
			}
			case "cancel":
				if (nnk.modules.consent) nnk.modules.consent.cancelAll();
				host.cancelAll();
				guest.cancelJoin();
				setPhase("idle");
				emit("cancelled");
				break;
			default:
				emit("error", { message: "未知命令: " + cmd.action });
		}
	}

	/* 命令执行报错时把堆栈前几行带回工坊——引擎/扩展深处的错误只有堆栈能定位 */
	async function executeSafe(cmd, context) {
		try {
			return await dispatch(cmd, context);
		} catch (err) {
			if (!context.isCurrent()) return;
			console.error("[联机助手] 命令执行失败:", cmd.action, err);
			var stack = "";
			try {
				stack = String(err.stack || "").split("\n").slice(1, 4).join(" ← ").trim();
			} catch (e2) { /* 取不到就只报消息 */ }
			var detail = { cmd: cmd.action, message: (err.message || String(err)) + (stack ? "  @" + stack : "") };
			if (cmd.action === "set_config" && cmd.args && cmd.args.key === "mqttUrl") {
				detail.key = "mqttUrl";
				if (typeof cmd.args.requestId === "string" && cmd.args.requestId.length > 0 && cmd.args.requestId.length <= 160 && !/[\x00-\x1f\x7f]/.test(cmd.args.requestId)) detail.requestId = cmd.args.requestId;
			}
			context.emit("error", detail);
		}
	}

	function enqueueCommand(cmd, binding, bridgeEpoch, generation) {
		if (stopped || bridgeEpoch !== epoch) return Promise.resolve();
		return new Promise(function(resolve) {
			commandQueue.push({ command: cmd, binding: binding, epoch: bridgeEpoch, generation: generation === undefined ? bindingGeneration : generation, resolve: resolve });
			drainCommands();
		});
	}

	function drainCommands() {
		if (commandRunner || stopped || !commandQueue.length) return;
		var runner = { epoch: epoch, waiting: false }; commandRunner = runner;
		(async function() {
			while (!stopped && runner.epoch === epoch && commandQueue.length) {
				var item = commandQueue.shift(); runner.active = item;
				try {
					if (item.epoch !== epoch || item.generation !== bindingGeneration) continue;
					var verified = item.binding ? await readBridgeConfig() : cfg;
					if (stopped || item.epoch !== epoch || item.generation !== bindingGeneration) continue;
					if (item.binding && !verified) {
						/* Unknown is not revoked: keep the received head and retry on a later poll. */
						commandQueue.unshift(item); item = null; runner.waiting = true; break;
					}
					if (item.binding && !sameBinding(item.binding, verified)) continue;
					item.resolve(await executeSafe(item.command, captureContext()));
				} finally { if (item) item.resolve(); runner.active = null; }
			}
		})().catch(function(error) {
			if (!stopped && runner.epoch === epoch) emit('error', { message: '本机操作执行失败：' + String(error.message || error) });
		}).finally(function() {
			if (commandRunner === runner) { commandRunner = null; if (!runner.waiting) drainCommands(); }
		});
	}

	function dispatchSafe(cmd) { return enqueueCommand(cmd, cfg, epoch); }

	async function poll() {
		if (polling || stopped) {
			return;
		}
		polling = true;
		var capturedEpoch = epoch;
		var latest = await readBridgeConfig();
		if (stopped || capturedEpoch !== epoch || !latest) { if (capturedEpoch === epoch) polling = false; return; }
		/* 本地绑定文件是显式绑定的依据；切换凭据时不转送前一实例的私有事件。 */
		var binding = cfg, generation = bindingGeneration;
		drainCommands();
		controller = new AbortController();
		var requestController = controller;
		var deadline = setTimeout(function() { requestController.abort(); }, 2500);
		var batch = backlog.concat(events.splice(0, events.length));
		backlog = batch;   /* 先记账:这一批没确认送达前都算欠着 */
		var req;
		try {
			req = fetch(cfg.baseUrl + "/online/bridge", {
				method: "POST",
				signal: controller.signal,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					token: cfg.token,
					commandCapacity: Math.max(0, maxPendingCommands - commandQueue.length - (commandRunner ? 1 : 0)),
					kernel: (function() {
						var role = "";
						try {
							if (nnk.state.guest && nnk.state.guest.session) {
								role = "guest";
							} else if (nnk.state.host && nnk.state.host.active) {
								role = "host";
							}
						} catch (e2) { /* 忽略 */ }
						return { version: nnk.version, build: nnk.build || null, transferPaused: nnk.state.transferPaused === true, transferProtocol: nnk.state.transferProtocol || null, stage: nnk.state.bootStage || "booting", role: role };
					})(),
					/* 邀请码列表的元数据(id/状态/生成时刻/客人名,不含码正文——正文走
					 * 事件流,不给 0.7 秒一轮的心跳塞几 KB 的 SDP)。并进 state 下发:
					 * 工坊读 bridge.state.*,并跟着房间状态一起过期(30 秒宽限) */
					state: Object.assign({}, state, {
						batchProposals: nnk.modules.carrierTransfer ? nnk.modules.carrierTransfer.snapshot().proposals : nnk.modules.consent ? nnk.modules.consent.summaries() : [],
						fileBatches: nnk.modules.carrierTransfer ? nnk.modules.carrierTransfer.snapshot().files : nnk.modules.batch ? nnk.modules.batch.snapshot() : [],
						batchFilesPaused: nnk.modules.carrierTransfer ? nnk.state.transferPaused === true : !nnk.modules.batch || nnk.modules.batch.paused,
						invites: (function() {
							try {
								var hs = nnk.state.host;
								return ((hs && hs.invites) || []).map(function(it) {
									return { id: it.id, status: it.status, at: it.at, guest: it.guest || "", note: it.note || "" };
								});
							} catch (e3) {
								return [];
							}
						})()
					}),
					cfg: {
						transferLimitMB: confirmedTransferLimitMB,
						autoTransfer: confirmedAutoTransfer,
						unlockUIExtensions: !!nnk.modules.config.get("unlockUIExtensions"),
						autoUnlockExtensions: !!nnk.modules.config.get("autoUnlockExtensions"),
						root: !!(nnk.networkProfile ? nnk.networkProfile.root : nnk.modules.compat && nnk.modules.compat.gameRoot()),
						/* 虚拟网卡直连(Radmin/ZeroTier 等):自动生效、无需开关,
						 * 这里上报检测结果,工坊面板显示"已就绪"让用户看得见 */
						virtualIps: (function() {
							try {
								return (nnk.modules.rtc && nnk.modules.rtc.virtualIps) ? nnk.modules.rtc.virtualIps() : [];
							} catch (e4) {
								return [];
							}
						})(),
						/* 上报对端候选类型及往返延迟：host 为局域网直连，srflx 为公网打洞，relay 为中继。 */
						link: (function() {
							try {
								return (nnk.modules.rtc && nnk.modules.rtc.currentLink) ? nnk.modules.rtc.currentLink() : null;
							} catch (e5) {
								return null;
							}
						})(),
						/* 人物标识:工坊靠它回填输入框、插件靠它判断要不要离线补发 */
						onlineName: String(nnk.modules.config.get("onlineName") || ""),
						onlineAvatar: String(nnk.modules.config.get("onlineAvatar") || ""),
						/* 信令服务器当前生效值(自定义或默认) */
						mqttUrl: String(nnk.modules.config.get("mqttUrl") || "")
					},
					events: batch
				})
			});
		} catch (err) {
			failures++;   /* fetch 同步抛错(地址非法等):下一轮照常重试 */
			clearTimeout(deadline);
			polling = false;
			return;
		}
		req.then(function(r) {
			if (!r.ok) {
				throw new Error("HTTP " + r.status);
			}
			failures = 0;
			if (stopped || capturedEpoch !== epoch) throw Error("旧桥响应已失效");
			return r.json();
		}).then(async function(body) {
			if (stopped || capturedEpoch !== epoch) return;
			/* 旧端口的延迟应答不能在用户更换绑定后继续下发命令。 */
			await readBridgeConfig();
			if (stopped || capturedEpoch !== epoch) return;
			if (generation === bindingGeneration) backlog = [];   /* 收到送达确认后清空本次发送的事件积压。 */
			var cmds = body && Array.isArray(body.commands) ? body.commands : [];
			for (var i = 0; i < cmds.length; i++) enqueueCommand(cmds[i], binding, capturedEpoch, generation);
		}).catch(function(err) {
			if (stopped || capturedEpoch !== epoch) return;
			failures++;
			if (failures === 3 || failures === 10) {
				console.warn("[联机助手] 桥暂时不通(" + failures + " 次):", err && err.message);
			}
		}).then(function() {
			clearTimeout(deadline);
			if (controller === requestController) controller = null;
			if (capturedEpoch === epoch) polling = false;
		});
	}

	window.addEventListener("pagehide", function() { nnk.modules.bridge.stop("document retired"); }, {once: true});
	nnk.modules.bridge = {
		init: async function(options) {
			if (timer || cfg || initializing) throw Error("同一窗口桥已启动");
			initializing = true;
			stopped = false; var initEpoch = ++epoch; commandOverride = options && options.dispatch || null;
			var c = await readBridgeConfig();
			initializing = false;
			if (stopped || epoch !== initEpoch) return;
			cfg = c;
			if (c) {
				console.log("[联机助手] 心跳桥就绪: " + c.baseUrl);
			} else {
				console.log("[联机助手] 等待有效桥配置，可在工坊绑定到当前 DSH");
			}
			var pending = options && options.pendingCommands || [];
			for (var i = 0; i < pending.length; i++) enqueueCommand(pending[i], c, initEpoch);
			poll();
			timer = setInterval(poll, c && c.intervalMs || 700);
		},
		beforeTransition: async function() {
			var deadline = Date.now() + 10000, capturedEpoch = epoch;
			while (ordinaryOperations) {
				if (stopped || capturedEpoch !== epoch) throw Error("旧文档配置操作已失效");
				var resources = ordinaryOperations.pendingSnapshot();
				if (!resources.pendingExecutions && !resources.pendingNative) return;
				if (Date.now() >= deadline) throw Error("原配置写入尚未完成，本次载入已停止");
				await new Promise(function(resolve) { setTimeout(resolve, 25); });
			}
		},
		stop: function(reason) {
			stopped = true; epoch++; polling = false; if (timer) clearInterval(timer); timer = null;
			if (controller) controller.abort(reason); controller = null; cfg = null; commandOverride = null;
			configControllers.forEach(function(pending) { pending.abort(reason); }); configControllers.clear();
			commandQueue.splice(0).forEach(function(item) { item.resolve(); });
			if (commandRunner && commandRunner.active) commandRunner.active.resolve(); commandRunner = null;
			if (ordinaryOperations) ordinaryOperations.dispose(reason); ordinaryOperations = null;
		},
		dispatchSafe: dispatchSafe,
		snapshot: function() { return { stopped: stopped, polling: polling, timer: !!timer, events: events.length, backlog: backlog.length, commandPending: commandQueue.length, commandRunning: !!commandRunner, state: Object.assign({}, state) }; },
		captureContext: captureContext,
		emit: emit,
		setPhase: setPhase
	};
})();

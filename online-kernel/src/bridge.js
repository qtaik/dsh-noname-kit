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
	var state = { phase: "idle", ts: Date.now() };

	function emit(type, data) {
		seq++;
		events.push({ seq: seq, type: type, data: data || null, ts: Date.now() });
		if (events.length > 100) {
			events.splice(0, events.length - 100);
		}
	}

	function setPhase(phase, extra) {
		state = Object.assign({ phase: phase, ts: Date.now() }, extra || {});
	}

	function readBridgeConfig() {
		var url = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/nnk-bridge.json";
		return fetch(url, { cache: "no-store" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.catch(function() { return null; });
	}

	function dispatch(cmd) {
		var host = nnk.modules.host;
		var guest = nnk.modules.guest;
		var args = cmd.args || {};
		switch (cmd.action) {
			case "create_room":
				host.createInternetRoom(args.mode, args.signaling);
				break;
			case "join_room":
				guest.joinByRoomCode(args.code);
				break;
			case "invite_refresh":
				host.refreshInvite();
				break;
			case "accept_answer":
				host.acceptAnswer(args.code);
				break;
				case "join_invite":
					guest.joinByInvite(args.code);
					break;
				case "transfer_pack":
					if (nnk.modules.transfer) {
						nnk.modules.transfer.start(args.name);
					}
					break;
				case "clear_quarantine":
					if (nnk.modules.compat) {
						nnk.modules.compat.clearQuarantine();
					}
					break;
				case "set_config": {
					/* 只放行允许工坊改的内核配置键,值做强转 */
					var allowed = { unlockUIExtensions: "boolean", autoUnlockExtensions: "boolean" };
					if (allowed.hasOwnProperty(args.key)) {
						nnk.modules.config.set(args.key, args.value === true);
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
						emit("error", { message: "头像武将不存在: " + avatar2 + "(可能是对面补传还没完成,先选本机已有的武将)" });
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
	function dispatchSafe(cmd) {
		try {
			dispatch(cmd);
		} catch (err) {
			console.error("[联机助手] 命令执行失败:", cmd.action, err);
			var stack = "";
			try {
				stack = String(err.stack || "").split("\n").slice(1, 4).join(" ← ").trim();
			} catch (e2) { /* 取不到就只报消息 */ }
			emit("error", { cmd: cmd.action, message: (err.message || String(err)) + (stack ? "  @" + stack : "") });
		}
	}

	function poll() {
		if (!cfg) {
			return;
		}
		fetch(cfg.baseUrl + "/online/bridge", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				token: cfg.token,
				kernel: { version: nnk.version },
				state: state,
				cfg: {
					unlockUIExtensions: !!nnk.modules.config.get("unlockUIExtensions"),
					autoUnlockExtensions: !!nnk.modules.config.get("autoUnlockExtensions"),
					root: !!(nnk.modules.compat && nnk.modules.compat.gameRoot()),
					/* 人物标识:工坊靠它回填输入框、插件靠它判断要不要离线补发 */
					onlineName: String(nnk.modules.config.get("onlineName") || ""),
					onlineAvatar: String(nnk.modules.config.get("onlineAvatar") || "")
				},
				events: events.splice(0, events.length)
			})
		}).then(function(r) {
			if (!r.ok) {
				throw new Error("HTTP " + r.status);
			}
			failures = 0;
			return r.json();
		}).then(function(body) {
			var cmds = body && body.commands || [];
			cmds.forEach(dispatchSafe);
		}).catch(function(err) {
			failures++;
			if (failures === 3 || failures === 10) {
				console.warn("[联机助手] 桥暂时不通(" + failures + " 次):", err && err.message);
			}
		});
	}

	nnk.modules.bridge = {
		init: function() {
			readBridgeConfig().then(function(c) {
				if (!c || !c.baseUrl || !c.token) {
					console.log("[联机助手] 未找到桥配置(nnk-bridge.json),无头待机(联机操作不可用,重新安装内核可修复)");
					return;
				}
				cfg = c;
				console.log("[联机助手] 心跳桥就绪: " + c.baseUrl);
				poll();
				timer = setInterval(poll, c.intervalMs || 700);
			});
		},
		emit: emit,
		setPhase: setPhase
	};
})();

/* Legacy 补传实现仅保留供消息兼容处理，自动发送、手动发送和内容接收入口均关闭。当前补传由批次事务协议处理，不允许降级到此模块。保留的实现通过 ready/done 回执、背压、逐块写入及单文件摘要校验处理旧消息；缺少逐请求授权与整批原子提交保障，不能用于接收扩展文件。 */
(function() {
	var nnk = window.__nnk__;
	/* Legacy 补传入口固定关闭，配置、版本字段及 ready/done 回执均不能解除。 */
	var TRANSFER_PAUSED = true;
	var PAUSE_CODE = "TRANSFER_PAUSED";
	var PAUSE_REASON = "补传已暂停：旧协议缺少客人逐请求授权与整批完整性／回滚保障。正常联机及扩展体检仍可使用，缺包可能影响对局兼容性；安全补传协议完成前不允许 legacy 降级。";
	var rejectedIds = []; /* 有界去重:旧房主继续灌块时不逐块刷屏/回执。 */
	function reportPaused(name) {
		try { bridgeApi().emit("transfer_failed", { name: name, code: PAUSE_CODE, message: PAUSE_REASON }); } catch (e) { /* 不影响对局派发 */ }
	}
	function rejectIncoming(msg, force) {
		var id = msg && typeof msg.id === "number" ? msg.id : null;
		if (!force && rejectedIds.indexOf(id) >= 0) return;
		if (rejectedIds.indexOf(id) < 0) {
			rejectedIds.push(id);
			if (rejectedIds.length > 16) rejectedIds.shift();
		}
		reportPaused(msg && typeof msg.name === "string" ? msg.name : "");
		if (id !== null) sendAck(id, "fail", PAUSE_REASON, PAUSE_CODE);
	}
	var CHUNK = 48 * 1024;           /* 二进制块大小(b64 后 64KB,远小于 DC 消息上限) */
	var BUFFER_LIMIT = 256 * 1024;   /* 通道积压超过 256KB 就等(保对局消息优先) */
	var KERNEL_NAME = "联机助手";
	var INTEGRITY = "sha256-v1"; /* 休眠协议拒绝无摘要的旧清单;不代表授权协议。 */
	/* 回执时限为游戏重载、开局及选将期间的主线程繁忙预留时间，避免将消息处理延迟判断为无响应。 */
	var ACK_TIMEOUT = 6000;          /* 等客人 ready 回执的上限 */
	var DONE_TIMEOUT = 12000;        /* 等客人 done 回执的上限 */
	/* 背压等待上限为 45 秒，超时后报告消费过慢或无响应，为慢网及对端主线程繁忙预留处理时间。 */
	var STALL_TIMEOUT = 45000;       /* 背压等待的上限(对端半死时不再永久卡住) */

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	function nodeRequire() {
		try {
			if (typeof window.require === "function") {
				return window.require;
			}
		} catch (e) { /* 忽略 */ }
		return typeof require === "function" ? require : null;
	}

	/* 定位游戏根目录:统一走 compat 的实现(分类与补包必须一致) */
	function gameRoot() {
		return nnk.modules.compat ? nnk.modules.compat.gameRoot() : null;
	}

	function safeName(name) {
		return typeof name === "string" && /^[^\\\/:*?"<>|]+$/.test(name) && name !== KERNEL_NAME && name !== "." && name !== "..";
	}

	function safeRel(rel) {
		return typeof rel === "string" && rel.indexOf("..") < 0 && !/^[\\\/]/.test(rel) && rel.indexOf(":") < 0;
	}

	function bytesToB64(bytes) {
		var bin = "";
		for (var i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(bin);
	}

	function limitBytes() {
		var configured = Number(nnk.modules.config.get("transferLimitMB"));
		return Math.min(1024, Number.isFinite(configured) && configured > 0 ? configured : 300) * 1048576;
	}

	function currentBridges() {
		var hostState = nnk.state.host;
		return (hostState && hostState.bridges) || [];
	}

	function bridgeId(b) {
		/* 两种入参都吃:HostBridge 本身,或引擎的 Client(Client.ws 就是 HostBridge——
		 * game.broadcast 与 lib.message.server 的处理函数拿到的都是 Client)。
		 * RTCDataChannel.label 两端同名 "nnk-link",不能当身份,必须用实例代号 */
		try {
			if (b && b.ws && b.ws.bridgeId) {
				return b.ws.bridgeId;
			}
			return (b && b.bridgeId) ? b.bridgeId : null;
		} catch (e) {
			return null;
		}
	}

	/* 定向发送:message 里带 sendTo(本次传输的目标通道 label 列表)时,只发给
	 * 名单内的通道自己 send。名单为空=没有可定向的通道(对端内核过旧/通道全断)
	 * 时直接不发——早先这里退回 game.broadcast,但联机模式下广播开门就 return
	 * (game.online 门禁),旧对端也不懂 ready/done 协议,那条"兜底"只会把
	 * 1.9.0 修掉的"广播即成功"假象带回来。没通道由 startOne 前置失败 */
	function sendToBridges(func, payload) {
		if (!payload.sendTo || !payload.sendTo.length) {
			return;
		}
		var bridges = enteredBridges();
		bridges.forEach(function(b) {
			var id = bridgeId(b);
			if (id && payload.sendTo.indexOf(id) >= 0) {
				try { b.send(JSON.stringify([func, payload])); } catch (e2) { /* 单条失败不拖累其他 */ }
			}
		});
	}

	/* ---- 房主侧:补传队列(自动补传 = 一次入队全部缺失,逐个传) ---- */
	var txSeq = 0;
	var txQueue = [];      /* 队列项 { name, only }:only=本次只发给这一条通道
	                        * (清单补传按上报者定向——发给全体会把缺包客人 A 的
	                        * 扩展强推给没缺包的 B、覆盖 B 本地同名文件) */
	var txBusy = false;
	var txCurrent = null;  /* 正在传的队列项:防同名重复入队重复传 */
	var ackWait = null;     /* { id, need:[bridgeId], got:{}, resolve, timer, func } */
	var ackFailReason = ""; /* 客人明确回 fail 时带的原因(onAck 收下,startOne 用来播报) */

	/* 客人的 ready/done/fail 回执(由 install 注册到 lib.message.server) */
	function onAck(msg) {
		if (!msg || typeof msg.id !== "number") {
			return;
		}
		if (ackWait && ackWait.id === msg.id && msg.type === "fail") {
			/* 客人明确报告接收失败(不完整/体积超限/落盘失败):立刻收场带回原因,
			 * 别让房主干等超时后报一句笼统的"没等到回执" */
			var wf = ackWait;
			ackWait = null;
			clearTimeout(wf.timer);
			ackFailReason = msg.reason || "";
			wf.resolve(false);
			return;
		}
		if (ackWait && ackWait.id === msg.id && ackWait.func === msg.type) {
			try {
				var id = bridgeId(this);   /* 引擎把 client 传进来:bridgeId 挂在 HostBridge 上 */
				if (id !== null && ackWait.need.indexOf(id) >= 0 && !ackWait.got[id]) {
					ackWait.got[id] = true;
				} else if (id === null || ackWait.need.indexOf(id) < 0) {
					for (var i = 0; i < ackWait.need.length; i++) {
						if (!ackWait.got[ackWait.need[i]]) {
							ackWait.got[ackWait.need[i]] = true;
							break;
						}
					}
				}
			} catch (e) { /* 回执归属判定失败:按"收到一个"降级 */ }
			if (ackWait.need.every(function(n) { return ackWait.got[n]; })) {
				var w = ackWait;
				ackWait = null;
				clearTimeout(w.timer);
				w.resolve(true);
			}
		}
	}

	/* 本次发送固定目标客人名单；等待回执时仅检查名单中当前已由引擎接管的通道，排除停泊、排队及发送开始后才加入的客人。 */
	function enteredBridges() {
		return currentBridges().filter(function(b) { return b._entered === true; });
	}

	function waitAcks(id, func, timeoutMs, targets) {
		var live = {};
		enteredBridges().forEach(function(b) {
			var i2 = bridgeId(b);
			if (i2 !== null) {
				live[i2] = true;
			}
		});
		var need = (targets || enteredBridges().map(bridgeId)).filter(function(x) {
			return x !== null && x !== undefined && live[x];
		});
		ackFailReason = "";
		if (!need.length) {
			return Promise.resolve(false);
		}
		return new Promise(function(resolve) {
			var timer = setTimeout(function() {
				if (ackWait && ackWait.id === id) {
					ackWait = null;
				}
				resolve(false);
			}, timeoutMs);
			ackWait = { id: id, func: func, need: need, got: {}, timer: timer, resolve: resolve };
		});
	}

	function startTransfer(name, only) {
		if (TRANSFER_PAUSED) {
			reportPaused(Array.isArray(name) ? name.join("、") : (typeof name === "string" ? name : ""));
			return 0;
		}
		var list = Array.isArray(name) ? name : [name];
		var queued = 0;
		var nowTs = Date.now();
		Object.keys(txDone).forEach(function(k) {   /* 顺带剪掉过期记录(只写不清理会缓慢涨) */
			if (nowTs - txDone[k] > TX_DONE_TTL) {
				delete txDone[k];
			}
		});
		var targets = (only === undefined || only === null)
			? enteredBridges()
			: currentBridges().filter(function(b) { return bridgeId(b) === only; });
		for (var i = 0; i < list.length; i++) {
			/* 正在传的同名(同目标)不再排队;对"目标客人"都已传过的也不再排 */
			var allDone = targets.length > 0 && targets.every(function(b) {
				var at = txDone[doneKey(b, list[i])];
				return typeof at === "number" && (Date.now() - at) < TX_DONE_TTL;
			});
			var dup = (txCurrent && txCurrent.name === list[i] && txCurrent.only === (only || null))
				|| txQueue.some(function(e2) { return e2.name === list[i] && e2.only === (only || null); });
			if (!dup && !allDone) {
				txQueue.push({ name: list[i], only: only || null });
				queued++;
			}
		}
		pumpQueue();
		return queued;
	}

	var txDone = {};   /* "bridgeId|扩展名" -> 成功补传时间:防同一客人重连重复传,
	                    * 但 30 分钟后失效;按客人区分——否则第二位客人 30 分钟内
	                    * 加入时会被静默跳过(他真缺包却什么都收不到) */
	var TX_DONE_TTL = 30 * 60 * 1000;
	function doneKey(bridge, name) {
		return String(bridgeId(bridge)) + "|" + name;
	}

	function pumpQueue() {
		if (txBusy) {
			return;
		}
		var next = txQueue.shift();
		if (!next) {
			return;
		}
		txBusy = true;
		txCurrent = next;
		var served = next.only
			? [next.only]
			: enteredBridges().map(bridgeId);
		startOne(next.name, function(ok) {
			if (ok) {
				/* 记到参与本次传输的每位客人名下:同一位客人重连不重传,新客人照传 */
				served.forEach(function(bid) {
					if (bid) {
						txDone[bid + "|" + next.name] = Date.now();
					}
				});
			}
			txBusy = false;
			txCurrent = null;
			pumpQueue();
		}, next.only);
	}

	function startOne(name, done, only) {
		var fail = function(message) {
			bridgeApi().emit("transfer_failed", { name: name, message: message });
			done(false);
		};
		if (!currentBridges().length) {
			txQueue = [];
			return fail("没有已连接的客人,补传中止");
		}
		if (!safeName(name)) {
			return fail("扩展名不合法:" + name);
		}
		var req = nodeRequire();
		if (!req) {
			return fail("本游戏环境没有 Node 文件能力,补包不可用——补包需要官方版无名杀(Electron 外壳);可以请房主把游戏目录 extension/<扩展名> 整个文件夹拷给你,放到同样位置");
		}
		var fs = req("fs");
		var path = req("path");
		var root = gameRoot();
		if (!root) {
			return fail("定位游戏根目录失败,补包不可用——请确认游戏本体是官方版结构(resources/app 下能看到 extension/ 目录);也可以请房主手动拷贝扩展文件夹");
		}
		var dir = path.join(root, "extension", name);
		if (!fs.existsSync(dir)) {
			return fail("本地没有这个扩展:" + name);
		}
		/* 收集文件清单与总体积 */
		var files = [];
		var total = 0;
		var skipped = 0;   /* 符号链接/junction 等非常规条目:悄悄少发会让客人缺文件还报成功 */
		var limit = limitBytes();
		try {
			(function walk(dir2, rel) {
				fs.readdirSync(dir2, { withFileTypes: true }).forEach(function(entry) {
					var r = rel ? rel + "/" + entry.name : entry.name;
					var full = path.join(dir2, entry.name);
					if (entry.isDirectory()) {
						walk(full, r);
					} else if (entry.isFile()) {
						var size = fs.statSync(full).size;
						total += size;
						if (total > limit) {
							throw new Error("体积超过上限(" + Math.round(limit / 1048576) + "MB),取消补传——这个扩展太大,请让房主把 extension/<扩展名> 文件夹打包发给你,手动放到同样位置");
						}
						var sha256 = req("crypto").createHash("sha256").update(fs.readFileSync(full)).digest("hex");
						files.push({ rel: r, size: size, full: full, sha256: sha256 });
					} else {
						skipped++;
					}
				});
			})(dir, "");
		} catch (err) {
			return fail((err && err.message) || String(err));
		}
		if (skipped > 0) {
			return fail("有 " + skipped + " 个符号链接/非常规条目无法补传(会发出残缺副本),请手动拷贝该扩展");
		}
		if (!files.length) {
			return fail("这个扩展目录是空的:" + name);
		}

		var id = ++txSeq;
		var sendTo = (only === undefined || only === null)
			? enteredBridges().map(bridgeId).filter(function(x) { return x !== null; })
			: [only];
		if (!sendTo.length) {
			return fail("没有可定向的客人通道(对方内核可能过旧,请双方都升级到最新内核)");
		}
		/* 记录本次等待回执的客人名单；传输开始后新加入的客人不计入本次等待。 */
		var ackTargets = only ? [only] : enteredBridges().map(bridgeId).filter(function(x) { return x !== null; });
		var head = {
			id: id,
			integrity: INTEGRITY,
			name: name,
			total: total,
			sendTo: sendTo,
			files: files.map(function(f) { return { rel: f.rel, size: f.size, sha256: f.sha256 }; })
		};
		bridgeApi().emit("transfer_begin", { name: name, files: files.length, total: total });
		console.log("[联机助手] 开始补传扩展「" + name + "」:" + files.length + " 个文件," + Math.round(total / 1024) + "KB,等客人就绪…");
		sendToBridges("nnk_tx_begin", head);

		/* 等 ready 回执:没人应答就明确失败——绝不谎报"已补传" */
		waitAcks(id, "ready", ACK_TIMEOUT, ackTargets).then(function(ready) {
			if (!ready) {
				return fail(ackFailReason ? ("客人拒绝接收:" + ackFailReason) : "客人没有响应补传(可能还在进入房间的过程中)——请让客人重新加入后再试,或让他重启游戏后重试");
			}
			if (!currentBridges().length) {
				return fail("客人已全部断开,补传中止");
			}
			/* 逐块发送状态机:每块都检查通道积压,超限就暂停等待(保对局消息优先) */
			var fi = 0;
			var off = 0;
			var fileData = null;
			var waiting = false;
			var waitSince = 0;
			var gatesBlocked = function() {
				var bridges = enteredBridges().filter(function(b) { return sendTo.indexOf(bridgeId(b)) >= 0; });
				for (var i = 0; i < bridges.length; i++) {
					try {
						if (bridges[i].channel && bridges[i].channel.bufferedAmount > BUFFER_LIMIT) {
							return true;
						}
					} catch (e) { /* 通道已关,由异常路径处理 */ }
				}
				return false;
			};
			var step = function() {
				if (waiting) {
					return;
				}
				if (!currentBridges().length) {
					return fail("客人已全部断开,补传中止");
				}
				if (gatesBlocked()) {
					if (!waitSince) {
						waitSince = Date.now();
					} else if (Date.now() - waitSince > STALL_TIMEOUT) {
						return fail("通道积压太久(对端消费过慢或已无响应),补传中止——让客人确认游戏没卡死,稍后可再点一次「📦 补传」");
					}
					waiting = true;
					setTimeout(function() {
						waiting = false;
						step();
					}, 40);
					return;
				}
				waitSince = 0;
				try {
					var file = files[fi];
					if (!fileData) {
						fileData = fs.readFileSync(file.full);
						if (fileData.length !== file.size || req("crypto").createHash("sha256").update(fileData).digest("hex") !== file.sha256) {
							return fail("文件在清单生成后发生变化,补传中止");
						}
						sendToBridges("nnk_tx_file", { id: id, name: name, rel: file.rel, size: file.size, sha256: file.sha256, sendTo: sendTo });
					}
					var end = Math.min(off + CHUNK, fileData.length);
					sendToBridges("nnk_tx_data", { id: id, rel: file.rel, b64: bytesToB64(fileData.subarray(off, end)), sendTo: sendTo });
					off = end;
					if (off >= fileData.length) {
						fi++;
						off = 0;
						fileData = null;
						if (fi >= files.length) {
							/* 数据发完,等客人 done 回执再宣布完成 */
							sendToBridges("nnk_tx_done", { id: id, name: name, sendTo: sendTo });
							return waitAcks(id, "done", DONE_TIMEOUT, ackTargets).then(function(acked) {
								if (!acked) {
									return fail(ackFailReason ? ("客人报告补传失败:" + ackFailReason) : "数据已发完,但没等到客人的完成回执——请让客人重开游戏后再试");
								}
								bridgeApi().emit("transfer_done", { name: name });
								console.log("[联机助手] 补传完成:「" + name + "」(客人重启游戏后重新加入)");
								done(true);
							});
						}
					}
					step();
				} catch (err) {
					console.error("[联机助手] 补传失败:", err);
					return fail((err && err.message) || String(err));
				}
			};
			step();
		});
	}

	/* ---- 客人侧:接收落盘(边收边写,不攒内存) ---- */
	var rx = null;   /* { id, name, rel, size, got, pending, fd, tmp, total, doneBytes, reported } */

	function resetRx() {
		if (!rx) {
			return;
		}
		try {
			if (rx.fd !== null) {
				var req = nodeRequire();
				if (req) {
					req("fs").closeSync(rx.fd);
				}
			}
		} catch (e) { /* 忽略 */ }
		rx.fd = null;
	}

	function clientHandlers() {
		return {
			nnk_tx_begin: function(msg) {
				if (TRANSFER_PAUSED) { rejectIncoming(msg, true); return; }
				try {
					nnk.modules.transfer.begin(msg);
				} catch (e) { /* 形状不对:忽略,不影响对局 */ }
			},
			nnk_tx_file: function(msg) {
				if (TRANSFER_PAUSED) { rejectIncoming(msg, false); return; }
				try {
					if (!msg || !safeName(msg.name)) {
						return;
					}
					if (!rx || rx.id !== msg.id) {
						return;
					}
					/* 上一个文件收尾;收尾失败会清 rx,这里必须重新判空——
					 * 否则下面的 rx.rel 赋值直接抛错,异常还会逃出引擎的消息派发链 */
					flushFile();
					if (!rx) {
						return;
					}
					var expected = rx.files[msg.rel];
					if (!safeRel(msg.rel) || !expected || rx.received[msg.rel] || msg.size !== expected.size || msg.sha256 !== expected.sha256) {
						/* 记录被拒文件，结束传输时据此返回失败，避免漏传仍报成功。 */
						rx.rejectedFiles += 1;
						return;
					}
					rx.rel = msg.rel;
					rx.size = msg.size;
					rx.sha256 = expected.sha256;
					rx.got = 0;
					startFileWrite();
				} catch (e) { /* 内核消息处理器必须自保(引擎派发不在 try 内) */ }
			},
			nnk_tx_data: function(msg) {
				if (TRANSFER_PAUSED) { rejectIncoming(msg, false); return; }
				try {
					if (!rx || !msg || msg.id !== rx.id || msg.rel !== rx.rel) {
						return;
					}
					var bin = atob(msg.b64);
					var bytes = new Uint8Array(bin.length);
					for (var i = 0; i < bin.length; i++) {
						bytes[i] = bin.charCodeAt(i);
					}
					writeChunk(bytes);
					rx.got += bytes.length;
					rx.doneBytes += bytes.length;
					if (rx.got > rx.size) {
						bridgeApi().emit("transfer_failed", { name: rx.name, message: "收到的数据超过声明大小,接收中止" });
						abortRx();
						return;
					}
					reportProgress();
				} catch (e) { /* 同上:自保 */ }
			},
			nnk_tx_done: function(msg) {
				if (TRANSFER_PAUSED) { rejectIncoming(msg, false); return; }
				try {
					if (!rx || !msg || msg.id !== rx.id) {
						return;
					}
					var id = rx.id;
					var name = rx.name;
					var ok = flushFile();
					if (!ok) {
						/* 落盘校验失败:明确回 fail(房主立刻收场报原因,不干等超时) */
						sendAck(id, "fail", "落盘校验失败,文件已丢弃");
						return;
					}
					var rejected = rx.rejectedFiles;
					var doneFiles = rx.doneFiles;
					var expect = rx.expectCount;
					/* 仅在清单中的每个文件都完成摘要验证与落盘后返回成功。 */
					if (rejected > 0 || doneFiles !== expect) {
						var why = rejected > 0
							? (rejected + " 个文件名不合法,无法接收")
							: ("只收齐 " + doneFiles + "/" + expect + " 个文件");
						bridgeApi().emit("transfer_failed", { name: name, message: "接收不完整(" + why + ")" });
						sendAck(id, "fail", why);
						rx = null;
						return;
					}
					if (rx.reported < 100) bridgeApi().emit("transfer_progress", { name: name, pct: 100, side: "guest" });
					bridgeApi().emit("transfer_done", { name: name, side: "guest" });
					console.log("[联机助手] 补包接收完成:「" + name + "」,重启游戏后重新加入");
					sendAck(id, "done");
					rx = null;
				} catch (e) { /* 自保 */ }
			}
		};
	}

	function sendAck(id, type, reason, code) {
		try {
			var ack = { id: id, type: type, reason: reason || "" };
			if (code) ack.code = code;
			nnk.env.game.send("nnk_tx_ack", ack);
		} catch (e) { /* 忽略 */ }
	}

	/* 开始写一个新文件:目标先写临时文件,收齐校验字节数后 rename 到位 */
	function startFileWrite() {
		var req = nodeRequire();
		if (!req) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "本游戏环境没有 Node 文件能力,接收中止——补包需要官方版无名杀(Electron 外壳);可请房主手动拷贝扩展文件夹" });
			rx = null;
			return;
		}
		var fs = req("fs");
		var path = req("path");
		var root = gameRoot();
		if (!root) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "定位游戏根目录失败,接收中止——请确认游戏本体是官方版结构;也可请房主手动拷贝扩展文件夹" });
			rx = null;
			return;
		}
		try {
			var target = path.join(root, "extension", rx.name, rx.rel);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			rx.target = target;
			rx.skip = false;
			rx.hash = req("crypto").createHash("sha256");
			rx.tmp = target + ".nnk-part";
			try { fs.unlinkSync(rx.tmp); } catch (e2) { /* 残留清理 */ }
			rx.fd = fs.openSync(rx.tmp, "w");
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "写入失败(磁盘空间/权限?):" + ((err && err.message) || err) + "——腾出空间或关闭占用后重试" });
			rx = null;
		}
	}

	function writeChunk(bytes) {
		if (!rx || rx.skip) {
			return;
		}
		var req = nodeRequire();
		if (!req || rx.fd === null) {
			throw new Error("接收文件未就绪");
		}
		var data = Buffer.from(bytes);
		var offset = 0;
		while (offset < data.length) {
			var written = req("fs").writeSync(rx.fd, data, offset, data.length - offset);
			if (!written) throw new Error("写入没有推进");
			offset += written;
		}
		rx.hash.update(data);
	}

	function abortRx() {
		if (!rx) {
			return;
		}
		resetRx();
		try {
			if (rx.tmp) {
				var req = nodeRequire();
				if (req) {
					req("fs").unlinkSync(rx.tmp);
				}
			}
		} catch (e) { /* 忽略 */ }
		rx = null;
	}

	/* 收尾当前文件:字节数对得上才落到最终位置。返回是否成功。 */
	function flushFile() {
		if (!rx || rx.rel === null) {
			return true;
		}
		try {
			var fs = nodeRequire()("fs");
			resetRx();   /* 关临时文件句柄 */
			/* 即使同尺寸文件跳过写入，也校验实际接收字节数，防止截断数据被当作完整文件。 */
			if (rx.got !== rx.size) {
				bridgeApi().emit("transfer_failed", { name: rx.name, message: "文件「" + rx.rel + "」收齐 " + rx.got + " / " + rx.size + " 字节,不完整,已丢弃" });
				if (rx.tmp) {
					try { fs.unlinkSync(rx.tmp); } catch (e2) { /* 忽略 */ }
				}
				rx = null;
				return false;
			}
			if (rx.hash.digest("hex") !== rx.sha256 || nodeRequire()("crypto").createHash("sha256").update(fs.readFileSync(rx.tmp)).digest("hex") !== rx.sha256) {
				throw new Error("SHA-256 校验失败");
			}
			fs.renameSync(rx.tmp, rx.target);
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "落盘失败(磁盘空间/权限?):" + ((err && err.message) || err) + "——腾出空间或关闭占用后重试" });
			abortRx();
			return false;
		}
		rx.doneFiles += 1;   /* 已接收文件数，由 tx_done 对照清单核验。 */
		rx.received[rx.rel] = true;
		rx.rel = null;
		rx.skip = false;
		return true;
	}

	function reportProgress() {
		if (!rx || !rx.total) {
			return;
		}
		var pct = Math.min(100, Math.round(rx.doneBytes / rx.total * 100));
		/* 每增加 20% 上报一次进度，100% 由 tx_done 统一发送，避免重复尾块重复触发完成通知。 */
		if (pct >= rx.reported + 20) {
			rx.reported = pct;
			bridgeApi().emit("transfer_progress", { name: rx.name, pct: pct, side: "guest" });
			try {
				nnk.env.game.send("nnk_tx_progress", { id: rx.id, name: rx.name, pct: pct });
			} catch (e) { /* 忽略 */ }
		}
	}

	nnk.modules.transfer = {
		paused: TRANSFER_PAUSED,
		pauseReason: PAUSE_REASON,
		install: function() {
			nnk.state.transferPaused = false;
			var lib = nnk.env.lib;
			if (lib.message && lib.message.client) {
				var handlers = clientHandlers();
				for (var key in handlers) {
					if (TRANSFER_PAUSED || !lib.message.client["__nnk" + key]) {
						// 已有 legacy 标记也必须替换,不串接可能写盘的旧处理器。
						lib.message.client[key] = TRANSFER_PAUSED
							? (key === "nnk_tx_begin" ? function(msg) { rejectIncoming(msg, true); } : function(msg) { rejectIncoming(msg, false); })
							: handlers[key];
						lib.message.client["__nnk" + key] = true;
					}
				}
			}
			if (lib.message && lib.message.server) {
				if (TRANSFER_PAUSED) {
					// 迟到的旧 ready/done/progress 不是本版本的成功或进行中状态。
					lib.message.server.nnk_tx_progress = function() {};
					lib.message.server.nnk_tx_ack = function() {};
					lib.message.server.__nnkTxProgress = true;
					lib.message.server.__nnkTxAck = true;
				}
				if (!lib.message.server.__nnkTxProgress) {
					/* 客人 → 房主:接收进度透传给工坊 */
					lib.message.server.nnk_tx_progress = function(msg) {
						try {
							if (msg && typeof msg.pct === "number") {
								bridgeApi().emit("transfer_progress", { name: msg.name, pct: msg.pct, side: "hostview" });
							}
						} catch (e) { /* 忽略 */ }
					};
					lib.message.server.__nnkTxProgress = true;
				}
				if (!lib.message.server.__nnkTxAck) {
					/* 客人 → 房主:ready/done 回执(补传不再"广播即成功") */
					lib.message.server.nnk_tx_ack = function(msg) {
						try {
							onAck.call(this, msg);
						} catch (e) { /* 忽略 */ }
					};
					lib.message.server.__nnkTxAck = true;
				}
			}
			nnk.state.transferPaused = TRANSFER_PAUSED && !!(lib.message && lib.message.client && lib.message.server);
		},
		/* 工坊命令:补传指定扩展(传单个名字或名字数组,自动排队)。
		 * only=只发给这一条通道(清单自动补传按上报者定向,防误覆盖别人的本地包) */
		start: startTransfer,
		/* 通过指定引擎 client 或 HostBridge 的隧道定向发送内核消息；manifest 回执使用此路径，不经过 game.broadcast。 */
		sendDirect: function(client, func, payload) {
			if (TRANSFER_PAUSED && typeof func === "string" && func.indexOf("nnk_tx_") === 0) {
				reportPaused("");
				return false;
			}
			var id = bridgeId(client);
			if (id === null) {
				return false;
			}
			var bridges = enteredBridges();
			for (var i = 0; i < bridges.length; i++) {
				if (bridgeId(bridges[i]) === id) {
					try { bridges[i].send(JSON.stringify([func, payload])); return true; } catch (e) { return false; }
				}
			}
			return false;
		},
		clientId: bridgeId,
		/* 客人侧开始一次接收会话(收到 tx_begin 后:先落会话,再回 ready 回执) */
		begin: function(msg) {
			if (TRANSFER_PAUSED) {
				rejectIncoming(msg, true);
				return;
			}
			if (!msg || msg.integrity !== INTEGRITY || !safeName(msg.name) || !Array.isArray(msg.files) || !msg.files.length) {
				if (msg && typeof msg.id === "number") {
					sendAck(msg.id, "fail", "补传清单格式不对");
				}
				return;
			}
			/* 接收侧也守体积上限:不信房主报的 total(恶意/异常对端不能撑爆客人) */
			var limit = limitBytes();
			var declared = typeof msg.total === "number" && msg.total >= 0 ? msg.total : 0;
			var filesTotal = 0;
			var expectedFiles = Object.create(null);
			for (var i = 0; i < msg.files.length; i++) {
				var f = msg.files[i];
				if (!f || !safeRel(f.rel) || !f.rel || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.sha256 || "") || expectedFiles[f.rel]) {
					sendAck(msg.id, "fail", "补传清单里有非法条目");
					return;   /* 清单形状不对:整单拒收并明确回绝 */
				}
				filesTotal += f.size;
				expectedFiles[f.rel] = { size: f.size, sha256: f.sha256 };
			}
			if (filesTotal > limit || declared > limit) {
				bridgeApi().emit("transfer_failed", { name: msg.name, message: "对方要传的体积超过本机上限(" + Math.round(limit / 1048576) + "MB),已拒绝" });
				sendAck(msg.id, "fail", "体积超过本机上限");
				return;
			}
			abortRx();
			rx = {
				id: msg.id,
				name: msg.name,
				rel: null,
				size: 0,
				got: 0,
				files: expectedFiles,
				received: Object.create(null),
				fd: null,
				tmp: null,
				skip: false,
				total: filesTotal,
				doneBytes: 0,
				reported: 0,
				expectCount: msg.files.length,   /* 清单中预期的文件总数。 */
				doneFiles: 0,
				rejectedFiles: 0
			};
			bridgeApi().emit("transfer_progress", { name: msg.name, pct: 0, side: "guest" });
			sendAck(msg.id, "ready");
		}
	};
})();

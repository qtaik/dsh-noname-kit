/*
 * 自动补包(M4):房主把客人缺少的扩展自动传过去。
 * 流程:客人进房 → 清单交换(manifest)→ 房主算差集 → 自动排队补传全部缺失
 * → 客人落盘 → 提示客人重启游戏、重新输房号加入(重启后清单复查,缺的续传)。
 * 通道复用引擎 ws 消息分发(同 manifest):房主 game.broadcast 分块发,
 * 客人在 lib.message.client 上收块落盘;进度经 game.send 回报房主。
 *
 * ⚠️ 为什么要有 ready/done 双握手(真机实证的坑):
 *   引擎的 game.broadcast 只发给 `client.inited === true` 的客户端
 *   (官方 game/index.js 的 broadcast 里有这个门禁),而客人的"进房→握手→inited"
 *   是一条异步链:内核在 connectNow 里发完清单时,客人多半还没 inited。旧实现
 *   直接广播数据块 → 被引擎静默丢弃 → **一个字节都没落盘,但房主照样播报
 *   「✅ 已补传」**(客人侧仍显示缺失)。更早的版本还踩过"一次灌满通道把客人
 *   踢出房间",所以背压按块检查的逻辑保留。
 *   现在改成:先发 nnk_tx_begin(房间层,引擎握手无关),等客人们回
 *   nnk_tx_ready;超过 3 秒没有任何人应答就明确失败(不再谎报成功)。
 *   收尾同样要等 nnk_tx_done 的客人回执,缺谁就报谁。
 *
 * 文件读写直接用 Node fs——两台测试机的游戏外壳(Electron)渲染进程都是
 * nodeIntegration:true、contextIsolation:false,内核以扩展身份运行在
 * 渲染进程里,window.require 可用。找不到 fs 或定位不到游戏根目录时,
 * 补包不可用并明确报错(体检展示不受影响)。
 *
 * 安全边界:只写 extension/<扩展名>/ 之下;路径拒绝 ..、绝对路径、盘符;
 * 拒绝传本内核(联机助手)自身;总体积上限 = config transferLimitMB(默认 300)。
 * 接收侧同样按上限卡死(不信房主报的 total),并且**边收边写**到临时文件,
 * 落盘前校验累计字节数——不再把整个文件攒在内存里(旧版峰值 ~3× 文件体积)。
 */
(function() {
	var nnk = window.__nnk__;
	var CHUNK = 48 * 1024;           /* 二进制块大小(b64 后 64KB,远小于 DC 消息上限) */
	var BUFFER_LIMIT = 256 * 1024;   /* 通道积压超过 256KB 就等(保对局消息优先) */
	var KERNEL_NAME = "联机助手";
	var ACK_TIMEOUT = 3000;          /* 等客人 ready 回执的上限 */
	var DONE_TIMEOUT = 8000;         /* 等客人 done 回执的上限 */
	var STALL_TIMEOUT = 20000;       /* 背压等待的上限(对端半死时不再永久卡住) */

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
		return (nnk.modules.config.get("transferLimitMB") || 300) * 1024 * 1024;
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

	/* 定向广播:message 里带 sendTo(本次传输的目标通道 label 列表)时,
	 * 只发给名单内的通道自己 send;名单为空(旧对端/拿不到 label)退回引擎广播。 */
	function sendToBridges(func, payload) {
		var bridges = currentBridges();
		if (!payload.sendTo || !payload.sendTo.length) {
			try {
				nnk.env.game.broadcast(func, payload);
			} catch (e) { /* 忽略 */ }
			return;
		}
		bridges.forEach(function(b) {
			var id = bridgeId(b);
			if (id && payload.sendTo.indexOf(id) >= 0) {
				try { b.send(JSON.stringify([func, payload])); } catch (e2) { /* 单条失败不拖累其他 */ }
			}
		});
	}

	/* ---- 房主侧:补传队列(自动补传 = 一次入队全部缺失,逐个传) ---- */
	var txSeq = 0;
	var txQueue = [];
	var txBusy = false;
	var txCurrent = null;   /* 正在传的名字:防同名牌重复入队重复传 */
	var ackWait = null;     /* { id, need:[bridgeId], got:{}, resolve, timer, func } */

	/* 客人的 ready/done 回执(由 install 注册到 lib.message.server) */
	function onAck(msg) {
		if (!msg || typeof msg.id !== "number") {
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

	function waitAcks(id, func, timeoutMs) {
		var need = currentBridges().map(bridgeId).filter(function(x) { return x !== null; });
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

	function startTransfer(name) {
		var list = Array.isArray(name) ? name : [name];
		for (var i = 0; i < list.length; i++) {
			/* 正在传的同名扩展不再排队(手动按钮连点/自动+手动撞车防重复传);
			 * 本会话已传过的也不再排队(客人没重启时的重连会重新上报清单) */
			var doneAt = txDone[list[i]];
			var stillDone = typeof doneAt === "number" && (Date.now() - doneAt) < TX_DONE_TTL;
			if (list[i] !== txCurrent && !stillDone && txQueue.indexOf(list[i]) < 0) {
				txQueue.push(list[i]);
			}
		}
		pumpQueue();
	}

	var txDone = {};   /* 扩展名 -> 成功补传时间:防重连重复传,但 30 分钟后失效
	                    * (客人中途清了包/换了盘上内容时还能再补) */
	var TX_DONE_TTL = 30 * 60 * 1000;

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
		startOne(next, function(ok) {
			if (ok) {
				txDone[next] = Date.now();
			}
			txBusy = false;
			txCurrent = null;
			pumpQueue();
		});
	}

	function startOne(name, done) {
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
			return fail("本游戏环境没有 Node 文件能力,补包不可用");
		}
		var fs = req("fs");
		var path = req("path");
		var root = gameRoot();
		if (!root) {
			return fail("定位游戏根目录失败,补包不可用(需要 extension/" + KERNEL_NAME + " 存在)");
		}
		var dir = path.join(root, "extension", name);
		if (!fs.existsSync(dir)) {
			return fail("本地没有这个扩展:" + name);
		}
		/* 收集文件清单与总体积 */
		var files = [];
		var total = 0;
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
							throw new Error("体积超过上限(" + Math.round(limit / 1048576) + "MB),取消补传");
						}
						files.push({ rel: r, size: size, full: full });
					}
				});
			})(dir, "");
		} catch (err) {
			return fail((err && err.message) || String(err));
		}
		if (!files.length) {
			return fail("这个扩展目录是空的:" + name);
		}

		var id = ++txSeq;
		var sendTo = currentBridges().map(bridgeId).filter(function(x) { return x !== null; });
		var head = {
			id: id,
			name: name,
			total: total,
			sendTo: sendTo,
			files: files.map(function(f) { return { rel: f.rel, size: f.size }; })
		};
		bridgeApi().emit("transfer_begin", { name: name, files: files.length, total: total });
		console.log("[联机助手] 开始补传扩展「" + name + "」:" + files.length + " 个文件," + Math.round(total / 1024) + "KB,等客人就绪…");
		sendToBridges("nnk_tx_begin", head);

		/* 等 ready 回执:没人应答就明确失败——绝不谎报"已补传" */
		waitAcks(id, "ready", ACK_TIMEOUT).then(function(ready) {
			if (!ready) {
				return fail("客人没有响应补传(可能还在进入房间的过程中)——请让客人重新加入后再试,或让他重启游戏后重试");
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
				var bridges = currentBridges();
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
						return fail("通道积压太久(对端可能已卡死),补传中止——请让客人重开游戏后再试");
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
						sendToBridges("nnk_tx_file", { id: id, name: name, rel: file.rel, size: file.size, sendTo: sendTo });
						fileData = fs.readFileSync(file.full);
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
							return waitAcks(id, "done", DONE_TIMEOUT).then(function(acked) {
								if (!acked) {
									return fail("数据已发完,但没等到客人的完成回执——请让客人重开游戏后再试");
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
				try {
					nnk.modules.transfer.begin(msg);
				} catch (e) { /* 形状不对:忽略,不影响对局 */ }
			},
			nnk_tx_file: function(msg) {
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
					if (!safeRel(msg.rel) || typeof msg.size !== "number" || msg.size < 0) {
						return;
					}
					rx.rel = msg.rel;
					rx.size = msg.size;
					rx.got = 0;
					startFileWrite();
				} catch (e) { /* 内核消息处理器必须自保(引擎派发不在 try 内) */ }
			},
			nnk_tx_data: function(msg) {
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
				try {
					if (!rx || !msg || msg.id !== rx.id) {
						return;
					}
					if (rx.reported < 100) {
						rx.reported = 100;
						bridgeApi().emit("transfer_progress", { name: rx.name, pct: 100, side: "guest" });
					}
					var ok = flushFile();
					if (!ok) {
						/* 落盘失败:不发自 receipt(房主会报"没等到完成回执") */
						return;
					}
					bridgeApi().emit("transfer_done", { name: rx.name, side: "guest" });
					console.log("[联机助手] 补包接收完成:「" + rx.name + "」,重启游戏后重新加入");
					sendAck(rx.id, "done");
					rx = null;
				} catch (e) { /* 自保 */ }
			}
		};
	}

	function sendAck(id, type) {
		try {
			nnk.env.game.send("nnk_tx_ack", { id: id, type: type });
		} catch (e) { /* 忽略 */ }
	}

	/* 开始写一个新文件:目标先写临时文件,收齐校验字节数后 rename 到位 */
	function startFileWrite() {
		var req = nodeRequire();
		if (!req) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "本游戏环境没有 Node 文件能力,接收中止" });
			rx = null;
			return;
		}
		var fs = req("fs");
		var path = req("path");
		var root = gameRoot();
		if (!root) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "定位游戏根目录失败,接收中止" });
			rx = null;
			return;
		}
		try {
			var target = path.join(root, "extension", rx.name, rx.rel);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			rx.target = target;
			/* 同尺寸文件视为已有:跳过写入,只走一遍计数(最后按 size 比对即通过) */
			if (fs.existsSync(target) && fs.statSync(target).size === rx.size) {
				rx.skip = true;
				rx.fd = null;
				rx.tmp = null;
				return;
			}
			rx.skip = false;
			rx.tmp = target + ".nnk-part";
			try { fs.unlinkSync(rx.tmp); } catch (e2) { /* 残留清理 */ }
			rx.fd = fs.openSync(rx.tmp, "w");
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "写入失败:" + ((err && err.message) || err) });
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
		req("fs").writeSync(rx.fd, Buffer.from(bytes));
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
			if (!rx.skip) {
				if (rx.got !== rx.size) {
					bridgeApi().emit("transfer_failed", { name: rx.name, message: "文件「" + rx.rel + "」收齐 " + rx.got + " / " + rx.size + " 字节,不完整,已丢弃" });
					try { fs.unlinkSync(rx.tmp); } catch (e2) { /* 忽略 */ }
					rx = null;
					return false;
				}
				fs.renameSync(rx.tmp, rx.target);
			}
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "落盘失败:" + ((err && err.message) || err) });
			rx = null;
			return false;
		}
		rx.rel = null;
		rx.skip = false;
		return true;
	}

	function reportProgress() {
		if (!rx || !rx.total) {
			return;
		}
		var pct = Math.min(100, Math.round(rx.doneBytes / rx.total * 100));
		/* 每 20% 报一次,别刷屏;100% 由 tx_done 收尾统一补发(这里的相等判定
		 * 若不去掉,重复送达的尾块会把 100% 刷好几遍——实测 4 连发) */
		if (pct >= rx.reported + 20) {
			rx.reported = pct;
			bridgeApi().emit("transfer_progress", { name: rx.name, pct: pct, side: "guest" });
			try {
				nnk.env.game.send("nnk_tx_progress", { id: rx.id, name: rx.name, pct: pct });
			} catch (e) { /* 忽略 */ }
		}
	}

	nnk.modules.transfer = {
		install: function() {
			var lib = nnk.env.lib;
			if (lib.message && lib.message.client) {
				var handlers = clientHandlers();
				for (var key in handlers) {
					if (!lib.message.client["__nnk" + key]) {
						lib.message.client[key] = handlers[key];
						lib.message.client["__nnk" + key] = true;
					}
				}
			}
			if (lib.message && lib.message.server) {
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
		},
		/* 工坊命令:补传指定扩展(传单个名字或名字数组,自动排队) */
		start: startTransfer,
		/* 客人侧开始一次接收会话(收到 tx_begin 后:先落会话,再回 ready 回执) */
		begin: function(msg) {
			if (!msg || !safeName(msg.name) || !Array.isArray(msg.files)) {
				return;
			}
			/* 接收侧也守体积上限:不信房主报的 total(恶意/异常对端不能撑爆客人) */
			var limit = limitBytes();
			var declared = typeof msg.total === "number" && msg.total >= 0 ? msg.total : 0;
			var filesTotal = 0;
			for (var i = 0; i < msg.files.length; i++) {
				var f = msg.files[i];
				if (!f || !safeRel(f.rel) || typeof f.size !== "number" || f.size < 0) {
					return;   /* 清单形状不对:整单拒收 */
				}
				filesTotal += f.size;
			}
			if (filesTotal > limit || declared > limit) {
				bridgeApi().emit("transfer_failed", { name: msg.name, message: "对方要传的体积超过本机上限(" + Math.round(limit / 1048576) + "MB),已拒绝" });
				return;
			}
			resetRx();
			rx = {
				id: msg.id,
				name: msg.name,
				rel: null,
				size: 0,
				got: 0,
				fd: null,
				tmp: null,
				skip: false,
				total: filesTotal,
				doneBytes: 0,
				reported: 0
			};
			bridgeApi().emit("transfer_progress", { name: msg.name, pct: 0, side: "guest" });
			sendAck(msg.id, "ready");
		}
	};
})();

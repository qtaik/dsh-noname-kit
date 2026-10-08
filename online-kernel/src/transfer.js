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
	/* 回执上限:判的对象是"对端主线程何时跑到这条消息"——对端开局/选将
	 * 等重载阶段主线程可能整段卡住,JS 回执跟着断供(同族教训:心跳判死
	 * 被主线程卡顿骗)。给足余量,宁可慢判也不误报"客人没响应" */
	var ACK_TIMEOUT = 6000;          /* 等客人 ready 回执的上限 */
	var DONE_TIMEOUT = 12000;        /* 等客人 done 回执的上限 */
	/* 背压等待上限:20→45 秒。原值按"对端卡死"上沿定,但慢网/对端主线程长卡顿
	 * (会话来不急消费,缓冲一直高于阈值)同样会连续触发——把"慢"误报成"卡死",
	 * 用户被告知"让客人重开游戏"白折腾一趟,已传的部分还不保留。放宽后只是
	 * 真卡死时晚 25 秒报错,文案也改成"消费过慢/无响应" */
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

	/* 定向发送:message 里带 sendTo(本次传输的目标通道 label 列表)时,只发给
	 * 名单内的通道自己 send。名单为空=没有可定向的通道(对端内核过旧/通道全断)
	 * 时直接不发——早先这里退回 game.broadcast,但联机模式下广播开门就 return
	 * (game.online 门禁),旧对端也不懂 ready/done 协议,那条"兜底"只会把
	 * 1.9.0 修掉的"广播即成功"假象带回来(审计实证)。没通道由 startOne 前置失败 */
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
	                        * 扩展强推给没缺包的 B、覆盖 B 本地同名文件,审计实证) */
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

	/* 只对"已交给引擎"的客人等回执:停泊/排队的客人通道没被 lib.init.connection
	 * 接管,他们的 nnk_tx_ack 根本到不了本内核——把他们算进必答名单,
	 * 每次补传都会 3 秒后报"客人没响应"(真正缺包的人反而拿不到包)。
	 * targets=本次会话冻结的参与名单(开始发送那一刻定);等回执时再与"现在还
	 * 挂着的已进入通道"取交集——中途新放行的客人没收到过一个字节,不能算必答
	 * (旧实现在收尾一刻重算名单,双客人场景必误报"没等到回执",审计实证) */
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
						files.push({ rel: r, size: size, full: full });
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
			? currentBridges().map(bridgeId).filter(function(x) { return x !== null; })
			: [only];
		if (!sendTo.length) {
			return fail("没有可定向的客人通道(对方内核可能过旧,请双方都升级到最新内核)");
		}
		/* 本次会话的必答名单(冻结在此):中途新放行的客人不参与本次,不欠回执 */
		var ackTargets = only ? [only] : enteredBridges().map(bridgeId).filter(function(x) { return x !== null; });
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
						/* 记一笔:被拒的文件收尾时必须让完整性收口报失败,
						 * 不能"跳过一个文件还回 done"(假成功活路,审计实证) */
						rx.rejectedFiles += 1;
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
					var id = rx.id;
					var name = rx.name;
					var rejected = rx.rejectedFiles;
					var doneFiles = rx.doneFiles;
					var expect = rx.expectCount;
					if (rx.reported < 100) {
						rx.reported = 100;
						bridgeApi().emit("transfer_progress", { name: name, pct: 100, side: "guest" });
					}
					var ok = flushFile();
					if (!ok) {
						/* 落盘校验失败:明确回 fail(房主立刻收场报原因,不干等超时) */
						sendAck(id, "fail", "落盘校验失败,文件已丢弃");
						return;
					}
					/* 完整性收口:清单里每个文件都必须走到落盘(或同尺寸跳过)。
					 * 被拒条目(如文件名含 ..)照旧回 done,就是 1.9.0 修过的
					 * "假成功"漏网活路(审计实证)——缺一个都不报成功 */
					if (rejected > 0 || doneFiles !== expect) {
						var why = rejected > 0
							? (rejected + " 个文件名不合法,无法接收")
							: ("只收齐 " + doneFiles + "/" + expect + " 个文件");
						bridgeApi().emit("transfer_failed", { name: name, message: "接收不完整(" + why + ")" });
						sendAck(id, "fail", why);
						rx = null;
						return;
					}
					bridgeApi().emit("transfer_done", { name: name, side: "guest" });
					console.log("[联机助手] 补包接收完成:「" + name + "」,重启游戏后重新加入");
					sendAck(id, "done");
					rx = null;
				} catch (e) { /* 自保 */ }
			}
		};
	}

	function sendAck(id, type, reason) {
		try {
			nnk.env.game.send("nnk_tx_ack", { id: id, type: type, reason: reason || "" });
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
			/* 字节校验对"跳过写入(盘上已有同尺寸)"同样适用:不校验的话,
			 * 主机少发/截断时旧文件会被当新文件、还报成功(实测) */
			if (rx.got !== rx.size) {
				bridgeApi().emit("transfer_failed", { name: rx.name, message: "文件「" + rx.rel + "」收齐 " + rx.got + " / " + rx.size + " 字节,不完整,已丢弃" });
				if (rx.tmp) {
					try { fs.unlinkSync(rx.tmp); } catch (e2) { /* 忽略 */ }
				}
				rx = null;
				return false;
			}
			if (!rx.skip) {
				fs.renameSync(rx.tmp, rx.target);
			}
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "落盘失败(磁盘空间/权限?):" + ((err && err.message) || err) + "——腾出空间或关闭占用后重试" });
			rx = null;
			return false;
		}
		rx.doneFiles += 1;   /* 完整性收口计数:tx_done 按它核对"清单里每个文件都到了" */
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
		/* 工坊命令:补传指定扩展(传单个名字或名字数组,自动排队)。
		 * only=只发给这一条通道(清单自动补传按上报者定向,防误覆盖别人的本地包) */
		start: startTransfer,
		/* 定向直发:给一个引擎 client(或 HostBridge),把一条内核消息直接从它
		 * 的隧道发过去(与补传同款,不经 game.broadcast——联机模式下广播开门
		 * 就 return,差集回发因此从来没到过客人;审计实证)。manifest 回发用它 */
		sendDirect: function(client, func, payload) {
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
			if (!msg || !safeName(msg.name) || !Array.isArray(msg.files)) {
				if (msg && typeof msg.id === "number") {
					sendAck(msg.id, "fail", "补传清单格式不对");
				}
				return;
			}
			/* 接收侧也守体积上限:不信房主报的 total(恶意/异常对端不能撑爆客人) */
			var limit = limitBytes();
			var declared = typeof msg.total === "number" && msg.total >= 0 ? msg.total : 0;
			var filesTotal = 0;
			for (var i = 0; i < msg.files.length; i++) {
				var f = msg.files[i];
				if (!f || !safeRel(f.rel) || typeof f.size !== "number" || f.size < 0) {
					sendAck(msg.id, "fail", "补传清单里有非法条目");
					return;   /* 清单形状不对:整单拒收并明确回绝 */
				}
				filesTotal += f.size;
			}
			if (filesTotal > limit || declared > limit) {
				bridgeApi().emit("transfer_failed", { name: msg.name, message: "对方要传的体积超过本机上限(" + Math.round(limit / 1048576) + "MB),已拒绝" });
				sendAck(msg.id, "fail", "体积超过本机上限");
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
				reported: 0,
				expectCount: msg.files.length,   /* 完整性收口:清单里的文件数 */
				doneFiles: 0,
				rejectedFiles: 0
			};
			bridgeApi().emit("transfer_progress", { name: msg.name, pct: 0, side: "guest" });
			sendAck(msg.id, "ready");
		}
	};
})();

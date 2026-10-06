/*
 * 自动补包(M4):房主把客人缺少的扩展自动传过去。
 * 流程:客人进房 → 清单交换(manifest)→ 房主算差集 → 自动排队补传全部缺失
 * → 客人落盘 → 提示客人重启游戏、重新输房号加入(重启后清单复查,缺的续传)。
 * 通道复用引擎 ws 消息分发(同 manifest):房主 game.broadcast 分块发,
 * 客人在 lib.message.client 上收块落盘;进度经 game.send 回报房主。
 *
 * 传输安全(真机实证:一次把整个文件的块灌进对局 DataChannel,客人 20% 被踢出
 * 房间):背压按【块】检查(旧版按文件检查,大文件一次灌爆通道挤掉对局心跳),
 * 积压超限就暂停等待,保证对局消息优先。
 *
 * 文件读写直接用 Node fs——两台测试机的游戏外壳(Electron)渲染进程都是
 * nodeIntegration:true、contextIsolation:false,内核以扩展身份运行在
 * 渲染进程里,window.require 可用。找不到 fs 或定位不到游戏根目录时,
 * 补包不可用并明确报错(体检展示不受影响)。
 *
 * 安全边界:只写 extension/<扩展名>/ 之下;路径拒绝 ..、绝对路径、盘符;
 * 拒绝传本内核(联机助手)自身;总体积上限 = config transferLimitMB(默认 300)。
 */
(function() {
	var nnk = window.__nnk__;
	var CHUNK = 48 * 1024;          /* 二进制块大小(b64 后 64KB,远小于 DC 消息上限) */
	var BUFFER_LIMIT = 256 * 1024;  /* 所有通道积压超过 256KB 就等(保对局消息优先) */
	var KERNEL_NAME = "联机助手";

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

	/* ---- 房主侧:补传队列(自动补传 = 一次入队全部缺失,逐个传) ---- */
	var txSeq = 0;
	var txQueue = [];
	var txBusy = false;

	function startTransfer(name) {
		var list = Array.isArray(name) ? name : [name];
		for (var i = 0; i < list.length; i++) {
			if (txQueue.indexOf(list[i]) < 0) {
				txQueue.push(list[i]);
			}
		}
		pumpQueue();
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
		startOne(next, function() {
			txBusy = false;
			pumpQueue();
		});
	}

	function startOne(name, done) {
		var hostState = nnk.state.host;
		if (!hostState || !hostState.bridges || !hostState.bridges.length) {
			bridgeApi().emit("error", { message: "没有已连接的客人,补传中止" });
			txQueue = [];
			done(false);
			return;
		}
		if (!safeName(name)) {
			bridgeApi().emit("error", { message: "扩展名不合法:" + name });
			done(false);
			return;
		}
		var req = nodeRequire();
		if (!req) {
			bridgeApi().emit("error", { message: "本游戏环境没有 Node 文件能力,补包不可用" });
			done(false);
			return;
		}
		var fs = req("fs");
		var path = req("path");
		var root = gameRoot();
		if (!root) {
			bridgeApi().emit("error", { message: "定位游戏根目录失败,补包不可用(需要 extension/" + KERNEL_NAME + " 存在)" });
			done(false);
			return;
		}
		var dir = path.join(root, "extension", name);
		if (!fs.existsSync(dir)) {
			bridgeApi().emit("error", { message: "本地没有这个扩展:" + name });
			done(false);
			return;
		}
		/* 收集文件清单与总体积 */
		var files = [];
		var total = 0;
		var limit = (nnk.modules.config.get("transferLimitMB") || 300) * 1024 * 1024;
		try {
			(function walk(dir, rel) {
				fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
					var r = rel ? rel + "/" + entry.name : entry.name;
					var full = path.join(dir, entry.name);
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
			bridgeApi().emit("transfer_failed", { name: name, message: (err && err.message) || String(err) });
			done(false);
			return;
		}
		if (!files.length) {
			bridgeApi().emit("error", { message: "这个扩展目录是空的:" + name });
			done(false);
			return;
		}
		var id = ++txSeq;
		bridgeApi().emit("transfer_begin", { name: name, files: files.length, total: total });
		console.log("[联机助手] 开始补传扩展「" + name + "」:" + files.length + " 个文件," + Math.round(total / 1024) + "KB");
		try {
			nnk.env.game.broadcast("nnk_tx_begin", {
				id: id,
				name: name,
				total: total,
				files: files.map(function(f) { return { rel: f.rel, size: f.size }; })
			});
		} catch (e) { /* 忽略 */ }

		/* 逐块发送状态机:每块都检查通道积压,超限就暂停等待(保对局消息优先) */
		var fi = 0;
		var off = 0;
		var fileData = null;
		var waiting = false;
		var gatesBlocked = function() {
			var bridges = nnk.state.host.bridges || [];
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
			if (!nnk.state.host.bridges || !nnk.state.host.bridges.length) {
				bridgeApi().emit("transfer_failed", { name: name, message: "客人已全部断开,补传中止" });
				done(false);
				return;
			}
			if (gatesBlocked()) {
				waiting = true;
				setTimeout(function() {
					waiting = false;
					step();
				}, 40);
				return;
			}
			try {
				var file = files[fi];
				if (!fileData) {
					nnk.env.game.broadcast("nnk_tx_file", { id: id, name: name, rel: file.rel, size: file.size });
					fileData = fs.readFileSync(file.full);
				}
				var end = Math.min(off + CHUNK, fileData.length);
				nnk.env.game.broadcast("nnk_tx_data", { id: id, rel: file.rel, b64: bytesToB64(fileData.subarray(off, end)) });
				off = end;
				if (off >= fileData.length) {
					fi++;
					off = 0;
					fileData = null;
					if (fi >= files.length) {
						nnk.env.game.broadcast("nnk_tx_done", { id: id, name: name });
						bridgeApi().emit("transfer_done", { name: name });
						console.log("[联机助手] 补传完成:「" + name + "」(客人重启游戏后重新加入)");
						done(true);
						return;
					}
				}
				step();
			} catch (err) {
				bridgeApi().emit("transfer_failed", { name: name, message: (err && err.message) || String(err) });
				console.error("[联机助手] 补传失败:", err);
				done(false);
			}
		};
		step();
	}

	/* ---- 客人侧:接收落盘 ---- */
	var rx = null;   /* { id, name, rel, size, got, chunks, files, doneBytes, total, reported } */

	function clientHandlers() {
		return {
			nnk_tx_begin: function(msg) {
				nnk.modules.transfer.begin(msg);
			},
			nnk_tx_file: function(msg) {
				if (!msg || !safeName(msg.name)) {
					return;
				}
				if (!rx || rx.id !== msg.id) {
					return;
				}
				flushFile();
				if (!safeRel(msg.rel)) {
					return;
				}
				rx.rel = msg.rel;
				rx.size = msg.size;
				rx.got = 0;
				rx.chunks = [];
			},
			nnk_tx_data: function(msg) {
				if (!rx || !msg || msg.id !== rx.id || msg.rel !== rx.rel) {
					return;
				}
				var bin = atob(msg.b64);
				var bytes = new Uint8Array(bin.length);
				for (var i = 0; i < bin.length; i++) {
					bytes[i] = bin.charCodeAt(i);
				}
				rx.chunks.push(bytes);
				rx.got += bytes.length;
				rx.doneBytes += bytes.length;
				reportProgress();
			},
			nnk_tx_done: function(msg) {
				if (!rx || !msg || msg.id !== rx.id) {
					return;
				}
				flushFile();
				bridgeApi().emit("transfer_done", { name: rx.name, side: "guest" });
				console.log("[联机助手] 补包接收完成:「" + rx.name + "」,重启游戏后重新加入");
				rx = null;
			}
		};
	}

	/* 把攒完的当前文件写进 extension/<名字>/<rel>;同尺寸文件跳过不重写 */
	function flushFile() {
		if (!rx || rx.rel === null) {
			return;
		}
		var req = nodeRequire();
		if (!req) {
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
			if (fs.existsSync(target) && fs.statSync(target).size === rx.size) {
				/* 同尺寸视为已有,跳过 */
			} else {
				fs.mkdirSync(path.dirname(target), { recursive: true });
				var parts = rx.chunks;
				var total = 0;
				parts.forEach(function(b) { total += b.length; });
				var merged = new Uint8Array(total);
				var off = 0;
				parts.forEach(function(b) {
					merged.set(b, off);
					off += b.length;
				});
				fs.writeFileSync(target, Buffer.from(merged));
			}
		} catch (err) {
			bridgeApi().emit("transfer_failed", { name: rx.name, message: "写入失败:" + ((err && err.message) || err) });
			rx = null;
			return;
		}
		rx.rel = null;
		rx.chunks = null;
	}

	function reportProgress() {
		if (!rx || !rx.total) {
			return;
		}
		var pct = Math.min(100, Math.round(rx.doneBytes / rx.total * 100));
		/* 每 20% 报一次,别刷屏 */
		if (pct >= rx.reported + 20 || pct === 100) {
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
			if (lib.message && lib.message.server && !lib.message.server.__nnkTxProgress) {
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
		},
		/* 工坊命令:补传指定扩展(传单个名字或名字数组,自动排队) */
		start: startTransfer,
		/* 客人侧开始一次接收会话(收到 tx_begin 前,房主先广播会话头) */
		begin: function(msg) {
			if (!msg || !safeName(msg.name) || !Array.isArray(msg.files)) {
				return;
			}
			rx = {
				id: msg.id,
				name: msg.name,
				rel: null,
				size: 0,
				got: 0,
				chunks: null,
				total: msg.total || 0,
				doneBytes: 0,
				reported: 0
			};
			bridgeApi().emit("transfer_progress", { name: msg.name, pct: 0, side: "guest" });
		}
	};
})();

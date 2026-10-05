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
					host.createInternetRoom(args.mode);
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
		setPhase: setPhase,
		getState: function() { return state; }
	};
})();

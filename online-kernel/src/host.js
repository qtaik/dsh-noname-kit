/*
 * 主机端(无头):软服务器 + 邀请码信令,事件经 bridge 上报工坊。
 * 原生 createServer 在渲染进程里 require("ws") 起 8080 监听;这里把它整个
 * 换成 WebRTC 接客——每个客人的 DataChannel 包成 HostBridge 交给
 * lib.init.connection,引擎从此以为来的是普通客人。房主自己的座位由
 * waitForPlayer 直接创建(playerid="1"),不经过任何 socket。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;

	var hostState = nnk.state.host = {
		active: false,     /* 本次启动里已进入"互联网建房"流程(含跨重载接力) */
		roomCode: null,
		bridges: []
	};

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	function genRoomCode() {
		var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		var bytes = new Uint8Array(6);
		crypto.getRandomValues(bytes);
		var s = "";
		for (var i = 0; i < 6; i++) {
			s += chars[bytes[i] % chars.length];
		}
		return s;
	}

	function softCreateServer() {
		var env = nnk.env;
		var lib = env.lib;
		var game = env.game;
		var uiE = env.ui;
		/* 与原生 createServer 相同的状态初始化(game/index.js:2167-2176) */
		lib.node.clients = [];
		lib.node.banned = [];
		lib.node.observing = [];
		lib.node.torespond = {};
		lib.node.torespondtimeout = {};
		lib.node.waitForResult = {};
		lib.playerOL = {};
		lib.cardOL = {};
		lib.vcardOL = {};
		lib.wsOL = {};
		/* 无头建房跳过了原生的建房设置菜单,「禁止不同版本玩家进房」(默认开,
		 * 1.9↔1.11 跨版本会被拒)和「禁止扩展玩家进房」在这里统一替房主关掉
		 * ——versionOL 相同的版本间协议互通,精确版本与扩展差异由工坊体检提示 */
		try {
			game.saveConfig("check_versionLocal", false, "connect");
			game.saveConfig("check_extension", false, "connect");
		} catch (e) { /* 个别版本无此键也不影响建房 */ }
		uiE.create.roomInfo();
		uiE.create.chat();
		hostState.roomCode = genRoomCode();
		game.ip = "nnk://" + hostState.roomCode;
		bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode });
		startInvite();
	}

	/* 邀请码模式:主机是 offer 方(邀请码→客人回执码→工坊粘贴回执) */
	function startInvite() {
		var env = nnk.env;
		var pc = new RTCPeerConnection(rtc.pcConfig());
		var settled = false;
		var channel = pc.createDataChannel("nnk-link", { ordered: true });
		channel.onopen = function() {
			if (settled) {
				return;
			}
			settled = true;
			/* 这张 pc 已经转为在座客人的承载连接,必须从"待应答"位上摘掉:
			 * 否则下一次 refreshInvite 会把它 close 掉,等于踢掉已坐下的客人 */
			hostState.invitePc = null;
			var conn = new rtc.HostBridge(channel);
			conn._pc = pc;
			hostState.bridges.push(conn);
			conn.onDown(function() {
				var i = hostState.bridges.indexOf(conn);
				if (i >= 0) {
					hostState.bridges.splice(i, 1);
				}
			});
			env.lib.init.connection(conn);
			bridgeApi().emit("guest_connected", { guests: hostState.bridges.length });
		};
		pc.createOffer().then(function(offer) {
			return pc.setLocalDescription(offer);
		}).then(function() {
			return rtc.waitGather(pc);
		}).then(function() {
			hostState.invitePc = pc;
			bridgeApi().setPhase("invite_ready", { roomCode: hostState.roomCode });
			bridgeApi().emit("invite_ready", { code: rtc.encodeCode("offer", pc.localDescription) });
		}).catch(function(err) {
			try { pc.close(); } catch (e) { /* 清理半程 pc,防泄漏 */ }
			console.error("[联机助手] 生成邀请码失败", err);
			bridgeApi().emit("error", { message: "生成邀请码失败: " + (err.message || err) });
		});
	}

	var api = {
		init: function() {
			var env = nnk.env;
			rtc = nnk.modules.rtc;
			if (env.game.__nnkCreateServerPatched) {
				return;
			}
			env.game.__nnkCreateServerPatched = true;
			var origCreateServer = env.game.createServer;
			env.game.createServer = function() {
				if (hostState.active) {
					return softCreateServer();
				}
				return origCreateServer.apply(env.game, arguments);
			};
			/* 跨重载接力:工坊建房若触发过 game.reload(),重启后凭 pending 标记恢复建房态 */
			try {
				var pending = localStorage.getItem(env.lib.configprefix + "nnk_host_pending");
				if (pending) {
					localStorage.removeItem(env.lib.configprefix + "nnk_host_pending");
					hostState.active = true;
					console.log("[联机助手] 检测到待建房间标记,重载后继续互联网建房");
				}
			} catch (e) { /* localStorage 不可用则无接力 */ }
		},

		/* 工坊命令:创建互联网房间。无论游戏当前停在哪个界面,先落到联机模式再直启。 */
		createInternetRoom: function(mode) {
			var env = nnk.env;
			mode = String(mode || "identity");
			/* 模式白名单:与引擎联机菜单一致(lib.mode[x].connect 为真值的五个) */
			if (["identity", "guozhan", "versus", "doudizhu", "single"].indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			/* 离线对局进行中禁止建房:直启/重载都会把当前对局丢掉 */
			if (env.game.players && env.game.players.length && !env._status.over) {
				bridgeApi().emit("error", { message: "游戏正在对局中,请先结束当前对局再创建互联网房间" });
				return;
			}
			/* 已在等待房间:等价于"再来一张邀请码" */
			if (env._status.waitingForPlayer && hostState.roomCode) {
				this.refreshInvite();
				return;
			}
			hostState.active = true;
			bridgeApi().setPhase("host_booting", { mode: mode });
			if (env.lib.config.mode === "connect") {
				startDirect(mode);
			} else {
				/* 主菜单/对局等其他界面:存直启标记后重载,connect.js 的
				 * directstartmode 分支会自动 switchMode 进等待房间 */
				try {
					localStorage.setItem(env.lib.configprefix + "nnk_host_pending", mode);
					localStorage.setItem(env.lib.configprefix + "directstart", "true");
				} catch (e) { /* 忽略 */ }
				env.game.saveConfig("directstartmode", mode);
				env.game.saveConfig("mode", "connect");
				env.game.reload();
			}
		},

		refreshInvite: function() {
			if (!hostState.roomCode || !env_ready()) {
				bridgeApi().emit("error", { message: "还没有可用的房间,请先创建互联网房间" });
				return;
			}
			if (hostState.invitePc) {
				try { hostState.invitePc.close(); } catch (e) { /* 忽略 */ }
				hostState.invitePc = null;
			}
			startInvite();
		},

		acceptAnswer: function(codeText) {
			var pc = hostState.invitePc;
			if (!pc) {
				bridgeApi().emit("error", { message: "没有待应答的邀请,请先创建互联网房间" });
				return;
			}
			var data;
			try {
				data = rtc.decodeCode(codeText);
				if (data.k !== "answer") {
					throw new Error("这不是回执码,请粘贴客人回发的「回执码」");
				}
			} catch (err) {
				bridgeApi().emit("error", { message: err.message });
				return;
			}
			pc.setRemoteDescription(data.sdp).then(function() {
				bridgeApi().setPhase("connecting", { roomCode: hostState.roomCode });
			}).catch(function(err) {
				bridgeApi().emit("error", { message: "回执码无效: " + (err.message || err) });
			});
		},

		cancelAll: function() {
			var env = nnk.env;
			hostState.active = false;
			if (hostState.invitePc) {
				try { hostState.invitePc.close(); } catch (e) { /* 忽略 */ }
				hostState.invitePc = null;
			}
			try {
				localStorage.removeItem(env.lib.configprefix + "nnk_host_pending");
			} catch (e) { /* 忽略 */ }
		}
	};

	function env_ready() {
		return nnk.env && nnk.env._status.waitingForPlayer;
	}

	/* 复刻原生「启动服务器」的直启分支(ui/create/menu/pages/startMenu.js:77-91):
	 * 联机界面里无需重载,直接 switchMode 进入所选模式的等待房间。 */
	function startDirect(mode) {
		var env = nnk.env;
		var game = env.game;
		var uiE = env.ui;
		localStorage.setItem(env.lib.configprefix + "directstart", "true");
		game.saveConfig("directstartmode", mode);
		game.saveConfig("mode", "connect");
		if (!uiE.exitroom) {
			uiE.exitroom = uiE.create.system("退出房间", function() {
				game.saveConfig("directstartmode");
				game.reload();
			}, true);
		}
		game.switchMode(mode);
		game.requireSandboxOn();
	}

	nnk.modules.host = api;
})();

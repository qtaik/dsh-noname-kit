/*
 * 主机端(无头):软服务器 + 房号/邀请码双信令,事件经 bridge 上报工坊。
 * 原生 createServer 在渲染进程里 require("ws") 起 8080 监听;这里把它整个
 * 换成 WebRTC 接客——每个客人的 DataChannel 包成 HostBridge 交给
 * lib.init.connection,引擎从此以为来的是普通客人。房主自己的座位由
 * waitForPlayer 直接创建(playerid="1"),不经过任何 socket。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;
	var signaling;

	var hostState = nnk.state.host = {
		active: false,        /* 本次启动里已进入"互联网建房"流程(含跨重载接力) */
		signaling: "mqtt",    /* mqtt=房号直连(默认) | invite=邀请码兜底 */
		roomCode: null,
		bridges: [],
		invitePc: null,
		mqttSession: null,
		presenceTimer: null,
		mqttGen: 0            /* 信令会话代号:startMqtt 递增,作废迟到会话用 */
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
		if (nnk.modules.compat) {
			nnk.modules.compat.unlockPacks();
			nnk.modules.compat.dumpExtensions();   /* 透视:本次联机实际加载/跳过了哪些扩展 */
		}
		bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode });
		startHosting();
	}

	/* 按建房时选定的信令方式挂"互联网接入器" */
	function startHosting() {
		if (hostState.signaling === "invite") {
			startInvite();
		} else {
			startMqtt();
		}
	}

	/* 房号模式(MQTT):主机是 answer 方——订阅 offer 主题,每个客人一条
	 * 连接提议就应答一条;同时以 retained 心跳向房号主题声明自己在房 */
	function startMqtt() {
		var env = nnk.env;
		var code = hostState.roomCode;
		/* 幂等:重复建房/换码先清旧会话与心跳(顺带换代号);两条会话并存
		 * 会对同一提议应答两次,守卫见下方 resolve 的代号比对 */
		cleanupMqtt();
		var gen = hostState.mqttGen;
		bridgeApi().setPhase("mqtt_waiting", { roomCode: code });
		signaling.openRoomSession(code, "host",
			[signaling.roomTopic(code, "offer"), signaling.roomTopic(code, "host")],
			function(topic, msg) {
				if (/\/offer$/.test(topic) && msg && msg.guestId && msg.sdp) {
					answerMqttOffer(code, msg);
				}
			}
		).then(function(session) {
			if (hostState.signaling !== "mqtt" || hostState.roomCode !== code || hostState.mqttGen !== gen) {
				session.end();   /* 等待期间被换码/取消/重新建房,这次会话作废 */
				return;
			}
			hostState.mqttSession = session;
			var presence = function() {
				session.publish(signaling.roomTopic(code, "host"), { ts: Date.now() }, true)
					.catch(function() { /* 单次心跳失败可容忍 */ });
			};
			presence();
			hostState.presenceTimer = setInterval(presence, 10000);
		}).catch(function(err) {
			bridgeApi().emit("error", { message: "房号信令连接失败: " + (err.message || err) + " —— 可改用邀请码方式建房" });
		});
	}

	/* 应答一条客人的连接提议(客人=offer 方) */
	function answerMqttOffer(code, msg) {
		var env = nnk.env;
		var pc = new RTCPeerConnection(rtc.pcConfig());
		pc.ondatachannel = function(e) {
			var channel = e.channel;
			channel.onopen = function() {
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
				/* 上报 room_open:工坊据此把「房号就绪…等朋友加入」换成
				 * 「客人已连接,游戏里点开始游戏」(此前无阶段承载,文案是死的) */
				bridgeApi().setPhase("room_open", { roomCode: code, signaling: hostState.signaling });
				bridgeApi().emit("guest_connected", { guests: hostState.bridges.length });
			};
		};
		pc.onconnectionstatechange = function() {
			if (pc.connectionState === "failed") {
				/* failed 是终态且本侧不做 ICE restart,半死 pc 必须关掉,
				 * 否则客人每重试一次就漏一个连接对象 */
				try { pc.close(); } catch (e2) { /* 忽略 */ }
				bridgeApi().emit("error", { message: "一位客人的直连建立失败(双方网络没打通),需要其重新加入——房号反复失败,主机可改用邀请码方式建房" });
			}
		};
		pc.setRemoteDescription(msg.sdp).then(function() {
			return pc.createAnswer();
		}).then(function(answer) {
			return pc.setLocalDescription(answer);
		}).then(function() {
			return rtc.waitGather(pc);
		}).then(function() {
			if (hostState.mqttSession && hostState.roomCode === code) {
				return hostState.mqttSession.publish(
					signaling.roomTopic(code, "answer/" + msg.guestId),
					{ k: "answer", sdp: pc.localDescription }
				);
			}
			/* 等应答期间房号被换/信令被取消:这张应答发出去也没人收,关掉半程 pc */
			try { pc.close(); } catch (e) { /* 忽略 */ }
		}).catch(function(err) {
			try { pc.close(); } catch (e) { /* 清理半程 pc */ }
			bridgeApi().emit("error", { message: "应答客人失败: " + (err.message || err) });
		});
	}

	function cleanupMqtt() {
		/* 换代号:任何清理都让在途的迟到会话作废(含 cancelAll 后才连上的) */
		hostState.mqttGen = (hostState.mqttGen || 0) + 1;
		if (hostState.presenceTimer) {
			clearInterval(hostState.presenceTimer);
			hostState.presenceTimer = null;
		}
		if (hostState.mqttSession) {
			var session = hostState.mqttSession;
			hostState.mqttSession = null;
			/* 清掉 retained 的在线心跳,客人端立即显示房主离线 */
			if (hostState.roomCode) {
				try {
					session.publishRaw(signaling.roomTopic(hostState.roomCode, "host"), "", true);
				} catch (e) { /* 忽略 */ }
			}
			session.end();
		}
	}

	/* 邀请码模式:主机是 offer 方(邀请码→客人回执码→工坊粘贴回执) */
	function startInvite() {
		var env = nnk.env;
		/* 幂等:上一次邀请还挂着就先关掉(重复建房/换码),防泄漏与误应答 */
		if (hostState.invitePc) {
			try { hostState.invitePc.close(); } catch (e) { /* 忽略 */ }
			hostState.invitePc = null;
		}
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
			bridgeApi().setPhase("room_open", { roomCode: hostState.roomCode, signaling: hostState.signaling });
			bridgeApi().emit("guest_connected", { guests: hostState.bridges.length });
		};
		pc.createOffer().then(function(offer) {
			return pc.setLocalDescription(offer);
		}).then(function() {
			return rtc.waitGather(pc);
		}).then(function() {
			if (!hostState.active) {
				/* 生成邀请码期间被取消:这张码作废,别把已取消的邀请挂回去 */
				try { pc.close(); } catch (e) { /* 忽略 */ }
				return;
			}
			hostState.invitePc = pc;
			bridgeApi().setPhase("invite_ready", { roomCode: hostState.roomCode });
			bridgeApi().emit("invite_ready", { code: rtc.encodeCode("offer", pc.localDescription) });
		}).catch(function(err) {
			try { pc.close(); } catch (e) { /* 清理半程 pc,防泄漏 */ }
			console.error("[联机助手] 生成邀请码失败", err);
			bridgeApi().emit("error", { message: "生成邀请码失败: " + (err.message || err) });
		});
	}

	/* 应答后的连接监视:ICE 打不通时绝不能无声悬挂(实测教训——第一版在
	 * 协商成功后静默挂死,用户以为没反应反复点连接,只会收到 wrong state 报错)。
	 * 失败/超时都自动换一张新邀请码,客人重新走一遍即可。 */
	function watchHostConnection(pc) {
		var dead = false;
		var giveUp = function(reason) {
			if (dead || hostState.invitePc !== pc) {
				return;   /* 已连上(连接建立时 invitePc 会被摘牌)或已换过码 */
			}
			dead = true;
			bridgeApi().emit("error", { message: reason + "。已自动生成新邀请码——让客人从「加入互联网房间」重新走一遍;反复失败请检查两台电脑防火墙是否放行无名杀(UDP),或换个网络再试" });
			hostState.invitePc = null;
			try { pc.close(); } catch (e) { /* 忽略 */ }
			startInvite();
		};
		pc.onconnectionstatechange = function() {
			if (pc.connectionState === "failed") {
				giveUp("直连建立失败(双方网络没打通)");
			}
		};
		setTimeout(function() {
			if (pc.connectionState !== "connected" && pc.connectionState !== "closed") {
				giveUp("20 秒仍未打通直连(网络受限)");
			}
		}, 20000);
	}

	var api = {
		init: function() {
			var env = nnk.env;
			rtc = nnk.modules.rtc;
			signaling = nnk.modules.signaling;
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
			/* 跨重载接力 + 回房残留清理:
			 * - 有 nnk_host_pending = 工坊刚点了创建、游戏正重载途中,恢复互联网建房;
			 * - 没有时,必须清掉上次建房残留的 directstartmode/directstart——否则引擎
			 *   每次开机都自动恢复进上次的等待房间(还是原生局域网房,房间名=本机
			 *   内网 IP),用户什么都没点就"被进房"(实测踩坑) */
			try {
				var pending = localStorage.getItem(env.lib.configprefix + "nnk_host_pending");
				if (pending) {
					localStorage.removeItem(env.lib.configprefix + "nnk_host_pending");
					hostState.active = true;
					console.log("[联机助手] 检测到待建房间标记,重载后继续互联网建房");
				} else if (env.lib.config.directstartmode || localStorage.getItem(env.lib.configprefix + "directstart")) {
					env.game.saveConfig("directstartmode");
					localStorage.removeItem(env.lib.configprefix + "directstart");
					console.log("[联机助手] 已清除上次建房残留的自动回房标记,本次开机不自动进房");
				}
			} catch (e) { /* localStorage 不可用则无接力 */ }
		},

		/* 工坊命令:创建互联网房间。无论游戏当前停在哪个界面,先落到联机模式再直启。 */
		createInternetRoom: function(mode, signalingMode) {
			var env = nnk.env;
			mode = String(mode || "identity");
			hostState.signaling = signalingMode === "invite" ? "invite" : "mqtt";
			/* 模式白名单:与引擎联机菜单一致(lib.mode[x].connect 为真值的五个) */
			if (["identity", "guozhan", "versus", "doudizhu", "single"].indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			/* 离线对局进行中不再拒绝(旧守卫会打断建房):重载进联机模式本身就是
			 * "返回主页"的干净起手,自动丢弃当前对局——也顺带绕开官方版首次
			 * 启动状态异常导致无法建房的问题 */
			if (env.game.players && env.game.players.length && !env._status.over) {
				bridgeApi().emit("info", { message: "检测到单人对局未结束,将自动退出并重载建房" });
			}
			hostState.active = true;
			/* 自愈:系统按钮栏(ui.system1/2)正常由引擎开机时的 ui.create.arena()
			 * 创建,个别引擎构建/界面环境下可能缺失——建房流程(退出房间按钮、
			 * 房间信息/聊天)全依赖它,缺失时重建一次 HUD 再继续 */
			if (!env.ui.system1 || !env.ui.system2) {
				try {
					env.ui.create.arena();
					console.log("[联机助手] 检测到系统按钮栏缺失,已重建 HUD");
				} catch (err) {
					console.error("[联机助手] HUD 重建失败,继续建房(退出房间按钮可能缺失)", err);
				}
			}
			/* 已有等待房间(本内核建的,或上次会话遗留、引擎开机自动恢复的原生房间):
			 * 不再叠加 switchMode(实测叠加会崩 UI),直接收编——生成房号挂上互联网邀请 */
			if (env._status.waitingForPlayer) {
				if (!hostState.roomCode) {
					hostState.roomCode = genRoomCode();
					env.game.ip = "nnk://" + hostState.roomCode;
				}
				/* 收编的原生遗留房没有「退出房间」按钮(原生路径才会建),补齐 */
				if (!env.ui.exitroom && env.ui.system1 && env.ui.system2) {
					env.ui.exitroom = env.ui.create.system("退出房间", function() {
						env.game.saveConfig("directstartmode");
						env.game.reload();
					}, true);
				}
				if (nnk.modules.compat) {
					nnk.modules.compat.unlockPacks();
				}
				bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode });
				startHosting();
				return;
			}
			bridgeApi().setPhase("host_booting", { mode: mode });
			/* 无条件走重载直启:实测"同模式原地 switchMode"的快路径会把残留的
			 * 离线开局界面 DOM 垫在联机房间下面(半截画面)——重载后从干净的
			 * 联机界面起手是原生验证过的唯一干净路径,代价只是几秒启动。
			 * connect.js start 的 directstartmode 分支(需 lib.node)会自动
			 * switchMode 进等待房间,nnk_host_pending 让内核在那边接管软服务器 */
			try {
				localStorage.setItem(env.lib.configprefix + "nnk_host_pending", mode);
				localStorage.setItem(env.lib.configprefix + "directstart", "true");
			} catch (e) { /* 忽略 */ }
			env.game.saveConfig("directstartmode", mode);
			env.game.saveConfig("mode", "connect");
			env.game.reload();
		},

		refreshInvite: function() {
			if (!hostState.roomCode || !env_ready()) {
				bridgeApi().emit("error", { message: "还没有可用的房间,请先创建互联网房间" });
				return;
			}
			if (hostState.signaling === "mqtt") {
				/* 房号模式换码:重生成房号并重挂信令(旧房号的心跳随之停止) */
				cleanupMqtt();
				hostState.roomCode = genRoomCode();
				env.game.ip = "nnk://" + hostState.roomCode;
				bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode });
				startMqtt();
				return;
			}
			/* 旧邀请码的关闭在 startInvite 里统一做 */
			startInvite();
		},

		acceptAnswer: function(codeText) {
			var pc = hostState.invitePc;
			if (!pc) {
				bridgeApi().emit("error", { message: "没有待应答的邀请,请先创建互联网房间" });
				return;
			}
			/* 一张邀请码只能被应答一次:协商完成后 signalingState 回到 stable,
			 * 再粘同一条回执码会报 wrong state——正确动作是换一张新邀请码重试 */
			if (pc.signalingState !== "have-local-offer") {
				bridgeApi().emit("error", { message: "这张邀请码已经协商过了(客人没进来说明直连没打通)。点「♻️ 换一张邀请码重试」,让客人用新码重新走一遍" });
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
				watchHostConnection(pc);
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
			cleanupMqtt();
			try {
				localStorage.removeItem(env.lib.configprefix + "nnk_host_pending");
			} catch (e) { /* 忽略 */ }
		}
	};

	function env_ready() {
		return nnk.env && nnk.env._status.waitingForPlayer;
	}

	nnk.modules.host = api;
})();

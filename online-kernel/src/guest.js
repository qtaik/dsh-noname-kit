/*
 * 客人端(无头):加入互联网房间 + 接管 game.connect 的 nnk:// 地址。
 * 邀请码模式里客人是 answer 方:工坊下发邀请码 → 内核生成回执码(事件上报,
 * 工坊展示复制)→ 房主粘贴回执 → 通道打通 → 引擎握手照常走。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;

	var guestState = nnk.state.guest = {
		session: null   /* { pc, fake, autoConnect } */
	};

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	/* 把已就绪的 FakeWebSocket 接进引擎(复刻 game.connect 的接线部分,
	 * 唯一差别是 game.sandbox 置空:nnk 通道没有原生沙盒键,好友局信任主机) */
	function connectNow() {
		var env = nnk.env;
		var session = guestState.session;
		if (!session || !session.fake || env.game.online) {
			return;
		}
		env._status.connectCallback = function(success) {
			if (success) {
				bridgeApi().setPhase("connected");
				bridgeApi().emit("session_established");
			}
		};
		if (env.game.ws) {
			env.game.ws._nocallback = true;
			env.game.ws.close();
			delete env.game.ws;
		}
		env.game.sandbox = null;
		var fake = session.fake;
		env.game.ws = fake;
		fake.onopen = env.lib.element.ws.onopen;
		fake.onmessage = env.lib.element.ws.onmessage;
		fake.onerror = env.lib.element.ws.onerror;
		fake.onclose = env.lib.element.ws.onclose;
		env._status.ip = "nnk://p2p";
		fake.replay();
		if (fake.isOpen()) {
			fake.onopen();
		}
		bridgeApi().setPhase("entering");
		bridgeApi().emit("entering_room");
	}

	function resetSession() {
		if (guestState.session && guestState.session.pc) {
			try { guestState.session.pc.close(); } catch (e) { /* 忽略 */ }
		}
		guestState.session = null;
	}

	var api = {
		init: function() {
			var env = nnk.env;
			rtc = nnk.modules.rtc;
			if (env.game.__nnkConnectPatched) {
				return;
			}
			env.game.__nnkConnectPatched = true;
			var origConnect = env.game.connect;
			env.game.connect = function(ip, callback) {
				if (typeof ip === "string" && ip.indexOf("nnk://") === 0) {
					var session = guestState.session;
					if (!session || !session.fake) {
						bridgeApi().emit("error", { message: "没有已建立的直连通道,请从工坊「加入互联网房间」重新走流程" });
						if (callback) {
							callback(false);
						}
						return;
					}
					connectNow();
					return;
				}
				return origConnect.call(env.game, ip, callback);
			};
		},

		/* 工坊命令:粘贴主机的邀请码,生成回执码(事件 answer_ready 上报) */
		joinByInvite: function(offerText) {
			resetSession();
			var env = nnk.env;
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			/* 本实例正在当主机建房:一台游戏不能既做服务器又做客人 */
			if (env._status.waitingForPlayer) {
				bridgeApi().emit("error", { message: "本游戏正在建房等待中,不能同时加入其他房间" });
				return;
			}
			var pc = new RTCPeerConnection(rtc.pcConfig());
			var session = { pc: pc, autoConnect: true };
			guestState.session = session;
			bridgeApi().setPhase("joining");
			var data;
			try {
				data = rtc.decodeCode(offerText);
				if (data.k !== "offer") {
					throw new Error("这是回执码,请粘贴房主的「邀请码」");
				}
			} catch (err) {
				resetSession();
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: err.message });
				return;
			}
			pc.ondatachannel = function(e) {
				var fake = new rtc.FakeWebSocket(e.channel);
				session.fake = fake;
				fake.onUp(function() {
					if (session.autoConnect) {
						connectNow();
					}
				});
				fake.onDown(function() {
					if (guestState.session === session) {
						guestState.session = null;
						bridgeApi().setPhase("idle");
						bridgeApi().emit("room_closed", { side: "guest" });
					}
				});
			};
			/* 连接监视:打不通不能无声悬挂(与主机端同款),失败了明确说,让房主换码 */
			pc.onconnectionstatechange = function() {
				if (pc.connectionState === "failed") {
					bridgeApi().emit("error", { message: "直连建立失败(双方网络没打通)——请房主换一张新邀请码,你重新粘贴加入;反复失败检查防火墙是否放行无名杀(UDP)" });
					bridgeApi().setPhase("idle");
					resetSession();
				}
			};
			setTimeout(function() {
				if (pc.connectionState !== "connected" && pc.connectionState !== "closed") {
					bridgeApi().emit("error", { message: "20 秒仍未打通直连(网络受限)——请房主换一张新邀请码再试" });
				}
			}, 20000);
			pc.setRemoteDescription(data.sdp).then(function() {
				return pc.createAnswer();
			}).then(function(answer) {
				return pc.setLocalDescription(answer);
			}).then(function() {
				return rtc.waitGather(pc);
			}).then(function() {
				bridgeApi().setPhase("answer_ready");
				bridgeApi().emit("answer_ready", { code: rtc.encodeCode("answer", pc.localDescription) });
			}).catch(function(err) {
				console.error("[联机助手] 加入失败", err);
				resetSession();
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "加入失败: " + (err.message || err) });
			});
		},

		cancelJoin: function() {
			resetSession();
		}
	};

	nnk.modules.guest = api;
})();

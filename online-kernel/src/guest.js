/*
 * 客人端(无头):加入互联网房间 + 接管 game.connect 的 nnk:// 地址。
 * 邀请码模式里客人是 answer 方:工坊下发邀请码 → 内核生成回执码(事件上报,
 * 工坊展示复制)→ 房主粘贴回执 → 通道打通 → 引擎握手照常走。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;
	var signaling;

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
		if (nnk.modules.compat) {
			nnk.modules.compat.unlockPacks();   /* 本地扩展包进联机选将池(闸2) */
			nnk.modules.compat.dumpExtensions();   /* 透视:本次联机实际加载/跳过了哪些扩展 */
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
		/* 包清单上报房主体检(消息走对局连接,房主内核已登记处理器) */
		if (nnk.modules.manifest) {
			nnk.modules.manifest.sendManifest();
		}
	}

	function resetSession() {
		if (guestState.session && guestState.session.pc) {
			try { guestState.session.pc.close(); } catch (e) { /* 忽略 */ }
		}
		if (guestState.session && guestState.session.mqtt) {
			try { guestState.session.mqtt.end(); } catch (e) { /* 忽略 */ }
		}
		guestState.session = null;
	}

	/* 同房号自动重进(打完一把主机端重组后):连接突然断开且对局已结束,
	 * 说明房主正在重载重建同一房间——隔几秒用原房号再敲一次门,给主机
	 * 重载重建留出时间;次数用完或用户已取消/离开就明说,引导手动重进。
	 * rejoinCode 是会话令牌:cancelJoin 置空即可停掉整个循环。 */
	function autoRejoin(code, attempts) {
		var env = nnk.env;
		if (guestState.rejoinCode !== code || attempts <= 0 || !env._status.connectMode) {
			if (guestState.rejoinCode === code) {
				guestState.rejoinCode = null;
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "自动重回房间失败——请手动输入房号 " + code + " 重进" });
			}
			return;
		}
		bridgeApi().emit("info", { message: "房主正在重组房间,自动重回 " + code + "(第 " + (9 - attempts) + " 次尝试)…" });
		api.joinByRoomCode(code);
		setTimeout(function() {
			if (guestState.rejoinCode !== code) {
				return;   /* 用户已取消 */
			}
			if (guestState.session && guestState.session.code === code) {
				guestState.rejoinCode = null;
				return;   /* 这次尝试还在连接中或已连上,交给它自己走完 */
			}
			autoRejoin(code, attempts - 1);
		}, 4000);
	}

	/*
	 * 客人加入的前置:联机界面元素(ui.control/arenalog 等)只在 mode=connect
	 * 开机时由引擎构建——从离线主菜单直接接线,引擎收到服务器的 init 包就会
	 * clearArena 崩(真机实证:ui.control undefined)。与主机同款:先重载进
	 * 联机模式,落地后 init 凭 localStorage 标记自动续跑(WebRTC/信令会话
	 * 不跨重载,由续跑重建)。
	 */
	function ensureConnectBoot(task) {
		var env = nnk.env;
		try {
			localStorage.setItem(env.lib.configprefix + "nnk_guest_pending", JSON.stringify(task));
		} catch (e) { /* 忽略 */ }
		bridgeApi().setPhase("guest_booting", task.kind === "room" ? { code: task.code } : {});
		env.game.saveConfig("mode", "connect");
		env.game.reload();
	}

	var api = {
		init: function() {
			var env = nnk.env;
			rtc = nnk.modules.rtc;
			signaling = nnk.modules.signaling;
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
			/* 重载落地:联机界面 HUD 就绪后自动续跑被重载打断的加入流程。
			 * fromResume=true 直通,不再触发重载(防引擎异常时无限重载环) */
			try {
				var pendingJson = localStorage.getItem(env.lib.configprefix + "nnk_guest_pending");
				if (pendingJson) {
					localStorage.removeItem(env.lib.configprefix + "nnk_guest_pending");
					var task = JSON.parse(pendingJson);
					var waited = 0;
					var resumeTimer = setInterval(function() {
						waited += 300;
						if (nnk.env.ui && nnk.env.ui.control && nnk.env.ui.arena) {
							clearInterval(resumeTimer);
							if (task && task.kind === "invite") {
								api.joinByInvite(task.code, true);
							} else if (task) {
								api.joinByRoomCode(task.code, true);
							}
						} else if (waited > 15000) {
							clearInterval(resumeTimer);
							bridgeApi().setPhase("idle");
							bridgeApi().emit("error", { message: "联机界面 15 秒未就绪,加入未完成——请重试" });
						}
					}, 300);
				}
			} catch (e) { /* localStorage 不可用则无续跑 */ }
		},

		/* 工坊命令:粘贴主机的邀请码,生成回执码(事件 answer_ready 上报) */
		joinByInvite: function(offerText, fromResume) {
			var env = nnk.env;
			if (!fromResume && !env._status.connectMode) {
				ensureConnectBoot({ kind: "invite", code: String(offerText || "") });
				return;
			}
			resetSession();
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

		/* 房号模式(客人=offer 方):输房号 → 经 MQTT 发连接提议,等房主应答 */
		joinByRoomCode: function(codeText, fromResume) {
			var env = nnk.env;
			if (!fromResume && !env._status.connectMode) {
				ensureConnectBoot({ kind: "room", code: String(codeText || "") });
				return;
			}
			resetSession();
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			if (env._status.waitingForPlayer) {
				bridgeApi().emit("error", { message: "本游戏正在建房等待中,不能同时加入其他房间" });
				return;
			}
			var code = String(codeText || "").trim().toUpperCase();
			if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
				bridgeApi().emit("error", { message: "房号格式不对(应为 6 位字母数字组合)" });
				return;
			}
			var pc = new RTCPeerConnection(rtc.pcConfig());
			var guestId = signaling.randomId();
			var session = { pc: pc, autoConnect: true, code: code };
			guestState.session = session;
			bridgeApi().setPhase("joining", { code: code });
			var channel = pc.createDataChannel("nnk-link", { ordered: true });
			var fake = new rtc.FakeWebSocket(channel);
			session.fake = fake;
			fake.onUp(function() {
				session.wasIn = true;
				if (session.autoConnect) {
					connectNow();
				}
			});
			fake.onDown(function() {
				if (guestState.session === session) {
					guestState.session = null;
					/* 打完一把主机端重组:连接突然断开且对局已结束,自动同房号重进 */
					if (session.wasIn && session.code && nnk.env._status.over && nnk.env._status.connectMode) {
						bridgeApi().setPhase("joining", { code: session.code });
						guestState.rejoinCode = session.code;
						autoRejoin(session.code, 8);
						return;
					}
					bridgeApi().setPhase("idle");
					bridgeApi().emit("room_closed", { side: "guest" });
				}
			});
			pc.onconnectionstatechange = function() {
				if (pc.connectionState === "failed") {
					bridgeApi().emit("error", { message: "直连建立失败(双方网络没打通)——反复失败检查防火墙是否放行无名杀(UDP),或换用邀请码方式" });
					bridgeApi().setPhase("idle");
					resetSession();
				}
			};
			var answered = false;
			pc.createOffer().then(function(offer) {
				return pc.setLocalDescription(offer);
			}).then(function() {
				return rtc.waitGather(pc);
			}).then(function() {
				return signaling.openRoomSession(code, "guest-" + guestId,
					[signaling.roomTopic(code, "answer/" + guestId), signaling.roomTopic(code, "host")],
					function(topic, msg) {
						if (/\/host$/.test(topic)) {
							session.hostSeen = Date.now();
							return;
						}
						if (/\/answer\//.test(topic) && !answered && msg && msg.sdp) {
							answered = true;
							session.hostSeen = Date.now();
							pc.setRemoteDescription(msg.sdp).catch(function(err) {
								bridgeApi().emit("error", { message: "房主应答处理失败: " + (err.message || err) });
							});
						}
					}
				).then(function(mqttSession) {
					session.mqtt = mqttSession;
					/* 房主在线校验:retained 心跳应在订阅后立即送达 */
					return new Promise(function(resolve, reject) {
						setTimeout(function() {
							if (!session.hostSeen) {
								reject(new Error("没有找到该房号的在线主机(房号可能输错,或房主已离线)"));
							} else {
								resolve(mqttSession);   /* 传给下一步发提议用(参数作用域不跨 then) */
							}
						}, 3500);
					});
				}).then(function(mqttSession) {
					return mqttSession.publish(signaling.roomTopic(code, "offer"), {
						guestId: guestId,
						sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
					});
				}).then(function() {
					bridgeApi().setPhase("waiting_host", {});
					setTimeout(function() {
						if (!answered && guestState.session === session) {
							bridgeApi().emit("error", { message: "30 秒未收到房主应答(可能已掉线)——重新输入房号再试,或换用邀请码方式" });
						}
					}, 30000);
				}).catch(function(err) {
					resetSession();
					bridgeApi().setPhase("idle");
					bridgeApi().emit("error", { message: (err && err.message) || "加入失败" });
				});
			}).catch(function(err) {
				resetSession();
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "加入失败: " + (err.message || err) });
			});
		},

		cancelJoin: function() {
			guestState.rejoinCode = null;   /* 停掉还在跑的自动重进循环 */
			resetSession();
			/* 重载尚未落地就取消:把待续跑标记一并清掉,落地后不再自动加入 */
			try {
				localStorage.removeItem(nnk.env.lib.configprefix + "nnk_guest_pending");
			} catch (e) { /* 忽略 */ }
		}
	};

	nnk.modules.guest = api;
})();

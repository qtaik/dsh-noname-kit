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
		stage: null,          /* lobby=P2P 大厅(未进引擎) | loaded=引擎房间已建 */
		roomCode: null,
		reuseCode: null,      /* 打完一把重载重组:接力上局的房号,客人自动重进 */
		inviteAt: 0,          /* 当前邀请码生成时刻:候选地址会随 NAT 映射过期,时效提示用 */
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
		/* 打完一把重载重组:接力上局房号,客人凭同一房号自动重进 */
		hostState.roomCode = hostState.reuseCode || genRoomCode();
		hostState.reuseCode = null;
		hostState.stage = "loaded";
		game.ip = "nnk://" + hostState.roomCode;
		if (nnk.modules.compat) {
			nnk.modules.compat.unlockPacks();
			nnk.modules.compat.dumpExtensions();   /* 透视:本次联机实际加载/跳过了哪些扩展 */
		}
		bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode, signaling: hostState.signaling });
		emitRoomMembers();   /* 房间一建好就报成员表,工坊弹窗从一开始就有准确容量 */
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

	/* 模式人数上限:优先读引擎的模式配置(lib.mode[模式].config.player_number.item,
	 * 动态 getter——身份 2~10、国战 2~12),读不到用兜底表。
	 * 兜底表按引擎真值:对决 1v1~4v4=2/4/6/8、斗地主固定 3、单挑 2 */
	function modeMaxPlayers(mode) {
		var fallback = { identity: 10, guozhan: 12, versus: 8, doudizhu: 3, single: 2 };
		try {
			var pn = nnk.env.lib.mode[mode] && nnk.env.lib.mode[mode].config && nnk.env.lib.mode[mode].config.player_number;
			var nums = (pn && pn.item ? Object.keys(pn.item) : []).map(function(k) {
				return parseInt(k, 10);
			}).filter(function(n) {
				return !isNaN(n);
			});
			if (nums.length) {
				return Math.max.apply(null, nums);
			}
		} catch (e) { /* 忽略 */ }
		return fallback[mode] || 10;
	}

	/* 房间真实容量:载入后读引擎房间配置。取值顺序对齐引擎口径——
	 * 引擎自己的放人自检读 configOL.number(library/index.js「denied number」),
	 * 显示口径是 player_number || number(ui/create);identity 8 人局改人数后
	 * 两个键都会跟着变,对决/斗地主/单挑由 waitForPlayer 设 number。
	 * 大厅阶段房间还没建,configOL 可能是上一局的残值,不可信,退回模式上限 */
	function roomCapacity() {
		var env = nnk.env;
		var mode = hostState.roomMode || "identity";
		if (hostState.stage === "loaded") {
			try {
				if (env.lib.configOL && env.lib.configOL.mode === mode) {
					var n = parseInt(env.lib.configOL.number, 10) || parseInt(env.lib.configOL.player_number, 10);
					if (n > 0) {
						return n;
					}
				}
			} catch (e) { /* 读不到退回模式上限 */ }
		}
		return modeMaxPlayers(mode);
	}

	/* 各模式人数上限快照(随成员表上报工坊):工坊弹窗的座位数/模式标签用它,
	 * 点其他模式也能立刻显示该模式能装几人 */
	function modeCaps() {
		var caps = {};
		["identity", "guozhan", "versus", "doudizhu", "single"].forEach(function(m) {
			caps[m] = modeMaxPlayers(m);
		});
		return caps;
	}

	/* 成员表上报(弹窗②数据源):房主始终在等待队列首位(带人物标识名字),
	 * capacity=房间真实容量(roomCapacity,工坊据此画空座位)。
	 * 同时转发给停泊中的客人(nnk_members):客人弹窗的等待队列不再是空的,
	 * 排队的人也能看到自己排第几、前面还有几个空位 */
	function emitRoomMembers() {
		var list = [];
		try {
			var av = nnk.env.lib.config.connect_avatar || "";
			list.push({
				name: nnk.env.get.connectNickname(),
				avatar: nnk.env.lib.translate[av] || av,
				role: "host",
				entered: hostState.stage === "loaded"
			});
		} catch (e) { /* env 未就绪则只报客人 */ }
		hostState.bridges.forEach(function(b) {
			list.push({
				name: (b._member && b._member.name) || "已连接客人",
				avatar: (b._member && b._member.avatar) || "",
				entered: !!b._entered,
				queued: !!b._queued
			});
		});
		var cap = roomCapacity();
		var payload = {
			list: list,
			capacity: cap,
			mode: hostState.roomMode || null,   /* 房间当前模式(工坊判「选中模式=房间模式」用真容量) */
			caps: modeCaps()                    /* 各模式人数上限(座位数/标签数据源) */
		};
		bridgeApi().emit("room_members", payload);
		hostState.bridges.forEach(function(b) {
			if (!b._entered) {
				try { b.send(JSON.stringify({ nnk_members: payload })); } catch (e2) { /* 通道可能已半死 */ }
			}
		});
	}

	/* 空位补进:等待房里有人退出后,把排队里的第一个提升进引擎。
	 * 只在等待房阶段补位(stage=loaded 且引擎在等客):对局中有人掉线,
	 * 空位交给引擎原生机制(断线重连/掉线转 AI),不把排队客人硬塞进
	 * 进行中的对局——下一局载入时所有客人重新过门禁,按容量进门 */
	function promoteNextQueued() {
		var env = nnk.env;
		if (hostState.stage !== "loaded" || !env._status.waitingForPlayer) {
			return;
		}
		var capacity = roomCapacity();
		var enteredGuests = hostState.bridges.filter(function(b) {
			return b._entered;
		}).length;
		if (enteredGuests >= capacity - 1) {
			return;   /* 房主占 1 席,客人上限 = 上限-1 */
		}
		for (var i = 0; i < hostState.bridges.length; i++) {
			var b = hostState.bridges[i];
			if (b._queued) {
				b._queued = false;
				b.send(JSON.stringify({ nnk_stage: "loaded" }));
				env.lib.init.connection(b);
				b._entered = true;
				emitRoomMembers();
				bridgeApi().setPhase("room_open", { roomCode: hostState.roomCode, signaling: hostState.signaling });
				bridgeApi().emit("guest_connected", { guests: enteredGuests + 1 });
				return;
			}
		}
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
					emitRoomMembers();
					promoteNextQueued();
				});
				if (hostState.stage === "lobby") {
					/* 大厅停车:引擎不接管,内核级 hello/成员表先跑;
					 * 载入后 lib.init.connection 的 on("message") 会自然接管本槽 */
					conn.send(JSON.stringify({ nnk_stage: "lobby" }));
					conn.onmessage = function(data) {
						try {
							var msg2 = JSON.parse(data);
							if (msg2 && msg2.nnk_hello) {
								var av = String(msg2.nnk_hello.avatar || "");
								conn._member = {
									name: String(msg2.nnk_hello.name || "").slice(0, 12) || "客人",
									avatar: (nnk.env.lib.translate[av] || av)
								};
								emitRoomMembers();
							}
						} catch (e3) { /* 非内核协议消息忽略 */ }
					};
					return;
				}
				/* 等待队列门禁:房主占 1 席,客人按模式容量进入,超员排队等空位 */
				var queueCapacity = roomCapacity();
				var enteredGuests = hostState.bridges.filter(function(b) {
					return b._entered;
				}).length;
				if (enteredGuests >= queueCapacity - 1) {
					conn.send(JSON.stringify({ nnk_stage: "queued" }));
					conn._queued = true;
					emitRoomMembers();
					return;
				}
				conn.send(JSON.stringify({ nnk_stage: "loaded" }));
				env.lib.init.connection(conn);
				conn._entered = true;
				emitRoomMembers();
				/* 上报 room_open:工坊据此把「房号就绪…等朋友加入」换成
				 * 「客人已连接,游戏里点开始游戏」(此前无阶段承载,文案是死的) */
				bridgeApi().setPhase("room_open", { roomCode: code, signaling: hostState.signaling });
				bridgeApi().emit("guest_connected", { guests: enteredGuests + 1 });
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

	/* 关掉所有"停在大厅/排队"的内核级连接(已交给引擎的连接归引擎管,不动):
	 * 主机取消或另建新房时,停泊中的客人靠 nnk_stage=closed 立即知道房主已散,
	 * 不用在排队页干等,也不会把旧成员带进下一个房间的成员表 */
	function closeParkedBridges() {
		hostState.bridges.forEach(function(b) {
			if (b._entered) {
				return;
			}
			try { b.send(JSON.stringify({ nnk_stage: "closed" })); } catch (e) { /* 通道可能已半死 */ }
			try { b.close(); } catch (e2) { /* 已关 */ }
		});
		hostState.bridges = hostState.bridges.filter(function(b) {
			return b._entered;
		});
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
			/* 队列门禁与房号模式同款:房满就拒(先发 full 再关,客人端内核 tap
			 * 认得它,给人话提示),邀请码通道不再绕过人数限制 */
			var capacity = roomCapacity();
			var enteredGuests = hostState.bridges.filter(function(b) {
				return b._entered;
			}).length;
			if (enteredGuests >= capacity - 1) {
				try { channel.send(JSON.stringify({ nnk_stage: "full" })); } catch (e2) { /* 忽略 */ }
				try { pc.close(); } catch (e3) { /* 忽略 */ }
				bridgeApi().emit("error", { message: "房间人数已满(" + capacity + " 人),这位客人没能进入——等有人退出,再发一张新邀请码让他重连" });
				return;
			}
			var conn = new rtc.HostBridge(channel);
			conn._pc = pc;
			hostState.bridges.push(conn);
			conn.onDown(function() {
				var i = hostState.bridges.indexOf(conn);
				if (i >= 0) {
					hostState.bridges.splice(i, 1);
				}
			});
			/* 与房号模式同款:先发内核放行指令再交给引擎——客人端 tap 收到
			 * loaded 才接引擎,full/closed 这类内核消息也才有人接 */
			conn.send(JSON.stringify({ nnk_stage: "loaded" }));
			env.lib.init.connection(conn);
			conn._entered = true;
			bridgeApi().setPhase("room_open", { roomCode: hostState.roomCode, signaling: hostState.signaling });
			bridgeApi().emit("guest_connected", { guests: hostState.bridges.filter(function(b2) { return b2._entered; }).length });
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
			hostState.inviteAt = Date.now();
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
			bridgeApi().emit("error", { message: reason + "。已自动生成新邀请码——常见原因是码放太久(里面的候选地址过期)或防火墙拦 UDP:新码生成后要马上发给朋友马上用,别攒" });
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
					/* 信令方式与阶段都要接力:lobby=回到大厅(引擎停在联机菜单,
					 * 不建等待房);loaded=直启进引擎等待房间。兼容旧格式(纯串=loaded) */
					var pendingStage = "loaded";
					try {
						var pendingTask = JSON.parse(pending);
						if (pendingTask && typeof pendingTask === "object") {
							hostState.signaling = pendingTask.signaling === "invite" ? "invite" : "mqtt";
							if (pendingTask.stage === "lobby") {
								pendingStage = "lobby";
							}
							if (pendingTask.mode) {
								hostState.roomMode = pendingTask.mode;
							}
						}
					} catch (e) { /* 旧格式,按 loaded 处理 */ }
					/* 打完一把重组的接力房号(普通建房没有这个键,照常生成新号) */
					var reuseCode = localStorage.getItem(env.lib.configprefix + "nnk_host_roomcode");
					if (reuseCode && /^[A-HJ-NP-Z2-9]{6}$/.test(reuseCode)) {
						hostState.reuseCode = reuseCode;
					}
					localStorage.removeItem(env.lib.configprefix + "nnk_host_roomcode");
					hostState.active = true;
					console.log("[联机助手] 检测到待建房间标记,重载后继续互联网建房(" + pendingStage + ")" + (hostState.reuseCode ? "(沿用原房号 " + hostState.reuseCode + ")" : ""));
					if (pendingStage === "lobby") {
						/* 大厅续跑:引擎停在联机菜单即可,内核恢复信令继续收成员 */
						hostState.stage = "lobby";
						hostState.roomCode = hostState.reuseCode || genRoomCode();
						hostState.reuseCode = null;
						env.game.ip = "nnk://" + hostState.roomCode;
						if (hostState.signaling === "mqtt") {
							startMqtt();
							bridgeApi().setPhase("mqtt_waiting", { roomCode: hostState.roomCode });
						}
						console.log("[联机助手] 大厅已恢复(房号 " + hostState.roomCode + "),等待载入到游戏");
					} else {
						hostState.stage = "loaded";
						/* 自愈看门狗:重载后 20 秒房间还没建起来(开机竞速/接力配置写入
						 * 丢失,实测卡纯背景页),带原模式原房号自动再重载一次。
						 * 只救一次:救援重载写入的 pending 带 rescued=true,带标记的开机
						 * 不再重载级救援(防无限重载循环),只上报引导手动。
						 * lobby 阶段不需要建房,看门狗不生效 */
						var watchdogMode = (pendingTask && typeof pendingTask === "object" && pendingTask.mode) || "identity";
						var alreadyRescued = !!(pendingTask && typeof pendingTask === "object" && pendingTask.rescued);
						setTimeout(function() {
							if (!hostState.active || hostState.roomCode || env._status.waitingForPlayer || env._status.over) {
								return;   /* 房间已就绪/已取消/已在局中,不用救 */
							}
							if (alreadyRescued) {
								bridgeApi().emit("error", { message: "房间自动重试后仍未建起来——请回工坊重新创建房间,或重启游戏后再试" });
								return;
							}
							try {
								localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: watchdogMode, signaling: hostState.signaling, stage: "loaded", rescued: true }));
								if (hostState.reuseCode) {
									localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.reuseCode);
								}
								localStorage.setItem(env.lib.configprefix + "directstart", "true");
								console.warn("[联机助手] 重载后房间未就绪,自动带原房号再重载一次");
								bridgeApi().emit("info", { message: "重载后房间没建起来,正在自动重试(带原房号)…" });
								var waits = 2;
								var gone = false;
								var go2 = function() {
									if (!gone) {
										gone = true;
										env.game.reload();
									}
								};
								env.game.saveConfig("directstartmode", watchdogMode, null, go2);
								env.game.saveConfig("mode", "connect", null, go2);
								setTimeout(go2, 1500);
								return;
							} catch (e) { /* 忽略 */ }
							env.game.reload();
						}, 20000);
					}
				} else if (env.lib.config.directstartmode || localStorage.getItem(env.lib.configprefix + "directstart")) {
					env.game.saveConfig("directstartmode");
					localStorage.removeItem(env.lib.configprefix + "directstart");
					console.log("[联机助手] 已清除上次建房残留的自动回房标记,本次开机不自动进房");
				}
			} catch (e) { /* localStorage 不可用则无接力 */ }
			/* 打完一把不散房:引擎在联机对局结束后强制 game.reload(结束 15 秒定时器
			 * 和「重新开始」按钮都走它),软服务器随页面消失,房间即散。包装 reload:
			 * 对局刚结束(over)且房号模式房间还在时,把同一房号接力过去再重载——
			 * 重载后沿用原房号续建,客人凭断线感知自动重进,谁都不用再输码。
		 * ★ saveConfig 是异步写库,直接重载会把 mode 的写入丢掉(实测:重载后
		 *   引擎拿不到直启标记,卡在纯背景页)——等写入回调落地再重载,1.5 秒
		 *   兜底防写库挂死;directstartmode 故意不写(回大厅不自动进房)。
		 * 邀请码模式的 SDP 一次性无法复用,仍是重载即散(备用方式不变) */
		if (!env.game.__nnkReloadPatched) {
			env.game.__nnkReloadPatched = true;
			var origReload = env.game.reload;
			hostState.origReload = origReload;   /* 工坊「载入/重开」复用同一重载 */
			env.game.reload = function() {
				try {
					if (hostState.active && hostState.roomCode && hostState.signaling === "mqtt"
						&& env._status.connectMode && env._status.over) {
						var overMode = env._status.mode || "identity";
						/* 回大厅:重载后引擎停在联机菜单,stage=lobby,成员重连后
						 * 停车等待下一次载入;directstartmode 故意不写(不自动进房) */
						localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: overMode, signaling: "mqtt", stage: "lobby" }));
						localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.roomCode);
						localStorage.setItem(env.lib.configprefix + "directstart", "true");
						bridgeApi().emit("info", { message: "对局结束,已回到房间大厅(原房号 " + hostState.roomCode + " 保留),选模式后点「载入到游戏」继续" });
						var waits = 1;
						var gone = false;
						var go = function() {
							if (gone) {
								return;
							}
							gone = true;
							origReload.apply(env.game);
						};
						env.game.saveConfig("mode", "connect", null, go);
						setTimeout(go, 1500);
						return;
					}
				} catch (e) { /* 接力失败则按老行为散房 */ }
				return origReload.apply(this, arguments);
			};
		}
	},

		/* 工坊命令:创建互联网房间。
		 * mqtt(默认)= 大厅路径:只建信令与房号,主机停在当前界面不重载,
		 * 选模式后由「载入到游戏」(restart_room)进引擎;
		 * invite(备用)= 旧路径:邀请码 offer 要求引擎房间先建好,走重载直启。 */
		createInternetRoom: function(mode, signalingMode) {
			var env = nnk.env;
			mode = String(mode || "identity");
			hostState.signaling = signalingMode === "invite" ? "invite" : "mqtt";
			if (["identity", "guozhan", "versus", "doudizhu", "single"].indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			if (hostState.active && hostState.roomCode) {
				/* 房间已存在(弹窗重开/页面刷新):不发新房号,恢复显示。
				 * 有房号的房间必是 mqtt(邀请码房没有房号)——信令方式钉回去,
				 * 防止这次传进来的 invite 参数翻转 signaling,害「载入到游戏」误拒 */
				hostState.signaling = "mqtt";
				bridgeApi().setPhase(hostState.stage === "loaded" ? "room_open" : "mqtt_waiting", { roomCode: hostState.roomCode, signaling: "mqtt", stage: hostState.stage });
				emitRoomMembers();
				return;
			}
			if (hostState.signaling === "invite") {
				/* 邀请码备用路径(旧流程):重载直启建引擎房间 */
				hostState.stage = "loaded";
				hostState.active = true;
				hostState.roomMode = mode;   /* 容量门禁按这次选的模式算 */
				bridgeApi().setPhase("host_booting", { mode: mode });
				try {
					localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: mode, signaling: "invite", stage: "loaded" }));
					localStorage.setItem(env.lib.configprefix + "directstart", "true");
				} catch (e) { /* 忽略 */ }
				var inviteWaits = 2;
				var inviteGone = false;
				var inviteGo = function() {
					if (inviteGone) {
						return;
					}
					inviteGone = true;
					env.game.reload();
				};
				env.game.saveConfig("directstartmode", mode, null, inviteGo);
				env.game.saveConfig("mode", "connect", null, inviteGo);
				setTimeout(inviteGo, 1500);
				return;
			}
			/* 大厅路径:瞬间完成,不重载不进游戏 */
			if (env.game.players && env.game.players.length && !env._status.over && !env._status.waitingForPlayer) {
				bridgeApi().emit("info", { message: "检测到对局未结束:大厅先建着,「载入到游戏」时会自动退出对局" });
			}
			/* 上一次会话停泊的客人(大厅/排队)不带走:通知散场再开新房 */
			closeParkedBridges();
			hostState.stage = "lobby";
			hostState.active = true;
			hostState.roomMode = mode;
			hostState.roomCode = genRoomCode();
			env.game.ip = "nnk://" + hostState.roomCode;
			bridgeApi().setPhase("mqtt_waiting", { roomCode: hostState.roomCode, stage: "lobby" });
			startMqtt();
			emitRoomMembers();   /* 新房立刻报一张成员表(工坊弹窗不等第一位客人) */
		},

		refreshInvite: function() {
			var env = nnk.env;
			if (!hostState.roomCode) {
				bridgeApi().emit("error", { message: "还没有可用的房间,请先创建互联网房间" });
				return;
			}
			if (hostState.signaling === "mqtt") {
				/* 房号模式换码:重生成房号并重挂信令(旧房号的心跳随之停止)。
				 * 大厅阶段不碰引擎随时可换;等待房阶段要求引擎就绪(env_ready) */
				if (hostState.stage === "loaded" && !env_ready()) {
					bridgeApi().emit("error", { message: "房间还没就绪,稍等一下再换房号" });
					return;
				}
				cleanupMqtt();
				hostState.roomCode = genRoomCode();
				env.game.ip = "nnk://" + hostState.roomCode;
				bridgeApi().setPhase(hostState.stage === "lobby" ? "mqtt_waiting" : "hosting", { roomCode: hostState.roomCode });
				startMqtt();
				return;
			}
			if (!env_ready()) {
				bridgeApi().emit("error", { message: "还没有可用的房间,请先创建互联网房间" });
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
		/* 码龄预警:邀请码里的 ICE 候选跟着 NAT 端口映射活,映射几十秒到几
		 * 分钟就过期——实测放 14 分钟的码必失败。粘码时先报个龄,失败了别懵 */
		var ageMin = hostState.inviteAt ? Math.round((Date.now() - hostState.inviteAt) / 60000) : 0;
		if (ageMin >= 3) {
			bridgeApi().emit("info", { message: "这张邀请码已生成 " + ageMin + " 分钟——码放太久,里面的候选地址基本过期了,直连大概率失败;失败后点「换一张邀请码重试」,新码要马上发马上用" });
		}
		watchHostConnection(pc);
	}).catch(function(err) {
		bridgeApi().emit("error", { message: "回执码无效: " + (err.message || err) });
	});
		},

		/* 工坊大厅:按所选模式重开一局(原房号不变,客人自动重回)。
		 * 等待房/结算屏都可以点;对局进行中拒绝。 */
		restartRoom: function(mode) {
			var env = nnk.env;
			if (!hostState.active || !hostState.roomCode || hostState.signaling !== "mqtt") {
				bridgeApi().emit("error", { message: "还没有房号模式的房间可以重开" });
				return;
			}
			mode = String(mode || env._status.mode || "identity");
			if (["identity", "guozhan", "versus", "doudizhu", "single"].indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.players && env.game.players.length && !env._status.over && !env._status.waitingForPlayer) {
				bridgeApi().emit("error", { message: "对局还没打完,结束后再重开" });
				return;
			}
			try {
				localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: mode, signaling: "mqtt", stage: "loaded" }));
				localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.roomCode);
				localStorage.setItem(env.lib.configprefix + "directstart", "true");
			} catch (e) { /* 忽略 */ }
			hostState.stage = "loaded";
			hostState.roomMode = mode;
			bridgeApi().emit("info", { message: "正在按「" + (env.lib.translate[mode] || mode) + "」重开房间(原房号 " + hostState.roomCode + ",客人自动重回)…" });
			var waits = 2;
			var gone = false;
			var go = function() {
				if (gone) {
					return;
				}
				gone = true;
				hostState.origReload.apply(env.game);
			};
			/* 与「重新开始」同款:配置写库回调落地后再重载(1.5 秒兜底) */
			env.game.saveConfig("directstartmode", mode, null, go);
			env.game.saveConfig("mode", "connect", null, go);
			setTimeout(go, 1500);
		},

		cancelAll: function() {
			var env = nnk.env;
			hostState.active = false;
			hostState.stage = null;
			hostState.reuseCode = null;
			/* 房号一并清掉:残留的话,工坊会显示幻影房号,甚至把旧房号当活房
			 * 恢复显示(那个房号的信令早已拆掉,朋友加入只会扑空) */
			hostState.roomCode = null;
			hostState.roomMode = null;
			if (hostState.invitePc) {
				try { hostState.invitePc.close(); } catch (e) { /* 忽略 */ }
				hostState.invitePc = null;
			}
			/* 大厅/排队的客人收到 nnk_stage=closed 立即散场,不会永远挂在排队页 */
			closeParkedBridges();
			cleanupMqtt();
			try {
				localStorage.removeItem(env.lib.configprefix + "nnk_host_pending");
				localStorage.removeItem(env.lib.configprefix + "nnk_host_roomcode");
			} catch (e) { /* 忽略 */ }
		}
	};

	function env_ready() {
		return nnk.env && nnk.env._status.waitingForPlayer;
	}

	nnk.modules.host = api;
})();

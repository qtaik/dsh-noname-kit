/*
 * 主机端(无头):软服务器 + 一体化房间的两道门。房间由房号标识、恒有房号门
 * (MQTT 信令);邀请码是同一个房间的第二道门,按需生成(一客一张)。
 * 原生 createServer 在渲染进程里 require("ws") 起 8080 监听;这里把它整个
 * 换成 WebRTC 接客——每个客人的 DataChannel 包成 HostBridge 交给
 * lib.init.connection,引擎从此以为来的是普通客人。房主自己的座位由
 * waitForPlayer 直接创建(playerid="1"),不经过任何 socket。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;
	var signaling;

	/* 房间模式白名单(唯一来源:校验/人数表/UI 列表都用它)。
	 * 引擎会在联机单挑局里把 _status.mode 原生改写成 "normal"(mode/single.js),
	 * 任何把引擎当前模式当房间模式收下的路径都会被污染成非法值——
	 * 实测症状:创建房间恒报「不支持的模式: normal」,刷新也解不开 */
	var ROOM_MODES = ["identity", "guozhan", "versus", "doudizhu", "single"];

	var hostState = nnk.state.host = {
		active: false,        /* 本次启动里已进入"互联网建房"流程(含跨重载接力) */
		signaling: "mqtt",    /* 恒为 mqtt:一体化房间必有房号门;邀请码是同一房间的第二道门,
		                       * 按需生成(一客一张),不在这里记状态 */
		stage: null,          /* lobby=P2P 大厅(未进引擎) | loaded=引擎房间已建 */
		roomCode: null,
		roomMode: null,       /* 房间当前模式(ROOM_MODES 之一;建房/恢复时赋值,解散清空) */
		reuseCode: null,      /* 打完一把重载重组:接力上局的房号,客人自动重进 */
		invites: [],          /* 邀请码列表(一客一张,可同时挂多张):见 startInvite */
		inviteSeq: 0,         /* 邀请码行号自增(列表里按行号定位:粘回执码/作废) */
		bridges: [],
		mqttSession: null,
		presenceTimer: null,
		mqttGen: 0            /* 信令会话代号:startMqtt 递增,作废迟到会话用 */
	};

	/* 一张邀请码最多同时挂几张:候选地址会随 NAT 映射过期,挂多了也没用,
	 * 还白占本机端口;超了就挤掉最老的那张(列表里留痕,不静默消失) */
	var MAX_PENDING_INVITES = 6;
	/* 列表总行数上限(含已用/失效的历史行):超了从最老的失效行开始扔 */
	var MAX_INVITE_ROWS = 12;

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	/* 虚拟网卡直连候选的播报(每次开机只说一次,防高频重试刷屏) */
	var directNoted = { sent: false, recv: false };
	function noteSent(hosts) {
		if (hosts.length && !directNoted.sent) {
			directNoted.sent = true;
			bridgeApi().emit("info", { message: "检测到虚拟网卡地址 " + hosts.join("、") + ",已作为直连候选随信令发出" });
		}
		return hosts;
	}
	function noteRecv(count) {
		if (count > 0 && !directNoted.recv) {
			directNoted.recv = true;
			bridgeApi().emit("info", { message: "客人提供了 " + count + " 个虚拟网卡直连地址,已加入连接尝试" });
		}
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
		/* 打完一把重载重组:接力上局房号,客人凭同一房号自动重进;
		 * 原地载入路径:保留大厅已经在用的房号(roomCode 已有) */
		hostState.roomCode = hostState.roomCode || hostState.reuseCode || genRoomCode();
		hostState.reuseCode = null;
		hostState.stage = "loaded";
		game.ip = "nnk://" + hostState.roomCode;
		if (nnk.modules.compat) {
			nnk.modules.compat.unlockPacks();
			nnk.modules.compat.dumpExtensions();   /* 透视:本次联机实际加载/跳过了哪些扩展 */
		}
		bridgeApi().setPhase("hosting", { roomCode: hostState.roomCode, signaling: hostState.signaling });
		emitRoomMembers();   /* 房间一建好就报成员表,工坊弹窗从一开始就有准确容量 */
		/* 信令已在大厅跑着就不重挂(原地载入路径);重载路径 mqttSession 为空照常起 */
		if (!hostState.mqttSession) {
			startHosting();
		}
		/* 原地载入:大厅停泊的客人不断开——等引擎就绪后直接用现有通道交给引擎 */
		admitParkedWhenReady();
	}

	/* 原地载入收编:等引擎就绪标志(waitingForPlayer 置真=等待房座位已建好,
	 * 此时客人 init 不会被引擎的"未就绪拒客"分支拦下),再把停泊客人按容量
	 * 逐个用现有通道交给引擎——零断开、零重连;超容量的继续排队 */
	function admitParkedWhenReady() {
		var env = nnk.env;
		if (!hostState.bridges.some(function(b) { return !b._entered; })) {
			return;   /* 没有停泊客人,不用等 */
		}
		var waited = 0;
		var timer = setInterval(function() {
			waited += 200;
			if (env._status.waitingForPlayer) {
				clearInterval(timer);
				admitAllParked();
			} else if (waited > 10000) {
				clearInterval(timer);   /* 引擎久久未就绪:不硬塞,客人留在队列 */
			}
		}, 200);
	}

	/* 把停泊客人按容量收进引擎(原地载入用;重载路径 bridges 为空,天然无操作) */
	function admitAllParked() {
		var env = nnk.env;
		var capacity = roomCapacity();
		var enteredGuests = hostState.bridges.filter(function(b) { return b._entered; }).length;
		var admitted = 0;
		hostState.bridges.forEach(function(b) {
			if (b._entered || enteredGuests >= capacity - 1) {
				return;
			}
			b._queued = false;
			b.send(stageMsg("loaded"));
			env.lib.init.connection(b);
			b._entered = true;
			enteredGuests += 1;
			admitted += 1;
		});
		emitRoomMembers();
		if (admitted > 0) {
			settleInvitePhase();   /* 还有码在等回执就停在 invite_ready,否则 room_open */
			bridgeApi().emit("guest_connected", { guests: enteredGuests });
		}
	}

	/* 原地进房:调引擎原生的"菜单→建房"(switchMode → waitForPlayer → createServer)。
	 * 12 秒看门狗:迟迟等不到引擎就绪(waitingForPlayer)就放弃原地、退回重载。
	 * 返回 false=switchMode 都没调起来,调用方立即落回重载 */
	function startInPlace(mode) {
		var env = nnk.env;
		var done = false;
		var timer = setInterval(function() {
			if (env._status.waitingForPlayer) {
				done = true;
				clearInterval(timer);
			}
		}, 200);
		setTimeout(function() {
			clearInterval(timer);
			if (!done && hostState.active && hostState.stage === "loaded" && !env._status.waitingForPlayer) {
				done = true;
				bridgeApi().emit("info", { message: "原地进入未成功,改用重载方式…" });
				reloadIntoGame(mode);
			}
		}, 12000);
		try {
			env.game.switchMode(mode);
			return true;
		} catch (e) {
			done = true;
			clearInterval(timer);
			return false;
		}
	}

	/* 重载进房(老路径):接力标记 + 通知客人载入 + 等写库回调落地再重载 */
	function reloadIntoGame(mode) {
		var env = nnk.env;
		try {
			localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: mode, signaling: "mqtt", stage: "loaded" }));
			localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.roomCode);
			localStorage.setItem(env.lib.configprefix + "directstart", "true");
		} catch (e) { /* 忽略 */ }
		hostState.stage = "loaded";
		hostState.roomMode = mode;
		/* 通知客人「主机要载入重载了」:客人端据此把自动重回的话术切成
		 * 「载入跟随」;顺带清掉 retained 心跳——重载窗口里新来的/重试的
		 * 客人会立刻看到「没找到在线主机」快速重试,而不是对着旧心跳
		 * 白等 30 秒(主机重启后 startMqtt 会重新挂上心跳) */
		try {
			if (hostState.mqttSession) {
				hostState.mqttSession.publish(signaling.roomTopic(hostState.roomCode, "host"), { nnk_loading: true });
				hostState.mqttSession.publishRaw(signaling.roomTopic(hostState.roomCode, "host"), "", true);
			}
		} catch (eN) { /* 通知失败不影响重载 */ }
		bridgeApi().emit("info", { message: "正在按「" + (env.lib.translate[mode] || mode) + "」重开房间(原房号 " + hostState.roomCode + ",客人自动重回)…" });
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
	}

	/* 挂"房号门"(一体化房间恒有)。邀请码是同一房间的第二道门,由工坊
	 * 「生成邀请码」按需开,不在这里挂 */
	function startHosting() {
		startMqtt();
	}

	/* 房号门(MQTT):主机是 answer 方——订阅 offer 主题,每个客人一条
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
			if (hostState.roomCode !== code || hostState.mqttGen !== gen) {
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
			bridgeApi().emit("error", { message: "房号信令连接失败: " + (err.message || err) + " —— 可给朋友生成一张邀请码,从另一道门进来" });
		});
	}

	/* 模式人数上限:引擎的 player_number.item 选项列表理论上开到 10/12
	 * (_status.maximumNumberOfPlayers 全库无赋值处,恒走默认),但实战口径的
	 * 可用上限是 8(用户实机校准:身份/国战 9+ 人的局不实用)——取「引擎
	 * 读取」与「实战上限」的较小者,引擎哪天改小了也跟随。
	 * 对决按 1v1~4v4=2/4/6/8、斗地主固定 3、单挑 2。
	 * 载入后房间真值仍以 configOL 为准(房间设置真开了 9 人局,座位显示 9) */
	function modeMaxPlayers(mode) {
		var practical = { identity: 8, guozhan: 8, versus: 8, doudizhu: 3, single: 2 };
		var cap = practical[mode] || 8;
		try {
			var pn = nnk.env.lib.mode[mode] && nnk.env.lib.mode[mode].config && nnk.env.lib.mode[mode].config.player_number;
			var nums = (pn && pn.item ? Object.keys(pn.item) : []).map(function(k) {
				return parseInt(k, 10);
			}).filter(function(n) {
				return !isNaN(n);
			});
			if (nums.length) {
				return Math.min(Math.max.apply(null, nums), cap);
			}
		} catch (e) { /* 忽略 */ }
		return cap;
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
		ROOM_MODES.forEach(function(m) {
			caps[m] = modeMaxPlayers(m);
		});
		return caps;
	}

	/* 成员表上报(工坊房间大厅的数据源):房主始终在等待队列首位(带人物标识
	 * 名字),capacity=房间真实容量(roomCapacity,工坊据此画空座位)。
	 * 同时转发给每个客人(nnk_members):停泊中的客人靠内核 tap 接,已进引擎的
	 * 客人靠自己的内核在通道里嗅探同一条消息——两种门、进没进引擎都推,
	 * 客人弹窗才不会在进房那一刻定格(实测:两边都显示「等待载入」) */
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
			try { b.send(JSON.stringify({ nnk_members: payload })); } catch (e2) { /* 通道可能已半死 */ }
		});
	}

	/* 内核阶段指令(大厅/排队/放行)统一带上房号:客人存下来,断线后就能走
	 * 房号门自动重回——两道门进来的客人待遇一样,自动恢复不再区分门 */
	function stageMsg(stage) {
		return JSON.stringify({ nnk_stage: stage, code: hostState.roomCode });
	}

	/* 登记一条新客人通道(两道门共用):入册 + 挂统一的下线清理——
	 * 摘客、停心跳、刷新成员表、让排队的人补位 */
	function registerBridge(conn, pc) {
		hostState.bridges.push(conn);
		conn.onDown(function() {
			var i = hostState.bridges.indexOf(conn);
			if (i >= 0) {
				hostState.bridges.splice(i, 1);
			}
			if (pc._nnkPing) {
				try { pc._nnkPing.stop(); } catch (eP) { /* 忽略 */ }
			}
			if (pc._nnkPingCh) {
				try { pc._nnkPingCh.close(); } catch (eP2) { /* 忽略 */ }
			}
			/* 走邀请码门进来的客人走了:这条 pc 已无人使用,收掉它——不收的话
			 * used 行会一直攥着一条死连接,列表(和 0.7 秒一轮的心跳)随进房人数
			 * 单调增长,行数上限也压不住。used 行本身保留作"谁来过"的痕迹,
			 * 由 pruneInvites 按数量回收 */
			if (conn._invite && pc._nnkClosed !== true) {
				pc._nnkClosed = true;
				try { pc.close(); } catch (eC) { /* 忽略 */ }
			}
			emitRoomMembers();
			promoteNextQueued();
		});
	}

	/* 接客公共流程(房号门与邀请码门完全共用):按房间阶段决定这位客人是停在
	 * 大厅等载入、排队等空位,还是直接交给引擎——两道门只是"客人怎么找到
	 * 主机"的差别,进来之后的成员表/容量队列/载入流程全共享 */
	function handleNewBridge(conn) {
		var env = nnk.env;
		/* 房间已散(解散/换房)之后才打通链路的迟到连接:邀请码是外面留着的
		 * 一段文本,客人可能隔一会儿才用——没有房间就不能把客人塞给引擎
		 * (引擎的房间没建,init 会被"未就绪拒客"分支拦下)。客套收场:
		 * 发 closed 让客人端显示「房主已解散房间」,通道关掉由 onDown 摘册 */
		if (!hostState.active || !hostState.roomCode) {
			try { conn.send(JSON.stringify({ nnk_stage: "closed" })); } catch (e0) { /* 通道可能已半死 */ }
			try { conn.close(); } catch (e1) { /* 已关 */ }
			return;
		}
		if (hostState.stage === "lobby") {
			/* 大厅停车:引擎不接管,内核级 hello/成员表先跑;
			 * 载入后 lib.init.connection 的 on("message") 会自然接管本槽。
			 * 房号随指令下发:邀请码门进来的客人也拿得到,断线走房号门回来 */
			conn.send(stageMsg("lobby"));
			conn.onmessage = function(data) {
				try {
					var msg2 = JSON.parse(data);
					if (msg2 && msg2.nnk_hello) {
						var av = String(msg2.nnk_hello.avatar || "");
						conn._member = {
							name: String(msg2.nnk_hello.name || "").slice(0, 12) || "客人",
							avatar: (nnk.env.lib.translate[av] || av)
						};
						/* 邀请码门进来的:名字写回那一行,列表里就能看到"谁在用这张码" */
						if (conn._invite) {
							conn._invite.guest = conn._member.name;
						}
						emitRoomMembers();
					}
				} catch (e3) { /* 非内核协议消息忽略 */ }
			};
			/* 新人一进来就推一份成员表:客人开弹窗不再先看到 0 人
			 * (hello 只在他那侧发出后才会到,这中间有空窗) */
			emitRoomMembers();
			/* 阶段收口:这位客人可能正是拿某张邀请码来的(那张码转「已使用」),
			 * 还有别的码在等就继续停在等回执——交给统一的阶段收口函数 */
			settleInvitePhase();
			return;
		}
		/* 等待队列门禁:房主占 1 席,客人按模式容量进入,超员排队等空位 */
		var queueCapacity = roomCapacity();
		var enteredGuests = hostState.bridges.filter(function(b) {
			return b._entered;
		}).length;
		if (enteredGuests >= queueCapacity - 1) {
			conn.send(stageMsg("queued"));
			conn._queued = true;
			emitRoomMembers();
			/* 阶段也要收口:这位客人如果正是拿某张邀请码来的(那张已转 used),
			 * 此处不收口的话主机工坊会永远停在「正在建立点对点直连…」——要等
			 * 下一次有人退出/下一次生成邀请码才被纠正 */
			settleInvitePhase();
			return;
		}
		conn.send(stageMsg("loaded"));
		env.lib.init.connection(conn);
		conn._entered = true;
		emitRoomMembers();
		/* 上报 room_open(工坊据此把「房号就绪…等朋友加入」换成「客人已连接」),
		 * 但还有邀请码在等回执时会停在 invite_ready——统一走阶段收口 */
		settleInvitePhase();
		bridgeApi().emit("guest_connected", { guests: enteredGuests + 1 });
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
				b.send(stageMsg("loaded"));
				env.lib.init.connection(b);
				b._entered = true;
				emitRoomMembers();
				settleInvitePhase();
				bridgeApi().emit("guest_connected", { guests: enteredGuests + 1 });
				return;
			}
		}
	}

	/* 应答一条客人的连接提议(客人=offer 方)。
	 * 提议是公共 broker 上人人可发的明文结构:这里的加固=guestId 白名单
	 * (会拼进主题名,非法字符能让 broker 断开本机连接)+ 同一 guestId 限流
	 * (防伪造提议刷爆 pc 创建),以及每条提议前校验房号未换。 */
	var offerSeen = {};   /* guestId -> 最近受理时间 */
	var OFFER_MIN_GAP = 1500;
	function answerMqttOffer(code, msg) {
		var env = nnk.env;
		var guestId = msg && typeof msg.guestId === "string" ? msg.guestId : "";
		if (!/^[0-9a-z]{4,12}$/.test(guestId)) {
			return;   /* 形状不对:静默丢弃(公共频道上什么垃圾都可能来) */
		}
		var now = Date.now();
		if (offerSeen[guestId] && now - offerSeen[guestId] < OFFER_MIN_GAP) {
			return;   /* 同一客人的重复提议:限流 */
		}
		offerSeen[guestId] = now;
		/* 清一下过期的记录,免得无限增长 */
		var keys = Object.keys(offerSeen);
		if (keys.length > 50) {
			keys.forEach(function(k) {
				if (now - offerSeen[k] > 60000) {
					delete offerSeen[k];
				}
			});
		}
		var pc = new RTCPeerConnection(rtc.pcConfig());
		pc.ondatachannel = function(e) {
			if (e.channel.label === "nnk-ping") {
				/* 专用心跳线:只保温+判死,不进 bridges;判死=关整条 pc,
				 * 主通道随之关闭,走既有 onDown 清理(摘客/成员表/队列补位) */
				e.channel.onopen = function() {
					pc._nnkPingCh = e.channel;
					pc._nnkPing = rtc.startPing(e.channel, function() {
						try { pc.close(); } catch (eD) { /* 忽略 */ }
					});
				};
				return;
			}
			var channel = e.channel;
			channel.onopen = function() {
				pc._nnkAdopted = true;   /* 有人接上来了:看门狗不再收它 */
				var conn = new rtc.HostBridge(channel);
				registerBridge(conn, pc);
				handleNewBridge(conn);
			};
		};
		/* 没人完成的提议看门狗:客人发布提议后消失/被恶意刷提议时,这条 pc 永远
		 * 停在 new 状态(ICE 从没开始,连 failed 都不会到),没人回收就是泄漏。
		 * 90 秒(远超客人侧单次尝试 ~35 秒 + 一两轮重试)还没被接走就收掉 */
		setTimeout(function() {
			if (!pc._nnkAdopted) {
				try { pc.close(); } catch (e5) { /* 忽略 */ }
			}
		}, 90000);
		pc.onconnectionstatechange = function() {
			if (pc.connectionState === "failed") {
				/* failed 是终态且本侧不做 ICE restart,半死 pc 必须关掉,
				 * 否则客人每重试一次就漏一个连接对象 */
				try { pc.close(); } catch (e2) { /* 忽略 */ }
				bridgeApi().emit("error", { message: "一位客人的直连建立失败(双方网络没打通),需要其重新加入——反复失败的话,给这位朋友生成一张邀请码,让他从另一道门进来" });
			}
		};
		pc.setRemoteDescription(msg.sdp).then(function() {
			noteRecv(rtc.addInjected(pc, msg.hosts));   /* 客人提议里带的虚拟网卡直连地址(Radmin/ZeroTier 等) */
			return pc.createAnswer();
		}).then(function(answer) {
			return pc.setLocalDescription(answer);
		}).then(function() {
			return rtc.waitGather(pc);
		}).then(function() {
			if (hostState.mqttSession && hostState.roomCode === code) {
				return hostState.mqttSession.publish(
					signaling.roomTopic(code, "answer/" + guestId),
					{ k: "answer", sdp: pc.localDescription, hosts: noteSent(rtc.directHosts(pc)) }
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

	/* 关掉所有"停在大厅/排队"的内核级连接(已交给引擎的不动它的通道,只从
	 * 内核的成员表/队列里清出——引擎自己管着那些连接):主机解散或另建新房时,
	 * 停泊中的客人靠 nnk_stage=closed 立即知道房主已散,不用在排队页干等;
	 * 全体清空是为了下一张成员表干净——否则旧客人(含已在局的)会挂到新房里 */
	function closeParkedBridges() {
		hostState.bridges.forEach(function(b) {
			if (b._entered) {
				return;
			}
			try { b.send(JSON.stringify({ nnk_stage: "closed" })); } catch (e) { /* 通道可能已半死 */ }
			try { b.close(); } catch (e2) { /* 已关 */ }
		});
		hostState.bridges = [];
	}

	/* 邀请码门(按需生成,一客一张,可同时挂多张):主机是 offer 方
	 * (邀请码→客人回执码→工坊把那行的回执码贴回来)。每张码自己一条 pc、
	 * 自己的状态与看门狗,互不影响——两个朋友可以同时拿码、同时进来。
	 * 通道打通后与房号门走同一套接客流程(共用成员表/容量队列/载入流程) */
	function startInvite() {
		/* 上限:挂满就挤掉最老的那张待用码(它多半已经过期了) */
		var pending = [];
		hostState.invites.forEach(function(it) {
			if (it.status === "pending") {
				pending.push(it);
			}
		});
		if (pending.length >= MAX_PENDING_INVITES) {
			retireInvite(pending[0], "挂着太久,已自动作废");
		}
		var entry = {
			id: ++hostState.inviteSeq,
			pc: null,
			code: "",
			at: Date.now(),
			status: "pending",   /* pending 等回执 → answering 打通中 → used 已用 / dead 失效 */
			guest: "",           /* 客人的名字(停车报 hello 时补上) */
			note: ""             /* 失效原因(列表里给人看) */
		};
		hostState.invites.push(entry);
		pruneInvites();
		var pc = new RTCPeerConnection(rtc.pcConfig());
		entry.pc = pc;
		var channel = pc.createDataChannel("nnk-link", { ordered: true });
		/* 专用心跳线(主机侧建两条,客人按 label 分流):保温+秒级判死 */
		var pingChannel = pc.createDataChannel("nnk-ping", { ordered: true });
		pingChannel.onopen = function() {
			pc._nnkPingCh = pingChannel;
			pc._nnkPing = rtc.startPing(pingChannel, function() {
				try { pc.close(); } catch (eD) { /* 忽略 */ }
			});
		};
		channel.onopen = function() {
			if (entry.status === "used") {
				return;
			}
			if (entry.status === "dead") {
				/* 这张码已被作废(或自动过期),只是通道凑巧抢先打通:不放行
				 * ——关掉它,客人端按"连接断了"收场 */
				try { pc.close(); } catch (eD2) { /* 忽略 */ }
				return;
			}
			/* 这张码的使命完成:转"已使用"(列表里留痕),连接交给公共接客流程 */
			entry.status = "used";
			entry.note = "";
			var conn = new rtc.HostBridge(channel);
			conn._invite = entry;   /* 客人报 hello 时把名字写回这一行 */
			registerBridge(conn, pc);
			handleNewBridge(conn);
		};
		pc.createOffer().then(function(offer) {
			return pc.setLocalDescription(offer);
		}).then(function() {
			return rtc.waitGather(pc);
		}).then(function() {
			if (entry.status === "dead") {
				return;   /* 生成期间被作废/挤掉:关连接已在 retireInvite 里做了 */
			}
			if (!hostState.active) {
				/* 生成期间被取消:这张码作废,别把已取消的邀请挂回去 */
				retireInvite(entry, "房间已解散");
				return;
			}
			entry.code = rtc.encodeCode("offer", pc.localDescription, noteSent(rtc.directHosts(pc)));
			bridgeApi().emit("invite_ready", { id: entry.id, code: entry.code });
			settleInvitePhase();
			/* 自动过期:候选地址本来就活不过几分钟,一张没人用的码挂 10 分钟
			 * 基本已经死了——标失效留痕并让出端口,免得列表里全是"等回执码" */
			setTimeout(function() {
				if (entry.status === "pending") {
					retireInvite(entry, "放太久已失效,请重新生成");
				}
			}, 10 * 60 * 1000);
		}).catch(function(err) {
			retireInvite(entry, "生成失败");
			console.error("[联机助手] 生成邀请码失败", err);
			bridgeApi().emit("error", { message: "生成邀请码失败: " + (err.message || err) });
		});
	}

	/* 作废一张码:关掉它的连接、在列表里标失效留痕。已使用(used)的行不动
	 * ——那条 pc 就是客人正在用的通道,关掉等于把人踢出房间 */
	function retireInvite(entry, note) {
		if (!entry) {
			return;
		}
		if (entry.status === "used") {
			return;
		}
		if (entry.pc) {
			try { entry.pc.close(); } catch (e) { /* 忽略 */ }
		}
		entry.status = "dead";
		entry.note = note || "已作废";
		settleInvitePhase();
	}

	/* 整表清空(解散房间/另建新房时用):未使用的关连接标失效,已使用的只摘册
	 * ——那条 pc 就是客人正在用的通道,引擎自己管着,内核不能关 */
	function clearInvites(note) {
		hostState.invites.forEach(function(it) {
			if (it.status !== "used" && it.pc) {
				try { it.pc.close(); } catch (e) { /* 忽略 */ }
			}
			if (it.status !== "used") {
				it.status = "dead";
				it.note = note || "已作废";
			}
		});
		hostState.invites = [];
	}

	/* 列表行数上限:超了从"最老且能扔的"行开始扔——dead 随时可扔;used 行
	 * 留 5 分钟痕迹(足够工坊把这行渲染完、看清"谁用过")之后也算可扔,否则
	 * 长局里 used 行只增不减,行数上限形同虚设。还在等回执/正在打通的
	 * (pending/answering)永远不动 */
	function pruneInvites() {
		var usedTtlMs = 5 * 60 * 1000;
		while (hostState.invites.length > MAX_INVITE_ROWS) {
			var idx = -1;
			for (var i = 0; i < hostState.invites.length; i++) {
				var it = hostState.invites[i];
				var droppable = it.status === "dead" || (it.status === "used" && Date.now() - (it.at || 0) > usedTtlMs);
				if (droppable) {
					idx = i;
					break;
				}
			}
			if (idx < 0) {
				return;   /* 满屏都是活跃码:保留,等它们收尾再来 */
			}
			hostState.invites.splice(idx, 1);
		}
	}

	/* 按行号找码;不带行号(旧客户端的 accept_answer 只有 code)= 最新的那张待用码 */
	function findInvite(id) {
		var i;
		if (id) {
			for (i = 0; i < hostState.invites.length; i++) {
				if (hostState.invites[i].id === id) {
					return hostState.invites[i];
				}
			}
			return null;
		}
		for (i = hostState.invites.length - 1; i >= 0; i--) {
			if (hostState.invites[i].status === "pending") {
				return hostState.invites[i];
			}
		}
		return null;
	}

	/* 邀请码的临时阶段收口:只要还有码在等回执/在打通,阶段就停在
	 * invite_ready/connecting(旧客户端靠这两个阶段渲染码和粘贴框);
	 * 都收尾了就回到房间本来的阶段(大厅等待/等待房/客人已连接) */
	function settleInvitePhase() {
		if (!hostState.active || !hostState.roomCode) {
			return;   /* 房间没了:由 cancelAll 收尾,这里不抢阶段 */
		}
		var hasAnswering = false;
		var hasPending = false;
		hostState.invites.forEach(function(it) {
			if (it.status === "answering") {
				hasAnswering = true;
			}
			if (it.status === "pending") {
				hasPending = true;
			}
		});
		if (hasAnswering) {
			bridgeApi().setPhase("connecting", { roomCode: hostState.roomCode });
			return;
		}
		if (hasPending) {
			bridgeApi().setPhase("invite_ready", { roomCode: hostState.roomCode });
			return;
		}
		if (hostState.stage === "lobby") {
			bridgeApi().setPhase("mqtt_waiting", { roomCode: hostState.roomCode, stage: "lobby" });
			return;
		}
		var entered = hostState.bridges.some(function(b) { return b._entered; });
		bridgeApi().setPhase(entered ? "room_open" : "hosting", { roomCode: hostState.roomCode, signaling: hostState.signaling });
	}

	/* 一张码的连接监视:ICE 打不通时绝不能无声悬挂(实测教训——第一版在协商
	 * 成功后静默挂死,用户以为没反应反复点连接,只会收到 wrong state 报错)。
	 * 失败/超时:这一行标失效,并自动补一张新码(落在列表里,位置清楚) */
	function watchInviteConnection(entry) {
		var pc = entry.pc;
		var done = false;
		var giveUp = function(reason) {
			if (done || entry.status !== "answering") {
				return;   /* 已打通(→used)或已收场 */
			}
			done = true;
			entry.status = "dead";
			entry.note = reason;
			try { pc.close(); } catch (e) { /* 忽略 */ }
			bridgeApi().emit("error", { message: "第 " + entry.id + " 张邀请码" + reason + "。已自动补一张新码——常见原因是码放太久(里面的候选地址过期)或防火墙拦 UDP:新码要马上发马上用" });
			if (hostState.active) {
				startInvite();
			}
			settleInvitePhase();
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
					/* 阶段接力:lobby=回到大厅(引擎停在联机菜单,不建等待房);
					 * loaded=直启进引擎等待房间。兼容旧格式(纯串=loaded) */
					var pendingStage = "loaded";
					try {
						var pendingTask = JSON.parse(pending);
						if (pendingTask && typeof pendingTask === "object") {
							/* 旧的 signaling:"invite" 标记不再改变建房方式:一体化房间
							 * 一律先建大厅带走房号门(旧邀请码房没有房号,已并入) */
							if (pendingTask.stage === "lobby") {
								pendingStage = "lobby";
							}
							if (pendingTask.mode) {
								/* 续跑的 mode 过白名单:接力标记若被引擎改写的
								 * _status.mode(联机单挑局="normal")污染,在这里拦下 */
								if (ROOM_MODES.indexOf(pendingTask.mode) >= 0) {
									hostState.roomMode = pendingTask.mode;
								}
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
						startMqtt();
						bridgeApi().setPhase("mqtt_waiting", { roomCode: hostState.roomCode, stage: "lobby" });
						emitRoomMembers();   /* 恢复后立刻报一份成员表:否则工坊弹窗一直停在「同步中…」(等客人进来才补上) */
						console.log("[联机助手] 大厅已恢复(房号 " + hostState.roomCode + "),等待载入到游戏");
					} else {
						hostState.stage = "loaded";
						/* 自愈看门狗:重载后 20 秒房间还没建起来(开机竞速/接力配置写入
						 * 丢失,实测卡纯背景页),带原模式原房号自动再重载一次。
						 * 只救一次:救援重载写入的 pending 带 rescued=true,带标记的开机
						 * 不再重载级救援(防无限重载循环),只上报引导手动。
						 * lobby 阶段不需要建房,看门狗不生效 */
						var watchdogMode = (pendingTask && typeof pendingTask === "object" && pendingTask.mode && ROOM_MODES.indexOf(pendingTask.mode) >= 0) ? pendingTask.mode : "identity";
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
			 * 对局刚结束(over)且房间还在时,把同一房号接力过去再重载——
			 * 重载后沿用原房号续建,客人凭断线感知自动重进,谁都不用再输码。
			 * ★ saveConfig 是异步写库,直接重载会把 mode 的写入丢掉(实测:重载后
			 *   引擎拿不到直启标记,卡在纯背景页)——等写入回调落地再重载,1.5 秒
			 *   兜底防写库挂死;directstartmode 故意不写(回大厅不自动进房)。
			 * 一体化房间恒有房号(邀请码只是第二道门),所以这条接力对所有房间都成立,
			 * 客人自动重回也不再分门——旧的「邀请码房间重载即散」限制随一体化消失 */
		if (!env.game.__nnkReloadPatched) {
			env.game.__nnkReloadPatched = true;
			var origReload = env.game.reload;
			hostState.origReload = origReload;   /* 工坊「载入/重开」复用同一重载 */
			env.game.reload = function() {
				try {
					if (hostState.active && hostState.roomCode
						&& env._status.connectMode && env._status.over) {
						/* 不用 _status.mode:联机单挑局里引擎会把它原生改写成
						 * "normal"(mode/single.js),写进接力标记会让下个开机把
						 * 房间模式污染成非法值,创建房间恒报「不支持的模式:
						 * normal」(实测)。回大厅保持房间的原模式才是正确语义 */
						var overMode = hostState.roomMode || "identity";
						/* 回大厅:重载后引擎停在联机菜单,stage=lobby,成员重连后
						 * 停车等待下一次载入;directstartmode 故意不写(不自动进房) */
						localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: overMode, signaling: "mqtt", stage: "lobby" }));
						localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.roomCode);
						localStorage.setItem(env.lib.configprefix + "directstart", "true");
						bridgeApi().emit("info", { message: "对局结束,已回到房间大厅(原房号 " + hostState.roomCode + " 保留),选模式后点「载入到游戏」继续" });
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

		/* 工坊命令:创建互联网房间(一体化:建房即开大厅,房号门自动就绪)。
		 * signalingMode 参数只为兼容旧客户端:传 invite = 建完顺手生成一张邀请码
		 * (邀请码早已不是独立的建房方式,而是同一房间的第二道门,按需开) */
		createInternetRoom: function(mode, signalingMode) {
			var env = nnk.env;
			mode = String(mode || "identity");
			hostState.signaling = "mqtt";
			if (ROOM_MODES.indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			if (hostState.active && hostState.roomCode) {
				/* 房间已存在(弹窗重开/页面刷新):不发新房号,恢复显示。
				 * 旧客户端的「改用邀请码方式建房」请求在这里补一张邀请码 */
				bridgeApi().setPhase(hostState.stage === "loaded" ? "room_open" : "mqtt_waiting", { roomCode: hostState.roomCode, signaling: "mqtt", stage: hostState.stage });
				emitRoomMembers();
				if (signalingMode === "invite") {
					startInvite();
				}
				return;
			}
			/* 单机对局中点创建:直接退出对局进联机界面(房间在重载落地后的大厅里
			 * 自动建好)——顺带让之后的「载入到游戏」能走原地进房(秒级、不断线)。
			 * 此前这里只是"大厅先建着",结果载入又被对局守卫拒绝,成了死角。 */
			if (env.game.players && env.game.players.length && !env._status.over && !env._status.waitingForPlayer && !env.game.online) {
				hostState.stage = "lobby";
				hostState.active = true;
				hostState.roomMode = mode;
				bridgeApi().setPhase("host_booting", { mode: mode });
				bridgeApi().emit("info", { message: "正在退出当前对局并进入联机界面…(单机进度不会保留;房间落地后自动建好)" });
				try {
					localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: mode, signaling: "mqtt", stage: "lobby" }));
				} catch (e) { /* 忽略 */ }
				var exitGone = false;
				var exitGo = function() {
					if (exitGone) {
						return;
					}
					exitGone = true;
					env.game.reload();
				};
				env.game.saveConfig("mode", "connect", null, exitGo);
				setTimeout(exitGo, 1500);
				return;
			}
			/* 大厅路径:瞬间完成,不重载不进游戏。
			 * 上一次会话停泊的客人(大厅/排队)与旧邀请码都不带走:通知散场再开新房 */
			closeParkedBridges();
			clearInvites("房间已重建");
			hostState.stage = "lobby";
			hostState.active = true;
			hostState.roomMode = mode;
			hostState.roomCode = genRoomCode();
			env.game.ip = "nnk://" + hostState.roomCode;
			bridgeApi().setPhase("mqtt_waiting", { roomCode: hostState.roomCode, stage: "lobby" });
			startMqtt();
			emitRoomMembers();   /* 新房立刻报一张成员表(工坊弹窗不等第一位客人) */
			/* 游戏不在联机大厅界面(引擎的联机菜单)时,自动带过去:重载进联机
			 * 模式一次,落地后本段大厅与房号原样恢复。用户的操作预期是"建完房,
			 * 游戏里就该停在联机大厅等载入"——不然游戏停在原界面,像什么都没
			 * 发生(实测报障);而且停进联机菜单后,之后的「载入到游戏」走原地
			 * 秒级路径,不用再重载 */
			var atConnectMenu = env._status.connectMode && !env.game.online && !env.game.onlineroom
				&& !env._status.waitingForPlayer && (!env.game.players || !env.game.players.length);
			/* 旧客户端兼容的补码放在重载判断之后:重载会清掉内存里的 invites 表
			 * (房号靠 nnk_host_roomcode 接力,邀请码没有接力),重载窗口里生成的码
			 * 到落地就成了死码——客人拿它生成回执码,主机粘贴必然报「没有待应答的
			 * 邀请」。要重载时等落地后由客户端按需再要一张 */
			if (signalingMode === "invite" && atConnectMenu) {
				startInvite();   /* 旧客户端兼容:建完补一张邀请码 */
			}
			if (!atConnectMenu) {
				try {
					localStorage.setItem(env.lib.configprefix + "nnk_host_pending", JSON.stringify({ mode: mode, signaling: "mqtt", stage: "lobby" }));
					localStorage.setItem(env.lib.configprefix + "nnk_host_roomcode", hostState.roomCode);   /* 房号跨重载保留 */
					localStorage.setItem(env.lib.configprefix + "directstart", "true");
				} catch (e2) { /* 忽略 */ }
				bridgeApi().emit("info", { message: "正在把游戏带进联机大厅界面(重载一次,房号 " + hostState.roomCode + " 不变,客人邀请码仍然有效)…" });
				var lobbyGone = false;
				var lobbyGo = function() {
					if (lobbyGone) {
						return;
					}
					lobbyGone = true;
					env.game.reload();
				};
				env.game.saveConfig("mode", "connect", null, lobbyGo);
				setTimeout(lobbyGo, 1500);
			}
		},

		/* 工坊弹窗换模式:只更新"下一局模式"并广播(不碰引擎、不重载)。
		 * 客人端的模式标签/座位数随 room_members 实时刷新——此前 radio 只改
		 * 主机本机状态不上报,客人永远看到旧模式(实测反馈) */
		setRoomMode: function(mode) {
			mode = String(mode || "");
			if (ROOM_MODES.indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (!hostState.active || !hostState.roomCode) {
				bridgeApi().emit("error", { message: "还没有房间,先创建 P2P 房间" });
				return;
			}
			hostState.roomMode = mode;
			emitRoomMembers();
		},

		/* 一个按钮多种用途:kind==="invite" = 按需生成一张新邀请码(可多张同时挂);
		 * kind==="cancel" = 作废指定那一张(id);不带 kind = 换一个房号(轮换房号门) */
		refreshInvite: function(kind, id) {
			var env = nnk.env;
			if (!hostState.roomCode) {
				bridgeApi().emit("error", { message: "还没有可用的房间,请先创建互联网房间" });
				return;
			}
			if (kind === "invite") {
				/* 邀请码是同一房间的第二道门:大厅阶段(客人先在厅里等)和载入后
				 * 都能生成,进来的客人走与房号门同一套容量队列与载入流程 */
				startInvite();
				return;
			}
			if (kind === "cancel") {
				/* 作废单张码(列表里那行的「作废」):只关它一条 pc,别的码不受影响 */
				var entry = findInvite(id);
				if (!entry || entry.status === "used") {
					bridgeApi().emit("error", { message: "这张邀请码没法作废(已经用过了或不存在)" });
					return;
				}
				retireInvite(entry, "已作废");
				bridgeApi().emit("info", { message: "第 " + entry.id + " 张邀请码已作废" });
				return;
			}
			/* 换房号:重生成房号并重挂信令(旧房号的心跳随之停止)。
			 * 大厅阶段不碰引擎随时可换;等待房阶段要求引擎就绪(env_ready)。
			 * 已发出的邀请码不跟着作废——它们自带 SDP,客人进来后拿到的是新房号 */
			if (hostState.stage === "loaded" && !env_ready()) {
				bridgeApi().emit("error", { message: "房间还没就绪,稍等一下再换房号" });
				return;
			}
			cleanupMqtt();
			hostState.roomCode = genRoomCode();
			env.game.ip = "nnk://" + hostState.roomCode;
			bridgeApi().setPhase(hostState.stage === "lobby" ? "mqtt_waiting" : "hosting", { roomCode: hostState.roomCode });
			startMqtt();
		},

		/* 粘贴某一行的回执码并连接。id = 列表行号(旧客户端不带 id:当最新那张待用码) */
		acceptAnswer: function(id, codeText) {
			var entry = findInvite(id);
			if (!entry) {
				bridgeApi().emit("error", { message: "没有待应答的邀请——先点「📨 生成邀请码」把码发给朋友" });
				return;
			}
			var pc = entry.pc;
			if (entry.status !== "pending" || !pc) {
				bridgeApi().emit("error", { message: "第 " + entry.id + " 张邀请码已经用过或已作废——回执码请贴到还显示「等回执码」的那一行" });
				return;
			}
			/* 一张邀请码只能被应答一次:协商完成后 signalingState 回到 stable,
			 * 再粘同一条回执码会报 wrong state——正确动作是作废这张、换一张新码 */
			if (pc.signalingState !== "have-local-offer") {
				bridgeApi().emit("error", { message: "第 " + entry.id + " 张邀请码已经协商过了(客人没进来说明直连没打通)。作废它再生成一张新码,让客人重新走一遍" });
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
				noteRecv(rtc.addInjected(pc, data.hosts));   /* 回执码里带的客人虚拟网卡直连地址 */
				entry.status = "answering";
				settleInvitePhase();
				/* 码龄预警:邀请码里的 ICE 候选跟着 NAT 端口映射活,映射几十秒到几
				 * 分钟就过期——实测放 14 分钟的码必失败。粘码时先报个龄,失败了别懵 */
				var ageMin = entry.at ? Math.round((Date.now() - entry.at) / 60000) : 0;
				if (ageMin >= 3) {
					bridgeApi().emit("info", { message: "第 " + entry.id + " 张邀请码已生成 " + ageMin + " 分钟——码放太久,里面的候选地址基本过期了,直连大概率失败;失败会自动补一张新码,新码要马上发马上用" });
				}
				watchInviteConnection(entry);
			}).catch(function(err) {
				bridgeApi().emit("error", { message: "回执码无效: " + (err.message || err) });
			});
		},

		/* 工坊大厅:按所选模式重开一局(原房号不变,客人自动重回)。
		 * 等待房/结算屏都可以点;对局进行中拒绝。
		 * 两条路:主机引擎正停在联机菜单 → 原地进房(不重载,成员不断线);
		 * 否则 → 重载进房(老路径,客人自动跟随)。 */
		restartRoom: function(mode) {
			var env = nnk.env;
			if (!hostState.active || !hostState.roomCode) {
				bridgeApi().emit("error", { message: "还没有房间可以重开,先创建 P2P 房间" });
				return;
			}
			/* 兜底用房间原模式,不用 _status.mode:联机单挑局会把它原生改写成
			 * "normal",拿它兜底会误报「不支持的模式」(实测) */
			mode = String(mode || hostState.roomMode || "identity");
			if (ROOM_MODES.indexOf(mode) < 0) {
				bridgeApi().emit("error", { message: "不支持的模式: " + mode });
				return;
			}
			if (env.game.players && env.game.players.length && !env._status.over && !env._status.waitingForPlayer) {
				if (env.game.online) {
					bridgeApi().emit("error", { message: "对局还没打完,结束后再重开" });
					return;
				}
				/* 单机对局中:载入即退出对局(重载落地时单机局面自然丢弃,
				 * 与创建房间的提示口径一致);联机对局仍拒绝 */
				bridgeApi().emit("info", { message: "正在退出当前对局并载入…(单机进度不会保留)" });
			}
			/* 原地快路径:引擎正停在联机菜单(connect 模式、无房无局)——复刻
			 * 原生联机菜单的"选择模式→开始"(startMenu.js):switchMode 之后
			 * 模式启动流程会自己走到 waitForPlayer → createServer(软服务器),
			 * 全程不重载、通道不断,停泊客人原地收编进房 */
			var atConnectMenu = env._status.connectMode && !env.game.online && !env.game.onlineroom
				&& !env._status.waitingForPlayer && (!env.game.players || !env.game.players.length);
			if (atConnectMenu) {
				hostState.stage = "loaded";
				hostState.roomMode = mode;
				bridgeApi().emit("info", { message: "正在原地进入游戏(不重载,成员不断线)…" });
				if (startInPlace(mode)) {
					return;   /* 原地路径已启动(带 12 秒兜底看门狗) */
				}
				bridgeApi().emit("info", { message: "原地进入未成功,改用重载方式…" });
			}
			reloadIntoGame(mode);
		},

		cancelAll: function() {
			var env = nnk.env;
			hostState.active = false;
			hostState.stage = null;
			hostState.reuseCode = null;
			/* 顺序要紧:cleanupMqtt 要拿房号去撤 broker 上那条 retained 心跳,
			 * 先清房号的话 publishRaw 直接空转——公共 broker 上会永久留下一张
			 * "这房还在"的心跳,之后任何人输这个房号加入都会先被判成"房主在线",
			 * 白等一轮(实测:解散后旧房号仍显示在线) */
			cleanupMqtt();
			hostState.roomCode = null;
			hostState.roomMode = null;
			/* 邀请码整体作废(清表:房间都没了,这些码不该再出现) */
			clearInvites("房间已解散");
			/* 大厅/排队的客人收到 nnk_stage=closed 立即散场,不会永远挂在排队页 */
			closeParkedBridges();
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

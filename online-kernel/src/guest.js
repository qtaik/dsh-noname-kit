/*
 * 客人端(无头):加入互联网房间 + 接管 game.connect 的 nnk:// 地址。
 * 同一个房间有两道门:房号门(客人=offer 方,经 MQTT 信令)与邀请码门
 * (客人=answer 方:工坊下发邀请码 → 内核生成回执码 → 房主粘贴 → 通道打通)。
 * 进门后都是同一套流程:先在大厅停车,房主载入时一起进引擎;断线自动重回
 * 统一走房号门(邀请码客人也会从内核指令里拿到房号)。
 */
(function() {
	var nnk = window.__nnk__;
	var rtc;
	var signaling;

	var guestState = nnk.state.guest = {
		session: null,   /* { pc, fake, autoConnect } */
		rejoinGen: 0,    /* 自动重回链代号:每次新链/取消都递增,旧链的迟到定时器作废 */
		rejoinBeatStreak: 0,   /* 连续「心跳判死」的重回轮数:≥3 收场——房主退游戏后别让客人白转满 8 轮(实测 2 分钟,只能手点取消) */
		lastAttemptBeatDead: false,   /* 上一轮是否以「心跳 10 秒无刷新」收场:重回循环据此换文案+计数 */
		lastIceFailAt: 0    /* 上一条「直连建立失败」发出时刻:同文案 2 秒去重(pc 迟到报错会双发) */
	};

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	/* 虚拟网卡直连候选的播报(每侧每次开机只说一次,防重回循环刷屏) */
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
			bridgeApi().emit("info", { message: "对方提供了 " + count + " 个虚拟网卡直连地址,已加入连接尝试" });
		}
	}

	/* 把已就绪的 FakeWebSocket 接进引擎(复刻 game.connect 的接线部分,
	 * 唯一差别是 game.sandbox 置空:nnk 通道没有原生沙盒键,好友局信任主机)。
	 * force=自动重回:客人进过房间后 game.online 恒真(引擎 init 置的),
	 * 不带 force 会被下面这道守卫拦死,重连永远进不来(实测 bug)——绕过后
	 * 由引擎原生重连协议接管(握手带旧 id,主机识别为老玩家回发 reinit) */
	function connectNow(force) {
		var env = nnk.env;
		var session = guestState.session;
		if (!session || !session.fake || (env.game.online && !force)) {
			return;
		}
		if (nnk.modules.compat) {
			nnk.modules.compat.unlockPacks();   /* 本地扩展包进联机选将池(闸2) */
			nnk.modules.compat.dumpExtensions();   /* 透视:本次联机实际加载/跳过了哪些扩展 */
		}
		env._status.connectCallback = function(success) {
			if (success) {
				session.entered = true;   /* 自动重回循环据此区分「真进了」和「还在握手」 */
				guestState.hostLoadingAt = 0;   /* 已进来,载入跟随之类的话术复位 */
				try { localStorage.removeItem(env.lib.configprefix + "nnk_guest_reentry"); } catch (eR) { /* 忽略 */ }
				try { localStorage.removeItem(env.lib.configprefix + "nnk_host_game"); } catch (eG) { /* 进来了:清"房主对局中"等待标记 */ }
				bridgeApi().setPhase("connected", session.code ? { code: session.code } : undefined);
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
		/* 进引擎之后通道里仍会来主机转发的小量内核消息(成员表 nnk_members):
		 * 在这里嗅探出来转给工坊——不这么接,客人弹窗会在进房那一刻定格,
		 * 连自己都显示「等待载入」(实测报障);其余消息原样交给引擎
		 * (引擎对非数组消息只会打 invalid message,所以内核消息必须自己消化) */
		var engineOnMessage = env.lib.element.ws.onmessage;
		fake.onmessage = function(ev) {
			if (ev && typeof ev.data === "string" && ev.data.indexOf("nnk_members") >= 0) {
				try {
					var m = JSON.parse(ev.data);
					if (m && m.nnk_members) {
						bridgeApi().emit("room_members", m.nnk_members);
						return;
					}
				} catch (eK) { /* 不是内核消息:交给引擎 */ }
			}
			return engineOnMessage.call(this, ev);
		};
		/* 会话期内连接出错:内核自己会接管恢复(自动重回 / 引擎重载+自动重回),
		 * 引擎原生的 alert(「连接失败」)是阻塞弹窗——不点它页面就冻着,会拖住
		 * 恢复流程,也和工坊动态里的自助提示重复。房间会话里统一吞掉,其余照旧 */
		fake.onerror = function(e) {
			if (session.wasIn && session.code && nnk.env._status.connectMode) {
				return;
			}
			return env.lib.element.ws.onerror.call(this, e);
		};
		fake.onclose = env.lib.element.ws.onclose;
		env._status.ip = "nnk://p2p";
		session.parked = true;   /* 已交给引擎:自动重回循环到此算落点,不再重试 */
		/* 顺序要紧:先报「进房中」再 onopen——引擎的 ws.onopen 会立刻回调
		 * connectCallback(true) 把状态推进到「已进入房间」;顺序反了会被
		 * entering 覆盖回去,状态就永远卡在「正在进入房间」(实测 bug)。
		 * 房号带上,别让 setPhase 把房间信息冲没(大厅入口要在整局里都可查) */
		bridgeApi().setPhase("entering", session.code ? { code: session.code } : undefined);
		bridgeApi().emit("entering_room");
		fake.replay();
		if (fake.isOpen()) {
			fake.onopen();
		}
		/* 包清单上报房主体检(消息走对局连接,房主内核已登记处理器) */
		if (nnk.modules.manifest) {
			nnk.modules.manifest.sendManifest();
		}
	}

	function resetSession() {
		if (guestState.session && guestState.session.ping) {
			try { guestState.session.ping.stop(); } catch (eP) { /* 忽略 */ }
		}
		if (guestState.session && guestState.session.pc) {
			try { guestState.session.pc.close(); } catch (e) { /* 忽略 */ }
		}
		if (guestState.session && guestState.session.mqtt) {
			try { guestState.session.mqtt.end(); } catch (e) { /* 忽略 */ }
		}
		guestState.session = null;
	}

	/* 自动重回彻底放弃:收场回干净菜单。房号/邀请码会话期内引擎的自毁重载
	 * 被内核抑制(_nocallback),收场必须自己重载一次——否则客人冻死在断线的
	 * 对局画面上(收场前令牌/会话都已清,重载包装不会再把这次当成"断线登记") */
	function finishRejoin() {
		try {
			if (nnk.env._status.connectMode) {
				nnk.env.game.reload();
			}
		} catch (e) { /* 忽略 */ }
	}

	/* 同房号自动重进(打完一把主机端重组后):连接突然断开且对局已结束,
	 * 说明房主正在重载重建同一房间——隔几秒用原房号再敲一次门,给主机
	 * 重载重建留出时间;次数用完或用户已取消/离开就明说,引导手动重进。
	 * rejoinCode 是会话令牌:cancelJoin 置空即可停掉整个循环。
	 * inFlight=上一尝试还在握手(信令校验/等应答):不占尝试次数,只隔 4 秒
	 * 复查——握手各阶段都有自己的超时(30 秒等应答会收掉会话),超时后这里
	 * 自然续上下一试;看 session.entered 区分「真进了」和「还在连」。 */
	function autoRejoin(code, attempts, inFlight, signalOnly) {
		var env = nnk.env;
		guestState.rejoinCode = code;
		/* 链代号:连续两次断开会各起一条重试链,旧链的迟到定时器必须作废
		 * ——否则两条链并发重连,互相 resetSession 抢连接(实测隐患) */
		var gen = guestState.rejoinGen = (guestState.rejoinGen || 0) + 1;
		if (attempts <= 0 || !env._status.connectMode) {
			/* 次数用尽/不在联机模式:收掉会话令牌并给人话提示。能不能提示只看这一处
			 * ——上面刚把 rejoinCode 赋成 code,再比它恒真;run 循环里的「用户已取消」
			 * 由 setTimeout 内的令牌比对负责兜底 */
			if (guestState.rejoinCode === code) {
				guestState.rejoinCode = null;
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "自动重回房间失败(房主可能已关闭游戏)——让房主重新建房后把新房号发给你(重新建房会换新房号,旧号重试没用)" });
				finishRejoin();
			}
			return;
		}
		if (!inFlight) {
			/* 刚收到主机的「载入」通知(60 秒内):话术切成载入跟随,别让客人
			 * 以为房主崩了;心跳已死且不在载入窗口:别再谎称「重组房间」;
			 * 其他场景(打完一把重组/掉线)照旧 */
			var hostLoading = Date.now() - (guestState.hostLoadingAt || 0) < 60000;
			var hostGone = guestState.lastAttemptBeatDead && !hostLoading;
			guestState.lastAttemptBeatDead = false;   /* 用后即清:本轮自己的判死会在中途重新置真 */
			bridgeApi().emit("info", { message: (hostLoading ? "主机正在载入游戏,自动跟随重连 " : hostGone ? "房主已无心跳,尝试重回 " : "房主正在重组房间,自动重回 ") + code + "(第 " + (9 - attempts) + " 次尝试)…" });
			api.joinByRoomCode(code, true, true);   /* rejoin 模式:绕过「联机中不能加入」守卫 */
		}
		setTimeout(function() {
			if (guestState.rejoinCode !== code || guestState.rejoinGen !== gen) {
				return;   /* 用户已取消 / 已被更新的重试链取代 */
			}
			if (guestState.session && (guestState.session.entered || guestState.session.parked)) {
				guestState.rejoinCode = null;
				guestState.rejoinBeatStreak = 0;
				guestState.lastAttemptBeatDead = false;
				return;   /* 已进入房间 / 已停回大厅,循环完成 */
			}
			/* 心跳连死收场:非载入窗口内连续 3 轮判死(约 1 分钟)= 房间解散/
			 * 房主关游戏,收场给人话,别让客人对着「正在重组房间」白转满 8 轮
			 * (实测 2 分钟只能手点取消)。计数在判死点自增(每轮至多一次),
			 * 载入窗口不计数(主机重载心跳本来就断跳,是正常空窗) */
			var hostLoadingNow = Date.now() - (guestState.hostLoadingAt || 0) < 60000;
			if (guestState.rejoinBeatStreak >= 3 && !hostLoadingNow) {
				guestState.rejoinCode = null;
				guestState.rejoinBeatStreak = 0;
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "连续多轮收不到房主心跳——房间已解散或房主已关闭游戏,自动重回中止。让房主重新建房后把新房号发给你(重新建房会换新房号)" });
				finishRejoin();
				return;
			}
			/* 次数扣减:只有"真尝试过、连到房间层"才扣。信令服务器连不上
			 * (公共 broker 偶发抽风)算信号层失败,不扣次数——否则 8 次被信号
			 * 超时耗完,会误报"房主可能已关闭游戏"。但也不能无限等:连续信号
			 * 失败超过 8 次(约 90 秒)仍收场并给出路。 */
			var signalOnlyNext = Boolean(guestState.lastJoinSignalFail);
			guestState.lastJoinSignalFail = false;
			if (signalOnlyNext) {
				guestState.rejoinSignalStreak = (guestState.rejoinSignalStreak || 0) + 1;
			} else if (guestState.session) {
				guestState.rejoinSignalStreak = 0;
			}
			if (signalOnlyNext && guestState.rejoinSignalStreak > 8) {
				guestState.rejoinCode = null;
				guestState.rejoinSignalStreak = 0;
				guestState.rejoinBeatStreak = 0;   /* 收场一并清连死计数:防跨链残留提前收场 */
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "信令服务器一直连不上,自动重回中止——请检查网络,或让房主发一张邀请码从另一道门进" });
				finishRejoin();
				return;
			}
			var deduct = signalOnlyNext ? 0 : (guestState.session ? 0 : 1);
			autoRejoin(code, attempts - deduct, !!guestState.session, signalOnlyNext);
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
		/* saveConfig 是异步写库,写丢=重载落回离线模式、续跑只能报错收场
		 * (实测同款竞速,主机侧 6f0c934 已修)——等写库回调落地再重载,
		 * 1.5 秒兜底防写库挂死。续跑标记是 localStorage 同步写,无此风险 */
		var gone = false;
		var go = function() {
			if (gone) {
				return;
			}
			gone = true;
			env.game.reload();
		};
		env.game.saveConfig("mode", "connect", null, go);
		setTimeout(go, 1500);
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
			/* 客人侧「重新开始」也走不散房:结算界面主客双方都有该按钮,客人点它
			 * 走的是引擎裸 reload,会掉回联机菜单要手动输房号——包一层写接力标记。
			 * ★ 还不能只认「对局结束」:引擎自己在联机中断时也会重载(library
			 * index.js ws.onclose:联机中一断 ws 就 directstart+game.reload),
			 * 以前这种重载不登记,客人重载后就静默停在菜单上(实测「进房后秒退」
			 * 的真身)。改为:只要还握着房间会话(或重试中的房号)就登记,任何
			 * 来源的重载都能自动重回;带连败保护(2 分钟内自动重回 >3 次就停,
			 * 防「重载→重进→再断」变死循环,并明说引导手动) */
			if (!env.game.__nnkGuestReloadPatched) {
				env.game.__nnkGuestReloadPatched = true;
				var origGuestReload = env.game.reload;
				env.game.reload = function() {
					try {
						var rc = (guestState.session && guestState.session.code) || guestState.rejoinCode;
						if (rc && env._status.connectMode) {
							var key = env.lib.configprefix + "nnk_guest_reentry";
							var rec = { n: 0, at: 0 };
							try { rec = JSON.parse(localStorage.getItem(key)) || rec; } catch (e3) { rec = { n: 0, at: 0 }; }
							var now = Date.now();
							if (now - rec.at > 120000) {
								rec = { n: 0, at: now };
							}
							rec.n += 1;
							try { localStorage.setItem(key, JSON.stringify(rec)); } catch (e4) { /* 忽略 */ }
							if (rec.n > 3) {
								try { localStorage.removeItem(env.lib.configprefix + "nnk_guest_pending"); } catch (e5) { /* 忽略 */ }
								bridgeApi().emit("error", { message: "客人端连续自动重连已多次——先点「退出房间」再重新加入(反复重连通常是本机游戏或网络不稳)" });
							} else {
								localStorage.setItem(env.lib.configprefix + "nnk_guest_pending", JSON.stringify({ kind: "room", code: rc }));
								bridgeApi().emit("info", { message: "游戏触发重载,已登记自动重回(原房号 " + rc + ")…" });
							}
						}
					} catch (e) { /* 忽略 */ }
					return origGuestReload.apply(this, arguments);
				};
			}
			/* 重载落地:联机界面 HUD 就绪后自动续跑被重载打断的加入流程。
			 * fromResume=true 直通,不再触发重载(防引擎异常时无限重载环) */
			try {
				var pendingJson = localStorage.getItem(env.lib.configprefix + "nnk_guest_pending");
				if (pendingJson) {
					localStorage.removeItem(env.lib.configprefix + "nnk_guest_pending");
					var task = JSON.parse(pendingJson);
					/* 续跑链代号:等待期间(含 UI 就绪前)用户取消/退出会递增 gen,
					 * 到点前复查——否则"等房主打完"的 20 秒延迟里点了取消,
					 * 定时器到点照样把人拉回房间(审计发现的竞态) */
					var resumeGen = guestState.rejoinGen || 0;
					var waited = 0;
					var resumeTimer = setInterval(function() {
						waited += 300;
						if (nnk.env.ui && nnk.env.ui.control && nnk.env.ui.arena) {
							clearInterval(resumeTimer);
							var startResume = function() {
								if (task && task.kind === "invite") {
									api.joinByInvite(task.code, true);
								} else if (task) {
									/* 客人自己点「重新开始」/主机重组后的重进:主机可能也在
									 * 重载重建,单次尝试大概率撞空——走带重试的自动重回 */
									autoRejoin(task.code, 8);
								}
							};
							var runResume = function() {
								if ((guestState.rejoinGen || 0) !== resumeGen) {
									return;   /* 等待期间已被取消/新链取代:作废 */
								}
								startResume();
							};
							/* 上一轮是"房主对局中"被拒:放慢节奏等本局打完再进(标记跨
							 * 重载写在 localStorage)——否则每 15 秒一轮重载循环,两边的
							 * 动态与日志都会被刷爆 */
							var waitMs2 = 0;
							try {
								var gAt = parseInt(localStorage.getItem(env.lib.configprefix + "nnk_host_game") || "0", 10) || 0;
								if (gAt && Date.now() - gAt < 120000) {
									waitMs2 = 20000;
								}
							} catch (eW) { /* 忽略 */ }
							if (waitMs2) {
								setTimeout(runResume, waitMs2);
							} else {
								runResume();
							}
						} else if (waited > 15000) {
							clearInterval(resumeTimer);
							bridgeApi().setPhase("idle");
							bridgeApi().emit("error", { message: "联机界面 15 秒未就绪,加入未完成——请重试" });
						}
					}, 300);
				}
			} catch (e) { /* localStorage 不可用则无续跑 */ }
			/* 引擎「加入被拒」(denied)的阻塞弹窗在房间会话期静音:
			 * 注意官方处理器末尾还有两个必须跑的副作用——game.ws.close()(关掉这
			 * 条连接)与 _status.connectDenied() 回调,version/key 分支还有
			 * saveConfig 清理;所以这里**不能提前 return 跳过原处理器**,只把
			 * window.alert/confirm 临时换成静音壳,原逻辑照跑(审计发现:早先
			 * 的 skip 会留下半挂连接与未收尾的 connecting 状态)。
			 * 「游戏已开始」=房主正在对局中、客人只能等本局结束——重试循环会
			 * 持续;这条只做播报与标记,不发弹窗 */
			if (env.lib && env.lib.message && env.lib.message.client
				&& typeof env.lib.message.client.denied === "function"
				&& !env.lib.message.client.denied.__nnkWrapped) {
				var origDenied = env.lib.message.client.denied;
				env.lib.message.client.denied = function(reason) {
					var inSession = false;
					try {
						inSession = !!(guestState.rejoinCode || (guestState.session && guestState.session.code));
					} catch (e0) { /* 忽略 */ }
					if (inSession) {
						try {
							if (reason === "gaming") {
								/* 跨重载的"房主对局中"标记:重载后的续跑据此放慢节奏,
								 * 别 15 秒一轮重载循环刷爆两边的动态与日志 */
								localStorage.setItem(nnk.env.lib.configprefix + "nnk_host_game", String(Date.now()));
							}
							/* 同一原因 60 秒内只播报一次(跨重载用 localStorage 节流) */
							var noteKey = nnk.env.lib.configprefix + "nnk_denied_note";
							var noted = parseInt(localStorage.getItem(noteKey) || "0", 10) || 0;
							if (Date.now() - noted > 60000) {
								localStorage.setItem(noteKey, String(Date.now()));
								var text = reason === "gaming" ? "房主正在对局中,暂时进不去——本局结束后会自动进入(持续重试中,不用管)"
									: reason === "version" ? "被拒:两边游戏本体版本不一致,请更新到同一版本"
									: reason === "number" ? "被拒:房间已满"
									: reason === "banned" ? "被拒:名字为空或被房主拉黑"
									: "加入被拒:" + reason;
								bridgeApi().emit("info", { message: text });
							}
						} catch (eN) { /* 忽略 */ }
						var oa = window.alert;
						var oc = window.confirm;
						try {
							window.alert = function() {};
							window.confirm = function() { return false; };   /* extension 分支的确认框也不阻塞 */
							return origDenied.apply(this, arguments);
						} finally {
							try { window.alert = oa; window.confirm = oc; } catch (eR) { /* 忽略 */ }
						}
					}
					return origDenied.apply(this, arguments);
				};
				env.lib.message.client.denied.__nnkWrapped = true;
			}
			/* 引擎「退出房间」按钮:先清本内核的重连令牌再走引擎原流程——否则它
			 * 触发的重载会被客机重载包装当成"断线"登记自动重回,用户点了退出还会
			 * 被拉回原房间(实测)。清令牌+清会话后,重载包装看到空令牌就不登记了 */
			if (env.ui && env.ui.click && typeof env.ui.click.exit === "function" && !env.ui.click.exit.__nnkExitWrapped) {
				var origExit = env.ui.click.exit;
				env.ui.click.exit = function() {
					try {
						guestState.rejoinCode = null;
						guestState.rejoinGen = (guestState.rejoinGen || 0) + 1;
						resetSession();
						localStorage.removeItem(env.lib.configprefix + "nnk_guest_pending");
					} catch (eX) { /* 忽略 */ }
					return origExit.apply(this, arguments);
				};
				env.ui.click.exit.__nnkExitWrapped = true;
			}
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
				if (!String(offerText || "").trim()) {
					throw new Error("粘贴框是空的——把房主发来的「邀请码」整段贴进来再点连接");
				}
				data = rtc.decodeCode(offerText);
				if (data.k !== "offer") {
					throw new Error("这是回执码,请粘贴房主的「邀请码」");
				}
			} catch (err) {
				resetSession();
				bridgeApi().setPhase("idle");
				var pMsg = err.message || "";
				if (pMsg.indexOf("不是有效的联机助手码") >= 0 || pMsg.indexOf("码内容无法识别") >= 0) {
					pMsg += "——码可能被聊天软件截断/加了表情,请让房主重新整段复制发一次";
				}
				bridgeApi().emit("error", { message: pMsg });
				return;
			}
			pc.ondatachannel = function(e) {
				if (e.channel.label === "nnk-ping") {
					/* 专用心跳线(主机侧建的):只保温+判死,不进引擎 */
					e.channel.onopen = function() {
						session.ping = rtc.startPing(e.channel, function() {
							if (guestState.session !== session) {
								return;
							}
							bridgeApi().emit("info", { message: "与主机的连接静默了,自动重连…" });
							try { session.fake.channel.close(); } catch (eD) { /* 忽略 */ }
						}, function() {
							return session.fake ? (session.fake._lastIn || 0) : 0;   /* 主通道来包=主机活着 */
						});
					};
					return;
				}
				var fake = new rtc.FakeWebSocket(e.channel);
				session.fake = fake;
				fake.onUp(function() { session.wasIn = true; });
				/* 内核协议 tap(与房号模式同款):收到放行(loaded/引擎消息直达)才接
				 * 引擎——closed=房主解散,给人话收场,不对着断线发懵;
				 * lobby/queued=一体化房间的停车与排队,顺带从指令里收下房号:
				 * 邀请码门进来的客人也拿着房号,断线后能走房号门自动重回 */
				fake.onmessage = function(ev) {
					var msg;
					try {
						msg = JSON.parse(ev.data);
					} catch (e2) {
						/* 非 JSON 消息:暂存回放,防丢 */
						fake._buffer.push(ev.data);
						return;
					}
					/* JSON.parse("null") 会返回 null(不抛错)——显式判掉,别掉进外层
					 * catch 把 "null" 原文回放给引擎,更别让它走到下面的分支判断 */
					if (!msg) {
						return;
					}
					try {
						if (msg.nnk_stage === "full") {
							/* 旧内核主机:房满直接拒收(新内核满员改为排队) */
							session.autoConnect = false;
							resetSession();
							bridgeApi().setPhase("idle");
							bridgeApi().emit("error", { message: "房间人数已满,主机没能让你进——等有人退出,让房主发一张新邀请码再来" });
						} else if (msg.nnk_stage === "closed") {
							/* 房主解散房间(工坊取消):立即散场,不自动重回。
							 * 与房号门同款:顺带把还在跑的重回链停掉 */
							session.autoConnect = false;
							guestState.rejoinCode = null;
							resetSession();
							bridgeApi().setPhase("idle");
							bridgeApi().emit("info", { message: "房主已解散房间" });
						} else if (msg.nnk_stage === "lobby") {
							if (msg.code) {
								session.code = String(msg.code);   /* 房号到手:断线走房号门自动重回 */
							}
							session.parked = true;   /* 落点:自动重回循环到此收 */
							bridgeApi().setPhase("lobby_waiting", session.code ? { code: session.code } : {});
							fake.send(JSON.stringify({ nnk_hello: {
								name: nnk.env.get.connectNickname(),
								avatar: nnk.env.lib.config.connect_avatar || ""
							} }));
						} else if (msg.nnk_stage === "queued") {
							if (msg.code) {
								session.code = String(msg.code);
							}
							session.parked = true;
							bridgeApi().setPhase("queued", session.code ? { code: session.code } : {});
						} else if (msg.nnk_members) {
							/* 主机转发的成员表(与房号门同款分支!):客人弹窗的
							 * 等待队列数据源——缺了这条,邀请码客人一开弹窗就永远
							 * 停在「正在同步房间信息…」(实测报障) */
							bridgeApi().emit("room_members", msg.nnk_members);
						} else if (session.autoConnect && (msg.nnk_stage === "loaded" || Array.isArray(msg))) {
							/* loaded=新内核放行指令;引擎消息(数组)直达=对端还没发
							 * 放行指令的旧内核——都当作放行,缓冲后交引擎(混装不吊死) */
							if (msg.code && !session.code) {
								session.code = String(msg.code);
							}
							fake._buffer.push(ev.data);
							connectNow();
						}
						/* 其余(无 nnk_stage 的非数组消息)忽略 */
					} catch (e2) {
						/* 分支处理自身出错:原文暂存回放,不吞消息 */
						fake._buffer.push(ev.data);
					}
				};
				fake.onDown(function() {
					if (guestState.session === session) {
						guestState.session = null;
						try { if (session.ping) session.ping.stop(); } catch (eP) { /* 忽略 */ }
				/* 一体化房间:邀请码客人也拿着房号(内核随停车指令下发),
				 * 断开后走房号门自动重回——恢复不再区分当初从哪道门进来 */
				if (session.wasIn && session.code && nnk.env._status.connectMode) {
					bridgeApi().setPhase("joining", { code: session.code });
					autoRejoin(session.code, 8);
					return;
				}
						bridgeApi().setPhase("idle");
						bridgeApi().emit("room_closed", { side: "guest" });
					}
				});
			};
			/* 关键时机差:回执码生成后,客人这边的 ICE 检查立刻开跑,而主机要
			 * 等人工粘贴回执码才开始检查——时间差里客人的候选对会全部超时
			 * (实测 ~11 秒 connectionState 就到 failed)。这是常态不是故障,
			 * 绝不能据此断会话:主机粘贴后它的检查会打过来,本机监听还在,
			 * 通道照样接上(此前一看到 failed 就 resetSession,房主贴慢一点
			 * 就永远连不上)。给 3 分钟保底,超时才判死码引导重来 */
			pc.onconnectionstatechange = function() {
				if (pc.connectionState === "failed" && !session.failNoted) {
					session.failNoted = true;
					bridgeApi().emit("info", { message: "直连检查暂时没打通(房主还没粘贴回执码属正常)——把回执码发给房主,他点「连接」后通道会自动接上;本页别关,最多再等 3 分钟" });
					setTimeout(function() {
						if (guestState.session === session && pc.connectionState !== "connected" && pc.connectionState !== "closed") {
							bridgeApi().emit("error", { message: "3 分钟没等来房主的连接——回执码可能已失效(候选过期)或房主没粘贴;请房主换一张新邀请码,马上发马上用" });
							bridgeApi().setPhase("idle");
							resetSession();
						}
					}, 180000);
				}
			};
			setTimeout(function() {
				if (guestState.session === session && pc.connectionState !== "connected" && pc.connectionState !== "closed") {
					bridgeApi().emit("info", { message: "还没连上?确认房主已粘贴你的回执码并点了「连接」——他粘贴前,你这边的直连检查打不通是正常的" });
				}
			}, 30000);
			pc.setRemoteDescription(data.sdp).then(function() {
				noteRecv(rtc.addInjected(pc, data.hosts));   /* 主机随邀请码带来的虚拟网卡直连地址 */
				return pc.createAnswer();
			}).then(function(answer) {
				return pc.setLocalDescription(answer);
			}).then(function() {
				return rtc.waitGather(pc);
			}).then(function() {
				/* 带上房号(与 joining/lobby_waiting/queued 同款):setPhase 是整体
				 * 替换 state,不带的话生成回执码这一拍工坊的房号会凭空消失——客人
				 * 手里的「房间大厅 / 退出房间」入口跟着闪没(实测:回执码出了,
				 * 反而找不到自己的房间)。邀请码门进来的客人本来就有 session.code */
				bridgeApi().setPhase("answer_ready", session.code ? { code: session.code } : undefined);
				bridgeApi().emit("answer_ready", { code: rtc.encodeCode("answer", pc.localDescription, noteSent(rtc.directHosts(pc))) });
			}).catch(function(err) {
				console.error("[联机助手] 加入失败", err);
				resetSession();
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "加入失败: " + (err.message || err) });
			});
		},

		/* 房号模式(客人=offer 方):输房号 → 经 MQTT 发连接提议,等房主应答。
		 * rejoin=自动重回专用:客人进过房间后 game.online/waitingForPlayer 恒为真,
		 * 这两道"防加入别的房间"的守卫会把重回自己房间也拦死(实测 bug),
		 * 整个跳过——重连交给引擎原生协议(旧 id 握手 → 主机回 reinit) */
		joinByRoomCode: function(codeText, fromResume, rejoin) {
			var env = nnk.env;
			if (!fromResume && !env._status.connectMode) {
				ensureConnectBoot({ kind: "room", code: String(codeText || "") });
				return;
			}
			resetSession();
			if (!rejoin) {
				/* 手动发起新加入:清掉上一条重回链留下的判死证据与计数 */
				guestState.lastAttemptBeatDead = false;
				guestState.rejoinBeatStreak = 0;
			}
			if (!rejoin && env.game.online) {
				bridgeApi().emit("error", { message: "游戏正在联机中,请先退出当前对局" });
				return;
			}
			if (!rejoin && env._status.waitingForPlayer) {
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
			var session = { pc: pc, autoConnect: true, code: code, rejoin: !!rejoin };
			guestState.session = session;
			bridgeApi().setPhase("joining", { code: code });
			var channel = pc.createDataChannel("nnk-link", { ordered: true });
			var fake = new rtc.FakeWebSocket(channel);
			session.fake = fake;
			/* 专用心跳线:与游戏数据线分开(不经过引擎)——保温空闲链路 + 秒级
			 * 判死。判死就关主通道,交给既有机制(停泊中=autoRejoin;已进房=
			 * 引擎重载 + 「任何来源重载都自动重回」)立刻接管 */
			var pingChannel = pc.createDataChannel("nnk-ping", { ordered: true });
			pingChannel.onopen = function() {
				session.ping = rtc.startPing(pingChannel, function() {
					if (guestState.session !== session) {
						return;
					}
					bridgeApi().emit("info", { message: "与主机的连接静默了,自动重连…" });
					try { channel.close(); } catch (eD) { /* 忽略 */ }
				}, function() {
					return session.fake ? (session.fake._lastIn || 0) : 0;   /* 主通道来包=主机活着 */
				});
			};
			fake.onUp(function() {
				session.wasIn = true;
				/* 大厅停车:先不接引擎,等主机的 stage 指令——loaded=进引擎,
				 * lobby=停车并报身份(hello)。tap 先收内核协议,进引擎时被
				 * connectNow 换成引擎 handler,暂存的引擎消息由 replay 回放 */
				fake.onmessage = function(ev) {
					try {
						var msg = JSON.parse(ev.data);
						if (msg && msg.nnk_stage === "loaded" && session.autoConnect) {
							connectNow(session.rejoin);
						} else if (msg && msg.nnk_stage === "queued") {
							session.parked = true;   /* 排队也是落点,重试循环到此收 */
							bridgeApi().setPhase("queued", { code: code });
						} else if (msg && msg.nnk_stage === "lobby") {
							/* 停车在大厅:必须报阶段——此前只发 hello 不报阶段,
							 * 客人工坊一直停在「等房主应答」,看着像没进房(实测反馈) */
							session.parked = true;   /* 落点:自动重回循环不必再重试 */
							bridgeApi().setPhase("lobby_waiting", { code: code });
							fake.send(JSON.stringify({ nnk_hello: {
								name: nnk.env.get.connectNickname(),
								avatar: nnk.env.lib.config.connect_avatar || ""
							} }));
						} else if (msg && msg.nnk_stage === "closed") {
							/* 房主解散房间(工坊取消):立即散场,不自动重回。
							 * resetSession 后随后的通道断开事件变成空操作(会话已不在) */
							guestState.rejoinCode = null;
							resetSession();
							bridgeApi().setPhase("idle");
							bridgeApi().emit("info", { message: "房主已解散房间" });
						} else if (msg && msg.nnk_members) {
							/* 主机转发的成员表:客人弹窗的等待队列数据源(与主机同款
							 * room_members 事件,动态流里会被过滤不刷屏) */
							bridgeApi().emit("room_members", msg.nnk_members);
						} else if (session.autoConnect && Array.isArray(msg)) {
							/* 引擎消息(数组)直达=对端旧内核没发放行指令——当作
							 * 放行(混装不吊死);大厅停车期主机引擎不发包,无此路径 */
							fake._buffer.push(ev.data);
							connectNow(session.rejoin);
						}
					} catch (e2) {
						/* 非 JSON 消息:暂存回放,防丢 */
						fake._buffer.push(ev.data);
					}
				};
				fake.replay();
			});
			fake.onDown(function() {
				if (guestState.session === session) {
					guestState.session = null;
					try { if (session.ping) session.ping.stop(); } catch (eP) { /* 忽略 */ }
				/* 房号房间的通道断开(主机重组/换模式重载/掉线)一律自动重回:
				 * 主机真退了的话重试穷尽后会给明确提示。
				 * 注:曾试过在此抑制引擎自毁重载(保 game.onlineID)走原生断线重连
				 * (reinit),但引擎 1.11.6 的 reinit 路径 decoded parsedResult 对
				 * 活对象无环保护,重连必爆栈(Maximum call stack size exceeded,
				 * event.name:game)——退回引擎自家的重载路径,身份刷新为新人,
				 * 主机侧「对局中新客人」的原生拒绝由 denied 包装转成工坊提示 */
				if (session.wasIn && session.code && nnk.env._status.connectMode) {
					bridgeApi().setPhase("joining", { code: session.code });
					autoRejoin(session.code, 8);
					return;
				}
					bridgeApi().setPhase("idle");
					bridgeApi().emit("room_closed", { side: "guest" });
				}
			});
			pc.onconnectionstatechange = function() {
				if (guestState.session !== session) {
					return;   /* 旧 pc 的迟到报错:不惊扰新一轮尝试(双发同文案、还会 resetSession 误杀新会话,实测) */
				}
				if (pc.connectionState === "failed") {
					if (Date.now() - (guestState.lastIceFailAt || 0) > 2000) {
						guestState.lastIceFailAt = Date.now();
						bridgeApi().emit("error", { message: "直连建立失败(双方网络没打通)——反复失败检查防火墙是否放行无名杀(UDP),或让房主发一张邀请码,从另一道门进来" });
					}
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
							/* 心跳刷新判定:主机活着每 10 秒换一个新时间戳。retained
							 * 的旧心跳会一直挂在 broker 上(主机强关时不撤),只看
							 * "有没有心跳"会把死主机当在线——所以要盯"有没有刷新" */
							if (msg && typeof msg.ts === "number") {
								if (session.beatTs && msg.ts !== session.beatTs) {
									session.beatRefreshed = true;
									guestState.lastAttemptBeatDead = false;   /* 心跳在刷新=房主活着,清掉判死证据 */
									guestState.rejoinBeatStreak = 0;
								}
								session.beatTs = msg.ts;
							}
							if (msg && msg.nnk_loading && !session.loadingSeen) {
								/* 主机点「载入到游戏」:报个信就行,不整页重载——跟随靠
								 * 通道断开后的 autoRejoin 重连(轻量;早先这里会重载,
								 * 但主机侧从没发过这条消息,是死路,而且客人机多一次
								 * 重载风险更大)。主机重启后按 stage 指令进引擎 */
								session.loadingSeen = true;
								guestState.hostLoadingAt = Date.now();
								bridgeApi().emit("info", { message: "主机正在载入游戏,马上自动跟随…" });
								return;
							}
							return;
						}
						if (/\/answer\//.test(topic) && !answered && msg && msg.sdp) {
							answered = true;
							session.hostSeen = Date.now();
							pc.setRemoteDescription(msg.sdp).then(function() {
								noteRecv(rtc.addInjected(pc, msg.hosts));   /* 主机应答里带的虚拟网卡直连地址 */
							}).catch(function(err) {
								bridgeApi().emit("error", { message: "房主应答处理失败: " + (err.message || err) });
							});
						}
					}
				).then(function(mqttSession) {
					session.mqtt = mqttSession;
					/* 房主在线校验:retained 心跳会在 SUBSCRIBE 往返后送达。窗口 3.5→8 秒:
					 * 计时是从 mqtt connect 起算的,订阅确认 + retained 投递在慢中继/移动
					 * 网络下 1~3 秒是常态,3.5 秒会把活着的房主报成「没有找到在线主机」,
					 * 还白扣一次重回预算(每轮成本仅 8~11 秒,8 轮约 80 秒就烧完) */
					return new Promise(function(resolve, reject) {
						setTimeout(function() {
							if (!session.hostSeen) {
								reject(new Error("没有找到该房号的在线主机(房号可能输错,或房主已离线)"));
							} else {
								resolve(mqttSession);   /* 传给下一步发提议用(参数作用域不跨 then) */
							}
						}, 8000);
					});
				}).then(function(mqttSession) {
					return mqttSession.publish(signaling.roomTopic(code, "offer"), {
						guestId: guestId,
						sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
						hosts: noteSent(rtc.directHosts(pc))   /* 虚拟网卡直连地址(Radmin/ZeroTier 等) */
					});
				}).then(function() {
					bridgeApi().setPhase("waiting_host", { code: code });
					/* 心跳快判:主机活着每 10 秒刷一次心跳;发完提议后 14 秒内
					 * 没见刷新=主机强关/掉线(只剩 broker 上的 retained 旧心跳),
					 * 立刻收会话让自动重回续下一试——不干等 30 秒(实测:死主机
					 * 时每轮都要耗满 30 秒)。窗口 10→14 秒:主机开局/选将时
					 * 主线程可能整段卡住,心跳跟着断供——这是"忙"不是"死",
					 * 留足余量防误判(同族教训:客机刚进选将就被判死) */
					setTimeout(function() {
						if (!answered && guestState.session === session && !session.beatRefreshed) {
							guestState.lastAttemptBeatDead = true;   /* 重回循环据此换文案 */
							var inLoading = Date.now() - (guestState.hostLoadingAt || 0) < 60000;
							if (!inLoading) {
								guestState.rejoinBeatStreak = (guestState.rejoinBeatStreak || 0) + 1;   /* 非载入窗口的判死:计入连死轮数 */
							}
							/* 载入窗口内别喊"主机可能已关闭游戏":同屏的动态流里正挂着
							 * 「主机正在载入游戏,自动跟随重连」,两句自相矛盾 */
							bridgeApi().emit("error", { message: inLoading
								? "主机正在载入游戏(心跳暂断)——自动跟随重连中…"
								: "房主心跳已停止刷新——主机可能已关闭游戏,正在重试…" });
							bridgeApi().setPhase("idle");
							resetSession();
						}
					}, 14000);
					setTimeout(function() {
						if (!answered && guestState.session === session) {
							bridgeApi().emit("error", { message: "30 秒未收到房主应答(可能已掉线)——重新输入房号再试,或让房主发一张邀请码" });
							/* 收掉半死会话:自动重回循环据此续上下一试,状态不留悬空 */
							bridgeApi().setPhase("idle");
							resetSession();
						}
					}, 30000);
				}).catch(function(err) {
					resetSession();
					bridgeApi().setPhase("idle");
					bridgeApi().emit("error", { message: (err && err.message) || "加入失败" });
				});
			}).catch(function(err) {
				/* 信令层失败(MQTT 连不上/超时/库缺失)打标:自动重回循环据此不扣重试
				 * 次数——这不是"房主不在"的证据(实测:8 次重试全被信令超时耗完,误报
				 * "房主可能已关闭游戏")。标记由 signaling 层统一打(err.nnkSignal),
				 * 文案匹配保留作旧路径兜底 */
				if ((err && err.nnkSignal) || /信令服务器/.test(String((err && err.message) || err))) {
					guestState.lastJoinSignalFail = true;
				}
				resetSession();
				bridgeApi().setPhase("idle");
				bridgeApi().emit("error", { message: "加入失败: " + (err.message || err) });
			});
		},

		cancelJoin: function() {
			guestState.rejoinCode = null;   /* 停掉还在跑的自动重进循环 */
			guestState.rejoinGen = (guestState.rejoinGen || 0) + 1;   /* 迟到定时器一并作废 */
			resetSession();
			/* 重载尚未落地就取消:把待续跑标记一并清掉,落地后不再自动加入 */
			try {
				localStorage.removeItem(nnk.env.lib.configprefix + "nnk_guest_pending");
			} catch (e) { /* 忽略 */ }
		}
	};

	nnk.modules.guest = api;
})();

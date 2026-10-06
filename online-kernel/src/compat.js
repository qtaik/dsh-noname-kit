/*
 * 联机兼容层(M3):垫片 + 开闸 + 隔离。
 *
 * 思路:联机与离线的结构性差异是引擎级的、可数的。针对每个已知差异在引擎
 * API 上打一块小垫片,所有踩中该差异的第三方扩展一起被治好——不改任何扩展
 * 文件(公开插件,不知道对面装了什么)。未知的扩展错误由隔离层接住:记日志、
 * 报工坊、对局继续。
 *
 * 总开关:config autoUnlockExtensions(默认开),关掉即回到引擎原生行为。
 */
(function() {
	var nnk = window.__nnk__;
	var KERNEL_NAME = "联机助手";

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	function enabled() {
		return nnk.modules.config.get("autoUnlockExtensions") !== false;
	}

	function inConnect() {
		return nnk.env && nnk.env._status && nnk.env._status.connectMode;
	}

	/* 从错误堆栈里认出所属扩展(extension/<名字>/…)。跳过本内核自己的帧
	 * (熔断链路里必然有我们的帧,不能把联机助手自己隔离了);认不出返回 null */
	function extNameFromStack(stack) {
		var stackStr = String(stack || "");
		var re = /\/extension\/([^\/\n]+)/g;
		var m;
		while ((m = re.exec(stackStr)) !== null) {
			var name = decodeURIComponent(m[1]);
			if (name !== KERNEL_NAME) {
				return name;
			}
		}
		return null;
	}

	function firstStackLines(stack, n) {
		return String(stack || "").split("\n").slice(1, (n || 4) + 1).join(" ← ").trim();
	}

	/* ---- 扩展分类(美化 vs 内容):按目录特征判定,判定不了就放行 ---- */
	var cachedRoot;
	function gameRoot() {
		if (cachedRoot !== undefined) {
			return cachedRoot;
		}
		cachedRoot = null;
		var req = (typeof window !== "undefined" && typeof window.require === "function") ? window.require : (typeof require === "function" ? require : null);
		if (!req) {
			return cachedRoot;
		}
		var fs = req("fs");
		var path = req("path");
		var candidates = [];
		/* 渲染进程的 cwd 不可靠(快捷方式启动时=任意目录),以 exe 路径为锚:
		 * 无名杀.exe → 壳根 → resources/app(扩展必然在其 extension/ 下) */
		try {
			candidates.push(path.join(path.dirname(process.execPath), "resources", "app"));
		} catch (e) { /* 忽略 */ }
		try {
			candidates.push(path.dirname(process.execPath));
		} catch (e) { /* 忽略 */ }
		try {
			candidates.push(process.cwd());
		} catch (e) { /* 忽略 */ }
		try {
			candidates.push(path.resolve(process.cwd(), "resources", "app"));
		} catch (e) { /* 忽略 */ }
		try {
			candidates.push(path.resolve(process.cwd(), ".."));
		} catch (e) { /* 忽略 */ }
		for (var i = 0; i < candidates.length; i++) {
			try {
				if (fs.existsSync(path.join(candidates[i], "extension", KERNEL_NAME, "extension.js"))) {
					cachedRoot = candidates[i];
					break;
				}
			} catch (e) { /* 忽略 */ }
		}
		return cachedRoot;
	}

	/* 内容扩展 = 目录里有 character.js 或 card.js(贡献武将/卡牌包);
	 * 其余视为美化类。美化类默认不参与联机加载(unlockUIExtensions 开关可放行),
	 * 判定不了(无 fs/定位不到根目录)按放行处理,宁可多开不错杀。 */
	function isContentExt(name) {
		if (nnk.modules.config.get("unlockUIExtensions")) {
			return true;
		}
		if (!name || KERNEL_NAME === name || /[\\\/:*?"<>|]/.test(name)) {
			return false;
		}
		var req = (typeof window !== "undefined" && typeof window.require === "function") ? window.require : (typeof require === "function" ? require : null);
		var root = gameRoot();
		if (!req || !root) {
			return true;
		}
		try {
			var fs = req("fs");
			var path = req("path");
			var dir = path.join(root, "extension", name);
			return fs.existsSync(path.join(dir, "character.js")) || fs.existsSync(path.join(dir, "card.js"));
		} catch (e) {
			return true;
		}
	}

	/* 隔离名单:名单内的扩展不再开闸(回退引擎原生行为=不加载其 content)。
	 * 0.3.5 起**不再自动写名单**——链式包装下按堆栈帧定罪必然误伤(真机
	 * 实证:十周年UI 被连坐),当前策略=只熔断降级+上报;名单保留给手动
	 * 清理(工坊重置按钮)与未来更准的定罪策略。本内核永不入名单。 */
	function blocklist() {
		var list = nnk.modules.config.get("unlockBlock");
		return Array.isArray(list) ? list.filter(function(n) { return n !== KERNEL_NAME; }) : [];
	}

	function quarantine(ext) {
		if (!ext || blocklist().indexOf(ext) >= 0) {
			return;
		}
		var list = blocklist();
		list.push(ext);
		try {
			nnk.modules.config.set("unlockBlock", list);
		} catch (e) { /* 存不进名单则下次还会踩,保险丝仍兜底 */ }
		bridgeApi().emit("ext_quarantined", {
			ext: ext,
			message: "联机下爆栈,已自动隔离(不加载该扩展的联机内容,重启游戏生效)"
		});
	}

	function clearQuarantine() {
		try {
			nnk.modules.config.set("unlockBlock", []);
		} catch (e) { /* 忽略 */ }
		bridgeApi().emit("ext_error", { message: "隔离名单已清空,重启游戏后全部扩展恢复联机加载" });
	}

	/*
	 * 闸1:引擎在联机模式默认整段跳过扩展 content(init/loading.js:
	 * !extension[5] && mode==="connect")。把 lib.extensions 里每条记录的
	 * 第 6 格(connect 标志)统一置真。
	 * 时机:onload 用 lib.extensions.map(loadExtension) 起内容加载,闸门检查
	 * 在 map 调用里同步跑完——所以必须在那之前翻完。boot 在导入期执行,先翻
	 * 一遍现存记录并包住 push;再包 game.import,每次新扩展注册都重翻一遍,
	 * 保证无论如何最后一条注册完成后全部标志就位。
	 */
	var importWrapped = false;
	function unlockExtensions() {
		if (!enabled()) {
			return;
		}
		var env = nnk.env;
		var blocked = blocklist();
		/* 裁决一条扩展的联机开关:本内核恒开(联机模式靠它自举,不能被分类
		 * 规则误伤);隔离名单内=关;内容扩展=开(哪怕作者没声明);
		 * 美化类=关(哪怕作者声明了 connect:true——真机实证:美化族普遍自带
		 * connect 声明,只拨亮不拨灭的话它们照样加载,开闸形同虚设) */
		function decide(name, obj) {
			if (name === KERNEL_NAME) {
				return true;
			}
			if (blocked.indexOf(name) >= 0) {
				return false;
			}
			return extKind(name, obj) === "content";
		}
		/* 内容/美化分类:现代扩展把武将/卡牌声明在 package 里(真机实证:小游戏
		 * 的武将在 package.character.character,磁盘上没有特征文件),所以对象
		 * 特征优先,磁盘特征(character.js/card.js)只做兜底。判定不了按美化。 */
		function extKind(name, obj) {
			try {
				var src = obj || (nnk.env.lib.extensionPack && nnk.env.lib.extensionPack[name]) || null;
				if (src) {
					var files = src.files || null;
					if (files && ((files.character && files.character.length) || (files.card && files.card.length))) {
						return "content";
					}
					var pc = src.character;
					if (pc && (Array.isArray(pc) ? pc.length : Object.keys(pc).length)) {
						return "content";
					}
					var cc = src.card;
					if (cc && (Array.isArray(cc) ? cc.length : Object.keys(cc).length)) {
						return "content";
					}
				}
			} catch (e) { /* 忽略 */ }
			return isContentExt(name) ? "content" : "ui";
		}
		var arr = env.lib.extensions;
		if (Array.isArray(arr)) {
			arr.forEach(function(ext) {
				if (Array.isArray(ext)) {
					ext[5] = decide(ext[0]);
				}
			});
			if (!arr.__nnkUnlocked) {
				var origPush = arr.push;
				arr.push = function() {
					for (var i = 0; i < arguments.length; i++) {
						if (Array.isArray(arguments[i])) {
							arguments[i][5] = decide(arguments[i][0]);
						}
					}
					return origPush.apply(this, arguments);
				};
				arr.__nnkUnlocked = true;
			}
		}
		if (!importWrapped && typeof env.game.import === "function") {
			var origImport = env.game.import;
			env.game.import = function(type, func) {
				var wrappedFunc = func;
				if (type === "extension" && enabled() && typeof func === "function") {
					wrappedFunc = function() {
						var obj = func.apply(this, arguments);
						try {
							if (obj && obj.name) {
								var want = decide(obj.name, obj);
								obj.connect = want;
								/* 官方 1.11.5:未启用的扩展在 game.import 开头直接早退
								 * (自动导入的扩展默认未启用)——内容扩展代为启用,
								 * 否则联机模式下它们连注册记录都不会有 */
								if (want && !nnk.env.lib.config["extension_" + obj.name + "_enable"]) {
									env.game.saveConfig("extension_" + obj.name + "_enable", true);
								}
							}
						} catch (e) { /* 忽略 */ }
						return obj;
					};
				}
				var ret = origImport.call(this, type, wrappedFunc);
				if (type === "extension") {
					try {
						unlockExtensions();
					} catch (e) { /* 忽略 */ }
				}
				return ret;
			};
			importWrapped = true;
		}
	}

	/*
	 * 闸2:扩展武将包/卡牌包须在 lib.connectCharacterPack / lib.connectCardPack
	 * 里才进联机选将池(init/loading.js 只认包对象上的 connect 标志)。
	 * 在建房/进房时调用——此刻所有包已解析完毕,直接把本地全部包名推进去。
	 * 双方都开:房间的包列表由房主定,客人侧同名包可用是补包生效的前提。
	 */
	function unlockPacks() {
		if (!enabled()) {
			return;
		}
		var lib = nnk.env.lib;
		/* 自定义包要进房间设置,需要三处注册(真机逐层实证):
		 * 1. connectCharacterPack/connectCardPack——联机资格池;
		 * 2. config.all.characters/cards——总注册表,房间设置菜单的数据源
		 *    (用户当年手改游戏本体文件注册的就是这个数组);
		 * 3. config.characters/cards——启用列表,菜单开关默认打开。 */
		[
			["characterPack", "connectCharacterPack", "characters"],
			["cardPack", "connectCardPack", "cards"]
		].forEach(function(pair) {
			var packs = lib[pair[0]];
			var connectList = lib[pair[1]];
			if (!packs || !Array.isArray(connectList)) {
				return;
			}
			var allList = lib.config.all && Array.isArray(lib.config.all[pair[2]]) ? lib.config.all[pair[2]] : null;
			var enabledList = Array.isArray(lib.config[pair[2]]) ? lib.config[pair[2]] : null;
			for (var name in packs) {
				if (connectList.indexOf(name) < 0) {
					connectList.push(name);
				}
				if (allList && allList.indexOf(name) < 0) {
					allList.push(name);
				}
				if (enabledList && enabledList.indexOf(name) < 0) {
					enabledList.push(name);
				}
				/* 官方 translate 无兜底:扩展没配「包名_character_config」翻译时,
				 * 房间设置里的标签渲染成空白,看起来像"没加载"(真机实证)——
				 * 内核代填,用扩展名当标签 */
				try {
					if (lib.translate[name + "_character_config"] === undefined) {
						lib.translate[name + "_character_config"] = name;
					}
					if (lib.translate[name + "_card_config"] === undefined) {
						lib.translate[name + "_card_config"] = name;
					}
				} catch (e) { /* 忽略 */ }
			}
		});
	}

	/*
	 * 垫片(首块):无懈可击信息表挂点。离线:表挂在"是否使用无懈可击"询问
	 * 事件的父事件上(_info_map);联机:引擎把表随消息发给客人,挂在询问事件
	 * 自己身上(info_map)。读父事件的扩展在联机下必炸(十周年UI 实证)。
	 * 垫片在事件创建时发现身上带 info_map 而父事件没挂,就补一份引用过去,
	 * 事件收尾时清掉防串味。离线路径父事件本来就有表,垫片自动空转。
	 */
	function shimInfoMap() {
		var lib = nnk.env.lib;
		var proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || typeof proto.chooseToUse !== "function" || proto.chooseToUse.__nnkInfoMapShim) {
			return;
		}
		var orig = proto.chooseToUse;
		proto.chooseToUse = function() {
			var next = orig.apply(this, arguments);
			try {
				if (enabled() && next && next.info_map && next.parent && next.parent._info_map === undefined) {
					next.parent._info_map = next.info_map;
					var origFinish = next.finish;
					if (typeof origFinish === "function") {
						next.finish = function() {
							try {
								if (next.parent && next.parent._info_map === next.info_map) {
									delete next.parent._info_map;
								}
							} catch (e) { /* 忽略 */ }
							return origFinish.apply(this, arguments);
						};
					}
				}
			} catch (e) { /* 垫片绝不影响原流程 */ }
			return next;
		};
		proto.chooseToUse.__nnkInfoMapShim = true;
	}

	/*
	 * 隔离1:扩展运行期钩子。引擎经 game.callHook 逐个调 lib.hooks[name] 里的
	 * 钩子,一个崩会把整个流程带走(错误弹窗+局面卡死)。联机模式下改为逐个
	 * try/catch:崩了记扩展名+堆栈报工坊,其余钩子照跑。非联机模式原样走
	 * 原函数,离线行为零变化。
	 */
	function guardHooks() {
		var game = nnk.env.game;
		if (typeof game.callHook !== "function" || game.callHook.__nnkGuarded) {
			return;
		}
		var orig = game.callHook;
		game.callHook = function(name, args) {
			var hooks = inConnect() && nnk.env.lib.hooks ? nnk.env.lib.hooks[name] : null;
			if (!hooks) {
				return orig.call(this, name, args);
			}
			var list = [];
			try {
				for (var it of hooks) {
					list.push(it);
				}
			} catch (e) {
				return orig.call(this, name, args);
			}
			for (var i = 0; i < list.length; i++) {
				if (typeof list[i] !== "function") {
					continue;
				}
				try {
					list[i].apply(null, args);
				} catch (err) {
					console.error("[联机助手] 扩展钩子报错(已拦截):", name, err);
					bridgeApi().emit("ext_error", {
						hook: name,
						ext: extNameFromStack(err && err.stack),
						message: (err && err.message) || String(err),
						stack: firstStackLines(err && err.stack, 4)
					});
				}
			}
		};
		game.callHook.__nnkGuarded = true;
	}

	/*
	 * 隔离2:联机模式下,扩展文件里的未捕获错误不再走引擎的全局 alert
	 * (util/error.js setOnError——一局能弹十几次),改为记录+上报工坊;
	 * 引擎本体的错误照常弹原窗(那是真问题,必须让人看见)。
	 */
	function guardErrorPopup() {
		if (window.__nnkOnerrorGuarded) {
			return;
		}
		window.__nnkOnerrorGuarded = true;
		var orig = window.onerror;
		window.onerror = function(msg, src, line, col, err) {
			try {
				if (enabled() && inConnect() && err) {
					var ext = extNameFromStack(err.stack);
					if (ext) {
						console.error("[联机助手] 扩展运行错误(联机下已拦截,不弹窗):", ext, err);
						bridgeApi().emit("ext_error", {
							ext: ext,
							message: err.message || String(msg),
							stack: firstStackLines(err.stack, 6)
						});
						return;
					}
				}
			} catch (e) { /* 判定失败走原路径 */ }
			return orig && orig.apply(this, arguments);
		};
	}

	/* 透视:把引擎里每条扩展的最终裁决结果报给工坊(建房/进房时调用,
	 * 此刻所有扩展已注册完毕)。加载=引擎会跑它的 content;跳过=不加载。 */
	function dumpExtensions() {
		try {
			var arr = nnk.env.lib.extensions;
			if (!Array.isArray(arr)) {
				return;
			}
			var loaded = [];
			var skipped = [];
			arr.forEach(function(ext) {
				if (!Array.isArray(ext)) {
					return;
				}
				var kind = isContentExt(ext[0]) ? "content" : "ui";
				if (ext[5]) {
					loaded.push(ext[0]);
				} else if (kind === "content") {
					skipped.push(ext[0] + "(内容扩展被关)");
				} else {
					skipped.push(ext[0]);
				}
			});
			bridgeApi().emit("ext_dump", {
				loaded: loaded,
				skipped: skipped,
				configured: (nnk.env.lib.config.extensions || []).slice(),
				packs: {
					all: Object.keys(nnk.env.lib.characterPack || {}),
					connect: (nnk.env.lib.connectCharacterPack || []).slice(),
					excluded: (nnk.env.lib.config.connect_characters || []).slice(),
					cardsExcluded: (nnk.env.lib.config.connect_cards || []).slice(),
					cardsAll: Object.keys(nnk.env.lib.cardPack || {}),
					cardsConnect: (nnk.env.lib.connectCardPack || []).slice()
				}
			});
		} catch (e) { /* 忽略 */ }
	}

	nnk.modules.compat = {
		install: function() {
			unlockExtensions();
			/* 包池解锁的三个时机,层层兜底(真机实证:联机菜单页在 connect 启动
			 * 时一次性构建,晚于包解析、早于 switchMode——必须赶在菜单构建前):
			 * 时机一 arenaReady——arena 建好、联机菜单未构建(主时机);
			 * 时机二 switchMode——房间配置快照前;
			 * 时机三 createServer——软服务器启动(兜底)。 */
			try {
				if (Array.isArray(nnk.env.lib.arenaReady)) {
					nnk.env.lib.arenaReady.push(function() {
						if (enabled()) {
							unlockPacks();
						}
					});
				}
			} catch (e) { /* 忽略 */ }
			/* 包池解锁必须赶在引擎快照之前:switchMode 组装房间配置时会把
			 * connectCharacterPack slice 成 configOL.characterPack(真机实证:
			 * 解锁挂在 createServer 里晚于快照,自定义武将/卡牌进不了房间) */
			var env = nnk.env;
			if (typeof env.game.switchMode === "function" && !env.game.switchMode.__nnkPackUnlock) {
				var origSwitchMode = env.game.switchMode;
				env.game.switchMode = function(name2, configx) {
					try {
						if (enabled()) {
							unlockPacks();
						}
					} catch (e) { /* 忽略 */ }
					return origSwitchMode.apply(this, arguments);
				};
				env.game.switchMode.__nnkPackUnlock = true;
			}
			/* 模式页右侧面板补建:引擎的模式面板是懒构建(点标签才生成),无头
			 * 建房没人点过,进房后其它模式面板被移除、房间模式面板不存在→空白。
			 * 包装 ui.click.connectMenu(菜单打开)后自动补建房间模式的面板 */
			try {
				var clickTarget = env.ui.click;
				if (clickTarget && !clickTarget.__nnkMenuPatched) {
					var rawConnectMenu = clickTarget.connectMenu || null;
					var wrappedMenu = null;
					var ensureModePane = function() {
						try {
							var cfgOL = env.lib.configOL;
							var mode = cfgOL && cfgOL.mode;
							if (!mode || !env._status.waitingForPlayer) {
								return;
							}
							var container = env.ui.connectMenuContainer;
							if (!container) {
								return;
							}
							var all = container.getElementsByTagName("*");
							for (var i = 0; i < all.length; i++) {
								var node = all[i];
								if (node.mode === mode && typeof node._initLink === "function") {
									node.classList.add("active");
									if (!node.link) {
										node._initLink();
									}
									if (node.link && node.parentNode && node.parentNode.nextSibling) {
										node.parentNode.nextSibling.appendChild(node.link);
									}
									break;
								}
							}
						} catch (e) { /* 忽略 */ }
					};
					Object.defineProperty(clickTarget, "connectMenu", {
						configurable: true,
						get: function() {
							if (rawConnectMenu && !wrappedMenu) {
								wrappedMenu = function() {
									var ret = rawConnectMenu.apply(this, arguments);
									try {
										if (env._status && env._status.waitingForPlayer) {
											setTimeout(ensureModePane, 30);
										}
									} catch (e) { /* 忽略 */ }
									return ret;
								};
							}
							return wrappedMenu || rawConnectMenu;
						},
						set: function(v) {
							rawConnectMenu = v;
							wrappedMenu = null;
						}
					});
					clickTarget.__nnkMenuPatched = true;
				}
			} catch (e) { /* 忽略 */ }
			shimInfoMap();
			guardHooks();
			guardErrorPopup();
			console.log("[联机助手] 兼容层就绪(开闸+垫片+错误拦截" + (enabled() ? "" : ",总开关已关闭") + ",隔离名单 " + blocklist().length + " 项)");
		},
		unlockExtensions: unlockExtensions,
		unlockPacks: unlockPacks,
		clearQuarantine: clearQuarantine,
		gameRoot: gameRoot,
		dumpExtensions: dumpExtensions
	};
})();

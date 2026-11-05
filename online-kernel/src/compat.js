/* 联机兼容层：在引擎 API 上适配已知的联机与离线差异，不改写第三方扩展文件；异常交给隔离层记录。autoUnlockExtensions 关闭时采用引擎原生行为。 */
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
			var name = m[1];
			try {
				name = decodeURIComponent(name);   /* 目录名带非法百分号转义(如 50%off)会抛:退回原文 */
			} catch (e2) { /* 忽略 */ }
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

	/* 隔离名单中的扩展保持引擎原生的不加载行为；不自动根据堆栈写入名单，仅熔断、降级和上报。名单支持手动清理，联机助手自身不加入名单。 */
	function blocklist() {
		var list = nnk.modules.config.get("unlockBlock");
		return Array.isArray(list) ? list.filter(function(n) { return n !== KERNEL_NAME; }) : [];
	}

	/* 通过 clearQuarantine 与 blocklist 管理手动隔离名单，不提供自动隔离链路。 */

	function clearQuarantine() {
		try {
			nnk.modules.config.set("unlockBlock", []);
		} catch (e) { /* 忽略 */ }
		bridgeApi().emit("ext_error", { message: "隔离名单已清空,重启游戏后全部扩展恢复联机加载" });
	}

	
	/* 对象内容优先,目录特征兜底;供联机裁决与体检共同使用。 */
	function extKind(name, obj) {
		try {
			var src = obj || (nnk.env.lib.extensionPack && nnk.env.lib.extensionPack[name]) || null;
			if (src) {
				var files = src.files;
				if (files && ((files.character && files.character.length) || (files.card && files.card.length))) return "content";
				var pack = src.package || src;
				var pc = pack.character && (pack.character.character || pack.character);
				var cc = pack.card && (pack.card.card || pack.card);
				if (pc && Object.keys(pc).length || cc && Object.keys(cc).length) return "content";
			}
		} catch (e) { /* 无法读取对象时使用目录特征 */ }
		return isContentExt(name) ? "content" : "ui";
	}
	var importWrapped = false;
	/**
	 * 扩展内容加载：联机模式按 lib.extensions 记录的 connect 标志决定是否加载内容。
	 * 必须在 onload 开始遍历前设置现有记录，并处理 push 和 game.import 新增的记录。
	 */
	function unlockExtensions() {
		if (!enabled()) {
			return;
		}
		var env = nnk.env;
		var blocked = blocklist();
		/* 裁决扩展联机开关：本内核保持开启，隔离名单中的扩展关闭，内容扩展开启，美化扩展关闭；分类结果优先于扩展自报的 connect 标志。 */
		function decide(name, obj) {
			if (nnk.modules.isolation && nnk.modules.isolation.blocked(name)) return false;
			if (name === KERNEL_NAME) {
				return true;
			}
			if (blocked.indexOf(name) >= 0) {
				return false;
			}
			return extKind(name, obj) === "content";
		}
		var arr = env.lib.extensions;
		if (Array.isArray(arr)) {
			arr.forEach(function(ext) {
				if (Array.isArray(ext)) {
					ext[5] = decide(ext[0], ext[4]);
				}
			});
			if (!arr.__nnkUnlocked) {
				var origPush = arr.push;
				arr.push = function() {
					for (var i = 0; i < arguments.length; i++) {
						if (Array.isArray(arguments[i])) {
							arguments[i][5] = decide(arguments[i][0], arguments[i][4]);
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

	/**
	 * 联机选将池：扩展包名需要加入 lib.connectCharacterPack / lib.connectCardPack。
	 * 建房或进房时，包已解析完毕，再将本地包加入列表；房主决定房间使用哪些包。
	 */
	function unlockPacks() {
		if (!enabled()) {
			return;
		}
		/* 只在联机语境下解锁:这三处注册里 config.characters/cards 就是**离线模式**
		 * 的启用列表,单机时把用户关掉的包全打开会污染设置(用户在菜单里动过包
		 * 开关就会被引擎把这份被改的表 saveConfig 落库)。 */
		var connectMode = false;
		try {
			connectMode = !!(nnk.env._status && nnk.env._status.connectMode) || nnk.env.lib.config.mode === "connect";
		} catch (e0) { connectMode = false; }
		if (!connectMode) {
			return;
		}
		var lib = nnk.env.lib;
		/* 自定义包分别注册到联机资格池 connectCharacterPack/connectCardPack、菜单数据源 config.all.characters/cards 和启用列表 config.characters/cards。 */
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
				/* 扩展未提供包名_character_config 翻译时，以扩展名补足房间设置标签。 */
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

	/* 将联机询问事件上的 info_map 引用补到缺少 _info_map 的父事件，兼容按父事件取表的扩展；事件结束时清理引用。 */
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
					var ext = extNameFromStack(err && err.stack);
					/* 归因不到扩展的钩子=引擎自带(defaultHooks 与扩展同住一张表):
					 * 仍然拦下(保联机稳定),但措辞分开——当成"扩展报错"上报会把
					 * 引擎自己的问题引向错误的排查方向 */
					console.error("[联机助手] " + (ext ? "扩展" : "引擎") + "钩子报错(已拦截):", name, err);
					bridgeApi().emit("ext_error", {
						hook: name,
						ext: ext,
						message: (ext ? "" : "[引擎钩子] ") + ((err && err.message) || String(err)),
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
				/* 扩展分类同样使用 extKind，优先读取对象声明，避免把含武将或卡牌的现代扩展误判为美化包。 */
				var kind = extKind(ext[0], ext[4]);
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

	/*
	 * 人物标识:把工坊保存的联机身份写进引擎原生键,零包装零补丁。
	 * 名字 → connect_nickname(引擎 get.connectNickname() 同款截 12 字,
	 * 联机握手包与 game.me.nickname 都读它);头像 → connect_avatar
	 * (武将 id,引擎拿 id 自己找图)。双写(普通 + "connect")与原生
	 * 设置页姿势一致。留空 = 完全不动,游戏内自己的设置照常生效。
	 */
	function applyIdentity() {
		/* 以工坊配置的变化判断是否覆盖昵称和头像：工坊值未变时，仅在引擎值仍等于上次同步值时写入；工坊值变化时更新并记录，保留用户在游戏内的修改。 */
		try {
			var game = nnk.env.game;
			var lib = nnk.env.lib;
			var curName = "";
			var curAvatar = "";
			try { curName = String(lib.config.connect_nickname || ""); } catch (e0) { curName = ""; }
			try { curAvatar = String(lib.config.connect_avatar || ""); } catch (e1) { curAvatar = ""; }
			var nextName = String(nnk.modules.config.get("onlineName") || "").slice(0, 12);
			var last = String(nnk.modules.config.get("identityStamped") || "");
			if (nextName && nextName !== curName && (nextName !== last || curName === last)) {
				game.saveConfig("connect_nickname", nextName);
				game.saveConfig("connect_nickname", nextName, "connect");
				curName = nextName;
			}
			if (nextName) {
				nnk.modules.config.set("identityStamped", nextName);
			}
			var nextAvatar = String(nnk.modules.config.get("onlineAvatar") || "").slice(0, 24);
			var lastA = String(nnk.modules.config.get("avatarStamped") || "");
			if (nextAvatar && nextAvatar !== curAvatar && (nextAvatar !== lastA || curAvatar === lastA)) {
				game.saveConfig("connect_avatar", nextAvatar);
				game.saveConfig("connect_avatar", nextAvatar, "connect");
			}
			if (nextAvatar) {
				nnk.modules.config.set("avatarStamped", nextAvatar);
			}
		} catch (e) { /* 身份写不进去不致命,引擎默认值(无名玩家/caocao)兜底 */ }
	}

	/* 武将 id 是否本机存在:set_identity 的头像校验用。lib.character 已含全部
	 * 已加载包,characterPack 查询兜底 mode_ 临时包;判定不了按原生姿势放行
	 * (原生设置页就是个文本框,啥 id 都收,引擎自己兜底渲染)。 */
	function hasCharacter(id) {
		try {
			var lib = nnk.env.lib;
			if (lib.character && lib.character[id]) {
				return true;
			}
			var packs = lib.characterPack || {};
			for (var p in packs) {
				if (packs[p] && packs[p][id]) {
					return true;
				}
			}
			return false;
		} catch (e) {
			return true;
		}
	}

	nnk.modules.compat = {
		install: function() {
			applyIdentity();
			unlockExtensions();
			/* 在 arenaReady、switchMode 和 createServer 三处解锁包池：分别覆盖联机菜单构建前、房间配置快照前和软服务器启动时的注册需求。 */
			try {
				if (Array.isArray(nnk.env.lib.arenaReady)) {
					nnk.env.lib.arenaReady.push(function() {
						if (enabled()) {
							unlockPacks();
						}
					});
				}
			} catch (e) { /* 忽略 */ }
			/* 在 switchMode 创建 configOL.characterPack 快照前解锁包池，使自定义武将与卡牌进入房间配置。 */
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
		unlockPacks: unlockPacks,
		clearQuarantine: clearQuarantine,
		gameRoot: gameRoot,
		dumpExtensions: dumpExtensions,
		applyIdentity: applyIdentity,
		hasCharacter: hasCharacter
	};
})();

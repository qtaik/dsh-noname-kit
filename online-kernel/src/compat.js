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

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	function enabled() {
		return nnk.modules.config.get("autoUnlockExtensions") !== false;
	}

	function inConnect() {
		return nnk.env && nnk.env._status && nnk.env._status.connectMode;
	}

	/* 从错误堆栈里认出所属扩展(extension/<名字>/…),认不出返回 null */
	function extNameFromStack(stack) {
		var m = /\/extension\/([^\/\n]+)/.exec(String(stack || ""));
		return m ? decodeURIComponent(m[1]) : null;
	}

	function firstStackLines(stack, n) {
		return String(stack || "").split("\n").slice(1, (n || 4) + 1).join(" ← ").trim();
	}

	/* 隔离名单:在联机下爆栈过的扩展不再开闸(回退引擎原生行为=不加载其
	 * content),名单持久化在内核配置里,其余扩展照常开闸。 */
	function blocklist() {
		var list = nnk.modules.config.get("unlockBlock");
		return Array.isArray(list) ? list : [];
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
		var arr = env.lib.extensions;
		if (Array.isArray(arr)) {
			arr.forEach(function(ext) {
				if (Array.isArray(ext) && !ext[5] && blocked.indexOf(ext[0]) < 0) {
					ext[5] = true;
				}
			});
			if (!arr.__nnkUnlocked) {
				var origPush = arr.push;
				arr.push = function() {
					for (var i = 0; i < arguments.length; i++) {
						if (Array.isArray(arguments[i]) && !arguments[i][5] && blocked.indexOf(arguments[i][0]) < 0) {
							arguments[i][5] = true;
						}
					}
					return origPush.apply(this, arguments);
				};
				arr.__nnkUnlocked = true;
			}
		}
		if (!importWrapped && typeof env.game.import === "function") {
			var origImport = env.game.import;
			env.game.import = function(type) {
				var ret = origImport.apply(this, arguments);
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
		[["characterPack", "connectCharacterPack"], ["cardPack", "connectCardPack"]].forEach(function(pair) {
			var packs = lib[pair[0]];
			var connectList = lib[pair[1]];
			if (!packs || !Array.isArray(connectList)) {
				return;
			}
			for (var name in packs) {
				if (connectList.indexOf(name) < 0) {
					connectList.push(name);
				}
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

	/*
	 * 防砖保险丝:个别扩展用代理包装 ui.create.arena,联机模式下自引用成环,
	 * 引擎开机调 arena 时爆栈(RangeError),整次启动直接失败(真机实证:
	 * 十周年B4UI,「加载内容失败」大屏)。保险丝包住 ui.create.arena:第一次
	 * 爆栈就摘除全部扩展包装、退回原版 arena 让启动活下去,并把肇事扩展拉进
	 * 隔离名单——下次启动其 content 不再加载,其余扩展照常开闸。
	 */
	function arenaFuse() {
		var ui = nnk.env.ui;
		if (!ui || !ui.create || typeof ui.create.arena !== "function" || ui.create.arena.__nnkFuse) {
			return;
		}
		var pristine = ui.create.arena;
		var fuse = function() {
			var current = ui.create.arena;
			var fn = current === fuse ? pristine : current;
			try {
				return fn.apply(this, arguments);
			} catch (e) {
				if (e instanceof RangeError && ui.create.arena !== pristine) {
					var ext = extNameFromStack(e && e.stack);
					console.error("[联机助手] arena 包装器爆栈,已摘除扩展包装退回原版:", ext, e);
					ui.create.arena = pristine;
					quarantine(ext);
					return pristine.apply(this, arguments);
				}
				throw e;
			}
		};
		ui.create.arena = fuse;
	}

	nnk.modules.compat = {
		install: function() {
			unlockExtensions();
			arenaFuse();
			shimInfoMap();
			guardHooks();
			guardErrorPopup();
			console.log("[联机助手] 兼容层就绪(开闸+垫片+隔离" + (enabled() ? "" : ",总开关已关闭") + ",隔离名单 " + blocklist().length + " 项)");
		},
		unlockExtensions: unlockExtensions,
		unlockPacks: unlockPacks,
		clearQuarantine: clearQuarantine
	};
})();

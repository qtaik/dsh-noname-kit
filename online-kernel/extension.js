/*
 * 联机助手·内核(无头运行时)—— 由 dsh-noname-kit 插件安装/升级到游戏 extension/ 目录。
 *
 * 职责:在游戏进程里提供跨网络联机的"插座"(WebRTC 传输 + 引擎联机接驳),
 * 自身不带任何操作界面 —— 建房/加入/发码收码全部由 DSH 工坊「🌐 联机」页签
 * 指挥,经本地 HTTP 心跳桥(src/bridge.js)轮询命令、上报状态。
 *
 * 形态说明:纯老式 game.import 模块副作用注册(零 import 语句),
 * 1.9.0(ESM 动态 import 加载)与 1.11.x(window.game shim)两版通吃。
 */
(function() {
	if (window.__nnkLoaded) {
		return;
	}
	window.__nnkLoaded = true;
	if (!window.__nnk__) {
		window.__nnk__ = { version: "0.1.2", modules: {}, env: null, state: {} };
	}

	game.import("extension", function(lib, game, ui, get, ai, _status) {
		return {
			name: "联机助手",
			/* 引擎联机模式下的扩展总闸(init/loading.js)只放行带 connect 标志的扩展,
			 * 内核自身必须带,否则联机模式下整个内核不加载。 */
			connect: true,
			editable: false,
			precontent: function() {
				return window.__nnk__.boot(lib, game, ui, get, ai, _status);
			},
			content: function() {
				/* content 阶段无额外动作:一切挂接已在 precontent 完成 */
			}
		};
	});

	window.__nnk__.boot = async function(lib, game, ui, get, ai, _status) {
		var nnk = window.__nnk__;
		nnk.env = { lib: lib, game: game, ui: ui, get: get, ai: ai, _status: _status };
		var files = ["config", "rtc", "host", "guest", "bridge"];
		for (var i = 0; i < files.length; i++) {
			var name = files[i];
			if (nnk.modules[name]) {
				continue;
			}
			var base = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/src/";
			try {
				await import(base + name + ".js");
			} catch (e) {
				console.error("[联机助手] 子模块加载失败: " + name, e);
				return;
			}
		}
		if (nnk.modules.host) {
			nnk.modules.host.init();
		}
		if (nnk.modules.guest) {
			nnk.modules.guest.init();
		}
		if (nnk.modules.bridge) {
			nnk.modules.bridge.init();
		}
		console.log("[联机助手] 内核 v" + nnk.version + " 就绪(无头模式)");
	};
})();

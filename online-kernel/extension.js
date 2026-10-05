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
		window.__nnk__ = { version: "0.3.4", modules: {}, env: null, state: {} };
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
		/* mqtt 库(UMD)经 <script> 标签加载进 window.mqtt——房号信令依赖它,
		 * 加载失败只降级房号信令不可用(邀请码模式不受影响),不阻塞内核 */
		await new Promise(function(resolve) {
			var s = document.createElement("script");
			s.src = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/lib/mqtt.min.js";
			s.onload = function() { resolve(); };
			s.onerror = function() { resolve(); };
			document.head.appendChild(s);
		});
		var files = ["config", "rtc", "signaling", "host", "guest", "bridge", "compat", "manifest", "transfer"];
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
		/* 兼容层(开闸+垫片+隔离)与体检/补包的消息表登记——都在内容加载前
		 * 装好:开闸必须在 onload 的 loadExtension 闸门检查之前生效 */
		if (nnk.modules.compat) {
			nnk.modules.compat.install();
		}
		if (nnk.modules.manifest) {
			nnk.modules.manifest.install();
		}
		if (nnk.modules.transfer) {
			nnk.modules.transfer.install();
		}
		console.log("[联机助手] 内核 v" + nnk.version + " 就绪(无头模式" + (window.mqtt ? ",MQTT 信令可用" : ",MQTT 库缺失,房号模式不可用") + ")");
	};
})();

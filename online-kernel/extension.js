/*
 * 联机助手·内核(无头运行时)—— 由 dsh-noname-kit 插件安装/升级到游戏 extension/ 目录。
 *
 * 职责:在游戏进程里提供跨网络联机的"插座"(WebRTC 传输 + 引擎联机接驳),
 * 不提供独立操作界面，选将设置沿用游戏房间菜单；建房/加入/发码收码由 DSH 工坊「🌐 联机」页签
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
		window.__nnk__ = { version: "0.3.99", build: "keepalive-1.10.8", modules: {}, env: null, state: {} };
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
		/* 每完成一个启动步骤就记录启动位置，并随心跳上报，供工坊显示内核启动进度。 */
		nnk.state.bootStage = "env-ready";
		/* Capture the actual Document before installing any engine compatibility hooks. */
		var lease;
		try {
			var bootstrap = require(lib.node.path.join(window.__dirname, "extension", "联机助手", "lib", "keepalive-bootstrap.cjs"));
			lease = bootstrap.capture(nnk, { window: window, document: document });
		} catch (error) {
			nnk.state.bootStage = "native-unavailable";
			nnk.state.bootError = error && error.message ? error.message : String(error);
			console.error("[联机助手] 无法初始化当前窗口，已跳过联机内核初始化：", error);
			return;
		}
		if (!lease.isCurrent()) return;
		var entry = await import(location.origin + "/extension/" + encodeURIComponent("联机助手") + "/keepalive/entry.js");
		if (!lease.isCurrent()) return;
		await entry.prepareEngine(nnk, lease);
		if (!lease.isCurrent()) return;
		/* mqtt 库(UMD)经 <script> 标签加载进 window.mqtt——房号信令依赖它,
		 * 加载失败只降级房号信令不可用(邀请码模式不受影响),不阻塞内核 */
		await new Promise(function(resolve) {
			var s = document.createElement("script");
			s.src = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/lib/mqtt.min.js";
			s.onload = function() { resolve(); };
			s.onerror = function() { resolve(); };
			document.head.appendChild(s);
		});
		if (!lease.isCurrent()) return;
		nnk.state.bootStage = "mqtt-loaded";
		var files = ["config", "rtc", "signaling", "host", "guest", "bridge", "compat", "isolation", "consent", "batch", "manifest", "transfer"];
		for (var i = 0; i < files.length; i++) {
			var name = files[i];
			if (nnk.modules[name]) {
				continue;
			}
			var base = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/src/";
			try {
				await import(base + name + ".js");
				if (!lease.isCurrent()) return;
			} catch (e) {
				console.error("[联机助手] 子模块加载失败: " + name, e);
				nnk.state.bootStage = "load-fail:" + name;
				return;
			}
		}
		nnk.state.bootStage = "modules-loaded";
		/* 各安装步骤独立兜底:一步炸了不能带走其余安装与心跳上报 */
		/* Keepalive owns online entry. Legacy reload/autoRejoin hooks stay absent. */
		nnk.state.bootStage = "inits-done";
		/* 兼容补丁仅用于独立联机对局窗口；普通游戏保留原生扩展、出牌和技能流程。
		 * 联机身份仍独立同步，体检与补传仅登记各自的消息类型。 */
		var compat = nnk.modules.compat;
		var scopedCompat = compat && { install: function() {
			if (lease.info.role === "engine") {
				compat.install();
			} else if (lease.info.role === "ordinary") {
				compat.applyIdentity();
			}
		} };
		var installs = [["compat", scopedCompat], ["manifest", nnk.modules.manifest], ["transfer", nnk.modules.transfer]];
		for (var j = 0; j < installs.length; j++) {
			var mod = installs[j][1];
			if (!mod) {
				continue;
			}
			try {
				mod.install();
				nnk.state.bootStage = installs[j][0] + "-done";
			} catch (err) {
				nnk.state.bootStage = "install-fail:" + installs[j][0];
				console.error("[联机助手] " + installs[j][0] + " 安装失败", err);
				if (nnk.modules.bridge) {
					nnk.modules.bridge.emit("error", { message: "内核模块 " + installs[j][0] + " 安装失败: " + ((err && err.message) || err) });
				}
			}
		}
		if (lease.info.role === "engine") {
			try {
				var pickerModule = await import(location.origin + "/extension/" + encodeURIComponent("联机助手") + "/keepalive/free-character-picker.js");
				if (!lease.isCurrent()) return;
				nnk.modules.freeCharacterPicker = pickerModule.installFreeCharacterPicker(nnk, lease);
				if (!lease.isCurrent()) { nnk.modules.freeCharacterPicker.dispose(); return; }
			} catch (pickerError) {
				try { nnk.modules.freeCharacterPicker?.dispose(); } catch (cleanupError) { console.error("[联机助手] 选将分类清理失败", cleanupError); }
				console.error("[联机助手] 选将分类不可用", pickerError);
			}
		}
		if (lease.info.role === "engine" && lease.info.engineRole === "host") {
			try {
				var choiceBase = location.origin + "/extension/" + encodeURIComponent("联机助手") + "/keepalive/";
				var choiceParts = await Promise.all(["free-character-choice", "free-character-identity", "free-character-guozhan", "free-character-versus", "free-character-single", "free-character-doudizhu"].map(function(name) { return import(choiceBase + name + ".js"); }));
				if (!lease.isCurrent()) return;
				nnk.modules.freeCharacterChoice = choiceParts[0].installFreeCharacterChoice(nnk, lease, [choiceParts[1].identityAdapter, choiceParts[2].guozhanAdapter, choiceParts[3].versusAdapter, choiceParts[4].singleAdapter, choiceParts[5].doudizhuAdapter]);
				if (!lease.isCurrent()) { nnk.modules.freeCharacterChoice.dispose(); return; }
			} catch (choiceError) {
				try { nnk.modules.freeCharacterChoice?.dispose(); } catch (cleanupError) { console.error("[联机助手] 选将设置清理失败", cleanupError); }
				console.error("[联机助手] 自由选将设置不可用", choiceError);
			}
		}
		nnk.state.bootStage = "ready";
		if (!lease.isCurrent()) return;
		await entry.install(nnk, lease);
		if (!lease.isCurrent()) return;
		console.log("[联机助手] 内核 v" + nnk.version + " 就绪(无头模式" + (window.mqtt ? ",MQTT 信令可用" : ",MQTT 库缺失,房号模式不可用") + ")");
	};
})();

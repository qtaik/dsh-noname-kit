/*
 * 包清单体检(M3):双方内核经引擎消息通道交换本机清单,房主算差集,两边
 * 工坊各显示一份差异,补传按钮在房主侧。不新增传输层——复用引擎 ws 消息
 * 分发:客人 game.send → 房主 lib.message.server;房主 game.broadcast →
 * 客人 lib.message.client(内核只需往两张消息表里登记自己的处理器)。
 *
 * 清单粒度=扩展(武将/卡牌包都在扩展目录里,包级差异由扩展级差异覆盖);
 * 本内核自身(联机助手)双方必有,不参与体检与补传。
 */
(function() {
	var nnk = window.__nnk__;

	function bridgeApi() {
		return nnk.modules.bridge;
	}

	function KERNEL_NAME() {
		return "联机助手";
	}

	/* 本机清单:已启用扩展 + 本地全部武将/卡牌包名(包名作参考信息展示) */
	function collect() {
		var lib = nnk.env.lib;
		var exts = [];
		var packs = [];
		var cards = [];
		try {
			(lib.config.extensions || []).forEach(function(name) {
				if (name !== KERNEL_NAME()) {
					exts.push(name);
				}
			});
		} catch (e) { /* 忽略 */ }
		try {
			for (var p in lib.characterPack) {
				packs.push(p);
			}
		} catch (e) { /* 忽略 */ }
		try {
			for (var c in lib.cardPack) {
				cards.push(c);
			}
		} catch (e) { /* 忽略 */ }
		exts.sort();
		return { exts: exts, packs: packs.sort(), cards: cards.sort(), kernel: nnk.version };
	}

	function validManifest(m) {
		return m && typeof m === "object" && Array.isArray(m.exts);
	}

	/* 差集:客人缺的(补传候选)与客人多有的(仅提示) */
	function diff(host, guest) {
		function split(hostList, guestList) {
			var missing = [];
			var extra = [];
			var guestSet = {};
			var hostSet = {};
			guestList.forEach(function(x) { guestSet[x] = true; });
			hostList.forEach(function(x) {
				hostSet[x] = true;
				if (!guestSet[x]) {
					missing.push(x);
				}
			});
			guestList.forEach(function(x) {
				if (!hostSet[x]) {
					extra.push(x);
				}
			});
			return { missing: missing, extra: extra };
		}
		return {
			exts: split(host.exts || [], guest.exts || []),
			packs: split(host.packs || [], guest.packs || []),
			cards: split(host.cards || [], guest.cards || []),
			guestKernel: guest.kernel || null
		};
	}

	/* 房主收到客人清单:算差集 → 上报工坊 → 回发客人一份 */
	function onGuestManifest(manifest) {
		if (!validManifest(manifest)) {
			return;
		}
		var result = diff(collect(), manifest);
		bridgeApi().emit("manifest_diff", result);
		try {
			nnk.env.game.broadcast("nnk_manifest_diff", result);
		} catch (e) { /* 广播失败不影响工坊展示 */ }
		console.log("[联机助手] 包体检完成:客人缺扩展 " + result.exts.missing.length + " 个、缺武将包 " + result.packs.missing.length + " 个");
	}

	nnk.modules.manifest = {
		install: function() {
			var lib = nnk.env.lib;
			if (lib.message && lib.message.server && !lib.message.server.__nnkManifest) {
				/* 客人 → 房主 */
				lib.message.server.nnk_manifest = function(manifest) {
					try {
						onGuestManifest(manifest);
					} catch (e) {
						console.error("[联机助手] 包体检处理失败:", e);
					}
				};
				lib.message.server.__nnkManifest = true;
			}
			if (lib.message && lib.message.client && !lib.message.client.__nnkManifest) {
				/* 房主 → 客人 */
				lib.message.client.nnk_manifest_diff = function(result) {
					try {
						bridgeApi().emit("manifest_diff", result);
					} catch (e) { /* 忽略 */ }
				};
				lib.message.client.__nnkManifest = true;
			}
		},
		/* 客人在进房握手成功后调用:把本机清单发给房主 */
		sendManifest: function() {
			try {
				nnk.env.game.send("nnk_manifest", collect());
			} catch (e) {
				console.warn("[联机助手] 清单上报失败:", e);
			}
		},
		collect: collect
	};
})();

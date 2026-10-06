/*
 * 配置存取:挂在 lib.config 的 nnk_ 前缀键下,随游戏配置持久化。
 */
(function() {
	var nnk = window.__nnk__;

	var DEFAULTS = {
		/* 打洞用的 STUN 服务器(国内可达 + 国外兜底) */
		stunServers: ["stun:stun.miwifi.com:3478", "stun:stun.l.google.com:19302"],
		/* 房号信令(MQTT over WebSocket):默认公共 broker,工坊「📡 信令服务器」
		 * 卡可改(自建/其它公共服务器,双方须一致),空值经 set_config 恢复此默认 */
		mqttUrl: "wss://broker.emqx.io:8084/mqtt",
		/* M4 自动补包的单次传输体积上限(MB) */
		transferLimitMB: 300,
		/* M3 联机开闸的总开关 */
		autoUnlockExtensions: true,
		/* 美化类扩展(不带武将/卡牌包的)是否也参与联机加载:默认关——
		 * 美化族是联机不稳定的大头,默认只开内容扩展保稳定 */
		unlockUIExtensions: false,
		/* 人物标识:工坊「👤 人物标识」保存的联机身份。
		 * onlineName 写进引擎原生键 connect_nickname(游戏内联机昵称),
		 * onlineAvatar 是武将 id,写进 connect_avatar(联机头像)。
		 * 留空 = 不动,游戏内自己的设置照常生效。 */
		onlineName: "",
		onlineAvatar: ""
	};

	nnk.modules.config = {
		defaults: DEFAULTS,
		get: function(key) {
			var v = nnk.env.lib.config["nnk_" + key];
			return v === undefined ? DEFAULTS[key] : v;
		},
		set: function(key, value) {
			nnk.env.game.saveConfig("nnk_" + key, value);
		}
	};
})();

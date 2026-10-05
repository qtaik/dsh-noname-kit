/*
 * 配置存取:挂在 lib.config 的 nnk_ 前缀键下,随游戏配置持久化。
 */
(function() {
	var nnk = window.__nnk__;

	var DEFAULTS = {
		/* 打洞用的 STUN 服务器(国内可达 + 国外兜底) */
		stunServers: ["stun:stun.miwifi.com:3478", "stun:stun.l.google.com:19302"],
		/* M2 起使用的公共信令(MQTT over WebSocket) */
		mqttUrl: "wss://broker.emqx.io:8084/mqtt",
		/* M4 自动补包的单次传输体积上限(MB) */
		transferLimitMB: 300,
		/* M3 联机开闸的总开关 */
		autoUnlockExtensions: true,
		/* 美化类扩展(不带武将/卡牌包的)是否也参与联机加载:默认关——
		 * 美化族是联机不稳定的大头,默认只开内容扩展保稳定 */
		unlockUIExtensions: false,
		/* ui.create 防爆保险丝(代理实现):官方版不要开——官方 1.11.5 引擎
		 * 大量使用类私有字段,代理 this 会炸(选将界面真机实证);该保险丝
		 * 仅供第三方壳(美化扩展会毒化 ui.create 的环境)手动开启 */
		guardUICreate: false
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

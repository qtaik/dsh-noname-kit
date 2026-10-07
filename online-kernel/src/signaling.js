/*
 * 房号信令(M2):公共 MQTT broker 上的加密信令通道。
 *
 * 主题结构(nnk2/room/<房号指纹>/…):房号本身**不进主题**(公共 broker 上
 * 任何人都能通配符订阅;房号明文曾等于把密钥一起送出去——密文+房号即可解密),
 * 主题里用的是 FNV-1a 指纹(定宽、单向)。
 *   host            —— 主机在线心跳(retained,10s 一跳,客人用于判房主是否在线)
 *   offer           —— 客人发布连接提议 {guestId, sdp}(房主订阅)
 *   answer/<guestId>—— 主机按 guestId 定向回应答 {sdp}
 *
 * 载荷一律 AES-GCM 加密,密钥 = SHA-256("nnk-room|<房号>")。
 * ⚠️ 诚实口径:房号只有 6 位(≈31 bit),拿到指纹也解不开,但指纹可枚举——
 * 真正的防线是"房号只在两端私下交换";要更强需上 HMAC 挑战握手(待办)。
 * ICE 候选随 SDP 一次性交换(非 trickle),一条 offer / 一条 answer 完成牵线。
 */
(function() {
	var nnk = window.__nnk__;

	var b64url = function(bytes) {
		var bin = "";
		for (var i = 0; i < bytes.length; i++) {
			bin += String.fromCharCode(bytes[i]);
		}
		return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	};
	var unb64url = function(s) {
		s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
		while (s.length % 4) {
			s += "=";
		}
		var bin = atob(s);
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i);
		}
		return bytes;
	};

	async function deriveKey(code) {
		var raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nnk-room|" + code));
		return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
	}

	async function seal(key, obj) {
		var iv = crypto.getRandomValues(new Uint8Array(12));
		var data = new TextEncoder().encode(JSON.stringify(obj));
		var ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data));
		var bytes = new Uint8Array(iv.length + ct.length);
		bytes.set(iv);
		bytes.set(ct, iv.length);
		return b64url(bytes);
	}

	async function unseal(key, text) {
		var bytes = unb64url(text);
		var iv = bytes.subarray(0, 12);
		var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, bytes.subarray(12));
		return JSON.parse(new TextDecoder().decode(pt));
	}

	function randomId() {
		var bytes = new Uint8Array(6);
		crypto.getRandomValues(bytes);
		var s = "";
		for (var i = 0; i < bytes.length; i++) {
			s += (bytes[i] % 36).toString(36);
		}
		return s;
	}

	/*
	 * 打开一个房号信令会话:连接 broker、订阅 topics、消息先解密再回调。
	 * resolve 出 {publish(topic, obj, retained), end()};publish 自动加密。
	 */
	async function openRoomSession(code, role, topics, onMessage) {
		if (!window.mqtt) {
			throw new Error("MQTT 库未加载(房号信令不可用),请改用邀请码方式");
		}
		var key = await deriveKey(code);
		var cfgUrl = nnk.modules.config.get("mqttUrl") || "wss://broker.emqx.io:8084/mqtt";
		return await new Promise(function(resolve, reject) {
			var settled = false;
			var client;
			try {
				client = window.mqtt.connect(cfgUrl, {
					clientId: "nnk2-" + role + "-" + randomId(),
					keepalive: 30,
					reconnectPeriod: 4000,
					/* 连接超时压到 6 秒:公共 broker 偶发抽风时,房号门的自动重回
					 * 循环是"每 4 秒复查一次"——单次连接失败原要 12 秒才放弃,循环被
					 * 拖成一分钟只走两三次(实测:客户机从"重组房间"到"已进入房间"
					 * 花了约 2 分钟,大头就是这个超时)。健康连接 1~3 秒完成,压短
					 * 只影响"连不上"的场景:更快失败、更快交给循环重试 */
					connectTimeout: 6000,
					clean: true
				});
			} catch (err) {
				reject(err);
				return;
			}
			var session = {
				publish: async function(topic, obj, retained) {
					var payload = await seal(key, obj);
					client.publish(topic, payload, { qos: 0, retain: Boolean(retained) });
				},
				/* 原样发布(不清空 retained 心跳时用空载荷) */
				publishRaw: function(topic, payload, retained) {
					client.publish(topic, payload, { qos: 0, retain: Boolean(retained) });
				},
				end: function() {
					try { client.end(true); } catch (e) { /* 忽略 */ }
				}
			};
			client.on("connect", function() {
				settled = true;
				topics.forEach(function(t) { client.subscribe(t); });
				resolve(session);
			});
			client.on("message", function(topic, payload) {
				/* unseal 是异步的:必须先等解密完成再把明文对象交给回调,
				 * 直接把 Promise 传过去会让调用方判定 msg.guestId/msg.sdp 恒为
				 * undefined,提议/应答被静默丢弃(与 mqttSession 作用域坑同族) */
				unseal(key, String(payload)).then(function(msg) {
					try {
						onMessage(topic, msg);
					} catch (err) {
						console.error("[联机助手] 信令消息处理失败: " + topic, err);
					}
				}).catch(function() {
					/* 解不开的载荷=别的房号/别的用途,静默忽略 */
				});
			});
			client.on("error", function(err) {
				if (!settled) {
					try { client.end(true); } catch (e) { /* 忽略 */ }
					reject(err);
				}
			});
			setTimeout(function() {
				if (!settled) {
					try { client.end(true); } catch (e) { /* 忽略 */ }
					/* 文案说准:超时是"本机连不上信令服务器",与房主是否在重组无关
					 * (旧文案让用户以为房主那边出事了)。留邀请码这条路兜底。 */
					reject(new Error("信令服务器连不上或响应太慢(公共服务器偶发抽风;反复失败可让房主发一张邀请码,从另一道门进)"));
				}
			}, 7000);
		});
	}

	var api = {
		/* deriveKey/seal/unseal 仅服务上方会话逻辑,不对外导出 */
		randomId: randomId,
		/* 房号指纹:FNV-1a → base36(定宽 7 位)。两边算法一致即得到同一主题;
		 * 公共 broker 上不再出现房号明文(订阅者无法据此推导密钥/冒充房间) */
		roomHash: function(code) {
			var h = 0x811c9dc5;
			var str = String(code || "");
			for (var i = 0; i < str.length; i++) {
				h ^= str.charCodeAt(i);
				h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
			}
			var out = h.toString(36);
			while (out.length < 7) {
				out = "0" + out;
			}
			return out;
		},
		roomTopic: function(code, leaf) {
			return "nnk2/room/" + api.roomHash(code) + (leaf ? "/" + leaf : "");
		},
		openRoomSession: openRoomSession
	};

	nnk.modules.signaling = api;
})();

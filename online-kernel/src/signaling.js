/*
 * 房号信令(M2):公共 MQTT broker 上的加密信令通道。
 *
 * 主题结构(nnk2/room/<房号>/…):
 *   host            —— 主机在线心跳(retained,10s 一跳,客人用于判房主是否在线)
 *   offer           —— 客人发布连接提议 {guestId, sdp}(房主订阅)
 *   answer/<guestId>—— 主机按 guestId 定向回应答 {sdp}
 *
 * 载荷一律 AES-GCM 加密,密钥 = SHA-256("nnk-room|<房号>"):
 * 公共频道上任何人都能订阅主题,但拿不到房号就解不开载荷(内含双方 IP 候选)。
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
					connectTimeout: 10000,
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
				try {
					onMessage(topic, unseal(key, String(payload)));
				} catch (err) {
					/* 解不开的载荷=别的房号/别的用途,静默忽略 */
				}
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
					reject(new Error("信令服务器连接超时(可改用邀请码方式)"));
				}
			}, 12000);
		});
	}

	var api = {
		deriveKey: deriveKey,
		seal: seal,
		unseal: unseal,
		randomId: randomId,
		roomTopic: function(code, leaf) {
			return "nnk2/room/" + code + (leaf ? "/" + leaf : "");
		},
		openRoomSession: openRoomSession
	};

	nnk.modules.signaling = api;
})();

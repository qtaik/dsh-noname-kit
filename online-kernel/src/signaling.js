/* 房号信令通过公共 MQTT broker 交换 AES-GCM 加密载荷。主题使用房号的 FNV-1a 指纹，不包含房号明文；密钥为 SHA-256("nnk-room|<房号>")。host 主题发布 retained 心跳，offer 提交客人 SDP，answer/<guestId> 定向回应。ICE 候选随完整 SDP 一次性交换。六位房号及其指纹可被枚举，房号须由双方私下交换。 */
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

	/* 连接 broker 并订阅主题，解密成功后调用消息回调；返回 publish 与 end，publish 自动加密。连接失败标记 nnkSignal，使重试循环区分信令故障与房主不在线。 */
	function signalFailure(err) {
		var e2 = err instanceof Error ? err : new Error(String(err || "信令失败"));
		try { e2.nnkSignal = true; } catch (e3) { /* 极端情况(冻结对象):不强求 */ }
		return e2;
	}
	async function openRoomSession(code, role, topics, onMessage, signal, traceHook) {
		/* Optional operation-owned evidence hook. It cannot alter the protocol,
		 * encryption, client configuration or another session's listeners. */
		function trace(type, detail) {
			if (typeof traceHook !== "function") return;
			try {
				var evidence = JSON.parse(JSON.stringify(Object.assign({ at: Date.now(), type: type, role: role }, detail || {})));
				var returned = traceHook(evidence);
				if (returned && typeof returned.then === "function") Promise.resolve(returned).catch(function(error) {
					console.error("[联机助手] 信令记录回调失败:", type, error);
				});
			}
			catch (error) { console.error("[联机助手] 信令记录回调失败:", type, error); }
		}
		function cancelled() { var error = new Error("信令会话已取消"); error.name = "AbortError"; return error; }
		if (signal && signal.aborted) throw cancelled();
		if (!window.mqtt) {
			throw signalFailure(new Error("MQTT 库未加载(房号信令不可用),请改用邀请码方式"));
		}
		var key = await deriveKey(code);
		if (signal && signal.aborted) throw cancelled();
		var cfgUrl = nnk.modules.config.get("mqttUrl") || "wss://broker.emqx.io:8084/mqtt";
		trace("key-derived", { roomHash: api.roomHash(code), algorithm: "AES-GCM", keyDerivation: "SHA-256(nnk-room|code)", mqttUrl: cfgUrl });
		return await new Promise(function(resolve, reject) {
			var settled = false;
			var closed = false;
			var timer;
			var client;
			try {
				client = window.mqtt.connect(cfgUrl, {
					clientId: "nnk2-" + role + "-" + randomId(),
					keepalive: 30,
					reconnectPeriod: 4000,
					/* 单次 broker 连接超时为 6 秒，失败后交由每 4 秒检查的自动重试循环继续处理。 */
					connectTimeout: 6000,
					clean: true
				});
			} catch (err) {
				reject(signalFailure(err));
				return;
			}
			var session = {
				publish: async function(topic, obj, retained) {
					if (closed) throw cancelled();
					var payload = await seal(key, obj);
					if (closed) throw cancelled();
					trace("publish-encrypted", { topic: topic, plaintext: obj, ciphertext: payload, retained: Boolean(retained) });
					client.publish(topic, payload, { qos: 0, retain: Boolean(retained) });
					trace("publish-submitted", { topic: topic, ciphertext: payload, retained: Boolean(retained), qos: 0, brokerAcknowledged: false });
				},
				/* 原样发布(不清空 retained 心跳时用空载荷) */
				publishRaw: function(topic, payload, retained) {
					if (closed) return;
					client.publish(topic, payload, { qos: 0, retain: Boolean(retained) });
					trace("publish-raw-submitted", { topic: topic, payload: payload, retained: Boolean(retained), qos: 0, brokerAcknowledged: false });
				},
				end: function() {
					if (closed) return;
					closed = true;
					clearTimeout(timer);
					if (signal) signal.removeEventListener("abort", session.end);
					client.removeListener("connect", connected);
					client.removeListener("message", message);
					client.removeListener("error", failed);
					trace("session-close-requested", { settled: settled, ownListenersRemoved: ["connect", "message", "error"], closeMethod: "client.end(true)", brokerFlushAcknowledged: false });
					try { client.end(true); } catch (e) { /* 忽略 */ }
					if (!settled) { settled = true; reject(cancelled()); }
				}
			};
			function connected() {
				if (closed || settled) return;
				settled = true;
				clearTimeout(timer);
				trace("mqtt-connected", { mqttUrl: cfgUrl, topics: topics.slice() });
				topics.forEach(function(t) { client.subscribe(t); });
				resolve(session);
			}
			function message(topic, payload) {
				if (closed) return;
				var originalCiphertext = String(payload);
				trace("ciphertext-received", { topic: topic, ciphertext: originalCiphertext });
				/* 等待异步 unseal 完成，再将解密对象交给回调，保证调用方能读取 guestId 与 sdp。 */
				unseal(key, originalCiphertext).then(function(msg) {
					if (closed) { trace("decryption-result-after-closed", { topic: topic }); return; }
					trace("decrypted-received", { topic: topic, ciphertext: originalCiphertext, plaintext: msg });
					try {
						onMessage(topic, msg);
					} catch (err) {
						console.error("[联机助手] 信令消息处理失败: " + topic, err);
					}
				}).catch(function(error) {
					trace("decrypt-rejected", { topic: topic, ciphertext: originalCiphertext, error: String(error) });
					/* 解不开的载荷=别的房号/别的用途,静默忽略 */
				});
			}
			function failed(err) {
				trace("mqtt-error", { error: String(err), settled: settled, closed: closed });
				if (!settled) {
					settled = true;
					session.end();
					reject(signalFailure(new Error("信令服务器连不上: " + ((err && err.message) || err))));
				}
			}
			client.on("connect", connected);
			client.on("message", message);
			client.on("error", failed);
			if (signal) signal.addEventListener("abort", session.end, { once: true });
			if (signal && signal.aborted) { session.end(); return; }
			timer = setTimeout(function() {
				if (!settled) {
					settled = true;
					session.end();
					/* 这里等待的是本机信令连接。超时可提示用户改用邀请码。 */
					reject(signalFailure(new Error("信令服务器连不上或响应太慢(公共服务器偶发抽风;反复失败可让房主发一张邀请码,从另一道门进)")));
				}
			}, 7000);
		});
	}

	var api = {
		/* deriveKey/seal/unseal 仅服务上方会话逻辑,不对外导出 */
		randomId: randomId,
		/* 房号经 FNV-1a 生成定宽 7 位 base36 主题前缀。 */
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

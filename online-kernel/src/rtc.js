/*
 * RTC 传输层:
 *  - 客人侧 FakeWebSocket(onopen/onmessage 属性风格,对齐 lib.element.ws 的用法)
 *  - 主机侧 HostBridge(.on("message"/"close") 风格,对齐 NodeWS —— lib.init.connection 的入参契约)
 *  - 邀请码编解码(非 trickle:候选收齐后一次交换完整 SDP)
 */
(function() {
	var nnk = window.__nnk__;

	/* ---- unicode 安全的 base64url ---- */
	function bytesToB64(bytes) {
		var bin = "";
		for (var i = 0; i < bytes.length; i++) {
			bin += String.fromCharCode(bytes[i]);
		}
		return btoa(bin);
	}
	function b64ToBytes(b64) {
		var bin = atob(b64);
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i);
		}
		return bytes;
	}
	function encodeB64Url(str) {
		return bytesToB64(new TextEncoder().encode(str))
			.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}
	function decodeB64Url(s) {
		s = s.replace(/-/g, "+").replace(/_/g, "/");
		while (s.length % 4) {
			s += "=";
		}
		return new TextDecoder().decode(b64ToBytes(s));
	}

	/* ---- 邀请码:NNK1.<base64url(json)> ---- */
	function encodeCode(kind, desc) {
		return "NNK1." + encodeB64Url(JSON.stringify({
			v: 1,
			k: kind,
			sdp: { type: desc.type, sdp: desc.sdp }
		}));
	}
	function decodeCode(str) {
		var clean = String(str || "").replace(/\s+/g, "");
		var m = /^NNK1\.([A-Za-z0-9\-_]+)$/.exec(clean);
		if (!m) {
			throw new Error("不是有效的联机助手码");
		}
		var data = JSON.parse(decodeB64Url(m[1]));
		if (!data || data.v !== 1 || !data.sdp || !data.sdp.sdp) {
			throw new Error("码内容无法识别");
		}
		return data;
	}

	function pcConfig() {
		var stun = nnk.modules.config.get("stunServers") || [];
		return { iceServers: stun.map(function(u) { return { urls: u }; }) };
	}

	/* 非 trickle:等候选收齐(超时兜底,用已收集的候选直接走) */
	function waitGather(pc) {
		return new Promise(function(resolve) {
			if (pc.iceGatheringState === "complete") {
				return resolve();
			}
			var done = false;
			var finish = function() {
				if (!done) {
					done = true;
					resolve();
				}
			};
			pc.addEventListener("icegatheringstatechange", function() {
				if (pc.iceGatheringState === "complete") {
					finish();
				}
			});
			setTimeout(finish, 4000);
		});
	}

	/*
	 * 客人侧假 WebSocket。引擎在 game.connect 里直接给它挂
	 * onopen/onmessage/onerror/onclose,所以消息通道必须支持
	 * "接线前先缓冲、接线后回放"——否则主机握手首条 ["opened"]
	 * 会在引擎接管前到达而丢失。
	 */
	function FakeWebSocket(channel) {
		var self = this;
		this.channel = channel;
		this.onopen = null;
		this.onmessage = null;
		this.onerror = null;
		this.onclose = null;
		this._buffer = [];
		this._upHooks = [];
		this._downHooks = [];
		this._open = false;
		channel.onopen = function() {
			self._open = true;
			self._upHooks.forEach(function(f) { f(); });
			if (self.onopen) {
				self.onopen();
			}
		};
		channel.onmessage = function(e) {
			if (self.onmessage) {
				self.onmessage({ data: e.data });
			} else {
				self._buffer.push(e.data);
			}
		};
		channel.onerror = function(e) {
			if (self.onerror) {
				self.onerror(e);
			}
		};
		channel.onclose = function() {
			self._open = false;
			self._downHooks.forEach(function(f) { f(); });
			if (self.onclose) {
				self.onclose();
			}
		};
	}
	FakeWebSocket.prototype.onUp = function(fn) { this._upHooks.push(fn); };
	FakeWebSocket.prototype.onDown = function(fn) { this._downHooks.push(fn); };
	FakeWebSocket.prototype.isOpen = function() { return this._open; };
	FakeWebSocket.prototype.replay = function() {
		var self = this;
		var buf = this._buffer;
		this._buffer = [];
		buf.forEach(function(d) {
			if (self.onmessage) {
				self.onmessage({ data: d });
			} else {
				self._buffer.push(d);
			}
		});
	};
	FakeWebSocket.prototype.send = function(data) {
		if (this.channel.readyState === "open") {
			this.channel.send(data);
		}
	};
	FakeWebSocket.prototype.close = function() {
		try { this.channel.close(); } catch (e) { /* 已关 */ }
	};

	/*
	 * 主机侧桥:lib.init.connection(ws) 要求 ws 具备
	 * send/close/on(type,func),与引擎自带 NodeWS 同款接口。
	 * onDown 额外提供"连接断开"钩子:引擎会通过 on("close") 覆盖 onclose,
	 * 所以扩展自己的清理逻辑必须走钩子列表,不能占用 onclose 槽位。
	 */
	function HostBridge(channel) {
		var self = this;
		this.channel = channel;
		this._downHooks = [];
		channel.onmessage = function(e) {
			if (self.onmessage) {
				self.onmessage(e.data);
			}
		};
		channel.onclose = function() {
			self._downHooks.forEach(function(f) { f(); });
			if (self.onclose) {
				self.onclose();
			}
		};
		channel.onerror = function() { /* 引擎侧无对应处理,忽略 */ };
	}
	HostBridge.prototype.send = function(data) {
		if (this.channel.readyState === "open") {
			this.channel.send(data);
		}
	};
	HostBridge.prototype.close = function() {
		try { this.channel.close(); } catch (e) { /* 已关 */ }
	};
	HostBridge.prototype.on = function(type, func) {
		this["on" + type] = func;
	};
	HostBridge.prototype.onDown = function(fn) {
		this._downHooks.push(fn);
	};

	nnk.modules.rtc = {
		/* encodeB64Url/decodeB64Url 仅服务上方编解码,不对外导出 */
		encodeCode: encodeCode,
		decodeCode: decodeCode,
		pcConfig: pcConfig,
		waitGather: waitGather,
		FakeWebSocket: FakeWebSocket,
		HostBridge: HostBridge
	};
})();

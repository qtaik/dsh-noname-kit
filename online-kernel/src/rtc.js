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
	function encodeCode(kind, desc, hosts) {
		return "NNK1." + encodeB64Url(JSON.stringify({
			v: 1,
			k: kind,
			sdp: { type: desc.type, sdp: desc.sdp },
			/* 虚拟网卡直连地址随码走(空则不带:旧版收码方看到多余字段也无害) */
			hosts: hosts && hosts.length ? hosts : undefined
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

	/* 专用心跳("nnk-ping" 通道,与游戏数据线完全分开、不经过引擎):
	 * 每 2.5 秒发一拍,收到任意来包算活;约 8 秒(3 拍)没有来包就判死并回调
	 * onDead——秒级判死,不用干等 ICE consent 超时(~25 秒)才发现断线;
	 * 持续的微量流量还能防止空闲 P2P 链路被 NAT/UDP 映射超时悄悄回收。
	 * 返回 { stop() }:主动关闭通道前先 stop(),避免把自己的关闭当成对端掉线。 */
	function startPing(channel, onDead) {
		var stopped = false;
		var lastSeen = Date.now();
		var timer = null;
		function stop(dead) {
			if (stopped) {
				return;
			}
			stopped = true;
			if (timer) {
				clearInterval(timer);
			}
			if (dead && onDead) {
				try { onDead(); } catch (e) { /* 回调自行处理 */ }
			}
		}
		timer = setInterval(function() {
			if (stopped) {
				return;
			}
			if (channel.readyState === "closed") {
				stop(true);   /* 通道被关/协商失败=死 */
				return;
			}
			if (channel.readyState !== "open") {
				return;   /* 还没打开,下一拍再看 */
			}
			if (Date.now() - lastSeen > 8000) {
				stop(true);   /* 3 拍没来包=静默 */
				return;
			}
			try { channel.send("p"); } catch (e2) { /* 下一拍再判 */ }
		}, 2500);
		channel.onmessage = function() { lastSeen = Date.now(); };
		channel.onclose = function() { stop(true); };
		return { stop: function() { stop(false); } };
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
		/* 通道实例的唯一代号:label 两端都叫 "nnk-link"(RTCDataChannel 协议名),
		 * 做定向发送/回执归属必须用实例级 id */
		this.bridgeId = "b" + (++HOST_BRIDGE_SEQ);
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
	var HOST_BRIDGE_SEQ = 0;
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

	/* ---- 虚拟网卡直连(Radmin/ZeroTier/Hamachi/Tailscale 等异地组网工具)----
	 * 浏览器把局域网候选地址打码成 <uuid>.local,对方解析它要靠组播 mDNS——
	 * 虚拟局域网转发组播并不可靠,直连可能永远建不起来。这里把虚拟网卡的真实
	 * IP + 本机 ICE 端口作为额外直连地址随信令带给对方,对方直接朝它发检查,
	 * 不依赖组播。没有虚拟网卡时处处为空,行为与从前完全一致(零影响)。 */
	var VIRTUAL_NIC_RE = /radmin|zerotier|hamachi|tailscale|vpn|虚拟|tap|tun|wireguard/i;
	/* 纯函数(也供单测):从 networkInterfaces() 的形态里挑虚拟网卡 IPv4。
	 * 判定=网卡名像虚拟网卡,或地址落在 Radmin(26.x)/Hamachi(25.x)固定网段 */
	function virtualIpsFrom(ifaces, extra) {
		var out = [];
		var seen = {};
		function push(ip) {
			if (ip && ip !== "127.0.0.1" && !seen[ip]) {
				seen[ip] = true;
				out.push(ip);
			}
		}
		for (var name in (ifaces || {})) {
			var list = ifaces[name] || [];
			var isVirtual = VIRTUAL_NIC_RE.test(name);
			for (var i = 0; i < list.length; i++) {
				var a = list[i];
				if (!a || a.internal || a.family !== "IPv4") {
					continue;
				}
				if (isVirtual || /^(25|26)\./.test(a.address)) {
					push(a.address);
				}
			}
		}
		(extra || []).forEach(push);
		return out;
	}
	function virtualIps() {
		var ifaces = null;
		try {
			if (typeof require === "function") {
				ifaces = require("os").networkInterfaces();
			}
		} catch (e) { /* 无 node 环境:只认手动列表 */ }
		var extra = [];
		try {
			extra = nnk.modules.config.get("virtualIps") || [];
		} catch (e2) { /* 配置不可用 */ }
		return virtualIpsFrom(ifaces, extra);
	}
	/* 纯函数(也供单测):本地 SDP 里 host 候选的端口——地址被 mDNS 打码,
	 * 但端口是真的;虚拟 IP 配上这个端口就是一条可用的直连候选 */
	function hostPortFromSdp(sdp) {
		var m = /candidate:\S+ \d+ udp \d+ \S+ (\d+) typ host/.exec(String(sdp || ""));
		return m ? m[1] : null;
	}
	/* 发出用:["虚拟IP:端口", …](无虚拟网卡=空数组,载荷照旧) */
	function directHosts(pc) {
		try {
			var port = hostPortFromSdp(pc.localDescription && pc.localDescription.sdp);
			if (!port) {
				return [];
			}
			return virtualIps().map(function(ip) { return ip + ":" + port; });
		} catch (e) {
			return [];
		}
	}
	/* 接收用:把对方给的直连地址加进 ICE(必须在 setRemoteDescription 之后)。
	 * 返回成功加进去的条数;坏地址/被拒单条均不影响主流程 */
	function addInjected(pc, hosts) {
		var n = 0;
		(hosts || []).forEach(function(h) {
			var sp = String(h).split(":");
			if (sp.length !== 2 || !/^[0-9A-Fa-f.]+$/.test(sp[0]) || !/^\d+$/.test(sp[1])) {
				return;
			}
			try {
				var p = pc.addIceCandidate({
					candidate: "candidate:1 1 udp 2122260223 " + sp[0] + " " + sp[1] + " typ host",
					sdpMid: "0",
					sdpMLineIndex: 0
				});
				if (p && p.catch) {
					p.catch(function() { /* 单条被拒不影响其他候选 */ });
				}
				n++;
			} catch (e) { /* 忽略单条失败 */ }
		});
		return n;
	}

	nnk.modules.rtc = {
		/* encodeB64Url/decodeB64Url 仅服务上方编解码,不对外导出 */
		encodeCode: encodeCode,
		decodeCode: decodeCode,
		pcConfig: pcConfig,
		waitGather: waitGather,
		startPing: startPing,
		FakeWebSocket: FakeWebSocket,
		HostBridge: HostBridge,
		/* 虚拟网卡直连:directHosts/addInjected 供两道门收发,纯函数供单测 */
		directHosts: directHosts,
		addInjected: addInjected,
		virtualIpsFrom: virtualIpsFrom,
		hostPortFromSdp: hostPortFromSdp
	};
})();

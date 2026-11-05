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
	/* 移除粘贴内容中的空白，再提取第一段 NNK1.<base64url> 邀请码，允许聊天附文、引号及换行。 */
	function decodeCode(str) {
		var clean = String(str || "").replace(/\s+/g, "");
		var all = clean.match(/NNK1\./g);
		if (all && all.length > 1) {
			/* 粘了多个码(常见:聊天记录里旧码与新码一起复制)。静默取第一个可能是
			 * **过期的那张**,用户只会看到"连不上"——宁可让他删掉多余的再粘 */
			throw new Error("粘贴内容里有 " + all.length + " 个码——请只保留要用的那一个(删掉多余的再粘)");
		}
		var m = /NNK1\.([A-Za-z0-9\-_]+)/.exec(clean);
		if (!m) {
			/* 常见手滑分个类,给具体出路,而不是一句"不是有效的码" */
			if (/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) {
				throw new Error("这看起来是 6 位房号——请用「🚪 加入房间」入口;邀请码是 NNK1. 开头的一长串");
			}
			if (clean.indexOf("NNK1") >= 0) {
				throw new Error("码里的 NNK1 段不完整(可能被聊天软件截断)——请让对方重新整段复制一次");
			}
			throw new Error("不是有效的联机助手码(码以 NNK1. 开头;确认复制的是对方的「邀请码」或「回执码」)");
		}
		var data;
		try {
			data = JSON.parse(decodeB64Url(m[1]));
		} catch (e) {
			throw new Error("码内容无法识别(可能被聊天软件截断或改动)——请让对方重新整段复制一次");
		}
		if (!data || data.v !== 1 || !data.sdp || !data.sdp.sdp) {
			throw new Error("码内容无法识别(可能被聊天软件截断或改动)——请让对方重新整段复制一次");
		}
		return data;
	}

	function pcConfig() {
		var stun = nnk.modules.config.get("stunServers") || [];
		return { iceServers: stun.map(function(u) { return { urls: u }; }) };
	}

	/* 专用 nnk-ping 通道每 2.5 秒发送心跳；结合心跳来包、发送缓冲推进和主通道来包判断活跃度。网络连接状态用于区分主线程繁忙与真实断连；主动关闭前先 stop。 */
	function startPing(channel, onDead, peerTraffic, pcState) {
		var stopped = false;
		var lastSeen = Date.now();
		var lastBuffered = null;
		var timer = null;
		var disconnectedSince = 0;
		function stop(dead) {
			if (stopped) {
				return;
			}
			stopped = true;
			channel.onmessage = channel.onclose = null;
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
			try {
				var buf = channel.bufferedAmount || 0;
				if (lastBuffered !== null && buf < lastBuffered) {
					lastSeen = Date.now();
				}
				lastBuffered = buf;
			} catch (eB) { /* 读不到就算了 */ }
			var trafficAt = 0;
			var st = null;
			if (pcState) {
				try { st = pcState() || null; } catch (eS) { st = null; }
			}
			if (st !== "disconnected") {
				disconnectedSince = 0;
			} else if (!disconnectedSince) {
				disconnectedSince = Date.now();
			}
			if (peerTraffic) {
				try { trafficAt = peerTraffic() || 0; } catch (eT) { trafficAt = 0; }
			}
			/* JS 流量静默时继续检查 Chromium 维护的 connectionState；SCTP ACK 与 STUN 不依赖对端渲染线程，避免将选将或高延迟期间的忙碌判断为断线。 */
			if (Date.now() - Math.max(lastSeen, trafficAt) > 20000) {
				if (st === "connected" || st === "new" || st === "connecting") {
					lastSeen = Date.now();   /* 传输层说链路活着:重置计时继续等(对端只是忙) */
					disconnectedSince = 0;
				} else if (st === "disconnected") {
					/* ICE 抖动会自愈,先给一段恢复期;持续断开才当死 */
					if (Date.now() - disconnectedSince > 20000) {
						stop(true);
						return;
					}
				} else {
					/* failed/closed/取不到状态(pcState 缺省):维持旧行为,宁可真判死 */
					stop(true);
					return;
				}
			}
			try { channel.send("p"); } catch (e2) { /* 下一拍再判 */ }
		}, 2500);
		channel.onmessage = function() { lastSeen = Date.now(); };
		channel.onclose = function() { stop(true); };
		return { stop: function() { stop(false); } };
	}

	/* 非 trickle:等候选收齐(超时兜底,用已收集的候选直接走) */
	function waitGather(pc, signal) {
		return new Promise(function(resolve, reject) {
			if (signal && signal.aborted) { var error = new Error("连接尝试已取消"); error.name = "AbortError"; reject(error); return; }
			if (pc.iceGatheringState === "complete") {
				return resolve();
			}
			var done = false;
			var timer;
			var finish = function() {
				if (!done) {
					done = true;
					clearTimeout(timer);
					pc.removeEventListener("icegatheringstatechange", changed);
					if (signal) signal.removeEventListener("abort", abort);
					resolve();
				}
			};
			var changed = function() {
				if (pc.iceGatheringState === "complete") {
					finish();
				}
			};
			var abort = function() {
				if (done) return;
				done = true;
				clearTimeout(timer);
				pc.removeEventListener("icegatheringstatechange", changed);
				if (signal) signal.removeEventListener("abort", abort);
				var error = new Error("连接尝试已取消"); error.name = "AbortError"; reject(error);
			};
			if (signal && signal.aborted) { abort(); return; }
			pc.addEventListener("icegatheringstatechange", changed);
			if (signal) signal.addEventListener("abort", abort, { once: true });
			/* 非 trickle 模式最多等待 8 秒收集候选，再一次性交换 SDP；候选提前集齐时立即继续。 */
			timer = setTimeout(finish, 8000);
		});
	}

	/*
	 * 客人侧假 WebSocket。引擎在 game.connect 里直接给它挂
	 * onopen/onmessage/onerror/onclose,所以消息通道必须支持
	 * "接线前先缓冲、接线后回放"——否则主机握手首条 ["opened"]
	 * 会在引擎接管前到达而丢失。
	 */
	function FakeWebSocket(channel,options) {
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
		this._lastIn = 0;   /* 主通道最近来包时刻:心跳判死的兜底证据(见 startPing) */
		channel.onopen = function() {
			if (self._disposed) return;
			self._open = true;
			self._upHooks.forEach(function(f) { f(); });
			if (self.onopen) {
				self.onopen();
			}
		};
		channel.onmessage = function(e) {
			if (self._disposed) return;
			self._lastIn = Date.now();
			if (nnk.modules.consent && nnk.modules.consent.handle(self, e.data)) return;
			if (nnk.modules.batch && nnk.modules.batch.handle(self, e.data)) return;
            if (nnk.modules.manifest && nnk.modules.manifest.handle(self, e.data)) return;
			if (self.onmessage) {
				self.onmessage({ data: e.data });
			} else {
				self._buffer.push(e.data);
			}
		};
		channel.onerror = function(e) {
			if (self._disposed) return;
			if (self.onerror) {
				self.onerror(e);
			}
		};
		channel.onclose = function() {
			if (self._closed || self._disposed) return;
			self._closed = true;
			var onclose = self.onclose;
			self._open = false;
			self._downHooks.slice().forEach(function(f) { try { f(); } catch (error) { console.error("[联机助手] 客人关闭监听失败", error); } });
			if (onclose) {
				onclose.call(self);
			}
		};
		this._ownedChannelCallbacks = { onopen: channel.onopen, onmessage: channel.onmessage, onerror: channel.onerror, onclose: channel.onclose };
		if (nnk.modules.consent) nnk.modules.consent.attach(self, "guest");
        if (nnk.modules.manifest) nnk.modules.manifest.attach(self, "guest", options);
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
		if (this._disposed || this._closed) return;
		if (this.channel.readyState === "open") {
			this.channel.send(data);
		}
	};
	FakeWebSocket.prototype.close = function() {
		if (nnk.modules.manifest) nnk.modules.manifest.detach(this);
		try { this.channel.close(); } catch (e) { /* 已关 */ }
	};
	/* 释放尝试资源;正常引擎 close 回调由当前 owner 明确交付。 */
	FakeWebSocket.prototype.dispose = function() {
		if (this._disposed) return;
		this._disposed = true;
		this._closed = true;
		if (nnk.modules.manifest) nnk.modules.manifest.detach(this);
		if (nnk.modules.consent) nnk.modules.consent.detach(this);
		this._open = false;
		this._buffer = []; this._upHooks = []; this._downHooks = [];
		this.onopen = this.onmessage = this.onerror = this.onclose = null;
		releaseFacadeCallbacks(this);
		this.close();
	};
	function releaseFacadeCallbacks(socket) {
		var owned = socket._ownedChannelCallbacks || {};
		Object.keys(owned).forEach(function(name) { if (socket.channel[name] === owned[name]) socket.channel[name] = null; });
		socket._ownedChannelCallbacks = null;
	}

	/*
	 * 主机侧桥:lib.init.connection(ws) 要求 ws 具备
	 * send/close/on(type,func),与引擎自带 NodeWS 同款接口。
	 * onDown 额外提供"连接断开"钩子:引擎会通过 on("close") 覆盖 onclose,
	 * 所以扩展自己的清理逻辑必须走钩子列表,不能占用 onclose 槽位。
	 */
	function HostBridge(channel,options) {
		var self = this;
		this.channel = channel;
		/* 通道实例的唯一代号:label 两端都叫 "nnk-link"(RTCDataChannel 协议名),
		 * 做定向发送/回执归属必须用实例级 id */
		this.bridgeId = "b" + (++HOST_BRIDGE_SEQ);
		this._downHooks = [];
		channel.onmessage = function(e) {
			if (self._closed) return;
			if (nnk.modules.consent && nnk.modules.consent.handle(self, e.data)) return;
			if (nnk.modules.batch && nnk.modules.batch.handle(self, e.data)) return;
            if (nnk.modules.manifest && nnk.modules.manifest.handle(self, e.data)) return;
			if (self.onmessage) {
				self.onmessage(e.data);
			}
		};
		channel.onclose = function() {
			if (self._closed) return;
			self._closed = true;
			var engineClose = self.onclose;
			self._downHooks.slice().forEach(function(f) { try { f(); } catch (e) { /* 继续原生收尾 */ } });
			if (engineClose) engineClose.call(self);
		};
		channel.onerror = function() { /* 引擎侧无对应处理,忽略 */ };
		this._ownedChannelCallbacks = { onmessage: channel.onmessage, onerror: channel.onerror, onclose: channel.onclose };
		if (nnk.modules.consent) nnk.modules.consent.attach(self, "host");
        if (nnk.modules.manifest) nnk.modules.manifest.attach(self, "host", options);
	}
	var HOST_BRIDGE_SEQ = 0;
	HostBridge.prototype.send = function(data) {
		if (this._disposed || this._closed) return;
		if (this.channel.readyState === "open") {
			this.channel.send(data);
		}
	};
	HostBridge.prototype.close = function() {
		if (nnk.modules.manifest) nnk.modules.manifest.detach(this);
		try { this.channel.close(); } catch (e) { /* 已关 */ }
	};
	/* Retire a per-document facade without closing its channel or transport.
	 * A normal legacy close still uses close() above; endpoint retirement owns
	 * only these NNK registrations and callback properties. */
	HostBridge.prototype.dispose = function() {
		if (this._disposed) return;
		this._disposed = true;
		this._closed = true;
		if (nnk.modules.manifest) nnk.modules.manifest.detach(this);
		if (nnk.modules.consent) nnk.modules.consent.detach(this);
		this._downHooks = [];
		this.onopen = this.onmessage = this.onerror = this.onclose = null;
		releaseFacadeCallbacks(this);
	};
	HostBridge.prototype.on = function(type, func) {
		this["on" + type] = func;
	};
	HostBridge.prototype.onDown = function(fn) {
		this._downHooks.push(fn);
	};

	/* 虚拟网卡直连：将真实虚拟网卡 IP 与本机 ICE 端口作为附加候选随信令发送，避免依赖跨网段 mDNS 组播；没有虚拟网卡时不添加候选。 */
	var VIRTUAL_NIC_RE = /radmin|zerotier|hamachi|tailscale|vpn|虚拟|tap|tun|wireguard/i;
	/* 公网 IPv6(2000::/3)也注入:校园网/教育网普遍给每台机器公网 v6,两端都有时
	 * **不需要打洞**(没有 NAT)就能直连——而浏览器自己的 v6 候选被打码成 .local,
	 * 对面解析不了,这条路白扔。v6 用 [地址]:端口 的形态(解析无歧义)。
	 * 只认全局单播;链路本地(fe80::)没 zone 连不上、其它特殊段一律跳过 */
	function isGlobalV6(addr) {
		var ip = String(addr || "").split("%")[0].toLowerCase();
		if (ip.indexOf(":") < 0) {
			return false;
		}
		return /^2[0-9a-f]{0,3}:/.test(ip) || /^3[0-9a-f]{0,3}:/.test(ip);
	}
	/* 纯函数(也供单测):从 networkInterfaces() 的形态里挑「值得随信令带给对方的
	 * 直连地址」= 虚拟网卡 IPv4(Radmin/Hamachi 段)+ 任何网卡上的公网 IPv6 */
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
				if (!a || a.internal) {
					continue;
				}
				var isV4 = a.family === "IPv4" || a.family === 4;
				var isV6 = a.family === "IPv6" || a.family === 6;
				if (isV4) {
					if (isVirtual || /^(25|26)\./.test(a.address)) {
						push(a.address);
					}
				} else if (isV6 && isGlobalV6(a.address)) {
					push("[" + String(a.address).split("%")[0] + "]");
				}
			}
		}
		(extra || []).forEach(push);
		return out;
	}
	var virtualIpsCache = { at: 0, list: null };
	function virtualIps() {
		/* 5 秒缓存:桥心跳 0.7 秒一拍,别每拍都枚举网卡;接/断 Radmin 后
		 * 地址变化最多 5 秒内被发现 */
		if (virtualIpsCache.list && Date.now() - virtualIpsCache.at < 5000) {
			return virtualIpsCache.list;
		}
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
		var out = virtualIpsFrom(ifaces, extra);
		virtualIpsCache = { at: Date.now(), list: out };
		return out;
	}
	/* 纯函数(也供单测):本地 SDP 里**所有** host 候选的端口(去重)。
	 * Chromium 给每张网卡各绑一个 ICE socket(端口互不相同),而地址全被
	 * mDNS 打码成 .local——配虚拟 IP 必须把每个端口都试一遍:只取第一个
	 * 会打到别的网卡的 socket 上被丢弃(双网卡机器=以太网在前,必失效) */
	function hostPortsFromSdp(sdp) {
		var re = /candidate:\S+ \d+ udp \d+ \S+ (\d+) typ host/g;
		var out = [];
		var m;
		while ((m = re.exec(String(sdp || "")))) {
			if (out.indexOf(m[1]) < 0) {
				out.push(m[1]);
			}
		}
		return out;
	}
	/* 发出用:["虚拟IP:端口", …] 全交叉(无虚拟网卡=空数组,载荷照旧)。
	 * 上限 8:网卡/虚拟 IP 再多也不至于把信令撑爆,多余组合本来也没意义 */
	function directHosts(pc) {
		try {
			var ports = hostPortsFromSdp(pc.localDescription && pc.localDescription.sdp);
			var ips = virtualIps();
			var out = [];
			/* 端口在外层、地址在内层交错:多地址(虚拟网卡 v4 + 公网 v6)时每个地址
			 * 都先轮到一次,不会被"第一个地址吃满额度"挤掉;总量上限 12 条 */
			ports.forEach(function(port) {
				ips.forEach(function(ip) {
					out.push(ip + ":" + port);
				});
			});
			return out.slice(0, 12);
		} catch (e) {
			return [];
		}
	}
	/* 接收用:把对方给的直连地址加进 ICE(必须在 setRemoteDescription 之后)。
	 * 返回成功加进去的条数;坏地址/被拒单条均不影响主流程;上限 8 条防载荷刷爆 */
	function addInjected(pc, hosts) {
		var n = 0;
		(hosts || []).slice(0, 12).forEach(function(h) {
			/* 两种形态:IPv4「1.2.3.4:5678」与 IPv6「[2001:db8::1]:5678」 */
			var str = String(h);
			var ip = "";
			var port = "";
			var m6 = /^\[([0-9A-Fa-f:]+)\]:(\d+)$/.exec(str);
			if (m6) {
				/* 只接收 2xxx/3xxx 开头的公网 IPv6；与发送侧一样跳过回环、链路本地和 ULA 地址。 */
				if (/^[23][0-9a-fA-F]{0,3}:/.test(m6[1])) {
					ip = "[" + m6[1] + "]";
					port = m6[2];
				}
			} else {
				var sp = str.split(":");
				if (sp.length === 2 && /^[0-9A-Fa-f.]+$/.test(sp[0]) && /^\d+$/.test(sp[1])) {
					ip = sp[0];
					port = sp[1];
				}
			}
			if (!ip || !port || Number(port) < 1 || Number(port) > 65535) {
				return;
			}
			try {
				/* 优先级给最低(1):候选类型是 host(type 偏好 126),只要给正常数值就
				 * **天然压过**对端真实的 srflx 公网候选(type 100)——于是同网/公网直连
				 * 明明更快,ICE 却优先去连虚拟网卡那条(可能正是 Radmin 的海外中继)。
				 * 置 1 = 排在所有候选之后:同网走局域网、能打洞走公网直连,
				 * 都打不通才落到虚拟网卡兜底(它存在的意义本来就是兜底) */
				var p = pc.addIceCandidate({
					/* SDP candidate 行里的 IPv6 不带方括号(裸地址,冒号分隔) */
					candidate: "candidate:1 1 udp 1 " + ip.replace(/^\[|\]$/g, "") + " " + port + " typ host",
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

	/* 每 5 秒读取 selectedCandidatePair，获取对端候选类型与 RTT；观测结果在 15 秒内有效，断连时不展示陈旧值。 */
	var lastLink = null;
	var linkWatchTimer = null;
	var linkWatchedPc = null;
	var LINK_KIND = { host: "direct", srflx: "p2p", prflx: "p2p", relay: "relay" };
	function trackPc(pc) {
		if (linkWatchedPc !== pc) {
			linkWatchedPc = pc;
			lastLink = null;   /* 换连接:旧线路的观测立刻作废,别把上一位客人的线报成当前线路 */
		}
		if (linkWatchTimer) {
			return;
		}
		linkWatchTimer = setInterval(function() {
			var target = linkWatchedPc;
			if (!target || typeof target.getStats !== "function") {
				return;
			}
			try {
				var p = target.getStats();
				if (!p || !p.then) {
					return;
				}
				p.then(function(report) {
					if (linkWatchedPc !== target) return;
					var candidates = {};
					var pair = null;
					var fallback = null;
					report.forEach(function(stat) {
						if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
							candidates[stat.id] = stat;
						}
						if (stat.type === "candidate-pair" && stat.state === "succeeded") {
							/* 双栈多路径时会有**多个** succeeded/nominated:只有 selected=true 的
							 * 才是真正在用的那条;取不到 selected 才退而用 nominated */
							if (stat.selected === true) {
								pair = stat;
							} else if (stat.nominated && !fallback) {
								fallback = stat;
							}
						}
					});
					if (!pair) {
						pair = fallback;
					}
					if (!pair) {
						return;
					}
					var remote = candidates[pair.remoteCandidateId] || {};
					var local = candidates[pair.localCandidateId] || {};
					lastLink = {
						at: Date.now(),
						kind: LINK_KIND[remote.candidateType] || (remote.candidateType || "?"),
						remote: remote.candidateType || "?",
						local: local.candidateType || "?",
						/* 注入的虚拟网卡/IPv6 直连地址优先级被我们置成 1:用它给工坊文案区分
						 * "真·局域网直连"与"走的注入地址"(否则后者会被显示成局域网直连) */
						injected: remote.candidateType === "host" && typeof remote.priority === "number" && remote.priority <= 1,
						rtt: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
						protocol: remote.protocol || local.protocol || ""
					};
				}).catch(function() { /* stats 拿不到不影响对局 */ });
			} catch (eS) { /* 同上 */ }
		}, 5000);
	}
	function stopTracking(pc) {
		if (linkWatchedPc !== pc) return;
		linkWatchedPc = null; lastLink = null;
		if (linkWatchTimer) clearInterval(linkWatchTimer);
		linkWatchTimer = null;
	}
	/** 15 秒内的最近一次观测(否则视为不新鲜,返回 null)。 */
	function currentLink() {
		if (!lastLink || Date.now() - lastLink.at > 15000) {
			return null;
		}
		return lastLink;
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
		virtualIps: virtualIps,   /* 工坊面板状态行用(检测到哪些虚拟网卡地址) */
		hostPortsFromSdp: hostPortsFromSdp,
		trackPc: trackPc,         /* 记住当前 pc,5 秒一轮观测线路(直连/中继 + RTT) */
		currentLink: currentLink,  /* 工坊「内核卡」显示用;15 秒无观测返回 null */
		stopTracking: stopTracking
	};
})();

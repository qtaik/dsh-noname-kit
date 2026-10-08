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
	/* 从粘贴内容里**摘出**码本体:聊天软件常给码加前后文(「邀请码:」/引号/表情)、
	 * 换行、或把整条消息一起复制进来——原先要求整串恰好等于 NNK1.<base64url>,
	 * 于是"码明明是对的却说无效"(群友报障"邀请码没用"的一大来源)。
	 * 做法:去掉所有空白,再在全串里找第一段 NNK1.<base64url> */
	function decodeCode(str) {
		var clean = String(str || "").replace(/\s+/g, "");
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

	/* 专用心跳("nnk-ping" 通道,与游戏数据线完全分开、不经过引擎):
	 * 每 2.5 秒发一拍,收到任意来包算活;约 20 秒(8 拍)全无来包才判死并回调
	 * onDead——秒级判死,不用干等 ICE consent 超时(~25 秒)才发现断线;
	 * 持续的微量流量还能防止空闲 P2P 链路被 NAT/UDP 映射超时悄悄回收。
	 * 判活的证据有三路(缺一不可,全是实测踩出来的):
	 *  ①心跳线来包;②自己发送缓冲在推进(对端 SCTP 层在 ACK——对端主线程
	 *  忙时心跳断供但 ACK 照常);③peerTraffic() 报的主通道来包时间(对端
	 *  开局时主通道正狂发数据,而它那侧的心跳定时器饿死——只看心跳必误杀,
	 *  实测:房主点开始游戏客人机必掉线)。
	 * 返回 { stop() }:主动关闭通道前先 stop(),避免把自己的关闭当成对端掉线。 */
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
			if (peerTraffic) {
				try { trafficAt = peerTraffic() || 0; } catch (eT) { trafficAt = 0; }
			}
			/* 三路 JS 证据全静默 ≠ 对端死了:选将框重渲染(大武将池)或 5~6 秒高延迟下,
			 * 双方可能整段不产生 JS 流量——旧逻辑 20 秒到点就杀,实测把活着的客人误杀,
			 * 客机引擎随即自毁重载(用户看到"一到选将框就卡退")。
			 * 判死前先问传输层:connectionState 由 Chromium 网络线程按 ICE consent 维护,
			 * **不依赖对端 JS**(SCTP ACK/STUN 都由网络进程收发,渲染线程卡住也照常),
			 * 正是纪律里"必须留一条不依赖对端 JS 的活证"。 */
			if (Date.now() - Math.max(lastSeen, trafficAt) > 20000) {
				var st = null;
				if (pcState) {
					try { st = pcState() || null; } catch (eS) { st = null; }
				}
				if (st === "connected" || st === "new" || st === "connecting") {
					lastSeen = Date.now();   /* 传输层说链路活着:重置计时继续等(对端只是忙) */
					disconnectedSince = 0;
				} else if (st === "disconnected") {
					/* ICE 抖动会自愈,先给一段恢复期;持续断开才当死 */
					if (!disconnectedSince) {
						disconnectedSince = Date.now();
						lastSeen = Date.now();
					} else if (Date.now() - disconnectedSince > 20000) {
						stop(true);
						return;
					} else {
						lastSeen = Date.now();
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
			/* 兜底 4→8 秒:这是**非 trickle** 的一次性交换,码一发出去就不再补候选,
			 * 4 秒内没集齐的 srflx 就永久丢了(默认 STUN 里 google 那条国内大概率不可达,
			 * 其超时会拖住整个 gathering)——慢网上表现为「双方网络没打通」。只在
			 * 集齐偏慢时才多等几秒;STUN 配空/全部秒回时行为不变 */
			setTimeout(finish, 8000);
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
		this._lastIn = 0;   /* 主通道最近来包时刻:心跳判死的兜底证据(见 startPing) */
		channel.onopen = function() {
			self._open = true;
			self._upHooks.forEach(function(f) { f(); });
			if (self.onopen) {
				self.onopen();
			}
		};
		channel.onmessage = function(e) {
			self._lastIn = Date.now();
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
				if (!a || a.internal || (a.family !== "IPv4" && a.family !== 4)) {
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
			var out = [];
			virtualIps().forEach(function(ip) {
				ports.forEach(function(port) {
					out.push(ip + ":" + port);
				});
			});
			return out.slice(0, 8);
		} catch (e) {
			return [];
		}
	}
	/* 接收用:把对方给的直连地址加进 ICE(必须在 setRemoteDescription 之后)。
	 * 返回成功加进去的条数;坏地址/被拒单条均不影响主流程;上限 8 条防载荷刷爆 */
	function addInjected(pc, hosts) {
		var n = 0;
		(hosts || []).slice(0, 8).forEach(function(h) {
			var sp = String(h).split(":");
			if (sp.length !== 2 || !/^[0-9A-Fa-f.]+$/.test(sp[0]) || !/^\d+$/.test(sp[1])) {
				return;
			}
			try {
				/* 优先级给最低(1):候选类型是 host(type 偏好 126),只要给正常数值就
				 * **天然压过**对端真实的 srflx 公网候选(type 100)——于是同网/公网直连
				 * 明明更快,ICE 却优先去连虚拟网卡那条(可能正是 Radmin 的海外中继)。
				 * 置 1 = 排在所有候选之后:同网走局域网、能打洞走公网直连,
				 * 都打不通才落到虚拟网卡兜底(它存在的意义本来就是兜底) */
				var p = pc.addIceCandidate({
					candidate: "candidate:1 1 udp 1 " + sp[0] + " " + sp[1] + " typ host",
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

	/* ── 当前线路观测(工坊「内核卡」显示:直连/中继 + 往返延迟)──
	 * 用户报障"延迟 5~6 秒"时,第一件事是分清"走错路了(中继)"还是"路本身就慢"。
	 * getStats 的 selectedCandidatePair 给出对端候选类型(host/srflx/relay)与 RTT。
	 * 5 秒一轮,结果 15 秒内有效(断了就不显示陈旧值)。 */
	var lastLink = null;
	var linkWatchTimer = null;
	var linkWatchedPc = null;
	var LINK_KIND = { host: "direct", srflx: "p2p", prflx: "p2p", relay: "relay" };
	function trackPc(pc) {
		linkWatchedPc = pc;
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
					var candidates = {};
					var pair = null;
					report.forEach(function(stat) {
						if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
							candidates[stat.id] = stat;
						}
						if (stat.type === "candidate-pair" && stat.state === "succeeded" && (stat.selected || stat.nominated)) {
							pair = stat;
						}
					});
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
						rtt: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
						protocol: remote.protocol || local.protocol || ""
					};
				}).catch(function() { /* stats 拿不到不影响对局 */ });
			} catch (eS) { /* 同上 */ }
		}, 5000);
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
		currentLink: currentLink  /* 工坊「内核卡」显示用;15 秒无观测返回 null */
	};
})();

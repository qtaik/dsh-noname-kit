/* The persistent renderer owns all native RTC objects.
 * Engine documents receive scalar scopes and message ports only. No game/lib,
 * socket facade, document or port is retained by this transport module. */
const PROTOCOL = "keepalive/1";
const MAX_FRAME_BYTES = 1048576;
const MAX_DIAGNOSTICS = 160;
const noOperation = () => {};

function identifier(value, name) {
  if (typeof value !== "string" || !value.length || value.length > 160) {
    throw new TypeError(`${name} must be a nonempty string of at most 160 characters`);
  }
  return value;
}

function readScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new TypeError("Engine scope is required");
  const allowed = new Set(["roundId", "documentGeneration", "generation"]);
  if (Object.keys(scope).some(key => !allowed.has(key))) throw new TypeError("Engine scope contains non-scope fields");
  const roundId = identifier(scope.roundId, "roundId");
  const generation = scope.documentGeneration ?? scope.generation;
  if (!Number.isSafeInteger(generation) || generation < 1) throw new TypeError("documentGeneration must be a positive safe integer");
  if (scope.documentGeneration !== undefined && scope.generation !== undefined && scope.documentGeneration !== scope.generation) {
    throw new TypeError("Conflicting document generations");
  }
  return Object.freeze({ roundId, documentGeneration: generation });
}

function sameScope(left, right) {
  return Boolean(left && right && left.roundId === right.roundId && left.documentGeneration === right.documentGeneration);
}

function frameBytes(raw) { return new TextEncoder().encode(raw).byteLength; }

export class TransportOwner {
  constructor({ role, offerer = role === "host", contextFromOffer = false, sessionId, peerId, remotePeerId, rtc, iceConfig, onGame = noOperation,
    onControl = noOperation, validateControl = null, onControlFailure = noOperation, onStopped = noOperation, onEvent = noOperation }) {
    if (role !== "host" && role !== "guest") throw new TypeError("role must be host or guest");
    if (typeof offerer !== "boolean") throw new TypeError("offerer must be a boolean");
    if(typeof contextFromOffer!=="boolean")throw new TypeError("contextFromOffer must be a boolean");
    this.role = role;
    this.offerer = offerer;
    this._contextFromOffer=contextFromOffer;this._contextBound=!contextFromOffer;
    this.sessionId = identifier(sessionId, "sessionId");
    this.peerId = identifier(peerId, "peerId");
    this.remotePeerId = identifier(remotePeerId, "remotePeerId");
    if (this.peerId === this.remotePeerId) throw new TypeError("Peer identities must differ");
    if(contextFromOffer&&(peerId!==role||remotePeerId!==(role==='host'?'guest':'host')))throw new TypeError("Derived initial contexts use canonical per-connection role identities");
    if (!rtc || ["encodeCode", "decodeCode", "waitGather", "startPing"].some(key => typeof rtc[key] !== "function")) {
      throw new TypeError("RTC codec, gather and ping helpers are required");
    }
    if (validateControl !== null && typeof validateControl !== 'function') throw new TypeError('validateControl must be a synchronous function');
    for (const callback of [onGame, onControl, onControlFailure, onStopped, onEvent]) {
      if (typeof callback !== "function") throw new TypeError("Transport callbacks must be functions");
    }
    this._rtc = rtc;
    this._onGame = onGame;
    this._onControl = onControl;
    this._validateControl = validateControl;
    this._onControlFailure = onControlFailure;
    this._controlOperations = new Set();
    this._onStopped = onStopped;
    this._onEvent = onEvent;
    this._scope = null;
    this._remoteDocumentGeneration = null;
    this._maxGeneration = 0;
    this._signalingPhase = "new";
    this._controller = new AbortController();
    this._waiters = new Set();
    this._diagnostics = [];
    this._helloSent = false;
    this._helloReceived = false;
    this._gameSendSeq = 0;
    this._gameReceiveSeq = 0;
    this._controlSendSeq = 0;
    this._controlReceiveSeq = 0;
    this._lastTrafficAt = 0;
    this._pingOwner = null;
    this.ready = false;
    this.stopped = false;
    this.stopReason = null;
    this.link = null;
    this.ping = null;
    this._counts = { pcConstructions: 0, dcConstructions: 0, negotiations: 0, localDescriptions: 0,
      remoteDescriptions: 0, pingStarts: 0, gameSent: 0, gameReceived: 0, controlsSent: 0,
      controlsReceived: 0, rejected: 0, attaches: 0, detaches: 0, stopEvents: 0, reconnectAttempts: 0 };
    const NativePc = rtc.RTCPeerConnection || globalThis.RTCPeerConnection;
    if (typeof NativePc !== "function") throw new Error("RTCPeerConnection is unavailable");
    const config = iceConfig === undefined ? (typeof rtc.pcConfig === "function" ? rtc.pcConfig() : { iceServers: [] })
      : (Array.isArray(iceConfig) ? { iceServers: iceConfig } : iceConfig);
    this.pc = new NativePc(config);
    this._counts.pcConstructions++;
    this.pc.onconnectionstatechange = () => {
      if (this.stopped) return;
      this._event("pc-state", { state: this.pc.connectionState });
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.stopTransport(`transport-${this.pc.connectionState}`);
      }
    };
    this.pc.ondatachannel = event => {
      if (this.stopped) { try { event.channel.close(); } catch {} return; }
      if (this.offerer) {
        try { event.channel.close(); } catch {}
        this.stopTransport("unexpected-remote-datachannel");
        return;
      }
      this._adoptChannel(event.channel);
    };
    this._event("pc-created", { role, offerer });
    if (offerer) {
      try {
        for (const label of ["nnk-link", "nnk-ping"]) {
          const channel = this.pc.createDataChannel(label, { ordered: true });
          this._counts.dcConstructions++;
          this._adoptChannel(channel);
        }
      } catch (error) { this.stopTransport("initial-datachannel-creation-failed"); throw error; }
    }
  }

  get currentScope() { return this._scope && { ...this._scope }; }
  get diagnostics() { return this._diagnostics.map(item => ({ ...item })); }

  _event(type, details = {}) {
    const event = { at: Date.now(), type };
    for (const [key, value] of Object.entries(details)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) event[key] = value;
    }
    this._diagnostics.push(event);
    if (this._diagnostics.length > MAX_DIAGNOSTICS) this._diagnostics.splice(0, this._diagnostics.length - MAX_DIAGNOSTICS);
    try { this._onEvent?.({ ...event }); } catch (error) {
      // Keep native warnings visible; application reporting failures are not hidden.
      console.error("[NNK keepalive] diagnostic callback failed", error);
    }
  }

  _reject(reason, frame) {
    this._counts.rejected++;
    this._event("frame-rejected", { reason, kind: typeof frame?.kind === "string" ? frame.kind : null,
      roundId: typeof frame?.roundId === "string" ? frame.roundId : null,
      generation: Number.isSafeInteger(frame?.documentGeneration) ? frame.documentGeneration : null });
  }

  _assertLive() { if (this.stopped) throw new Error(`Transport stopped: ${this.stopReason}`); }

  async _bindInitialContext(offer){
    if(!this._contextFromOffer)return;
    this._assertLive();
    if(this._contextBound||this._helloSent||this._helloReceived||this.ready||this._scope)throw Error('Initial connection context is already committed');
    if(offer?.k!=='offer'||offer.sdp?.type!=='offer'||typeof offer.sdp.sdp!=='string'||!offer.sdp.sdp)throw Error('Exact original offer SDP is required');
    const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(offer.sdp.sdp));
    this._assertLive();
    if(this._contextBound||this._helloSent||this._helloReceived||this.ready||this._scope)throw Error('Initial connection context changed during digest');
    this.sessionId='sdp-pair:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    this._contextBound=true;this._event('initial-context-bound',{sessionId:this.sessionId,source:'exact-exchanged-offer-sdp; correlation, not authentication'});
  }

  _adoptChannel(channel) {
    const field = channel?.label === "nnk-link" ? "link" : channel?.label === "nnk-ping" ? "ping" : null;
    if (!field || this[field]) {
      try { channel?.close(); } catch {}
      this.stopTransport(field ? "duplicate-datachannel" : "unknown-datachannel");
      return;
    }
    this[field] = channel;
    this._event("dc-adopted", { label: channel.label });
    channel.onerror = () => { if (!this.stopped) this.stopTransport(`${channel.label}-error`); };
    channel.onclose = () => { if (!this.stopped) this.stopTransport(`${channel.label}-closed`); };
    if (field === "link") channel.onmessage = event => this._receive(channel, event.data);
    channel.onopen = () => {
      if (this.stopped || this[field] !== channel) return;
      this._event("dc-open", { label: channel.label });
      if (field === "link") this._sendHello();
      else if (!this._pingOwner) {
        this._counts.pingStarts++;
        this._pingOwner = this._rtc.startPing(channel, () => this.stopTransport("heartbeat-dead"),
          () => this._lastTrafficAt, () => this.pc.connectionState);
      }
      this._tryReady();
    };
    if (channel.readyState === "open") channel.onopen();
  }

  _base(kind) { return { protocol: PROTOCOL, kind, sessionId: this.sessionId, sourcePeer: this.peerId }; }

  _transmit(frame) {
    this._assertLive();
    if (this.link?.readyState !== "open") throw new Error("nnk-link is not open");
    const raw = JSON.stringify(frame);
    if (frameBytes(raw) > MAX_FRAME_BYTES) throw new RangeError("Transport frame exceeds 1 MiB");
    this.link.send(raw);
  }

  _sendHello() {
    if (this._helloSent || this.stopped) return;
    try {
      if(!this._contextBound)throw Error('Initial connection context is not committed');
      this._transmit({ ...this._base("control"), seq: ++this._controlSendSeq, type: "hello",
        data: { capabilities: [PROTOCOL], role: this.role } });
      this._helloSent = true;
      this._counts.controlsSent++;
    } catch (error) {
      this._event("hello-send-failed", { message: error.message });
      this.stopTransport("hello-send-failed");
    }
  }

  _tryReady() {
    if (this.stopped || this.ready || !this._helloSent || !this._helloReceived
      || this.link?.readyState !== "open" || this.ping?.readyState !== "open") return;
    this.ready = true;
    this._event("transport-ready", { capability: PROTOCOL });
    for (const waiter of this._waiters) { clearTimeout(waiter.timer); waiter.resolve(this.snapshot()); }
    this._waiters.clear();
  }

  _receive(channel, raw) {
    if (this.stopped || channel !== this.link) { this._reject("unowned-channel"); return; }
    this._lastTrafficAt = Date.now();
    if (typeof raw !== "string" || frameBytes(raw) > MAX_FRAME_BYTES) { this._reject("invalid-size-or-type"); return; }
    let frame;
    try { frame = JSON.parse(raw); } catch { this._reject("invalid-json"); return; }
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || frame.protocol !== PROTOCOL) {
      this._reject("missing-keepalive-protocol", frame);
      if (!this._helloReceived) this.stopTransport("keepalive-not-supported");
      return;
    }
    // The callback is bound to this exact remote RTCDataChannel. Self-reported IDs
    // can only be checked against that binding; they cannot change its identity.
    if (frame.sessionId !== this.sessionId || frame.sourcePeer !== this.remotePeerId) { this._reject("wrong-peer-or-session", frame); return; }
    if (!Number.isSafeInteger(frame.seq) || frame.seq < 1) { this._reject("invalid-sequence", frame); return; }
    if (frame.kind === "control") {
      if (typeof frame.type !== "string" || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(frame.type) || !frame.data
        || typeof frame.data !== "object" || Array.isArray(frame.data)) { this._reject("invalid-control", frame); return; }
      if (frame.seq <= this._controlReceiveSeq) { this._reject("old-control-sequence", frame); return; }
      if (frame.type === "hello") {
        if (this._helloReceived) { this._reject("duplicate-hello", frame); return; }
        if (!Array.isArray(frame.data.capabilities) || !frame.data.capabilities.includes(PROTOCOL)
          || frame.data.role !== (this.role === "host" ? "guest" : "host")) {
          this._reject("unsupported-capability", frame);
          this.stopTransport("keepalive-not-supported");
          return;
        }
        this._helloReceived = true;
        this._controlReceiveSeq = frame.seq;
        this._counts.controlsReceived++;
        this._event("capability-agreed", { capability: PROTOCOL });
        this._tryReady();
        return;
      }
      if (!this.ready) { this._reject("control-before-ready", frame); return; }
      const context = Object.freeze({sessionId:this.sessionId,role:this.role,remotePeerId:this.remotePeerId,
        roundId:this._scope?.roundId??null,documentGeneration:this._scope?.documentGeneration??null});
      if(this._validateControl){
        try{
          const verdict=this._validateControl(frame,context);
          if(verdict&&typeof verdict.then==='function')Promise.resolve(verdict).catch(error=>this._event('async-validator-rejected',{message:String(error?.message??error)}));
          if(verdict!==true){this._reject(typeof verdict==='string'?verdict.slice(0,160):'control-semantics-rejected',frame);return;}
        }catch(error){this._reject('control-validator-failed',frame);this._event('control-validator-failed',{message:String(error?.message??error)});return;}
      }
      this._controlReceiveSeq = frame.seq;
      this._counts.controlsReceived++;
      const failureHook=this._onControlFailure;
      const failed=error=>{
        this._event('control-delivery-failed',{message:String(error?.message??error),controlType:frame.type,
          operationId:typeof frame.data.operationId==='string'?frame.data.operationId:null});
        try{return failureHook?.(error,frame,context);}catch(hookError){
          this._event('control-failure-hook-failed',{message:String(hookError?.message??hookError)});
          console.error('[NNK keepalive] control failure hook failed',hookError);
        }
      };
      try{
        const result=this._onControl(frame,context);
        if(result&&typeof result.then==='function'){
          const task=Promise.resolve(result).catch(failed).catch(error=>{
            this._event('control-failure-hook-failed',{message:String(error?.message??error)});
            console.error('[NNK keepalive] asynchronous failure hook failed',error);
          });
          this._controlOperations.add(task);task.finally(()=>this._controlOperations.delete(task));
        }
      }catch(error){
        const result=failed(error);
        if(result&&typeof result.then==='function'){
          const task=Promise.resolve(result).catch(hookError=>console.error('[NNK keepalive] asynchronous failure hook failed',hookError));
          this._controlOperations.add(task);task.finally(()=>this._controlOperations.delete(task));
        }
      }
      return;
    }
    if (frame.kind !== "game") { this._reject("unknown-message-kind", frame); return; }
    if (!this.ready) { this._reject("game-before-ready", frame); return; }
    if (!this._scope || frame.roundId !== this._scope.roundId || frame.documentGeneration !== this._remoteDocumentGeneration) {
      this._reject(this._scope ? "wrong-engine-scope" : "no-engine-binding", frame); return;
    }
    if (typeof frame.raw !== "string") { this._reject("invalid-game-payload", frame); return; }
    if (frame.seq <= this._gameReceiveSeq) { this._reject("old-game-sequence", frame); return; }
    this._gameReceiveSeq = frame.seq;
    this._counts.gameReceived++;
    const scope = this._scope;
    try {
      const result = this._onGame(frame.raw, frame);
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(error => {
          if (!this.stopped && sameScope(this._scope, scope)) {
            this._event("game-delivery-failed", { message: error.message });
            this.detachEngineBinding(scope, "engine-delivery-failed");
          } else this._event("retired-game-callback-rejected");
        });
      }
    } catch (error) {
      this._event("game-delivery-failed", { message: error.message });
      this.detachEngineBinding(scope, "engine-delivery-failed");
    }
  }

  attachEngine(scope, { remoteDocumentGeneration } = {}) {
    this._assertLive();
    const next = readScope(scope);
    const remoteGeneration = remoteDocumentGeneration ?? next.documentGeneration;
    if (!Number.isSafeInteger(remoteGeneration) || remoteGeneration < 1) throw new TypeError("remoteDocumentGeneration must be a positive safe integer");
    if (next.documentGeneration <= this._maxGeneration) throw new Error("Engine binding generation cannot be reused or rolled back");
    if (this._scope) throw new Error("Detach the current engine binding before attaching another");
    this._scope = next;
    this._remoteDocumentGeneration = remoteGeneration;
    this._maxGeneration = next.documentGeneration;
    this._counts.attaches++;
    this._event("engine-attached", { roundId: next.roundId, generation: next.documentGeneration, remoteGeneration });
    return { ...next };
  }

  detachEngineBinding(scope, reason = "retired") {
    const retired = readScope(scope);
    if (!sameScope(this._scope, retired)) { this._event("stale-detach-rejected", { roundId: retired.roundId, generation: retired.documentGeneration }); return false; }
    this._scope = null;
    this._remoteDocumentGeneration = null;
    this._counts.detaches++;
    this._event("engine-detached", { roundId: retired.roundId, generation: retired.documentGeneration, reason: String(reason).slice(0, 160) });
    return true;
  }

  sendGame(scope, raw) {
    this._assertLive();
    const target = readScope(scope);
    if (!this.ready) throw new Error("Keepalive capability is not ready");
    if (!sameScope(this._scope, target)) throw new Error("Engine binding is retired or unknown");
    if (typeof raw !== "string") throw new TypeError("Official game payload must be a string");
    const frame = { ...this._base("game"), ...target, seq: ++this._gameSendSeq, raw };
    this._transmit(frame);
    this._counts.gameSent++;
    return frame.seq;
  }

  // 控制消息复用有序 nnk-link，使用独立的单调序号。
  // 回合切换由协调器处理。
  sendControl(type, data = {}) {
    this._assertLive();
    if (!this.ready) throw new Error("Keepalive capability is not ready");
    if (type === "hello" || typeof type !== "string" || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(type)) throw new TypeError("Invalid or reserved control type");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Control data must be a JSON object");
    this._transmit({ ...this._base("control"), seq: ++this._controlSendSeq, type, data });
    this._counts.controlsSent++;
    return this._controlSendSeq;
  }

  waitReady(timeout = 10000) {
    if (!Number.isFinite(timeout) || timeout < 1) return Promise.reject(new TypeError("Ready timeout must be positive"));
    if (this.stopped) return Promise.reject(new Error(`Transport stopped: ${this.stopReason}`));
    if (this.ready) return Promise.resolve(this.snapshot());
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        if (this._waiters.has(waiter)) this.stopTransport("keepalive-capability-timeout");
      }, timeout);
      this._waiters.add(waiter);
    });
  }

  async createOffer() {
    this._assertLive();
    if (!this.offerer || this._signalingPhase !== "new") throw new Error("Only the initial offerer offer is allowed");
    this._signalingPhase = "creating-offer";
    this._counts.negotiations++;
    try {
      const offer = await this.pc.createOffer(); this._assertLive();
      await this.pc.setLocalDescription(offer); this._assertLive(); this._counts.localDescriptions++;
      await this._rtc.waitGather(this.pc, this._controller.signal); this._assertLive();
      const code=this._rtc.encodeCode("offer", this.pc.localDescription, this._rtc.directHosts?.(this.pc) || []);
      await this._bindInitialContext(this._rtc.decodeCode(code));this._assertLive();
      this._signalingPhase = "offered";
      return code;
    } catch (error) { this.stopTransport("initial-offer-failed"); throw error; }
  }

  async acceptOffer(code) {
    this._assertLive();
    if (this.offerer || this._signalingPhase !== "new") throw new Error("Only the initial answerer answer is allowed");
    this._signalingPhase = "answering";
    this._counts.negotiations++;
    try {
      const offer = this._rtc.decodeCode(code);
      if (offer.k !== "offer") throw new Error("Invitation is not an offer");
      await this._bindInitialContext(offer);this._assertLive();
      await this.pc.setRemoteDescription(offer.sdp); this._assertLive(); this._counts.remoteDescriptions++;
      this._rtc.addInjected?.(this.pc, offer.hosts);
      const answer = await this.pc.createAnswer(); this._assertLive();
      await this.pc.setLocalDescription(answer); this._assertLive(); this._counts.localDescriptions++;
      await this._rtc.waitGather(this.pc, this._controller.signal); this._assertLive();
      this._signalingPhase = "answered";
      return this._rtc.encodeCode("answer", this.pc.localDescription, this._rtc.directHosts?.(this.pc) || []);
    } catch (error) { this.stopTransport("initial-answer-failed"); throw error; }
  }

  async acceptAnswer(code) {
    this._assertLive();
    if (!this.offerer || this._signalingPhase !== "offered") throw new Error("Only the initial offer answer is allowed");
    this._signalingPhase = "applying-answer";
    try {
      const answer = this._rtc.decodeCode(code);
      if (answer.k !== "answer") throw new Error("Reply is not an answer");
      await this.pc.setRemoteDescription(answer.sdp); this._assertLive(); this._counts.remoteDescriptions++;
      this._rtc.addInjected?.(this.pc, answer.hosts);
      this._signalingPhase = "connected";
    } catch (error) { this.stopTransport("initial-answer-application-failed"); throw error; }
  }

  actualIdentity() { return { pc: this.pc, link: this.link, ping: this.ping }; }

  snapshot() {
    return { role: this.role, offerer: this.offerer, sessionId: this.sessionId, peerId: this.peerId, remotePeerId: this.remotePeerId,
      ready: this.ready, stopped: this.stopped, stopReason: this.stopReason,
      contextFromOffer:this._contextFromOffer,initialContextBound:this._contextBound,
      roundId: this._scope?.roundId ?? null, documentGeneration: this._scope?.documentGeneration ?? null,
      remoteDocumentGeneration: this._remoteDocumentGeneration,
      maxDocumentGeneration: this._maxGeneration, connectionState: this.pc.connectionState,
      linkState: this.link?.readyState ?? null, pingState: this.ping?.readyState ?? null,
      signalingPhase: this._signalingPhase, pending: this._waiters.size, diagnosticCount: this._diagnostics.length,
      controlValidation:this._validateControl!==null,lastAcceptedControlSeq:this._controlReceiveSeq,controlPending:this._controlOperations.size,
      ...this._counts };
  }

  stopTransport(reason = "explicit-stop") {
    if (this.stopped) return false;
    this.stopped = true;
    this.ready = false;
    this.stopReason = String(reason).slice(0, 160);
    if (this._scope) this.detachEngineBinding(this._scope, this.stopReason);
    this._controller.abort();
    if (this._pingOwner) {
      try { this._pingOwner.stop(); } catch (error) { this._event("ping-stop-failed", { message: error.message }); }
      this._pingOwner = null;
    }
    for (const channel of [this.link, this.ping]) {
      if (!channel) continue;
      channel.onopen = channel.onmessage = channel.onerror = channel.onclose = null;
      try { if (channel.readyState !== "closed") channel.close(); } catch (error) { this._event("dc-close-failed", { message: error.message }); }
    }
    this.pc.onconnectionstatechange = this.pc.ondatachannel = null;
    try { if (this.pc.connectionState !== "closed") this.pc.close(); } catch (error) { this._event("pc-close-failed", { message: error.message }); }
    for (const waiter of this._waiters) { clearTimeout(waiter.timer); waiter.reject(new Error(`Transport stopped: ${this.stopReason}`)); }
    this._waiters.clear();
    this._counts.stopEvents++;
    this._event("transport-stopped", { reason: this.stopReason });
    try { this._onStopped(this.stopReason, this.snapshot()); } catch (error) { console.error("[NNK keepalive] stop callback failed", error); }
    this._onGame = this._onControl = this._onControlFailure = this._validateControl = this._onStopped = this._onEvent = null;
    return true;
  }
}

export { PROTOCOL as KEEPALIVE_PROTOCOL };

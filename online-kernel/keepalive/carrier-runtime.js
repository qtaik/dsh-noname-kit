import {TransportOwner} from './transport-owner.js';
import {InitialConnector} from './initial-connector.js';
import {SessionRegistry} from './session-registry.js';
import {LobbyOwner} from './lobby-owner.js';
import {EngineBindingManager} from './engine-binding.js';
import {InitialPartyCoordinator} from './initial-party.js';
import {LobbyManifest,LOBBY_MANIFEST_TYPES} from './lobby-manifest.js';
import {collectLobbyInventory} from './lobby-inventory.js';
import {SettledPartyRecovery} from './party-recovery.js';
import {CarrierTransfer,TRANSFER_TYPES,TRANSFER_PROTOCOL} from './carrier-transfer.js';
import {enableBatchExtensions,withBatchActivation} from './batch-activation.js';
import {saveTransferLimit,validTransferLimit} from './transfer-limit-config.js';
import {transferPeerDisplay} from './transfer-display.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const sameTransferScope=(a,b)=>!!a&&!!b&&a.carrierSessionId===b.carrierSessionId&&a.partyEpoch===b.partyEpoch;
const exactTransferRequest=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).length===2&&Object.hasOwn(value,'peerId')&&Object.hasOwn(value,'scope')&&typeof value.peerId==='string'&&value.peerId.length>0&&value.peerId.length<=160&&!/[\x00-\x1f\x7f]/.test(value.peerId)&&!!value.scope&&typeof value.scope==='object'&&!Array.isArray(value.scope)&&[Object.prototype,null].includes(Object.getPrototypeOf(value.scope))&&Object.keys(value.scope).length===2&&Object.hasOwn(value.scope,'carrierSessionId')&&Object.hasOwn(value.scope,'partyEpoch')&&typeof value.scope.carrierSessionId==='string'&&value.scope.carrierSessionId.length>0&&value.scope.carrierSessionId.length<=160&&!/[\x00-\x1f\x7f]/.test(value.scope.carrierSessionId)&&Number.isSafeInteger(value.scope.partyEpoch)&&value.scope.partyEpoch>=0&&value.scope.partyEpoch<=1000000000;
function profileIdentity(profile){
  const identity=profile.identity||{},config=profile.config||{};
  return {name:String(identity.name??identity.connectNickname??config.onlineName??'').slice(0,12),
    avatar:String(identity.avatar??identity.connectAvatar??config.onlineAvatar??'').slice(0,24)};
}
export class CarrierRuntime {
  constructor({nnk,native,ipc,profile,onDisplay=()=>{}}){
    Object.assign(this,{nnk,native,ipc,profile,onDisplay});this.events=[];this.identities=new Map();this.stopped=false;this.nativeSnapshot=null;this.nativePollPending=false;this.leaving=false;this.leavePromise=null;this.carrierSessionId=crypto.randomUUID();this.partyEpoch=0;
    this.profileOperations=new Map();this.profileOperationSequence=0;this.profileConfirmedSequence=0;this.transferLimitSaving=null;this.transferRequest=null;this.manualManifestRows=new WeakMap();
    const bridge=nnk.modules.bridge;
    const event=(name,data={})=>{const row={at:Date.now(),name,data:clone(data)};this.events.push(row);if(this.events.length>160)this.events.shift();if(name==='error')onDisplay(data.message,true);};
    this.event=event;this.sessions=new SessionRegistry({onStopped:record=>{
      if(this.transferRequest?.peerId===record.peerId)this.clearTransferRequest(this.transferRequest,'连接已结束，本次重新传输已取消。');
      this.recovery?.captureBeforeDisconnect(record.peerId);this.identities.delete(record.peerId);
      const r=this.coordinator?.round;
      const enrolled=r&&record.lease&&['partySessionId','roundId','operationId'].every(key=>record.lease[key]===r[key]);
      const participant=this.coordinator?.role==='guest'?record.peerId===this.coordinator.guestPeer:this.coordinator?.members.has(record.peerId)||r?.continuationPeers?.includes(record.peerId);
      const inParty=enrolled||r?.continuationPeers?.includes(record.peerId);
      this.coordinator?.unregister(record.peerId);this.lobby?.onSessionChanged();
      if(!this.leaving&&r&&!r.failed&&inParty&&participant)this.coordinator.fail(r,Error('本局原连接已终止：'+record.reason));
      if(!this.leaving)this.recovery?.maybeRecover().catch(error=>bridge.emit('error',{message:'旧局回收未完成：'+error.message}));
      event('transport-stopped',record);if(!this.leaving)bridge.emit(inParty&&participant?'error':'info',{message:inParty&&participant?'本局保活连接已终止：'+record.reason:'大厅连接已结束：'+record.reason});this.update();
    },onEvent:event});
    this.engines=new EngineBindingManager({native,ipc,onEvent:event,
      onSend:(binding,peerId,raw,terminal)=>{
        if(this.engines.current!==binding||binding.lease.roundId!==this.coordinator.round?.roundId)throw Error('旧端点不能发出游戏消息');
        const owner=this.sessions.getOwner(peerId);if(!owner)throw Error('未批准的实际连接');
        if(terminal&&require('node:crypto').createHash('sha256').update(raw).digest('hex')!==terminal.rawHash)throw Error('原生终端帧指纹未匹配实际发送内容');
        const seq=owner.sendGame({roundId:binding.scope.roundId,documentGeneration:binding.scope.documentGeneration},raw);
        this.coordinator.settlement.sent(binding,peerId,seq,terminal);
      },onStatus:(binding,status)=>{this.coordinator.status(binding,status);this.coordinator.settlement.status(binding,status);this.update();},
      onModuleEvent:(binding,name,data)=>{
        if(this.engines.current!==binding||binding.scope?.roundId!==this.coordinator.round?.roundId)return;
        // These notifications have no operation ID. Only the captured request's
        // successful result may commit a profile or announce identity success.
        if(['config_applied','identity_applied'].includes(name)){event('profile-notification-observed',{name,scope:binding.scope});return;}
        this.coordinator.settlement.engineEvent(binding,name,data);
        if(name==='round-return-request')this.coordinator.returnToPluginRoom({requestId:data.requestId}).catch(error=>bridge.emit('error',{message:error.message}));
        if(name==='round-return-waiting')bridge.emit('info',{message:data.message});
        bridge.emit(name,{...data,scope:binding.scope});event('engine-module-event',{name,scope:binding.scope});
      },onFailure:(binding,error)=>{if(binding.lease.roundId===this.coordinator.round?.roundId)this.coordinator.fail(this.coordinator.round,error);this.update();}});
    this.coordinator=this.newCoordinator();this.installTransfer();this.installManifest();
    this.recovery=new SettledPartyRecovery({getCoordinator:()=>this.coordinator,getSessions:()=>this.sessions,emit:(name,data)=>{event(name,data);bridge.emit(name,data);},
      retire:async(c,r,isCurrent)=>{if(this.leaving||this.stopped||!isCurrent()||this.coordinator!==c||c.round!==r)return false;
        await c.retire('completed party connections ended');
        if(this.leaving||this.stopped||!isCurrent()||this.coordinator!==c||c.round!==r)return false;
        if(this.transfer.busy())throw Error('本机补传尚未结束，请完成或取消后再开始新一局');const capable=this.transfer.capabilitySnapshot();await this.transfer.dispose();await this.files?.dispose?.();if(this.leaving||this.stopped||!isCurrent()||this.coordinator!==c||c.round!==r)return false;c.resetCompletedRound(r);++this.partyEpoch;this.installTransfer(capable);this.installManifest();this.lobby?.onSessionChanged();this.update();return true;}});
    this.connector=new InitialConnector({rtc:nnk.modules.rtc,signaling:nnk.modules.signaling,onEvent:event,onFailure:error=>bridge.emit('error',{message:error.message}),
      allocationGuard:stats=>this.sessions.resourceSnapshot().liveOwners+stats.unadoptedAttempts+stats.retiredAttempts+stats.requestedOwners<=stats.maxTotalOwners,
      createOwner:({role,offerer})=>{
      this.assertSessionOpen();const coordinator=this.coordinator;coordinator.setRole(role);let owner;
      owner=new TransportOwner({role,offerer,contextFromOffer:true,sessionId:'uncommitted:'+crypto.randomUUID(),peerId:role,remotePeerId:role==='host'?'guest':'host',rtc:nnk.modules.rtc,
        validateControl:frame=>{if(this.leaving||this.stopped||coordinator!==this.coordinator||coordinator.closed)return 'retired-party';const transfer=this.transfer.validate(owner,frame);if(transfer!==null)return transfer;const result=this.manifest.validate(owner,frame);return result===null?coordinator.validate(owner,frame):result;},
        onControl:frame=>TRANSFER_TYPES.has(frame.type)?this.transfer.control(owner,frame):LOBBY_MANIFEST_TYPES.has(frame.type)?this.manifest.control(owner,frame):coordinator.control(owner,frame),onControlFailure:(error,frame)=>coordinator.failure(owner,error,frame),
        onGame:(raw,envelope)=>{
          const peerId=this.sessions.peerForActualOwner(owner),binding=this.engines.current;
          if(this.leaving||coordinator!==this.coordinator||coordinator.closed||!peerId||!binding||binding.lease.roundId!==envelope.roundId)throw Error('当前游戏帧没有已批准的实际端点');
          this.engines.game(peerId,raw,envelope,binding);
        },onStopped:reason=>{if(owner){this.connector?.transportStopped(owner,reason);this.sessions.transportStopped(owner,reason);}},onEvent:detail=>event('transport-event',{role,...detail})});return owner;
    }});
    this.lobby=new LobbyOwner({boot:{...profile,identity:profileIdentity(profile)},connector:this.connector,sessions:this.sessions,bridge,
      coordinator:{restartRoom:mode=>this.restartRoom(mode),blocksNewPublicRoom:()=>!!this.coordinator.round&&!this.coordinator.round.failed,blocksReplacementJoin:()=>this.sessions.snapshot().length>0,
        lobbySnapshot:()=>({hostIdentity:this.coordinator.getLocalIdentity(),mode:this.coordinator.room.available()?this.lobby.nextMode:this.coordinator.round?.mode,capacity:this.coordinator.room.available()?this.coordinator.room.receipt.plans[this.lobby.nextMode]?.capacity:this.engines.current?.status?.capacity,hostEntered:(this.engines.current?.status?.seats||[]).some(seat=>seat.playerid==='1'&&!seat.unselectable),selectedPeers:this.coordinator.round?(this.coordinator.room.available()?this.coordinator.room.receipt.peers:[...this.coordinator.members.keys()]):null}),continuationSnapshot:()=>this.sessions.hasEnteredConnections()?this.coordinator.snapshot():null},
      onRegistered:async record=>{
        this.assertSessionOpen();const before=this.coordinator;await this.recovery.maybeRecover();this.assertSessionOpen();if(this.coordinator!==before||before.closed)throw Error('原联机会话已结束，本次旧操作已取消');const coordinator=this.coordinator;coordinator.setRole(record.role);const owner=this.sessions.getOwner(record.peerId);if(!owner||!this.sessions.isLive(record.peerId))throw Error('原加入连接已结束');const actual=owner.actualIdentity();
        this.identities.set(record.peerId,{pc:new WeakRef(actual.pc),link:new WeakRef(actual.link),ping:new WeakRef(actual.ping)});
        try{if(!owner||!this.sessions.isLive(record.peerId))throw Error('原加入连接已结束');await coordinator.onRegistered(record);this.update();}catch(error){if(!this.leaving&&this.coordinator===coordinator&&!coordinator.closed){coordinator.fail(coordinator.round,error);bridge.emit('error',{message:error.message});}throw error;}
      },onMembers:()=>{
        if(this.stopped||this.leaving)return;
        if(this.lobby?.role==='host')for(const peer of this.sessions.snapshot())if(this.sessions.isLive(peer.peerId))this.coordinator.publishLobby(peer.peerId);
        this.update();
      }});
    nnk.state.transferPaused=true;nnk.state.host={active:false,invites:[]};nnk.state.guest={session:null};
    this.nativePollTimer=setInterval(()=>{
      if(this.stopped||this.nativePollPending)return;this.nativePollPending=true;const binding=this.engines.current;
      native.snapshot().then(value=>{if(!this.stopped&&this.engines.current===binding){this.nativeSnapshot=value;this.update();this.maybeAutoHealth();}})
        .catch(error=>{if(!this.stopped&&this.engines.current===binding){event('native-observation-failed',{error:String(error)});bridge.emit('error',{message:'原生窗口状态读取失败：'+error.message});}})
        .finally(()=>{this.nativePollPending=false;});
    },1000);
  }
  installTransfer(capable=[]){
    if(this.transferRequest)this.clearTransferRequest(this.transferRequest);
    this.autoHealthSeen=new Set();this.autoHealthPending=false;this.files=null;this.fileAdapterError='';
    if(typeof this.native.request==='function'&&typeof this.profile.root==='string')try{
      const path=require('node:path'),base=path.join(this.profile.root,'extension','联机助手','lib'),disk=require(path.join(base,'carrier-files-proxy.cjs')),core=require(path.join(base,'batch-files.cjs'));
      this.files=disk.createCarrierFilesProxy({native:this.native,ipc:this.ipc});
      this.filePrimitives={normalize:core.normalize,digest:core.manifestDigest,createChannel:options=>new (require(path.join(base,'batch-wire.cjs')).Channel)(options)};
    }catch{this.fileAdapterError='本机补传文件接口未就绪，请双方升级内核并重启游戏。';}
    this.transfer=new CarrierTransfer({sessions:this.sessions,getRole:()=>this.coordinator.role,getScope:()=>this.manifestScope(),canTransfer:()=>this.transferEligibility(),isRequestPending:()=>!!this.transferRequest||!!this.transferLimitSaving,
      collect:(names,options)=>this.files.collect(names,options),normalize:value=>this.normalizeTransferBatch(value),digest:value=>this.filePrimitives.digest(value),createChannel:options=>this.filePrimitives.createChannel(options),
      source:(grant,context)=>this.files.source(grant,context),receiver:(grant,context)=>this.receiveBatch(grant,context),emit:(name,data)=>{this.event(name,data);this.nnk.modules.bridge.emit(name,data);this.update();this.maybeAutoHealth();}});
    this.coordinator.lobbyTransfer=this.files?this.transfer:null;this.nnk.modules.carrierTransfer=this.transfer;for(const row of capable)if(this.sessions.getOwner(row.peerId)===row.owner&&this.sessions.get(row.peerId)?.connectionSessionId===row.connectionSessionId)this.transfer.setPeerCapability(row.peerId,true);if(this.files)this.nnk.state.transferProtocol=TRANSFER_PROTOCOL;
  }
  normalizeTransferBatch(value){
    const batch=this.filePrimitives.normalize(value),limit=Number(this.profile.config?.transferLimitMB??300);
    if(!validTransferLimit(limit)||batch.total>limit*1048576)throw Error('本批文件超过当前补传容量限制，请先调整容量后重新提议。');
    return batch;
  }
  assertTransferLimitIdle(){
    const transfer=this.nativeSnapshot?.transfer;
    if(this.transferLimitSaving||this.transferRequest||this.profileOperations.size||this.transfer.busy()||transfer?.owned||transfer?.cancelled||transfer?.recoveryRequired)throw Error('补传、授权或文件恢复尚未结束，请完成或取消后再修改容量。');
  }
  async saveRoomTransferLimit(args){
    this.assertTransferLimitIdle();
    const ticket={coordinator:this.coordinator,epoch:this.partyEpoch},requestId=crypto.randomUUID();this.transferLimitSaving=ticket;this.nnk.state.transferLimitSaving=true;this.update();
    const current=()=>!this.stopped&&!this.leaving&&this.transferLimitSaving===ticket&&this.coordinator===ticket.coordinator&&!ticket.coordinator.closed&&this.partyEpoch===ticket.epoch&&!this.engines.current;
    try{
      const snapshot=await this.native.snapshot();if(!current())throw Error('原补传容量设置操作已失效');this.nativeSnapshot=snapshot;
      if(snapshot?.transfer?.available!==true||snapshot.transfer.owned||snapshot.transfer.cancelled||snapshot.transfer.recoveryRequired)throw Error(snapshot?.transfer?.reason||'本机文件事务尚未就绪，未修改补传容量。');
      const saved=await saveTransferLimit({profile:this.profile,value:args.value,isCurrent:current});
      if(!current()||saved?.saved!==true)throw Error('原补传容量设置操作已失效');
      this.confirmProfile({config:{...this.profile.config,transferLimitMB:saved.value}},requestId);
      const profile=clone(this.profile);this.nnk.modules.bridge.emit('config_applied',{key:'transferLimitMB',value:saved.value,profile,requestId});
      return {profile,key:'transferLimitMB',value:saved.value};
    }finally{if(this.transferLimitSaving===ticket){this.transferLimitSaving=null;this.nnk.state.transferLimitSaving=false;this.update();this.maybeAutoHealth();}}
  }
  async receiveBatch(grant,context){
    const receiver=await this.files.receiver(grant,context);
    return withBatchActivation(receiver,{batch:grant.batch,activate:names=>enableBatchExtensions({profile:this.profile,names}),onResult:result=>{
      if(this.stopped)return;const message=result.reason;this.event('batch_activation',{activated:result.activated===true,message});
      this.nnk.modules.bridge.emit('info',{message});this.onDisplay(message);
    }});
  }
  transferEligibility(){
    if(this.stopped||this.leaving)return {available:false,reason:'原联机会话正在退出'};
    if(this.transferLimitSaving)return {available:false,reason:'正在保存补传容量设置，请稍后重试'};
    if(!this.files)return {available:false,reason:this.fileAdapterError||'当前内核未提供新版逐请求补传，请双方更新并重启'};
    if(this.engines.current||this.coordinator.next.pending||this.coordinator.next.committed||this.coordinator.room.pending||['loading','preparing','returning'].includes(this.coordinator.round?.phase))return {available:false,reason:'请先返回插件房间并关闭本目录的游戏窗口，再进行补传'};
    const ready=this.nativeSnapshot?.transfer;return (ready?.available===true||ready?.owned===true&&!ready.recoveryRequired&&!ready.cancelled)?{available:true,reason:''}:{available:false,reason:ready?.reason||'正在核对本机文件事务状态'};
  }
  maybeAutoHealth(){
    if(!this.lobby||this.stopped||this.leaving||!this.files||this.coordinator.role!=='host'||this.autoHealthPending||this.transferRequest)return;
    const state=this.transfer.availability(),manifest=this.manifest?.readiness();if(!state.available||!manifest?.available||manifest.pending||this.transfer.requestBusy())return;
    const peer=state.peers.find(id=>manifest.peers.includes(id)&&!this.autoHealthSeen.has(id));if(!peer)return;
    const current=this.coordinator,checker=this.manifest;this.autoHealthSeen.add(peer);this.autoHealthPending=true;
    Promise.resolve().then(()=>{if(this.coordinator===current&&!this.leaving&&!current.closed)return checker.recheck({peerId:peer});}).catch(error=>this.event('auto-health-deferred',{message:error.message})).finally(()=>{this.autoHealthPending=false;});
  }
  newCoordinator(operationGeneration=0){
    const bridge=this.nnk.modules.bridge,c=new InitialPartyCoordinator({sessions:this.sessions,engines:this.engines,
      onEvent:(name,data)=>{if(c!==this.coordinator||c.closed)return;this.event(name,data);bridge.emit(name,data);},
      onState:()=>{if(!this.stopped&&!this.leaving&&c===this.coordinator)this.lobby?._members();},
      getLobbyState:()=>({roomCode:this.lobby?.snapshot().roomCode??null,roomMode:this.lobby?.nextMode,memberState:this.lobby?.role==='host'?this.lobby.memberState():null}),
      getLocalIdentity:()=>profileIdentity(this.profile),onIdentity:()=>{if(c===this.coordinator&&!this.leaving)this.lobby?.onSessionChanged();}});
    c.operationGeneration=operationGeneration;return c;
  }
  manifestScope(){return {carrierSessionId:this.carrierSessionId,partyEpoch:this.partyEpoch};}
  async collectManifest({signal}){
    if(this.manifestCollection)throw Error('上次只读体检仍在回收，请稍后重试。');
    const operation={};this.manifestCollection=operation;
    try{
      const binding=this.engines.current;if(binding&&!binding.closed){const result=await this.engines.operation('manifest_fresh',{},binding);
        if(signal.aborted||this.engines.current!==binding||binding.closed)throw Error('原体检文档已退休');return result.inventory;}
      return await collectLobbyInventory(this.profile,{signal});
    }finally{if(this.manifestCollection===operation)this.manifestCollection=null;}
  }
  installManifest(){
    if(this.transferRequest)this.clearTransferRequest(this.transferRequest);
    const capable=this.manifest?.capabilitySnapshot?.()||[];this.manifest?.dispose();
    const checker=new LobbyManifest({sessions:this.sessions,getRole:()=>this.coordinator.role,getScope:()=>this.manifestScope(),collect:args=>this.collectManifest(args),emit:(name,data)=>this.manifestEvent(checker,name,data)});this.manifest=checker;
    for(const row of capable)if(this.sessions.getOwner(row.peerId)===row.owner&&this.sessions.get(row.peerId)?.connectionSessionId===row.connectionSessionId)this.manifest.setPeerCapability(row.peerId,true);
    this.coordinator.lobbyManifest=this.manifest;
  }
  transferRequestCurrent(ticket){
    return this.transferRequest===ticket&&!ticket.done&&!this.stopped&&!this.leaving&&this.transfer===ticket.transfer&&this.manifest===ticket.manifest&&this.coordinator===ticket.coordinator&&!ticket.coordinator.closed&&ticket.coordinator.role==='host'&&sameTransferScope(this.manifestScope(),ticket.scope)&&this.sessions.get(ticket.peerId)?.connectionSessionId===ticket.connectionSessionId&&this.sessions.getOwner(ticket.peerId)===ticket.owner&&this.sessions.peerForActualOwner(ticket.owner)===ticket.peerId&&this.sessions.isLive(ticket.peerId)&&!ticket.owner.stopped;
  }
  clearTransferRequest(ticket,message='',error=false){
    if(this.transferRequest!==ticket)return;clearTimeout(ticket.timer);ticket.timer=null;ticket.done=true;this.transferRequest=null;
    if(message&&!this.stopped)this.nnk.modules.bridge.emit(error?'error':'info',{message});
  }
  requestTransfer(args){
    this.assertSessionOpen();
    if(!exactTransferRequest(args)||!sameTransferScope(args.scope,this.manifestScope()))throw Error('本次重新传输的连接或会话已失效');
    if(this.coordinator.role!=='host')throw Error('只有房主可以发起重新传输');
    const gate=this.transferEligibility();if(!gate.available)throw Error(gate.reason);
    if(this.transferRequest||this.transfer.requestBusy(args.peerId))throw Error('已有补传或文件恢复正在进行，请先完成或取消');
    const state=this.manifest.readiness();if(!state.available||!state.peers.includes(args.peerId)||!this.transfer.availability().peers.includes(args.peerId))throw Error('对方尚未确认当前新版补传连接');
    if(state.pending||state.pendingScans||this.manifestCollection)throw Error('包体检正在进行，请完成后再重新传输');
    const owner=this.sessions.getOwner(args.peerId),record=this.sessions.get(args.peerId);
    if(!record||!owner||owner.stopped||!this.sessions.isLive(args.peerId)||this.sessions.peerForActualOwner(owner)!==args.peerId)throw Error('当前对端连接已结束');
    const ticket={peerId:args.peerId,scope:clone(args.scope),owner,connectionSessionId:record.connectionSessionId,coordinator:this.coordinator,manifest:this.manifest,transfer:this.transfer,request:null,state:'checking',done:false,timer:null};this.transferRequest=ticket;
    ticket.timer=setTimeout(()=>{if(this.transferRequest===ticket){this.clearTransferRequest(ticket,'本次体检未能及时完成，请重新体检后再试。',true);this.update();}},16000);ticket.timer.unref?.();
    this.nnk.modules.bridge.emit('info',{message:'正在重新体检，核对缺包后将发起新的补传请求。'});this.update();
    Promise.resolve().then(()=>{
      if(!this.transferRequestCurrent(ticket))throw Error('原连接或会话已更换，本次请求已取消');
      return ticket.manifest.recheck({peerId:ticket.peerId},rows=>{
        if(!this.transferRequestCurrent(ticket)||rows.length!==1||rows[0].peerId!==ticket.peerId||!sameTransferScope(rows[0].scope,ticket.scope))throw Error('本次体检请求已失效');
        ticket.request=rows[0].request;let requests=this.manualManifestRows.get(ticket.manifest);if(!requests){requests=new Set();this.manualManifestRows.set(ticket.manifest,requests);}requests.add(ticket.request);while(requests.size>64)requests.delete(requests.values().next().value);
      });
    }).then(result=>{if(this.transferRequest===ticket&&ticket.state==='checking'&&(!ticket.request||!result?.requested)){this.clearTransferRequest(ticket,'本次体检未完成，未发起补传，请稍后重试。',true);this.update();}}).catch(error=>{if(this.transferRequest===ticket){this.clearTransferRequest(ticket,String(error.message).slice(0,240),true);this.update();}});
    return {requested:true};
  }
  manifestEvent(checker,name,data){
    this.event(name,data);this.nnk.modules.bridge.emit(name,data);
    const manual=this.manualManifestRows?.get(checker)?.has(data.request)===true,ticket=this.transferRequest;
    const selected=ticket&&ticket.manifest===checker&&ticket.request===data.request&&ticket.peerId===data.peerId&&sameTransferScope(ticket.scope,data.scope);
    if(ticket&&!this.transferRequestCurrent(ticket))this.clearTransferRequest(ticket);
    if(name==='manifest_diff'){
      if(manual){
        if(selected&&this.transferRequestCurrent(ticket)&&ticket.state==='checking'){
          ticket.state='proposing';clearTimeout(ticket.timer);ticket.timer=null;
          ticket.transfer.request(ticket.peerId,data).then(offered=>{if(this.transferRequestCurrent(ticket))this.nnk.modules.bridge.emit(offered||data.inventoryVerified===true&&!data.exts?.needsFiles?.length?'info':'error',{message:offered?'新的补传请求已发送，请客机确认本批文件。':data.inventoryVerified!==true?'本次文件摘要未完整核验，未发起补传。':!data.exts?.needsFiles?.length?'本次未发现需要传输的扩展；无需重复下载。':'当前批次未能重新提议，请检查文件事务状态后再试。'});}).catch(()=>{if(this.transferRequestCurrent(ticket))this.nnk.modules.bridge.emit('error',{message:'本次文件清单未能重新采集，请核对本机文件后重试。'});}).finally(()=>{if(this.transferRequest===ticket){this.clearTransferRequest(ticket);this.update();}});
        }
      }else this.transfer.autoOffer(data.peerId,data).catch(error=>this.nnk.modules.bridge.emit('error',{message:'补传提议未能完成：'+error.message}));
    }else if(name==='manifest_check'&&selected&&!['pending','verified'].includes(data.status)&&this.transferRequest===ticket)this.clearTransferRequest(ticket,data.reason||'本次体检未完成，未发起补传。',true);
    this.update();this.maybeAutoHealth();
  }
  assertSessionOpen(){if(this.stopped)throw Error('联机窗口已关闭');if(this.leaving)throw Error('正在退出原联机会话；回收完成前不能开始另一连接。');}
  endSession(reason='user-leave'){
    if(this.leavePromise)return this.leavePromise;
    const c=this.coordinator,r=c.round;
    if(!this.leaving&&(this.nativeSnapshot?.playing===true||this.engines.current?.status?.playing===true||['playing','settling','loading','returning'].includes(r?.phase)||c.next.committed||c.room.pending?.committed))return Promise.reject(Error('当前对局或已提交的载入尚未结束，请先完成对局并返回插件房间。'));
    this.leaving=true;if(this.transferRequest)this.clearTransferRequest(this.transferRequest);this.recovery.reset();this.manifest.dispose();c.dispose();this.update();
    const task=(async()=>{
      await this.transfer.dispose();await this.files?.dispose?.();await this.lobby.cancelAll();this.sessions.stopAll(reason);await c.retire(reason);
      if(this.stopped)throw Error('联机窗口已关闭');
      if(this.sessions.snapshot().length||this.engines.current)throw Error('原会话尚未完全回收，请重试退出。');
      this.profileOperations.clear();this.identities.clear();this.coordinator=this.newCoordinator(c.operationGeneration);++this.partyEpoch;this.installTransfer();this.installManifest();this.leaving=false;this.lobby.resetSession();
      this.nnk.modules.bridge.emit('cancelled',{scope:'session'});this.update();return {ended:true};
    })();
    this.leavePromise=task;task.finally(()=>{if(this.leavePromise===task)this.leavePromise=null;}).catch(()=>{});return task;
  }
  confirmProfile(value,requestId=crypto.randomUUID(),forceIdentity=false){
    if(this.stopped)return false;const before=JSON.stringify(this.coordinator.getLocalIdentity());
    if(value.config)this.profile.config=clone(value.config);
    if(value.identity)this.profile.identity={...this.profile.identity,...clone(value.identity)};
    if(forceIdentity||JSON.stringify(this.coordinator.getLocalIdentity())!==before)this.coordinator.localIdentityChanged(requestId);
    return true;
  }
  update(){
    if(!this.lobby||this.stopped)return;const lobby=this.lobby.snapshot(),c=this.coordinator.snapshot(),r=c.round;
    if(this.transferRequest&&!this.transferRequestCurrent(this.transferRequest))this.clearTransferRequest(this.transferRequest);
    const remote=lobby.role==='guest'&&this.sessions.isLive(this.coordinator.guestPeer)?c.remoteLobby:null;
    this.nnk.state.host={active:lobby.role==='host',invites:this.lobby.inviteMetadata()};this.nnk.state.guest={session:lobby.role==='guest'?{connected:this.sessions.snapshot().length>0}:null};
    const manifestState=this.manifest.readiness(),recoveryState=this.recovery.status(),transferState=this.transfer.snapshot();this.nnk.state.transferPaused=!transferState.available;
    const ownLobbyMember=remote?.members.find(m=>m.peerId===remote.selfPeerId);
    const phase=r?.failed?'error':lobby.role==='host'?(r?.phase==='loading'?'host_booting':lobby.lobbyOpen||this.sessions.hasEnteredConnections()?'room_open':'idle'):
      this.sessions.snapshot().length?(r?'connected':ownLobbyMember?.queued?'queued':'lobby_waiting'):this.lobby.joinAttempt?'joining':'idle';
    const roomCode=lobby.role==='guest'?remote?.roomCode??null:lobby.roomCode;
    this.nnk.modules.bridge.setPhase(phase,{roomCode,lobbyOpen:lobby.role==='guest'?roomCode!==null:lobby.lobbyOpen,stage:this.coordinator.room.ready()?'lobby':r?'loaded':'lobby',nextMode:lobby.role==='guest'?remote?.mode||lobby.nextMode:lobby.nextMode,roundPhase:r?.phase||null,round:r,continuation:this.sessions.hasEnteredConnections()?c:null,
      members:c.members,invites:this.lobby.inviteMetadata(),transferPaused:!transferState.available,transferProtocol:TRANSFER_PROTOCOL,transferAvailable:transferState.available,transferUnavailableReason:transferState.reason,transferScope:this.manifestScope(),transferBusy:transferState.busy||!!this.transferRequest,transferRequestPending:!!this.transferRequest,transferLimitSaving:!!this.transferLimitSaving,transferRequestBusy:transferState.requestBusy,transferPeers:transferState.peers.map(peerId=>({peerId,name:String(this.sessions.get(peerId)?.identity?.name||'').slice(0,12),...transferPeerDisplay(this.sessions.get(peerId),this.coordinator.role)})),transferParticipants:this.sessions.snapshot().filter(record=>this.sessions.isLive(record.peerId)).map(record=>({peerId:record.peerId,...transferPeerDisplay(record,this.coordinator.role),transferCapable:transferState.peers.includes(record.peerId),scope:this.manifestScope()})),batchProposals:transferState.proposals,fileBatches:transferState.files,manifestScope:this.manifestScope(),manifestAvailable:!this.leaving&&manifestState.available,manifestUnavailableReason:this.leaving?'正在退出原联机会话':manifestState.reason,
      manifestInventorySource:this.engines.current?'当前游戏配置与本机文件清单':'最近游戏配置快照与实时文件指纹；更改游戏内启用状态后需重新打开联机入口。',partyRecovery:recoveryState,

      keepaliveDiagnostics:{scope:'actual current process observations; finite samples',carrierPid:process.pid,carrierMemoryBytes:process.memoryUsage(),native:this.nativeSnapshot,
        transportIdentity:this.transportIdentity(),engine:this.engines.snapshot(),registryResources:this.sessions.resourceSnapshot(),lobbyResources:this.lobby.resourceSnapshot(),initialResources:this.connector.resourceSnapshot?.()||null}});
    this.onDisplay(r?.failed?r.error:r?.phase==='returning'?'正在返回插件房间…':r?.phase==='plugin-room'?'已返回插件房间，等待房主选择模式并载入':r?.phase==='loading'?'正在载入新的游戏窗口…':r?.phase==='playing'?'对局进行中':r?.phase==='waiting'?'游戏等待房已就绪':this.sessions.snapshot().length?'已连接，等待本局入座':'网络窗口已就绪');
  }
  async createInternetRoom(mode,signaling){this.assertSessionOpen();const before=this.coordinator;await this.recovery.maybeRecover();this.assertSessionOpen();if(this.coordinator!==before||before.closed)throw Error('原联机会话已结束，本次旧操作已取消');this.coordinator.setRole('host');return this.lobby.createInternetRoom(mode,signaling);}
  async restartRoom(mode){this.assertSessionOpen();const before=this.coordinator;await this.recovery.maybeRecover();this.assertSessionOpen();if(this.coordinator!==before||before.closed)throw Error('原联机会话已结束，本次旧操作已取消');const c=this.coordinator;c.assertFilesIdle();if(this.recovery.status().blocked)throw Error('旧局名单中仍有玩家在线，请保留原组或结束原会话后重新建房；新连接不会替换旧座位。');if(c.round?.failed&&c.next.lastPlan?.lease.roundId===c.round.roundId)throw Error('本次续局载入失败，须使用明确重试；不会自动重连');if(c.round&&['settled','settling','returning'].includes(c.round.phase))throw Error('请先在结算页点击“返回插件房间”');const result=await (c.round&&['plugin-room','preparing'].includes(c.round.phase)?c.prepareNext({mode:mode||this.lobby.nextMode}):c.start(mode||this.lobby.nextMode));this.update();return result;}
  async retryRound(){this.assertSessionOpen();const result=await this.coordinator.next.retry();this.update();return result;}
  setRoomMode(mode){this.assertSessionOpen();if(this.coordinator.role!=='host')throw Error('只有房主可以调整模式');return this.lobby.setRoomMode(mode);}
  refreshInvite(kind,id){this.assertSessionOpen();return this.lobby.refreshInvite(kind,id);}
  acceptAnswer(id,code){this.assertSessionOpen();return this.lobby.acceptAnswer(id,code);}
  async joinByRoomCode(code){this.assertSessionOpen();const before=this.coordinator;await this.recovery.maybeRecover();this.assertSessionOpen();if(this.coordinator!==before||before.closed)throw Error('原联机会话已结束，本次旧操作已取消');this.coordinator.setRole('guest');return this.lobby.joinByRoomCode(code);}
  async joinByInvite(code){this.assertSessionOpen();const before=this.coordinator;await this.recovery.maybeRecover();this.assertSessionOpen();if(this.coordinator!==before||before.closed)throw Error('原联机会话已结束，本次旧操作已取消');this.coordinator.setRole('guest');return this.lobby.joinByInvite(code);}
  cancelAll(){return this.endSession('user-leave');}
  cancelJoin(){return this.lobby.cancelJoin();}
  async dispatch(cmd){
    const a=cmd.args||{};if(cmd.action!=='cancel')this.assertSessionOpen();
    if(cmd.action==='batch_request')return this.requestTransfer(a);
    if(cmd.action==='manifest_recheck')return this.manifest.recheck(a);
    const actions={create_room:()=>this.createInternetRoom(a.mode,a.signaling),restart_room:()=>this.restartRoom(a.mode),return_plugin_room:()=>this.coordinator.returnToPluginRoom(a),next_round:()=>this.coordinator.prepareNext(a),retry_round:()=>this.retryRound(),set_mode:()=>this.setRoomMode(a.mode),join_room:()=>this.joinByRoomCode(a.code),join_invite:()=>this.joinByInvite(a.code),invite_refresh:()=>this.refreshInvite(a.kind,a.id),accept_answer:()=>this.acceptAnswer(a.id,a.code),cancel:()=>this.cancelAll()};
    if(actions[cmd.action])return await actions[cmd.action]();
    if(cmd.action==='batch_decision'){if(!this.transfer.decide(a))throw Error('本次补传提议或授权已失效');return {accepted:true};}
    if(cmd.action==='batch_cancel'){if(!await this.transfer.cancel(a))throw Error('当前批次已提交或正在恢复，不能撤销文件更新');return {cancelled:true};}
    if(cmd.action==='batch_retry'){if(!await this.transfer.retry(a))throw Error('当前批次不能重试；如已提交请启用并重启');return {requested:true};}
    if(cmd.action==='transfer_pack')throw Error('缺包体检后会自动发起整批提议，请客机确认当前批次。');
    if(cmd.action==='batch_reload')throw Error('请按补传结果提示完全退出并重启无名杀；Ctrl+R不能代替重启。');
    if(cmd.action==='set_config'&&a.key==='transferLimitMB'){
      if(!a||typeof a!=='object'||Array.isArray(a)||![Object.prototype,null].includes(Object.getPrototypeOf(a))||Object.keys(a).length!==2||!Object.hasOwn(a,'key')||!Object.hasOwn(a,'value')||!validTransferLimit(a.value))throw Error('补传容量须为 1 至 1024 MiB 的整数');
      this.assertTransferLimitIdle();if(!this.engines.current)return this.saveRoomTransferLimit(a);
    }
    if(['set_config','set_identity','clear_quarantine'].includes(cmd.action)){
      const binding=this.engines.current;if(this.stopped||!binding)throw Error('当前没有可操作的游戏文档；请先载入到游戏。');
      if(this.profileOperations.size>=8||this.profileOperationSequence>=1000000000)throw Error('当前配置操作已达上限，请等待现有操作完成。');
      const operation={sequence:++this.profileOperationSequence,requestId:crypto.randomUUID(),binding,scope:{...binding.scope}};this.profileOperations.set(operation.sequence,operation);
      try{
        const result=await this.engines.operation(cmd.action,a,binding);
        if(this.stopped||this.engines.current!==binding||binding.closed===true||Object.keys(operation.scope).some(k=>binding.scope?.[k]!==operation.scope[k]))throw Error('原配置操作的游戏文档已退休，未提交旧身份回调。');
        if(result?.profile&&operation.sequence>this.profileConfirmedSequence){
          this.profileConfirmedSequence=operation.sequence;this.confirmProfile(result.profile,operation.requestId,cmd.action==='set_identity');
          if(cmd.action==='set_identity'){const applied=this.coordinator.getLocalIdentity();this.nnk.modules.bridge.emit('identity_applied',{...applied,avatarLabel:applied.avatar,profile:result.profile,requestId:operation.requestId});}
          if(cmd.action==='set_config')this.nnk.modules.bridge.emit('config_applied',{key:a.key,value:result.profile.config?.[a.key],profile:result.profile,requestId:operation.requestId});
        }
        return result;
      }finally{this.profileOperations.delete(operation.sequence);}
    }
    throw Error('未知命令：'+cmd.action);
  }
  transportIdentity(){return this.sessions.snapshot().map(record=>{
    const now=this.sessions.getOwner(record.peerId).actualIdentity(),before=this.identities.get(record.peerId);
    return {peerId:record.peerId,sessionId:record.connectionSessionId,samePC:now.pc===before?.pc.deref(),sameLink:now.link===before?.link.deref(),samePing:now.ping===before?.ping.deref(),snapshot:this.sessions.getOwner(record.peerId).snapshot()};});}
  snapshot(){return {coordinator:this.coordinator.snapshot(),sessions:this.sessions.snapshot(),engine:this.engines.snapshot(),transportIdentity:this.transportIdentity(),resources:{registry:this.sessions.resourceSnapshot(),lobby:this.lobby.resourceSnapshot(),initial:this.connector.resourceSnapshot?.()||null},events:this.events.slice()};}
  dispose(){this.stopped=true;if(this.transferRequest)this.clearTransferRequest(this.transferRequest);this.recovery.dispose();this.manifest.dispose();this.transfer.dispose().then(()=>this.files?.dispose?.()).catch(()=>{});this.profileOperations.clear();clearInterval(this.nativePollTimer);this.nativePollTimer=null;this.coordinator.dispose();this.engines.dispose();this.nnk.modules.bridge.stop('carrier retired');this.identities.clear();}
}

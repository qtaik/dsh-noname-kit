import {RoundSettlement} from './round-settlement.js';
import {RoundContinuation} from './round-continuation.js';
import {PluginRoom,ROOM_TYPES} from './plugin-room.js';
import {sameScope} from './engine-binding.js';
import {projectLobbyMembers} from './lobby-owner.js';
import {transferPeerDisplay} from './transfer-display.js';
const MODES=['identity','guozhan','versus','doudizhu','single'];
const INITIAL_PHASES=['loading','awaiting-bind','seating','waiting'];
const leaseKeys=['partySessionId','roundId','operationId'];
const same=(a,b)=>!!a&&!!b&&leaseKeys.every(k=>a[k]===b[k]);
const initialFailure=r=>r?.failed===true&&INITIAL_PHASES.includes(r.failedPhase)&&!r.continuationPeers;
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const identity=x=>!!x&&typeof x.name==='string'&&x.name.length<=12&&typeof x.avatar==='string'&&x.avatar.length<=24;
const exactIdentity=x=>identity(x)&&!Array.isArray(x)&&Object.keys(x).length===2&&Object.hasOwn(x,'name')&&Object.hasOwn(x,'avatar');
const IDENTITY_TYPES=new Set(['identity-update','identity-updated']),MAX_IDENTITY_REVISION=1000000000;
const seatList=x=>Array.isArray(x)&&x.length>0&&x.length<=64&&x.every(id)&&new Set(x).size===x.length;
const guestProof=(p,generation)=>!!p&&id(p.guestOnlineID)&&p.guestInitComplete===true&&seatList(p.guestSeatIds)&&p.guestSeatIds.includes(p.guestOnlineID)&&p.guestDocumentGeneration===generation&&p.wireSequence==='in:opened,out:init,in:init,out:inited';
const fullProof=(p,r,guestGeneration)=>!!p&&p.hostClientInited===true&&p.guestInited===true&&p.ordered===true&&p.seated===true&&p.roundId===r.roundId&&id(p.hostClientId)&&p.hostClientId===p.guestOnlineID&&seatList(p.hostSeats)&&seatList(p.guestSeats)&&p.hostSeats.includes(p.hostClientId)&&JSON.stringify([...p.hostSeats].sort())===JSON.stringify([...p.guestSeats].sort())&&Number.isSafeInteger(p.hostDocumentGeneration)&&p.hostDocumentGeneration>0&&p.guestDocumentGeneration===guestGeneration;
const seats=s=>(s?.seats||[]).filter(x=>x.playerid&&!x.unselectable).map(x=>x.playerid).sort();
const engineScope=(s,r,g)=>!!s&&Object.keys(s).length===6&&s.sessionId===r.partySessionId&&s.roundId===r.roundId&&s.documentGeneration===g&&['bindingId','bindingNonce','expectedOrigin'].every(k=>id(s[k]));
const signature=(s,p)=>{
  if(Array.isArray(s?.peerProofs)){
    const proof=s.peerProofs.find(x=>x.peerId===p);return proof&&proof.handshakeOrderInvalid===false&&typeof proof.handshakeOrder==='string'?proof.handshakeOrder:'';
  }
  return (s?.wire||[]).filter(x=>(!x.peerId||x.peerId===p)&&['opened','init','inited'].includes(x.tag)).map(x=>x.direction+':'+x.tag).join(',');
};
export class InitialPartyCoordinator {
  constructor({sessions,engines,onEvent=()=>{},onState=()=>{},getLobbyState=()=>({roomCode:null}),getLocalIdentity=()=>({name:'',avatar:''}),onIdentity=()=>{}}){
    Object.assign(this,{sessions,engines,onEvent,onState,getLobbyState,getLocalIdentity,onIdentity});this.role=null;this.round=null;this.operationGeneration=0;this.guestPeer=null;this.members=new Map();this.supportedPeers=new Set();this.capabilityTimers=new Map();this.requestTimer=null;this.closed=false;
    this.settlement=new RoundSettlement(this);this.room=new PluginRoom(this);this.next=new RoundContinuation(this);this.continuationCapable=new Set();this.roomCapable=new Set();
    this.identityRevision=0;this.identityVersions=new Map();this.identityPending=null;this.identityAcknowledged=0;
    this.guestApproval=null;this.guestApprovalSequence=0;this.guestRoundIds=new Set();this.guestOperationIds=new Set();
    this.guestApprovalOwners=new WeakMap();
  }
  live(round){return !!round&&!this.closed&&this.round===round&&!round.failed;}
  assert(round){if(!this.live(round))throw Error('旧局次操作已失效');if(round.continuationPeers?.some(peer=>!this.sessions.isLive(peer)))throw Error('原参加玩家的实际连接已终止，不能继续本次局次');}
  setRole(role){if(this.role&&this.role!==role)throw Error('当前保活连接不支持切换主客身份');this.role=role;}
  envelope(round,extra={}){return {protocol:'nnk-round/1',partySessionId:round?.partySessionId??null,roundId:round?.roundId??null,operationId:round?.operationId??null,requestId:crypto.randomUUID(),...extra};}
  send(peer,type,round,extra={}){if(this.closed)throw Error('原联机会话已结束');return this.sessions.sendControl(peer,type,this.envelope(round,extra));}
  clearIdentityPending(){if(this.identityPending)clearTimeout(this.identityPending.timer);this.identityPending=null;}
  localIdentityChanged(requestId=crypto.randomUUID()){
    if(this.closed||!id(requestId))throw Error('Current identity update request required');
    const value=this.getLocalIdentity();if(!exactIdentity(value))throw Error('Current bounded local identity required');
    if(this.role==='host'){this.onIdentity(null);return;}
    const peer=this.guestPeer,owner=this.sessions.getOwner(peer),record=this.sessions.get(peer);
    if(this.role!=='guest'||!owner||!record||!this.sessions.isLive(peer)||!this.supportedPeers.has(peer))return;
    if(this.identityRevision>=MAX_IDENTITY_REVISION)throw Error('Identity update revision limit reached');
    this.clearIdentityPending();const pending={peer,owner,connectionSessionId:record.connectionSessionId,revision:++this.identityRevision,requestId,identity:{...value},afterHostSequence:owner.snapshot().lastAcceptedControlSeq,timer:null};this.identityPending=pending;
    pending.timer=setTimeout(()=>{if(this.identityPending!==pending)return;this.clearIdentityPending();this.onEvent('error',{message:'身份已保存在当前游戏，但房主尚未确认本次身份更新；原连接保持。',identityRevision:pending.revision});},10000);
    try{return this.sessions.sendControl(peer,'identity-update',this.envelope(null,{protocol:'nnk-identity/1',requestId,connectionSessionId:pending.connectionSessionId,revision:pending.revision,identity:pending.identity}));}
    catch(error){if(this.identityPending===pending)this.clearIdentityPending();throw error;}
  }
  validateIdentity(owner,frame){
    const peer=this.sessions.peerForActualOwner(owner),d=frame.data,record=peer&&this.sessions.get(peer);
    if(!d||typeof d!=='object'||Array.isArray(d))return false;
    if(this.closed||!peer||this.sessions.getOwner(peer)!==owner||!record||!this.sessions.isLive(peer)||!this.supportedPeers.has(peer)||owner.role!==this.role||frame.sessionId!==record.connectionSessionId||!Number.isSafeInteger(frame.seq)||frame.seq<1||d.protocol!=='nnk-identity/1'||!id(d.requestId)||!leaseKeys.every(k=>d[k]===null)||d.connectionSessionId!==record.connectionSessionId||!Number.isSafeInteger(d.revision)||d.revision<1||d.revision>MAX_IDENTITY_REVISION||!exactIdentity(d.identity))return false;
    const allowed=['protocol',...leaseKeys,'requestId','connectionSessionId','revision','identity',...(frame.type==='identity-updated'?['updateRequestId']:[])];if(Object.keys(d).some(k=>!allowed.includes(k)))return false;
    if(frame.type==='identity-update'){const previous=this.identityVersions.get(peer);return this.role==='host'&&frame.sourcePeer==='guest'&&(!previous||d.revision>previous.revision&&frame.seq>previous.sequence&&d.requestId!==previous.requestId);}
    const pending=this.identityPending;return this.role==='guest'&&frame.sourcePeer==='host'&&peer===this.guestPeer&&!!pending&&pending.owner===owner&&pending.peer===peer&&pending.connectionSessionId===d.connectionSessionId&&pending.requestId===d.updateRequestId&&pending.revision===d.revision&&frame.seq>pending.afterHostSequence&&pending.identity.name===d.identity.name&&pending.identity.avatar===d.identity.avatar;
  }
  validate(owner,frame){
    if(this.closed)return 'retired-party';
    if(IDENTITY_TYPES.has(frame.type))return this.validateIdentity(owner,frame);
    const roomVerdict=this.room.validate(owner,frame);if(roomVerdict!==null)return roomVerdict;
    const nextVerdict=this.next.validate(owner,frame);if(nextVerdict!==null)return nextVerdict;
    const verdict=this.settlement.validate(owner,frame);if(verdict!==null)return verdict;
    const peer=this.sessions.peerForActualOwner(owner),d=frame.data,r=this.round,m=this.members.get(peer);
    if(!peer||!this.sessions.isLive(peer)||d.protocol!=='nnk-round/1'||!id(d.requestId))return 'unregistered-or-invalid-round-control';
    if(['party-request','lobby-state'].includes(frame.type)&&d.roundCapabilities!==undefined&&(!Array.isArray(d.roundCapabilities)||d.roundCapabilities.length>8||!d.roundCapabilities.every(id)||new Set(d.roundCapabilities).size!==d.roundCapabilities.length))return 'invalid-round-capabilities';
    if(frame.type==='party-request')return this.role==='host'&&!this.sessions.wasEverEntered(peer)&&d.partySessionId===null&&d.roundId===null&&d.operationId===null&&identity(d.identity);
    if(frame.type==='lobby-state')return this.role==='guest'&&peer===this.guestPeer&&leaseKeys.every(k=>d[k]===null)&&(d.roomCode===null||typeof d.roomCode==='string'&&/^[A-HJ-NP-Z2-9]{6}$/.test(d.roomCode))&&identity(d.hostIdentity)&&MODES.includes(d.mode)&&(d.nextMode===undefined||MODES.includes(d.nextMode))&&(d.caps===undefined||d.caps&&MODES.every(mode=>Number.isSafeInteger(d.caps[mode])&&d.caps[mode]>=2&&d.caps[mode]<=64))&&(d.capacity===null||Number.isSafeInteger(d.capacity)&&d.capacity>=2&&d.capacity<=64)&&Array.isArray(d.members)&&d.members.length<=64&&d.members.every(m=>m&&id(m.peerId)&&typeof m.name==='string'&&m.name.length<=12&&['host','guest'].includes(m.role)&&typeof m.entered==='boolean'&&typeof m.queued==='boolean')&&(d.targetPeerId===undefined||id(d.targetPeerId)&&d.members.some(m=>m.peerId===d.targetPeerId&&m.role==='guest'));
    if(frame.type==='party-accepted'){
      if(!(this.role==='guest'&&peer===this.guestPeer&&this.sessions.getOwner(peer)===owner&&this.supportedPeers.has(peer)&&leaseKeys.every(k=>id(d[k]))&&id(d.targetPeerId)&&Number.isSafeInteger(d.slot)&&d.slot>=1&&MODES.includes(d.mode)))return false;
      if(!r)return !this.guestRoundIds.has(d.roundId)&&!this.guestOperationIds.has(d.operationId);
      if(same(r,d))return this.live(r)&&INITIAL_PHASES.includes(r.phase)&&d.targetPeerId===r.remotePeerToken&&d.mode===r.mode&&d.slot===r.slot;
      const pending=this.guestApproval;
      if(pending)return this.pendingGuestApproval(pending,owner,d)&&!pending.cancelled&&d.targetPeerId===pending.data.targetPeerId&&d.mode===pending.data.mode&&d.slot===pending.data.slot;
      return this.freshGuestApproval(owner,frame,r);
    }
    if(frame.type==='operation-failed'&&(this.pendingGuestApproval(this.guestApproval,owner,d)||this.next.pendingGuestLoad(owner,d)))return typeof d.error==='string'&&d.error.length>0&&d.error.length<=2000;
    if(!r||!same(r,d)||!this.live(r))return 'wrong-current-round-operation';
    if(frame.type==='operation-failed')return typeof d.error==='string'&&d.error.length>0&&d.error.length<=2000&&((this.role==='host'&&(!!m||r.continuationPeers?.includes(peer)))||(this.role==='guest'&&peer===this.guestPeer));
    if(frame.type==='document-ready')return this.role==='host'&&!!m&&['accepted','awaiting-bind-ready','seating'].includes(m.phase)&&d.targetPeerId===peer&&Number.isSafeInteger(d.documentGeneration)&&d.documentGeneration>0&&(!d.engineScope||engineScope(d.engineScope,r,d.documentGeneration))&&(!m.engineScope||sameScope(d.engineScope,m.engineScope));
    if(frame.type==='bind-round')return this.role==='guest'&&peer===this.guestPeer&&['awaiting-bind','seating'].includes(r.phase)&&d.targetPeerId===r.remotePeerToken&&d.guestDocumentGeneration===this.engines.current?.scope?.documentGeneration&&Number.isSafeInteger(d.hostDocumentGeneration)&&d.hostDocumentGeneration>0;
    if(frame.type==='bind-ready')return this.role==='host'&&!!m&&['awaiting-bind-ready','seating'].includes(m.phase)&&d.targetPeerId===peer&&d.hostDocumentGeneration===this.engines.current?.scope?.documentGeneration&&d.guestDocumentGeneration===m.documentGeneration;
    if(frame.type==='seating-ready')return this.role==='host'&&!!m&&m.phase==='seating'&&d.documentGeneration===m.documentGeneration&&guestProof(d.proof,m.documentGeneration);
    if(frame.type==='seating-recheck')return this.role==='guest'&&peer===this.guestPeer&&r.phase==='seating'&&d.reason==='seat-list-changed'&&d.guestDocumentGeneration===this.engines.current?.scope?.documentGeneration&&d.hostDocumentGeneration===r.hostDocumentGeneration;
    if(frame.type==='seating-confirmed')return this.role==='guest'&&peer===this.guestPeer&&['seating','waiting'].includes(r.phase)&&d.guestDocumentGeneration===this.engines.current?.scope?.documentGeneration&&fullProof(d.proof,r,d.guestDocumentGeneration)&&d.proof.hostDocumentGeneration===r.hostDocumentGeneration;
    return 'unknown-or-out-of-phase-round-control';
  }
  async onRegistered(record){
    const peer=record.peerId;
    if(this.role==='host'){
      const timer=setTimeout(()=>{this.capabilityTimers.delete(peer);if(!this.supportedPeers.has(peer)&&this.sessions.isLive(peer)){this.onEvent('error',{message:'对端未确认本局控制协议，本次连接不支持保活续局。',peerId:peer});this.sessions.getOwner(peer).stopTransport('round-protocol-not-supported');}},10000);this.capabilityTimers.set(peer,timer);
      this.publishLobby(peer);await this.promote();
    }else{
      if(this.guestPeer&&this.guestPeer!==peer)throw Error('Guest already has an actual Host connection');this.guestPeer=peer;
      let attempts=0;if(this.requestTimer!==null)clearInterval(this.requestTimer);
      const request=()=>{if(this.round||!this.sessions.isLive(peer)){clearInterval(this.requestTimer);this.requestTimer=null;return;}
        if(++attempts>20){clearInterval(this.requestTimer);this.requestTimer=null;if(!this.supportedPeers.has(peer)){this.onEvent('error',{message:'对端未确认本局控制协议，本次连接不支持保活续局。'});this.sessions.getOwner(peer).stopTransport('round-protocol-not-supported');}else this.onEvent('info',{message:'网络已连接，房主尚未选择本次入座；可留在大厅等待。'});return;}this.send(peer,'party-request',null,{identity:this.getLocalIdentity(),roundCapabilities:['nnk-settle/1','nnk-next/1','nnk-room/1',...(this.lobbyManifest?['nnk-lobby-manifest/1']:[]),...(this.lobbyTransfer?['nnk-transfer/2']:[])]});};
      request();this.requestTimer=setInterval(request,500);
    }
    this.publishState();
  }
  publishLobby(peer){
    const lobby=this.getLobbyState(),hostIdentity=this.getLocalIdentity(),mode=this.room.available()?lobby.roomMode||this.round.mode:this.round?.mode||lobby.roomMode||'identity';
    const view=lobby.memberState||projectLobbyMembers({mode,nextMode:lobby.roomMode||mode,hostIdentity,hostEntered:(this.engines.current?.status?.seats||[]).some(seat=>seat.playerid==='1'&&!seat.unselectable),records:this.sessions.snapshot(),capacity:this.engines.current?.status?.capacity||this.room.receipt?.plans[mode]?.capacity,selectedPeers:this.round?(this.room.available()?this.room.receipt.peers:[...this.members.keys()]):null,roomCode:lobby.roomCode??null});
    this.send(peer,'lobby-state',null,{roomCode:view.roomCode,hostIdentity,roundCapabilities:['nnk-settle/1','nnk-next/1','nnk-room/1',...(this.lobbyManifest?['nnk-lobby-manifest/1']:[]),...(this.lobbyTransfer?['nnk-transfer/2']:[])],targetPeerId:peer,mode:view.mode,nextMode:view.nextMode,members:view.list,capacity:view.capacity,caps:view.caps});
  }
  assertFilesIdle(){if(this.lobbyTransfer&&!this.lobbyTransfer.canStart())throw Error('请先完成或取消当前补传；文件更新后须重启游戏再载入。');}
  freshGuestApproval(owner,frame,r){const d=frame.data;return initialFailure(r)&&this.guestApprovalOwners.get(r)===owner&&d.partySessionId===r.partySessionId&&d.targetPeerId===r.remotePeerToken&&d.roundId!==r.roundId&&d.operationId!==r.operationId&&!this.guestRoundIds.has(d.roundId)&&!this.guestOperationIds.has(d.operationId)&&Number.isSafeInteger(frame.seq)&&frame.seq>this.guestApprovalSequence;}
  pendingGuestApproval(pending,owner,data){return !!pending&&this.guestApproval===pending&&this.round===pending.old&&pending.owner===owner&&this.guestPeer===pending.peer&&this.sessions.getOwner(pending.peer)===owner&&this.sessions.isLive(pending.peer)&&same(pending.data,data);}
  rememberGuestApproval(frame){this.guestRoundIds.add(frame.data.roundId);this.guestOperationIds.add(frame.data.operationId);this.guestApprovalSequence=Math.max(this.guestApprovalSequence,frame.seq||0);}
  async openGuestApproval(peer,owner,frame){
    const d=frame.data,r={...Object.fromEntries(leaseKeys.map(k=>[k,d[k]])),operationGeneration:++this.operationGeneration,role:'guest',mode:d.mode,remotePeerToken:d.targetPeerId,slot:d.slot,phase:'loading',failed:false};
    this.guestApprovalOwners.set(r,owner);this.round=r;
    if(this.requestTimer!==null)clearInterval(this.requestTimer);this.requestTimer=null;this.sessions.bindEnrollment(peer,r);this.publishState();
    // Bind the approved identity before any file gate or engine work can fail.
    this.assertFilesIdle();
    const b=await this.engines.create(r);this.assert(r);await this.engines.command('approve-peer',{peerId:peer},b);this.assert(r);r.phase='awaiting-bind';
    this.send(peer,'document-ready',r,{targetPeerId:r.remotePeerToken,documentGeneration:b.scope.documentGeneration,engineScope:b.scope});this.publishState();return r;
  }
  async retryGuestApproval(pending){
    try{
      if(this.cleanupPromise)await this.cleanupPromise;
      if(this.closed||!this.pendingGuestApproval(pending,pending.owner,pending.data)||pending.cancelled)return;
      const old=pending.old,result=old.cleanupResult;
      if(!old.cleanupComplete||old.cleanupError||this.engines.current||old.cleanupHadEngine&&!result?.confirmation?.confirmed)throw Error('旧局原生引擎回收未确认，不能重新载入'+(old.cleanupError?'：'+old.cleanupError:''));
      await this.openGuestApproval(pending.peer,pending.owner,pending.frame);
    }catch(error){
      if(this.closed||this.guestApproval!==pending||pending.cancelled)return;
      const r=this.round;
      if(r!==pending.old&&same(r,pending.data)){if(this.live(r))this.fail(r,error);return;}
      if(!this.pendingGuestApproval(pending,pending.owner,pending.data))return;
      const message=error?.message||String(error);this.onEvent('error',{message,...Object.fromEntries(leaseKeys.map(k=>[k,pending.data[k]]))});
      try{this.send(pending.peer,'operation-failed',pending.data,{error:String(message).slice(0,2000)});}catch(sendError){this.onEvent('operation-failure-notice-error',{error:String(sendError)});}
    }finally{if(this.guestApproval===pending)this.guestApproval=null;}
  }
  async start(mode='identity'){
    this.assertFilesIdle();
    this.setRole('host');if(!MODES.includes(mode))throw Error('不支持的模式：'+mode);
    if(this.round&&!this.round.failed){if(this.round.phase==='waiting')return this.round;throw Error('当前对局尚未结束，不能载入新局');}
    if(this.round?.failed&&!initialFailure(this.round))throw Error('本局已中断；续局须使用既有明确重试，其他情况请结束原会话后重新建房');
    if(this.cleanupPromise)await this.cleanupPromise;
    if(this.engines.current)await this.retire('initial operation retry');this.assertFilesIdle();
    const r={partySessionId:this.round?.partySessionId||crypto.randomUUID(),roundId:crypto.randomUUID(),operationId:crypto.randomUUID(),operationGeneration:++this.operationGeneration,role:'host',mode,phase:'loading',failed:false};this.round=r;this.members.clear();this.publishState();
    try{
      const b=await this.engines.create(r);this.assert(r);await this.engines.command('prepare-host',{mode},b);this.assert(r);
      await this.engines.wait(b,()=>b.status?.waiting&&Number.isSafeInteger(b.status.capacity)&&b.status.capacity>=2,'实际原生等待房');this.assert(r);
      r.capacity=b.status.capacity;r.phase='waiting';await this.promote();this.assert(r);this.publishState();return r;
    }catch(error){this.fail(r,error);throw error;}
  }
  async promote(){
    const r=this.round;if(this.role!=='host'||!this.live(r)||!['waiting','seating'].includes(r.phase)||!this.engines.current?.status?.waiting)return;
    if(this.promoteOperation?.round===r)return this.promoteOperation.promise;
    const operation={round:r,promise:null};this.promoteOperation=operation;
    operation.promise=this.promoteCurrent(r).catch(error=>{this.fail(r,error);throw error;}).finally(()=>{if(this.promoteOperation===operation)this.promoteOperation=null;});
    return operation.promise;
  }
  async promoteCurrent(r){
    const b=this.engines.current;
    for(const record of this.sessions.snapshot().sort((a,b)=>a.joinOrdinal-b.joinOrdinal)){
      this.assert(r);if(!['waiting','seating'].includes(r.phase)||this.engines.current!==b||!b.status?.waiting)break;
      if(r.continuationPeers&&!r.continuationPeers.includes(record.peerId))continue;
      if(!this.sessions.isLive(record.peerId)||!this.supportedPeers.has(record.peerId)||this.members.has(record.peerId)||this.members.size>=r.capacity-1)continue;
      const reservation=await this.engines.command('reserve-start-peer',{peerId:record.peerId},b);this.assert(r);
      if(reservation?.reserved!==true){if(reservation?.reason==='native-game-started')break;throw Error('当前原生等待房未确认玩家名额');}
      if(!this.sessions.isLive(record.peerId)){
        await this.engines.command('release-start-peer',{peerId:record.peerId},b);this.assert(r);continue;
      }
      const m={peerId:record.peerId,phase:'accepted',slot:this.members.size+1,documentGeneration:null,proof:null,timer:null};this.members.set(record.peerId,m);this.sessions.bindEnrollment(record.peerId,r);
      m.timer=setTimeout(()=>{if(this.live(r)&&m.phase!=='entered')this.fail(r,Error('玩家新文档或入座确认超时'));},30000);
      this.send(record.peerId,'party-accepted',r,{targetPeerId:record.peerId,slot:m.slot,mode:r.mode});
    }
    for(const record of this.sessions.snapshot())this.publishLobby(record.peerId);this.publishState();
  }
  async control(owner,frame){
    if(this.closed)return false;
    if(IDENTITY_TYPES.has(frame.type)){
      if(this.validateIdentity(owner,frame)!==true)return false;
      const peer=this.sessions.peerForActualOwner(owner),d=frame.data;
      if(frame.type==='identity-update'){
        this.identityVersions.set(peer,{revision:d.revision,sequence:frame.seq,requestId:d.requestId});this.sessions.setIdentity(peer,owner,d.identity);this.onIdentity(peer);
        this.send(peer,'identity-updated',null,{protocol:'nnk-identity/1',updateRequestId:d.requestId,connectionSessionId:d.connectionSessionId,revision:d.revision,identity:{...d.identity}});
      }else{this.identityAcknowledged=d.revision;this.clearIdentityPending();this.onEvent('identity-synchronized',{revision:d.revision,requestId:d.updateRequestId});}
      return true;
    }
    if(ROOM_TYPES.has(frame.type))return this.room.control(owner,frame);
    if(['next-proposal','next-prepare','next-ready','next-commit','next-cancel','next-retry'].includes(frame.type))return this.next.control(owner,frame);
    if(['settle-fence','settle-ack','round-settled'].includes(frame.type))return this.settlement.control(owner,frame);
    const peer=this.sessions.peerForActualOwner(owner),d=frame.data;let r=this.round;
    if(frame.type==='party-request'){this.supportedPeers.add(peer);this.lobbyManifest?.setPeerCapability(peer,d.roundCapabilities?.includes('nnk-lobby-manifest/1')===true);this.lobbyTransfer?.setPeerCapability(peer,d.roundCapabilities?.includes('nnk-transfer/2')===true);if(d.roundCapabilities?.includes('nnk-settle/1')&&d.roundCapabilities.includes('nnk-next/1'))this.continuationCapable.add(peer);if(d.roundCapabilities?.includes('nnk-room/1'))this.roomCapable.add(peer);clearTimeout(this.capabilityTimers.get(peer));this.capabilityTimers.delete(peer);this.sessions.setIdentity(peer,owner,d.identity);this.onIdentity(peer);this.publishLobby(peer);const m=this.members.get(peer);if(m&&r)this.send(peer,'party-accepted',r,{targetPeerId:peer,slot:m.slot,mode:r.mode});else await this.promote();return;}
    if(frame.type==='lobby-state'){this.supportedPeers.add(peer);this.lobbyManifest?.setPeerCapability(peer,d.roundCapabilities?.includes('nnk-lobby-manifest/1')===true);this.lobbyTransfer?.setPeerCapability(peer,d.roundCapabilities?.includes('nnk-transfer/2')===true);if(d.roundCapabilities?.includes('nnk-settle/1')&&d.roundCapabilities.includes('nnk-next/1'))this.continuationCapable.add(peer);if(d.roundCapabilities?.includes('nnk-room/1'))this.roomCapable.add(peer);this.sessions.setIdentity(peer,owner,d.hostIdentity);const capacity=d.capacity??projectLobbyMembers({mode:d.mode}).capacity;this.remoteLobby={roomCode:d.roomCode,mode:d.mode,nextMode:d.nextMode||d.mode,members:d.members,capacity,caps:d.caps,selfPeerId:d.targetPeerId||null};this.onIdentity(peer);this.onEvent('room_members',{list:d.members,mode:d.mode,nextMode:d.nextMode||d.mode,capacity,caps:d.caps,roomCode:d.roomCode,lobbyOpen:d.roomCode!==null});this.publishState();return;}
    if(frame.type==='party-accepted'){
      if(this.validate(owner,frame)!==true)return false;
      if(r&&same(r,d)){this.assertFilesIdle();if(this.engines.current?.status?.environmentProofReady&&['awaiting-bind','seating','waiting'].includes(r.phase))this.send(peer,'document-ready',r,{targetPeerId:r.remotePeerToken,documentGeneration:this.engines.current.scope.documentGeneration,engineScope:this.engines.current.scope});return;}
      if(this.guestApproval)return this.guestApproval.promise;
      this.rememberGuestApproval(frame);
      if(!r)return this.openGuestApproval(peer,owner,frame);
      // Reserve before awaiting cleanup: duplicate approvals share this task.
      const pending={old:r,owner,peer,data:{...d},frame,cancelled:false,promise:null};this.guestApproval=pending;
      pending.promise=this.retryGuestApproval(pending);return pending.promise;
    }
    if(frame.type==='operation-failed'&&this.pendingGuestApproval(this.guestApproval,owner,d)){
      this.guestApproval.cancelled=true;this.guestApproval=null;this.onEvent('error',{message:d.error,...Object.fromEntries(leaseKeys.map(k=>[k,d[k]]))});return;
    }
    if(frame.type==='operation-failed'&&this.next.pendingGuestLoad(owner,d)){if(this.validate(owner,frame)!==true)return false;this.next.failGuestLoad(owner,d);return;}
    this.assert(r);
    if(frame.type==='operation-failed'){
      const message=this.role==='host'?transferPeerDisplay(this.sessions.get(peer),'host').peerLabel+(INITIAL_PHASES.includes(r.phase)?'载入未完成：':'本局已中断：')+d.error:d.error;
      this.fail(r,Error(message));return;
    }
    if(frame.type==='document-ready'){
      const m=this.members.get(peer),b=this.engines.current;
      if(m.documentGeneration!==null){if(m.documentGeneration!==d.documentGeneration)throw Error('同一入座操作的文档世代变化');this.sendBind(m,r,b);return;}
      m.documentGeneration=d.documentGeneration;m.engineScope=d.engineScope?Object.freeze({...d.engineScope}):null;m.phase='binding';await this.engines.command('approve-peer',{peerId:peer},b);this.assert(r);
      owner.attachEngine({roundId:r.roundId,documentGeneration:b.scope.documentGeneration},{remoteDocumentGeneration:m.documentGeneration});m.phase='awaiting-bind-ready';this.sendBind(m,r,b);return;
    }
    if(frame.type==='bind-round'){
      const b=this.engines.current;
      if(r.phase==='seating'){this.send(peer,'bind-ready',r,{targetPeerId:r.remotePeerToken,hostDocumentGeneration:r.hostDocumentGeneration,guestDocumentGeneration:b.scope.documentGeneration});return;}
      owner.attachEngine({roundId:r.roundId,documentGeneration:b.scope.documentGeneration},{remoteDocumentGeneration:d.hostDocumentGeneration});r.hostDocumentGeneration=d.hostDocumentGeneration;r.phase='seating';
      await this.engines.command('prepare-guest',{peerId:peer},b);this.assert(r);this.send(peer,'bind-ready',r,{targetPeerId:r.remotePeerToken,hostDocumentGeneration:d.hostDocumentGeneration,guestDocumentGeneration:b.scope.documentGeneration});this.status(b,b.status);return;
    }
    if(frame.type==='bind-ready'){
      const m=this.members.get(peer);if(m.phase==='seating')return;m.phase='seating';await this.engines.command('admit',{peerId:peer},this.engines.current);this.assert(r);this.publishState();return;
    }
    if(frame.type==='seating-ready'){this.members.get(peer).proof=d.proof;this.trySeat(peer);return;}
    if(frame.type==='seating-recheck'){r.sentGuestProof=null;const b=this.engines.current;this.status(b,b.status);return;}
    if(frame.type==='seating-confirmed'){
      const b=this.engines.current,s=b.status,proof=d.proof;
      if(s?.onlineID!==proof?.guestOnlineID||signature(s,peer)!=='in:opened,out:init,in:init,out:inited'||!Array.isArray(proof.guestSeats)||JSON.stringify(seats(s))!==JSON.stringify([...proof.guestSeats].sort()))throw Error('房主确认未匹配当前 Guest 原生入座');
      this.sessions.markEntered(peer,r,proof);clearTimeout(this.guestRoundTimer);this.guestRoundTimer=null;r.phase='waiting';this.publishState();return;
    }
  }
  sendBind(m,r,b){this.send(m.peerId,'bind-round',r,{targetPeerId:m.peerId,hostDocumentGeneration:b.scope.documentGeneration,guestDocumentGeneration:m.documentGeneration});}
  status(binding,status){
    const r=this.round;if(!r||!this.live(r)||this.engines.current!==binding)return;
    if(this.role==='guest'&&r.phase==='seating'&&status?.onlineID&&signature(status,this.guestPeer)==='in:opened,out:init,in:init,out:inited'){
      const proof={guestOnlineID:status.onlineID,guestInitComplete:true,guestSeatIds:seats(status),guestDocumentGeneration:binding.scope.documentGeneration,wireSequence:signature(status,this.guestPeer)};
      const fingerprint=JSON.stringify(proof);if(r.sentGuestProof!==fingerprint){r.sentGuestProof=fingerprint;this.send(this.guestPeer,'seating-ready',r,{documentGeneration:binding.scope.documentGeneration,proof});}
    }else if(this.role==='host')for(const peer of this.members.keys())this.trySeat(peer);
    if(status?.playing&&['waiting','seating'].includes(r.phase)){r.phase='playing';this.next.playing(r);this.publishState();}
  }
  async trySeat(peer){
    const r=this.round,m=this.members.get(peer),b=this.engines.current,s=b?.status;if(!r||!this.live(r)||!m||m.phase!=='seating'||!m.proof||!s)return;
    const client=(s.clients||[]).find(c=>c.peerId===peer),ids=seats(s),g=m.proof;
    if(!client?.inited||client.id!==g.guestOnlineID||g.guestInitComplete!==true||signature(s,peer)!=='out:opened,in:init,out:init,in:inited'||JSON.stringify(ids)!==JSON.stringify([...g.guestSeatIds].sort()))return;
    const proof={hostClientId:client.id,hostClientInited:true,guestOnlineID:g.guestOnlineID,guestInited:true,hostSeats:ids,guestSeats:g.guestSeatIds,hostDocumentGeneration:b.scope.documentGeneration,guestDocumentGeneration:m.documentGeneration,roundId:r.roundId,ordered:true,seated:true};
    m.phase='confirming';
    try{
      const confirmation=await this.engines.command('confirm-seat',{peerId:peer,proof},b);this.assert(r);
      if(confirmation?.confirmed===false&&confirmation.peerId===peer&&confirmation.reason==='seat-list-changed'){
        if(this.engines.current!==b||this.members.get(peer)!==m||m.phase!=='confirming')throw Error('当前座位重核操作已失效');
        if((m.seatRechecks=(m.seatRechecks||0)+1)>16)throw Error('当前座位名单持续变化，停止本次入座');
        m.phase='seating';m.proof=null;this.send(peer,'seating-recheck',r,{reason:'seat-list-changed',hostDocumentGeneration:b.scope.documentGeneration,guestDocumentGeneration:m.documentGeneration});this.publishState();return;
      }
      if(confirmation?.confirmed!==true||confirmation.peerId!==peer)throw Error('当前原生入座未得到有效核验回复');
      if(this.engines.current!==b||this.members.get(peer)!==m||m.phase!=='confirming')throw Error('当前原生入座确认已失效');
      this.sessions.markEntered(peer,r,proof);
      const activation=await this.engines.command('activate-seat',{peerId:peer,proof},b);this.assert(r);
      if(activation?.activated!==true||activation.peerId!==peer)throw Error('当前原生入座未得到有效开始许可');
      if(this.engines.current!==b||this.members.get(peer)!==m||m.phase!=='confirming')throw Error('当前原生开始许可已失效');
      m.phase='entered';clearTimeout(m.timer);m.timer=null;m.proof=null;
      this.send(peer,'seating-confirmed',r,{guestDocumentGeneration:m.documentGeneration,proof});this.onEvent('native-seated',{peerId:peer,...this.envelope(r),proof});this.publishState();
    }catch(error){this.fail(r,error);}
  }
  failure(owner,error,frame){const r=this.round;if(r&&same(r,frame?.data)&&this.live(r))this.fail(r,error);else this.onEvent('retired-control-failure',{error:String(error),operationId:frame?.data?.operationId||null});}
  prepareNext(args){this.assertFilesIdle();return this.next.begin(args);}
  returnToPluginRoom(args){return this.room.begin(args);}
  cancelNextPreparation(reason){const next=this.next.cancel(reason);const room=this.room.abort(reason);return next||room;}
  async loadNextHost(plan,old,retry=false,commitFailure=null){this.assertFilesIdle();
    const valid=()=>this.round===old&&(retry&&old.failed&&plan.retryOf===old.roundId||this.live(old));if(!valid())throw Error('旧续局提交已失效');if(this.cleanupPromise)await this.cleanupPromise;await this.retire('committed next native round');this.assertFilesIdle();if(!valid())throw Error('旧提交回收已失效');
    this.room.reset();const r={...plan.lease,operationGeneration:++this.operationGeneration,role:'host',mode:plan.mode,phase:'loading',failed:false,continuationPeers:plan.targetPeers.slice()};this.round=r;this.publishState();
    try{this.assert(r);for(const peer of r.continuationPeers)this.sessions.bindEnrollment(peer,r);if(commitFailure)throw Error('下一局提交广播未完成：'+commitFailure.message);const b=await this.engines.create(r);this.assert(r);await this.engines.command('prepare-host',{mode:r.mode,startRoster:r.continuationPeers},b);this.assert(r);await this.engines.wait(b,()=>b.status?.waiting&&b.status.capacity>=2,'下一局原生等待房');this.assert(r);
      const observed=await this.engines.command('next-plan',{mode:r.mode},b);this.assert(r);if(observed.configDigest!==plan.configDigest||b.status.capacity<=r.continuationPeers.length)throw Error('新文档配置或实际容量未匹配冻结名单');
      r.capacity=b.status.capacity;r.phase='seating';await this.promote();this.assert(r);
      await this.engines.wait(b,()=>r.continuationPeers.every(peer=>this.members.get(peer)?.phase==='entered'&&this.sessions.isEntered(peer)),'下一局全部原玩家的新 init 和入座',30000);this.assert(r);this.onEvent('next-native-seated',{...this.envelope(r),peers:r.continuationPeers.slice()});return r;
    }catch(error){this.fail(r,error);throw error;}
  }
  async loadNextGuest(plan,old,retry=false,pending=null){
    const valid=()=>this.next.currentGuestLoad(pending)&&pending.old===old&&pending.plan===plan&&pending.retry===retry;let r=null;
    try{
      if(!valid())throw Error('旧客端提交已失效');this.assertFilesIdle();
      if(this.cleanupPromise)await this.cleanupPromise;if(!valid())return;
      const hadEngine=!!this.engines.current,result=await this.retire('committed next native round');if(!valid())return;
      if(this.engines.current||result?.errors?.length||result&&!result.confirmation?.confirmed||hadEngine&&!result?.confirmation?.confirmed||retry&&(!old.cleanupComplete||old.cleanupError||old.cleanupHadEngine&&!old.cleanupResult?.confirmation?.confirmed))throw Error('旧局原生引擎回收未确认，不能重新载入');
      this.assertFilesIdle();if(!valid())return;
      this.room.reset();r={...plan.lease,operationGeneration:++this.operationGeneration,role:'guest',mode:plan.mode,remotePeerToken:old.remotePeerToken,slot:old.slot,phase:'loading',failed:false,continuationPeers:[pending.peer]};this.guestApprovalOwners.set(r,pending.owner);this.round=r;this.next.guestLoad=null;this.sessions.bindEnrollment(pending.peer,r);this.publishState();
      // A matching failure during old cleanup retires the new lease without opening a document.
      if(pending.failure){this.fail(r,Error(pending.failure));return r;}
      this.assert(r);const b=await this.engines.create(r);this.assert(r);await this.engines.command('approve-peer',{peerId:pending.peer},b);this.assert(r);r.phase='awaiting-bind';this.guestRoundTimer=setTimeout(()=>{this.guestRoundTimer=null;if(this.live(r)&&!this.sessions.isEntered(pending.peer))this.fail(r,Error('下一局房主绑定或原生入座超时'));},30000);this.send(pending.peer,'document-ready',r,{targetPeerId:r.remotePeerToken,documentGeneration:b.scope.documentGeneration,engineScope:b.scope});this.publishState();return r;
    }catch(error){
      if(r){this.fail(r,error);throw error;}
      if(!valid())return;
      const message=error?.message||String(error);old.nextError=message;this.onEvent('error',{message,...plan.lease});this.publishState();try{this.send(pending.peer,'operation-failed',plan.lease,{error:String(message).slice(0,2000)});}catch(sendError){this.onEvent('operation-failure-notice-error',{error:String(sendError)});}throw error;
    }finally{if(this.next.guestLoad===pending)this.next.guestLoad=null;}
  }
  fail(r,error){
    if(!this.live(r))return;r.failedPhase=r.phase;r.failed=true;r.phase='failed';r.error=error?.message||String(error);this.next.cancel(r.error);this.room.abort(r.error);for(const m of this.members.values()){clearTimeout(m.timer);m.timer=null;}
    this.onEvent('error',{message:r.error,partySessionId:r.partySessionId,roundId:r.roundId,operationId:r.operationId});this.publishState();
    for(const record of this.sessions.snapshot())if((same(record.lease,r)||r.continuationPeers?.includes(record.peerId))&&this.sessions.isLive(record.peerId)){
      try{this.send(record.peerId,'operation-failed',r,{error:String(r.error).slice(0,2000)});}catch(sendError){this.onEvent('operation-failure-notice-error',{error:String(sendError)});}
    }
    r.cleanupHadEngine=!!this.engines.current;
    const cleanup=this.retire('failed current engine operation').then(result=>{r.cleanupResult=result;r.cleanupComplete=true;return result;}).catch(cleanupError=>{
      r.cleanupError=String(cleanupError);this.onEvent('error',{message:'本次原生引擎回收未完成：'+cleanupError.message});if(this.cleanupPromise===cleanup)this.cleanupPromise=null;throw cleanupError;
    });
    this.cleanupPromise=cleanup;cleanup.catch(()=>{});
  }
  async retire(reason){
    clearTimeout(this.guestRoundTimer);this.guestRoundTimer=null;
    this.settlement.retire();
    const r=this.round;if(r){for(const m of this.members.values()){clearTimeout(m.timer);m.timer=null;}}
    for(const record of this.sessions.snapshot()){const owner=this.sessions.getOwner(record.peerId),scope=owner?.currentScope;if(scope)owner.detachEngineBinding(scope,reason);if(r)this.sessions.retireEnrollment(record.peerId,r);}
    const result=await this.engines.retire(reason);this.members.clear();return result;
  }
  resetCompletedRound(r){
    if(this.closed||this.round!==r||this.engines.current)throw Error('旧局回收未确认，不能重置名单');
    r.failed=true;this.next.dispose();this.room.dispose();this.settlement.dispose();this.members.clear();
    this.round=null;this.cleanupPromise=null;this.promoteOperation=null;this.remoteLobby=null;
    this.settlement=new RoundSettlement(this);this.room=new PluginRoom(this);this.next=new RoundContinuation(this);this.publishState();
  }
  publishState(){this.onState(this.snapshot());}
  snapshot(){const r=this.round;return {role:this.role,round:r&&{...Object.fromEntries(['partySessionId','roundId','operationId','mode','phase','capacity','failed','failedPhase','error','settlementReady','settlementError','nextError'].map(k=>[k,r[k]??null])),initialRetryAllowed:initialFailure(r)},next:this.next.snapshot(),room:this.room.snapshot(),settlement:this.settlement.snapshot(),members:[...this.members.values()].map(m=>({peerId:m.peerId,phase:m.phase,slot:m.slot,documentGeneration:m.documentGeneration})),remoteLobby:this.remoteLobby||null};}
  unregister(peer){this.lobbyManifest?.forgetPeer(peer);this.lobbyTransfer?.forgetPeer(peer).catch(()=>{});if(this.role==='guest'&&this.guestPeer===peer){this.guestPeer=null;this.remoteLobby=null;if(this.requestTimer!==null)clearInterval(this.requestTimer);this.requestTimer=null;}this.supportedPeers.delete(peer);this.continuationCapable.delete(peer);this.roomCapable.delete(peer);this.identityVersions.delete(peer);if(this.identityPending?.peer===peer)this.clearIdentityPending();clearTimeout(this.capabilityTimers.get(peer));this.capabilityTimers.delete(peer);}
  dispose(){this.closed=true;this.clearIdentityPending();this.identityVersions.clear();clearTimeout(this.guestRoundTimer);this.guestRoundTimer=null;this.next.dispose();this.room.dispose();this.settlement.dispose();if(this.requestTimer!==null)clearInterval(this.requestTimer);this.requestTimer=null;for(const m of this.members.values())clearTimeout(m.timer);for(const timer of this.capabilityTimers.values())clearTimeout(timer);this.capabilityTimers.clear();this.supportedPeers.clear();this.continuationCapable.clear();this.roomCapable.clear();this.members.clear();}
}

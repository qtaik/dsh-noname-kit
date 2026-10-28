import {sameScope} from './engine-binding.js';
const TYPES=new Set(['next-prepare','next-ready','next-commit','next-cancel','next-retry']);
const MODES=['identity','guozhan','versus','doudizhu','single'],KEYS=['partySessionId','roundId','operationId'];
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const same=(a,b)=>!!a&&!!b&&KEYS.every(key=>a[key]===b[key]);
const clone=x=>JSON.parse(JSON.stringify(x));
const digest=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
const retryShape=p=>Object.fromEntries(Object.keys(p||{}).filter(k=>!['id','lease','retryOf'].includes(k)).sort().map(k=>[k,p[k]]));
const frozenPlan=p=>{const value=clone(p);Object.freeze(value.lease);Object.freeze(value.targetPeers);return Object.freeze(value);};
export class RoundContinuation {
 constructor(c){this.c=c;this.pending=null;this.committed=null;this.timer=null;this.receipts=[];this.closed=false;this.requestHistory=[];this.lastPlan=null;this.retryRemaining=1;this.guestLoad=null;}
 current(t){return !this.closed&&this.pending===t&&this.c.live(t.oldRound)&&this.c.room.receipt===t.room&&this.c.room.available();}
 guestSource(owner,old){const c=this.c,peer=c.guestPeer;return c.role==='guest'&&!!peer&&c.guestApprovalOwners.get(old)===owner&&c.sessions.getOwner(peer)===owner&&c.sessions.peerForActualOwner(owner)===peer&&c.sessions.isLive(peer);}
 freshGuestLease(plan,old){const c=this.c,p=plan?.lease;return id(plan?.id)&&p?.partySessionId===old.partySessionId&&id(p.roundId)&&p.roundId!==old.roundId&&id(p.operationId)&&p.operationId!==old.operationId&&!c.guestRoundIds.has(p.roundId)&&!c.guestOperationIds.has(p.operationId);}
 reserveGuestLoad(owner,plan,old,retry){
  if(this.guestLoad||!this.guestSource(owner,old)||!this.freshGuestLease(plan,old))throw Error('原客端续局身份已失效');
  const t={old,oldLease:Object.freeze(Object.fromEntries(KEYS.map(k=>[k,old[k]]))),owner,peer:this.c.guestPeer,plan:frozenPlan(plan),signature:digest(plan),retry,cancelled:false,failure:null};
  this.c.guestRoundIds.add(plan.lease.roundId);this.c.guestOperationIds.add(plan.lease.operationId);this.guestLoad=t;return t;
 }
 currentGuestLoad(t){const c=this.c;return !!t&&!this.closed&&!c.closed&&this.guestLoad===t&&!t.cancelled&&c.round===t.old&&same(t.old,t.oldLease)&&this.guestSource(t.owner,t.old)&&c.guestPeer===t.peer&&digest(this.lastPlan)===t.signature&&(t.retry?t.old.failed===true&&t.plan.retryOf===t.old.roundId:c.live(t.old));}
 pendingGuestLoad(owner,data){const t=this.guestLoad;return this.currentGuestLoad(t)&&t.owner===owner&&same(t.plan.lease,data);}
 failGuestLoad(owner,data){
  const t=this.guestLoad;if(!this.pendingGuestLoad(owner,data))return false;
  if(!t.failure){t.failure=data.error;t.old.nextError=data.error;this.c.onEvent('error',{message:data.error,...t.plan.lease});this.c.publishState();}return true;
 }
 envelope(r,data){return this.c.envelope(r,{protocol:'nnk-next/1',...data});}
 send(peer,type,r,data){return this.c.sessions.sendControl(peer,type,this.envelope(r,data));}
 notifyCancel(t,reason){for(const peer of t.peers)if(this.c.sessions.isLive(peer)){try{this.send(peer,'next-cancel',t.oldRound,{planId:t.plan.id,planSignature:t.signature,reason:String(reason).slice(0,1000)});}catch(error){this.c.onEvent('next-cancel-notice-failed',{peerId:peer,message:error.message});}}}
 validate(owner,frame){
  if(!TYPES.has(frame.type))return null;
  const c=this.c,r=c.round,d=frame.data,peer=c.sessions.peerForActualOwner(owner),t=this.pending;
  if(this.closed||!peer||!c.sessions.isLive(peer)||d.protocol!=='nnk-next/1'||!id(d.requestId))return 'invalid-next-source';
  if(c.role==='guest'&&!this.guestSource(owner,r))return 'invalid-next-source';
  if(frame.type==='next-retry'){const p=d.plan;return !this.guestLoad&&!this.pending&&this.guestSource(owner,r)&&this.retryRemaining>0&&r?.failed===true&&same(r,d)&&same(this.lastPlan?.lease,r)&&p?.retryOf===r.roundId&&this.freshGuestLease(p,r)&&JSON.stringify(retryShape(p))===JSON.stringify(retryShape(this.lastPlan));}
  if(frame.type==='next-commit'&&d.plan&&this.receipts.some(receipt=>receipt.peer===peer&&same(receipt.oldLease,d)&&receipt.planSignature===digest(d.plan)))return true;
  if(!r||!c.live(r)||!same(r,d))return 'retired-next-operation';
  if(frame.type==='next-prepare'){
   const p=d.plan,room=c.room.receipt;return !this.guestLoad&&this.guestSource(owner,r)&&!!room&&this.freshGuestLease(p,r)&&(c.room.ready()||t?.oldRound===r&&t.prepared)&&p&&p.returnId===room.id&&p.barrierId===room.barrierId&&p.barrierRevision===room.revision&&p.oldRoundId===r.roundId&&p.lease?.partySessionId===r.partySessionId&&id(p.lease.roundId)&&p.lease.roundId!==r.roundId&&id(p.lease.operationId)&&p.lease.operationId!==r.operationId&&id(p.id)&&MODES.includes(p.mode)&&p.targetPeers?.includes(r.remotePeerToken)&&p.targetPeers.length<=16&&new Set(p.targetPeers).size===p.targetPeers.length&&p.targetPeers.every(id)&&typeof p.configDigest==='string'&&/^[a-f0-9]{64}$/.test(p.configDigest)&&sameScope(d.hostScope,room.hostScope)&&(!t||t.signature===digest(p));
  }
  if(!t||!this.current(t)||d.planId!==t.plan.id||d.planSignature!==t.signature)return 'wrong-current-next-plan';
  if(frame.type==='next-ready')return c.role==='host'&&t.peers.includes(peer)&&sameScope(d.guestScope,t.room.guestScopes[peer])&&d.hostGeneration===t.room.hostScope.documentGeneration&&d.ready===true;
  if(frame.type==='next-commit')return c.role==='guest'&&peer===c.guestPeer&&t.prepared===true&&!!d.plan&&digest(d.plan)===t.signature;
  return frame.type==='next-cancel'&&((c.role==='guest'&&peer===c.guestPeer)||(c.role==='host'&&t.peers.includes(peer)))&&typeof d.reason==='string';
 }
 async begin({mode,requestId=crypto.randomUUID()}={}){
  const c=this.c;
  if(c.role!=='host')throw Error('请等待房主在插件房间选择模式并载入到游戏');
  if(this.pending){if(mode&&this.pending.plan&&mode!==this.pending.plan.mode)throw Error('本次续局准备已冻结另一模式');return this.pending.promise;}
  if(this.committed)return this.committed.promise;
  if(!c.room.ready())throw Error('请先在结算页点击“返回插件房间”，等待双方完成返回');
  if(mode&&!MODES.includes(mode))throw Error('不支持的下一局模式');
  const oldRound=c.round,room=c.room.receipt,peers=room.peers.slice();
  if(peers.some(peer=>!c.continuationCapable?.has(peer)))throw Error('对端未确认本版本的续局控制协议，不能继续原连接');
  const t={oldRound,room,peers,plan:null,signature:null,ready:new Set(),prepared:false,promise:null,resolve:null,reject:null};
  t.promise=new Promise((resolve,reject)=>{t.resolve=resolve;t.reject=reject;});t.promise.catch(()=>{});this.pending=t;
  try{
   const actual=room.plans[mode||oldRound.mode];
   if(!this.current(t)||peers.some(peer=>!c.sessions.isLive(peer)))throw Error('插件房间的原连接或返回确认已失效');
   if(actual?.admission!==true||actual.mode!==(mode||oldRound.mode)||!Number.isSafeInteger(actual.capacity)||actual.capacity<2||actual.capacity>64)throw Error('返回时未取得有效的模式配置');
   if(peers.length>=actual.capacity)throw Error('下一局容量不足以容纳完整原名单，请先明确调整参加名单');
   const lease={partySessionId:oldRound.partySessionId,roundId:crypto.randomUUID(),operationId:crypto.randomUUID()};
   t.plan={id:crypto.randomUUID(),returnId:room.id,oldRoundId:oldRound.roundId,lease,mode:actual.mode,capacity:actual.capacity,configDigest:actual.configDigest,targetPeers:peers.slice(),barrierId:room.barrierId,barrierRevision:room.revision};
   t.signature=digest(t.plan);oldRound.phase='preparing';
   for(const peer of peers)this.send(peer,'next-prepare',oldRound,{plan:clone(t.plan),hostScope:clone(room.hostScope)});
   this.timer=setTimeout(()=>this.cancel('等待原玩家确认下一局准备超时'),12000);
   c.onEvent('next-preparing',{...this.envelope(oldRound,{}),plan:clone(t.plan)});c.publishState();
  }catch(error){this.cancel(error.message);}
  return t.promise;
 }
 async control(owner,frame){
  if(this.validate(owner,frame)!==true)return;
  const c=this.c,peer=c.sessions.peerForActualOwner(owner),d=frame.data;
  if(frame.type==='next-retry'){const old=c.round,t=this.reserveGuestLoad(owner,d.plan,old,true);this.retryRemaining--;this.lastPlan=clone(t.plan);return c.loadNextGuest(t.plan,old,true,t);}
  if(frame.type==='next-prepare'){
   if(this.pending?.signature===digest(d.plan)&&this.pending.prepared){this.sendReady(this.pending,peer);return;}
   const oldRound=c.round,t={oldRound,room:c.room.receipt,peers:[peer],plan:clone(d.plan),signature:digest(d.plan),prepared:true};this.pending=t;
   if(!this.current(t)){this.cancel('本机返回确认已失效');return;}
   oldRound.phase='preparing';
   this.sendReady(t,peer);this.timer=setTimeout(()=>this.cancel('等待房主提交下一局超时'),12000);c.publishState();return;
  }
  if(frame.type==='next-ready'){
   const t=this.pending;if(t.ready.has(peer))return;t.ready.add(peer);
   if(t.peers.every(id=>t.ready.has(id)))await this.commitHost(t);return;
  }
  if(frame.type==='next-cancel'){this.cancel(d.reason,false);return;}
  const known=this.receipts.find(receipt=>receipt.peer===peer&&same(receipt.oldLease,d)&&receipt.planSignature===digest(d.plan));if(known)return;
  const t=this.pending;if(!this.current(t)||!t.prepared)return;
  clearTimeout(this.timer);this.timer=null;
  this.receipts.push({peer,oldLease:Object.fromEntries(KEYS.map(key=>[key,t.oldRound[key]])),planSignature:t.signature});if(this.receipts.length>4)this.receipts.shift();
  this.pending=null;const loading=this.reserveGuestLoad(owner,t.plan,t.oldRound,false);this.lastPlan=clone(loading.plan);await c.loadNextGuest(loading.plan,t.oldRound,false,loading);
 }
 sendReady(t,peer){this.send(peer,'next-ready',t.oldRound,{planId:t.plan.id,planSignature:t.signature,guestScope:clone(t.room.localScope),hostGeneration:t.room.hostScope.documentGeneration,ready:true});}
 async commitHost(t){
  const c=this.c;if(!this.current(t))return;
  const actual=t.room.plans[t.plan.mode];
  if(actual.admission!==true||actual.configDigest!==t.plan.configDigest||t.peers.some(peer=>!c.sessions.isLive(peer))){this.cancel('准备期间配置、文件事务或原连接发生变化');return;}
  clearTimeout(this.timer);this.timer=null;
  let commitFailure=null;try{for(const peer of t.peers)this.send(peer,'next-commit',t.oldRound,{planId:t.plan.id,planSignature:t.signature,plan:clone(t.plan)});}catch(error){commitFailure=error;}
  this.pending=null;this.lastPlan=clone(t.plan);this.committed={plan:clone(t.plan),promise:t.promise};c.onEvent('next-committed',{...this.envelope(t.oldRound,{}),plan:clone(t.plan)});
  try{if(commitFailure)this.notifyCancel(t,'下一局提交广播未完成');const next=await c.loadNextHost(t.plan,t.oldRound,false,commitFailure);t.resolve(next);}catch(error){t.reject(error);}finally{this.committed=null;}
 }
 cancel(reason,notify=true){
  const loading=this.guestLoad;if(loading){loading.cancelled=true;this.guestLoad=null;if(notify&&this.c.sessions.isLive(loading.peer))try{this.c.send(loading.peer,'operation-failed',loading.plan.lease,{error:String(reason).slice(0,2000)});}catch(error){this.c.onEvent('next-cancel-notice-failed',{peerId:loading.peer,message:error.message});}if(this.c.live(loading.old)){loading.old.phase='plugin-room';loading.old.nextError=String(reason);this.c.publishState();}}
  const t=this.pending;if(!t)return !!loading;clearTimeout(this.timer);this.timer=null;this.pending=null;
  if(notify&&t.plan)this.notifyCancel(t,reason);
  t.reject?.(Error(reason));if(this.c.round===t.oldRound&&this.c.live(t.oldRound)){t.oldRound.phase='plugin-room';t.oldRound.nextError=String(reason);this.c.publishState();}
  this.c.onEvent('next-preparation-cancelled',{reason:String(reason),roundId:t.oldRound.roundId});return true;
 }
 async retry(){
  const c=this.c,r=c.round,p=this.lastPlan;if(c.role!=='host'||!r?.failed||!same(p?.lease,r)||this.retryRemaining<1||this.pending||this.committed)throw Error('本次失败局次不能继续重试');
  if(p.targetPeers.some(peer=>!c.sessions.isLive(peer)))throw Error('原连接已终止，不能重试或自动重连');
  this.retryRemaining--;const plan={...clone(p),id:crypto.randomUUID(),retryOf:r.roundId,lease:{partySessionId:r.partySessionId,roundId:crypto.randomUUID(),operationId:crypto.randomUUID()}};
  let broadcastFailure=null;try{for(const peer of plan.targetPeers)this.send(peer,'next-retry',r,{plan});}catch(error){broadcastFailure=error;}
  this.lastPlan=clone(plan);const promise=c.loadNextHost(plan,r,true,broadcastFailure);this.committed={plan,promise};try{return await promise;}finally{this.committed=null;}
 }
 playing(r){if(same(this.lastPlan?.lease,r))this.retryRemaining=1;}
 snapshot(){return {guestLoading:this.guestLoad&&{lease:clone(this.guestLoad.plan.lease),retry:this.guestLoad.retry,failed:!!this.guestLoad.failure},pending:this.pending&&{plan:clone(this.pending.plan),signature:this.pending.signature,ready:this.pending.ready?[...this.pending.ready]:[],prepared:this.pending.prepared===true},committed:this.committed&&clone(this.committed.plan),retryAvailable:this.c.round?.failed===true&&same(this.lastPlan?.lease,this.c.round)&&this.retryRemaining>0,resources:{timers:Number(this.timer!==null),receipts:this.receipts.length,requestHistory:this.requestHistory.length}};}
 dispose(){this.closed=true;this.cancel('续局控制器已退休');clearTimeout(this.timer);this.timer=null;this.receipts=[];this.requestHistory=[];}
}

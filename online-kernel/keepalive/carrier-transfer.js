import {transferPeerDisplay} from './transfer-display.js';
export const TRANSFER_PROTOCOL='nnk-transfer/2';
export const TRANSFER_TYPES=new Set(['transfer-consent','transfer-file']);
export const TRANSFER_MAX_BYTES=1073741824,TRANSFER_MAX_TTL_MS=900000;
export function transferBudgetMs(total){
 if(!Number.isSafeInteger(total)||total<0||total>TRANSFER_MAX_BYTES)throw RangeError('本批补传大小必须在 0 至 1 GiB 以内');
 return Math.min(TRANSFER_MAX_TTL_MS,120000+Math.ceil(total/1048576)*1000);
}
const MAX_PEERS=32,MAX_META=768*1024,MAX_FILE=65536,MAX_QUEUE=32;
const active=new Set(['pending','accepting','authorized_paused']);
const irreversible=new Set(['activation_pending','committed','committed_activation_required','unknown','recovery_required']);
const terminal=new Set(['declined','cancelled','expired','failed','disconnected']);
const leaseKeys=['partySessionId','roundId','operationId'];
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const bounded=(x,n=160)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\x00-\x1f\x7f]/.test(x);
const nonce=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const scopeOk=x=>exact(x,['carrierSessionId','partyEpoch'])&&bounded(x.carrierSessionId)&&Number.isSafeInteger(x.partyEpoch)&&x.partyEpoch>=0&&x.partyEpoch<=1000000000;
const sameScope=(a,b)=>!!a&&!!b&&a.carrierSessionId===b.carrierSessionId&&a.partyEpoch===b.partyEpoch;
const fresh=()=>crypto.randomUUID().replaceAll('-','');
const byteSize=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const fileFields={ready:[],ready_ack:[],data:['seq','index','offset','end','data'],ack:['seq'],finish:[],result:['status','reason'],result_ack:[],cancel:['status','reason']};
const fileOutcomes=new Set(['activation_pending','committed','committed_activation_required','failed','cancelled','expired','recovery_required','disconnected','unknown']);

// Authority belongs to a current registered transport; disk work is supplied by adapters.
// normalize checks the protocol manifest; checkBatch enforces the local capacity policy.
export class CarrierTransfer {
 constructor({sessions,getRole,getScope,canTransfer,collect,normalize,checkBatch=()=>{},digest,createChannel,source,receiver,emit=()=>{},now=()=>Date.now(),newId=fresh,setTimer=(...args)=>setTimeout(...args),clearTimer=(...args)=>clearTimeout(...args),isRequestPending=()=>false,autoTransfer=true}){
  if(!sessions||[getRole,getScope,canTransfer,collect,normalize,checkBatch,digest,createChannel,source,receiver,emit,now,newId,setTimer,clearTimer,isRequestPending].some(fn=>typeof fn!=='function'))throw TypeError('Transfer dependencies required');
  Object.assign(this,{sessions,getRole,getScope,canTransfer,collect,normalize,checkBatch,digest,createChannel,source,receiver,emit,now,newId,setTimer,clearTimer,isRequestPending});this.peers=new Map();this.history=[];this.closed=false;this.pendingCleanup=0;this.operations=new Set();this.autoTransferEnabled=autoTransfer!==false;this.preferenceGeneration=0;
 }
 setEnabled(value){
  if(typeof value!=='boolean')throw TypeError('补传开关必须是布尔值');
  if(this.autoTransferEnabled===value)return Promise.resolve();
  this.autoTransferEnabled=value;++this.preferenceGeneration;
  if(value)return Promise.resolve();
  const cleanup=[];
  for(const r of this.peers.values()){
   r.collecting?.controller.abort();const q=r.q;
   if(q&&active.has(q.status)&&!q.fileCommitted&&!irreversible.has(q.fileState?.status))cleanup.push(this._finish(r,q,'cancelled','本机已关闭扩展补传',true));
  }
  return Promise.all(cleanup).then(()=>undefined);
 }
 _preferenceCurrent(generation){return this.autoTransferEnabled&&this.preferenceGeneration===generation;}
 _declineOffer(r,d){this._send(r,'terminate',{from:r.local,to:r.remote,proposal:d.proposal,digest:d.digest,reason:'cancelled'});}
 capabilities(){return [TRANSFER_PROTOCOL];}
 capabilitySnapshot(){return [...this.peers.values()].filter(r=>this._actual(r)).map(r=>({peerId:r.peer,owner:r.owner,connectionSessionId:r.connectionSessionId,protocol:TRANSFER_PROTOCOL,ready:!!r.remote}));}
 _track(promise){this.operations.add(promise);promise.then(()=>this.operations.delete(promise),()=>this.operations.delete(promise));return promise;}
 _scope(){const value=this.getScope();if(!scopeOk(value))throw Error('Current transfer scope required');return value;}
 _actual(r){const record=this.sessions.get(r.peer);return !this.closed&&this.peers.get(r.peer)===r&&sameScope(r.scope,this._scope())&&this.getRole()===r.role&&record?.connectionSessionId===r.connectionSessionId&&this.sessions.getOwner(r.peer)===r.owner&&this.sessions.peerForActualOwner(r.owner)===r.peer&&this.sessions.isLive(r.peer)&&!r.owner.stopped;}
 _gate(peer){try{const value=this.canTransfer(peer);return value?.available===true?{available:true,reason:''}:{available:false,reason:String(value?.reason||'当前不能补传').slice(0,240)};}catch{return {available:false,reason:'当前文件事务条件尚未确认'};}}
 _canRotate(r,d,queued=false){return !!r.remote&&d.scope.carrierSessionId===r.remoteScope?.carrierSessionId&&d.scope.partyEpoch>r.remoteScope.partyEpoch&&d.nonce!==r.remote&&d.nonce!==r.local&&!r.collecting&&!r.diskPending&&r.queueDepth<=(queued?1:0)&&!this.pendingCleanup&&!(r.q&&(active.has(r.q.status)||r.q.fileCommitted||irreversible.has(r.q.fileState?.status)))&&this._gate(r.peer).available;}
 _binding(r,q){return {session:r.local,peerSession:r.remote,proposal:q.id,digest:q.digest,peerId:r.peer,scope:clone(r.scope)};}
 _display(r,q){
  if(!q.peerDisplay){const record=this.sessions.get(r.peer);q.peerDisplay=record?.connectionSessionId===r.connectionSessionId&&this.sessions.getOwner(r.peer)===r.owner?transferPeerDisplay(record,r.role):r.display||transferPeerDisplay(null,r.role);}
  return clone(q.peerDisplay);
 }
 _view(r,q){return {...this._binding(r,q),...this._display(r,q),role:r.role,status:q.status,source:'房主',batch:{extensions:q.batch.extensions.map(e=>({name:e.name,fileCount:e.files.length})),total:q.batch.total,count:q.batch.count},ttlMs:q.ttlMs,expires:q.expires,reason:q.reason||'',transferPaused:false};}
 _emit(r,q){this.emit('batch_consent',this._view(r,q));}
 _send(r,op,fields={}){if(!this._actual(r))throw Error('原补传连接或会话已结束');const data={protocol:TRANSFER_PROTOCOL,partySessionId:null,roundId:null,operationId:null,requestId:this.newId(),connectionSessionId:r.connectionSessionId,scope:clone(r.scope),op,...fields};this.sessions.sendControl(r.peer,'transfer-consent',data);}
 _bound(r,q){return {from:r.local,to:r.remote,proposal:q.id,digest:q.digest};}
 _hello(r){if(!this._actual(r)||r.remote||r.helloAttempts>=5)return;this._send(r,'hello',{nonce:r.local});r.helloAttempts++;r.helloTimer=this.setTimer(()=>{r.helloTimer=null;try{this._hello(r);}catch{}},1500);}
 setPeerCapability(peer,supported=true){
  if(!supported){this.forgetPeer(peer);return false;}if(this.closed)return false;
  const known=this.peers.get(peer);if(known&&this._actual(known))return true;
  if(known)this.forgetPeer(peer);const owner=this.sessions.getOwner(peer),record=this.sessions.get(peer),role=this.getRole(),scope=this._scope();
  if(!owner||!record||!this.sessions.isLive(peer)||!['host','guest'].includes(role)||owner.role!==role||this.sessions.peerForActualOwner(owner)!==peer||this.peers.size>=MAX_PEERS)return false;
  const local=this.newId();if(!nonce(local))throw Error('Fresh transfer nonce required');
  const r={peer,owner,connectionSessionId:record.connectionSessionId,display:transferPeerDisplay(record,role),role,scope:clone(scope),local,remote:null,remoteScope:null,q:null,used:new Set(),seen:new Set(),fingerprints:new Set(),lastSequence:owner.snapshot().lastAcceptedControlSeq||0,queue:Promise.resolve(),queueDepth:0,collecting:null,diskPending:0,helloAttempts:0,helloTimer:null};this.peers.set(peer,r);this._hello(r);return true;
 }
 _filePacket(packet,role){
  if(!plain(packet)||packet.nnk_files!==2||!nonce(packet.from)||!nonce(packet.to)||!nonce(packet.proposal)||!hash(packet.digest)||!Object.hasOwn(fileFields,packet.kind)||byteSize(packet)>MAX_FILE)return false;
  const common=['nnk_files','from','to','proposal','digest','kind'],fields=fileFields[packet.kind].slice();
  if(packet.kind==='result_ack'&&Object.hasOwn(packet,'status'))fields.push('status');
  if(!exact(packet,[...common,...fields]))return false;
  const incoming=role==='host'?['ready','ack','result','result_ack']:['ready_ack','data','finish','cancel','result','result_ack'];if(!incoming.includes(packet.kind))return false;
  if(packet.kind==='data')return Number.isSafeInteger(packet.seq)&&packet.seq>=0&&Number.isSafeInteger(packet.index)&&packet.index>=0&&Number.isSafeInteger(packet.offset)&&packet.offset>=0&&typeof packet.end==='boolean'&&typeof packet.data==='string'&&packet.data.length<=43696&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packet.data);
  if(packet.kind==='ack')return Number.isSafeInteger(packet.seq)&&packet.seq>=0;
  if(['result','cancel'].includes(packet.kind))return fileOutcomes.has(packet.status)&&typeof packet.reason==='string'&&packet.reason.length<=200;
  return packet.kind!=='result_ack'||!Object.hasOwn(packet,'status')||packet.status==='activation_pending';
 }
 validate(owner,frame){
  if(!TRANSFER_TYPES.has(frame?.type))return null;
  try{
   const peer=this.sessions.peerForActualOwner(owner),r=this.peers.get(peer),d=frame.data,record=peer&&this.sessions.get(peer);
   if(!r||r.owner!==owner||!this._actual(r)||frame.sessionId!==record.connectionSessionId||frame.sourcePeer!==(r.role==='host'?'guest':'host')||!Number.isSafeInteger(frame.seq)||frame.seq<=r.lastSequence||r.queueDepth>=MAX_QUEUE||[...this.peers.values()].reduce((n,row)=>n+row.queueDepth,0)>=128||!plain(d)||d.protocol!==TRANSFER_PROTOCOL||!leaseKeys.every(k=>d[k]===null)||d.connectionSessionId!==record.connectionSessionId||!bounded(d.requestId)||r.seen.has(d.requestId)||!scopeOk(d.scope))return 'invalid-current-transfer-source';
   const base=['protocol',...leaseKeys,'requestId','connectionSessionId','scope'];
   if(frame.type==='transfer-file'){
    const q=r.q,p=d.packet;if(!exact(d,[...base,'packet'])||!r.remote||!sameScope(d.scope,r.remoteScope)||!q||!r.channel||!this._filePacket(p,r.role)||p.from!==r.remote||p.to!==r.local||p.proposal!==q.id||p.digest!==q.digest)return 'invalid-transfer-file';
    if(!['result','result_ack','cancel'].includes(p.kind)&&!this._authorized(r,q))return 'unauthorized-transfer-file';return true;
   }
   if(!bounded(d.op,16)||byteSize(d)>MAX_META)return 'invalid-transfer-consent';
   if(d.op==='hello')return exact(d,[...base,'op','nonce'])&&nonce(d.nonce)&&d.nonce!==r.local&&(!r.remote||r.remote===d.nonce&&sameScope(d.scope,r.remoteScope)||this._canRotate(r,d))?true:'invalid-transfer-hello';
   if(!r.remote||d.from!==r.remote||d.to!==r.local||!sameScope(d.scope,r.remoteScope)||!nonce(d.proposal)||!hash(d.digest))return 'wrong-transfer-binding';
   const bound=[...base,'op','from','to','proposal','digest'],q=r.q;
   if(d.op==='offer'){
    if(r.role!=='guest'||!exact(d,[...bound,'batch','ttlMs'])||this.autoTransferEnabled&&!this._gate(peer).available||r.used.has(d.proposal)&&q?.id!==d.proposal||r.used.size>=128&&!r.used.has(d.proposal))return 'invalid-transfer-offer';
    const normalized=this.normalize(d.batch);if(d.ttlMs!==transferBudgetMs(normalized.total))return 'invalid-transfer-budget';return JSON.stringify(normalized)===JSON.stringify(d.batch)?true:'noncanonical-transfer-manifest';
   }
   if(!q||q.id!==d.proposal||q.digest!==d.digest)return 'retired-transfer-proposal';
   if(d.op==='decision')return r.role==='host'&&exact(d,[...bound,'yes'])&&typeof d.yes==='boolean'?true:'invalid-transfer-decision';
   if(d.op==='accept')return r.role==='guest'&&exact(d,[...bound,'remainingMs'])&&Number.isSafeInteger(d.remainingMs)&&d.remainingMs>0&&d.remainingMs<=q.ttlMs?true:'invalid-transfer-accept';
   if(d.op==='deny')return r.role==='guest'&&exact(d,[...bound,'reason'])&&d.reason==='declined'?true:'invalid-transfer-denial';
   if(d.op==='terminate')return exact(d,[...bound,'reason'])&&['cancelled','expired','failed','disconnected'].includes(d.reason)?true:'invalid-transfer-termination';
   return 'unknown-transfer-operation';
  }catch{return 'invalid-transfer-state';}
 }
 control(owner,frame){
  if(this.validate(owner,frame)!==true)return Promise.resolve(false);
  const r=this.peers.get(this.sessions.peerForActualOwner(owner)),d=clone(frame.data);r.lastSequence=frame.seq;r.seen.add(d.requestId);while(r.seen.size>64)r.seen.delete(r.seen.values().next().value);r.queueDepth++;
  if(frame.type==='transfer-consent'&&d.op==='terminate'&&r.q&&!r.q.fileCommitted)r.q.cancelRequested=true;
  const generation=this.preferenceGeneration;
  const task=r.queue.then(async()=>{if(!this._actual(r))return false;if(frame.type==='transfer-file'){const q=r.q,p=d.packet;if(!q||!r.channel||p.from!==r.remote||p.to!==r.local||p.proposal!==q.id||p.digest!==q.digest||!sameScope(d.scope,r.remoteScope))return false;r.channel.handle(JSON.stringify(p));await r.channel.current?.queue;return true;}await this._control(r,d,generation);return true;}).catch(async error=>{if(this._actual(r)&&r.q)await this._finish(r,r.q,'failed',String(error.message||error),true);return false;}).finally(()=>{r.queueDepth--;});r.queue=task;return task;
 }
 async _control(r,d,generation=this.preferenceGeneration){
  if(d.op==='hello'){
   if(r.remote&&this._canRotate(r,d,true)){
    const old=r.q;if(r.channel)await r.channel.close();if(!this._actual(r)||!this._canRotate(r,d,true))return;
    if(old){this.clearTimer(old.timer);this.clearTimer(old.retryTimer);old.cancelRequested=true;this._remember(r,old);}
    const local=this.newId();if(!nonce(local)||local===r.local||local===d.nonce)throw Error('重新协商必须使用新授权标识');
    r.local=local;r.remote=null;r.remoteScope=null;r.q=null;r.channel=null;r.used.clear();r.seen.clear();r.seen.add(d.requestId);r.fingerprints.clear();
   }
   if(!r.remote){r.remote=d.nonce;r.remoteScope=clone(d.scope);this.clearTimer(r.helloTimer);r.helloTimer=null;this._send(r,'hello',{nonce:r.local});this.emit('transfer-capability-ready',{peerId:r.peer,scope:clone(r.scope)});}return;
  }
  if(d.from!==r.remote||d.to!==r.local||!sameScope(d.scope,r.remoteScope))return;
  let q=r.q;
  if(d.op==='offer'){
   if(!this._preferenceCurrent(generation)){this._declineOffer(r,d);return;}
   if(q?.id===d.proposal){if(q.digest!==d.digest||JSON.stringify(q.batch)!==JSON.stringify(d.batch))throw Error('同一提议的内容发生变化');return;}
   if(q&&(active.has(q.status)||r.diskPending||q.fileCommitted||irreversible.has(q.fileState?.status)))throw Error('本机已有未完成或已提交批次');
   const batch=this.normalize(d.batch),value=await this.digest(batch);if(!this._actual(r))return;if(!this._preferenceCurrent(generation)){this._declineOffer(r,d);return;}if(!this._gate(r.peer).available)return;if(value!==d.digest)throw Error('整批文件摘要不匹配');
   try{this.checkBatch(batch);}catch{this._declineOffer(r,d);return;}
   if(q)this._remember(r,q);if(r.channel){await r.channel.close();r.channel=null;if(!this._actual(r))return;if(!this._preferenceCurrent(generation)){this._declineOffer(r,d);return;}if(!this._gate(r.peer).available)return;}
   const ttlMs=transferBudgetMs(batch.total);q={id:d.proposal,digest:value,batch,ttlMs,status:'pending',expires:this.now()+ttlMs,choice:null,cancelRequested:false};r.q=q;r.used.add(q.id);this._arm(r,q);this._emit(r,q);return;
  }
  if(!q||q.id!==d.proposal||q.digest!==d.digest)return;
  if(d.op==='terminate'){await this._finish(r,q,d.reason,'对端结束本次授权',false);return;}
  if(d.op==='decision'){
   if(q.expires<=this.now()&&!q.fileCommitted){await this._finish(r,q,'expired','本次逐请求授权已超时',true);return;}
   if(q.choice!==null){if(q.choice!==d.yes)throw Error('同一提议出现冲突的授权决定');if(q.status==='authorized_paused')this._send(r,'accept',{...this._bound(r,q),remainingMs:Math.max(1,q.expires-this.now())});else if(q.status==='declined')this._send(r,'deny',{...this._bound(r,q),reason:'declined'});return;}
   if(q.status!=='pending'||q.expires<=this.now())return;
   q.choice=d.yes;if(!d.yes){await this._finish(r,q,'declined','客机拒绝本次补传',false);this._send(r,'deny',{...this._bound(r,q),reason:'declined'});return;}
   if(!this._gate(r.peer).available)throw Error('客机授权时本机已不处于可补传状态');q.status='authorized_paused';this._send(r,'accept',{...this._bound(r,q),remainingMs:q.expires-this.now()});this._emit(r,q);await this._start(r,q);return;
  }
  if(d.op==='deny'){if(q.choice===false)await this._finish(r,q,'declined','客机拒绝本次补传',false);return;}
  if(d.op==='accept'&&q.status==='accepting'&&q.choice===true&&!q.cancelRequested&&q.expires>this.now()){
   if(!this._gate(r.peer).available)throw Error('本机已不处于可补传状态');this.clearTimer(q.retryTimer);q.retryTimer=null;q.expires=Math.min(q.expires,this.now()+d.remainingMs);q.status='authorized_paused';this._arm(r,q);this._emit(r,q);await this._start(r,q);
  }
 }
 _arm(r,q){this.clearTimer(q.timer);q.timer=this.setTimer(()=>{q.timer=null;if(r.q===q)this._finish(r,q,'expired','本次逐请求授权已超时',true).catch(()=>{});},Math.max(0,q.expires-this.now()));}
 _authorized(r,q){return this.autoTransferEnabled&&this._actual(r)&&r.q===q&&q.choice===true&&q.status==='authorized_paused'&&!q.cancelRequested&&q.expires>this.now()&&!q.fileCommitted&&this._gate(r.peer).available;}
 _grant(r,q){return {session:r.local,peerSession:r.remote,proposal:q.id,digest:q.digest,expires:q.expires,batch:clone(q.batch)};}
 _context(r,q){return {peerId:r.peer,owner:r.owner,connectionSessionId:r.connectionSessionId,scope:clone(r.scope),isAuthorized:()=>this._authorized(r,q)};}
 async _start(r,q){
  if(!this._authorized(r,q)||r.channel)return;
  const context=this._context(r,q);
  r.channel=this.createChannel({role:r.role,authorize:()=>this._authorized(r,q)?this._grant(r,q):null,send:raw=>{if(!this._actual(r)||r.q!==q)throw Error('原文件连接已结束');const packet=JSON.parse(raw);if(Object.hasOwn(packet,'reason'))packet.reason=packet.status==='unknown'?'文件结果尚未确认，请核对客机完整批次并重新体检。':packet.status==='recovery_required'?'本机文件恢复尚未完成，请先处理恢复状态。':packet.status==='activation_pending'?'整批文件已提交，正在保存客机扩展启用设置。':packet.status==='committed'?'客机已自动启用本批扩展，请完全退出并重启无名杀后重新体检。':packet.status==='committed_activation_required'?'整批文件已提交，自动启用结果需在客机确认；无需重新下载。':'本次文件操作未完成，请在对应设备查看本机提示。';if(byteSize(packet)>MAX_FILE)throw Error('文件帧超过上限');if((r.owner.link?.bufferedAmount||0)>2*1048576)throw Error('文件通道积压超过上限');this.sessions.sendControl(r.peer,'transfer-file',{protocol:TRANSFER_PROTOCOL,partySessionId:null,roundId:null,operationId:null,requestId:this.newId(),connectionSessionId:r.connectionSessionId,scope:clone(r.scope),packet});},
   source:async grant=>{if(!this._authorized(r,q))throw Error('本批没有当前授权');return await this.source(grant,context);},receiver:async grant=>{if(!this._authorized(r,q))throw Error('本批没有客机当前授权');return await this.receiver(grant,context);},report:value=>{q.fileState=clone(value);q.fileCommitted=value.fileCommitted===true||q.fileCommitted===true;if(!q.fileCommitted&&terminal.has(value.status)){q.status=value.status;q.reason=value.reason||'';q.cancelRequested=true;this.clearTimer(q.timer);this.clearTimer(q.retryTimer);q.timer=q.retryTimer=null;this._emit(r,q);}this.emit('batch_files',{...value,...this._binding(r,q),...this._display(r,q)});}});
  r.diskPending++;try{await r.channel.granted();}finally{r.diskPending--;}
 }
 _finish(r,q,status,reason,notify){return this._track(this._stop(r,q,status,reason,notify));}
 async _stop(r,q,status,reason,notify){
  if(r.q!==q)return;q.cancelRequested=true;this.clearTimer(q.timer);this.clearTimer(q.retryTimer);q.timer=q.retryTimer=null;
  if(!q.fileCommitted&&!irreversible.has(q.fileState?.status)){q.status=status;q.reason=String(reason).slice(0,200);}
  if(notify&&this._actual(r))try{this._send(r,'terminate',{...this._bound(r,q),reason:status==='declined'?'cancelled':['cancelled','expired','failed','disconnected'].includes(status)?status:'failed'});}catch{}
  if(r.channel){r.diskPending++;this.pendingCleanup++;try{await r.channel.stop(status,String(reason));}finally{r.diskPending--;this.pendingCleanup--;}}
  this._emit(r,q);
 }
 _remember(r,q){this.history.push({proposal:this._view(r,q),file:q.fileState&&{...clone(q.fileState),...this._binding(r,q),...this._display(r,q)}});while(this.history.length>32)this.history.shift();}
 _blocksRequest(r,peer){const completedOther=r.peer!==peer&&r.role==='host'&&r.q?.fileCommitted===true&&['committed','committed_activation_required'].includes(r.q.fileState?.status);return r.collecting||r.diskPending||r.queueDepth||!completedOther&&r.q&&(active.has(r.q.status)||r.q.fileCommitted||irreversible.has(r.q.fileState?.status));}
 requestBusy(peer){return this.isRequestPending()||this.operations.size>0||this.pendingCleanup>0||[...this.peers.values()].some(r=>this._blocksRequest(r,peer));}
 async _propose(r,names,explicit=false){
  const generation=this.preferenceGeneration;if(!this._preferenceCurrent(generation))return false;
  if(this.pendingCleanup||[...this.peers.values()].some(other=>other!==r&&this._blocksRequest(other,r.peer)))return false;
  if(!this._actual(r)||r.role!=='host'||!r.remote||!this._gate(r.peer).available||r.collecting||r.diskPending||r.q&&(active.has(r.q.status)||r.q.fileCommitted||irreversible.has(r.q.fileState?.status)))return false;
  if(!Array.isArray(names)||!names.length||names.length>64||new Set(names).size!==names.length||names.some(name=>!bounded(name,120)))return false;
  const collecting={controller:new AbortController()};r.collecting=collecting;
  try{
   const batch=this.normalize(await this.collect(names.slice(),{signal:collecting.controller.signal}));this.checkBatch(batch);if(!this._preferenceCurrent(generation)||!this._actual(r)||r.collecting!==collecting||collecting.controller.signal.aborted||!this._gate(r.peer).available)return false;
   if(JSON.stringify(batch.extensions.map(e=>e.name).sort())!==JSON.stringify(names.slice().sort()))throw Error('提议采集名单发生变化');
   const value=await this.digest(batch);if(!hash(value))throw Error('整批摘要无效');if(!this._preferenceCurrent(generation)||!this._actual(r)||r.collecting!==collecting||!this._gate(r.peer).available)return false;
   if(!explicit&&r.fingerprints.has(value))return false;if(r.used.size>=128)throw Error('本连接补传提议次数已达上限');
   if(r.q){this._remember(r,r.q);if(r.channel){await r.channel.close();r.channel=null;}}
   if(!this._preferenceCurrent(generation)||!this._actual(r)||r.collecting!==collecting||collecting.controller.signal.aborted||!this._gate(r.peer).available)return false;
   const ttlMs=transferBudgetMs(batch.total),id=this.newId();if(!nonce(id)||r.used.has(id))throw Error('必须使用新的补传提议');const q={id,digest:value,batch,ttlMs,status:'pending',expires:this.now()+ttlMs,choice:null,cancelRequested:false};
   const offer={...this._bound(r,q),batch,ttlMs};if(byteSize(offer)>MAX_META-1024)throw Error('整批文件清单超过控制帧上限');r.q=q;r.used.add(id);r.fingerprints.add(value);this._arm(r,q);this._send(r,'offer',offer);this._emit(r,q);return true;
  }catch(error){if(!this._preferenceCurrent(generation)||collecting.controller.signal.aborted)return false;throw error;}finally{if(r.collecting===collecting)r.collecting=null;}
 }
 autoOffer(peer,diff){const r=this.peers.get(peer);if(this.isRequestPending()||!r||diff?.verification!=='verified'||diff.inventoryVerified!==true||diff.scope&&!sameScope(diff.scope,r.scope))return Promise.resolve(false);return this._track(this._propose(r,diff.exts?.needsFiles,false));}
 request(peer,diff){const r=this.peers.get(peer);if(!r||diff?.verification!=='verified'||diff.inventoryVerified!==true||!scopeOk(diff.scope)||!sameScope(diff.scope,r.scope))return Promise.resolve(false);return this._track(this._propose(r,diff.exts?.needsFiles,true));}
 _selected(binding){if(!plain(binding)||!bounded(binding.peerId)||!scopeOk(binding.scope))return null;const r=this.peers.get(binding.peerId),q=r?.q;return r&&q&&this._actual(r)&&sameScope(binding.scope,r.scope)&&binding.session===r.local&&binding.peerSession===r.remote&&binding.proposal===q.id&&binding.digest===q.digest?{r,q}:null;}
 decide(binding){
  if(!exact(binding,['session','peerSession','proposal','digest','peerId','scope','yes']))return false;
  const selected=this._selected(binding);if(!selected||selected.r.role!=='guest'||selected.q.status!=='pending'||typeof binding.yes!=='boolean'||binding.yes&&(!this.autoTransferEnabled||!this._gate(selected.r.peer).available)||selected.q.expires<=this.now())return false;
  const {r,q}=selected;q.choice=binding.yes;q.status=binding.yes?'accepting':'declined';q.reason=binding.yes?'等待房主确认本次授权':'客机拒绝本次补传';this._emit(r,q);
  let attempts=0;const deliver=()=>{if(!this._actual(r)||r.q!==q||q.cancelRequested||!['accepting','declined'].includes(q.status)||q.expires<=this.now())return;try{this._send(r,'decision',{...this._bound(r,q),yes:binding.yes});}catch{this._finish(r,q,'disconnected','授权连接已结束',false).catch(()=>{});return;}if(++attempts<5)q.retryTimer=this.setTimer(deliver,2000);};deliver();return true;
 }
 cancel(binding){if(!exact(binding,['session','peerSession','proposal','digest','peerId','scope']))return Promise.resolve(false);const selected=this._selected(binding);if(!selected||selected.q.fileCommitted||irreversible.has(selected.q.fileState?.status))return Promise.resolve(false);return this._finish(selected.r,selected.q,'cancelled','用户结束本次补传授权',true).then(()=>true);}
 retry(binding){if(this.isRequestPending()||!exact(binding,['session','peerSession','proposal','digest','peerId','scope']))return Promise.resolve(false);const selected=this._selected(binding);if(!selected||selected.r.role!=='host'||!terminal.has(selected.q.status)||selected.q.fileCommitted||irreversible.has(selected.q.fileState?.status))return Promise.resolve(false);return this._track(this._propose(selected.r,selected.q.batch.extensions.map(e=>e.name),true));}
 availability(){const gate=this._gate();if(this.closed)return {available:false,reason:'补传控制器已结束',peers:[]};const peers=[...this.peers.values()].filter(r=>this._actual(r)&&r.remote).map(r=>r.peer);return {available:this.autoTransferEnabled&&gate.available&&peers.length>0,reason:!this.autoTransferEnabled?'本机已关闭扩展补传；可自行复制扩展后重新体检。':gate.available?(peers.length?'':'补传需要双方升级内核并完全重启无名杀'):gate.reason,peers};}
 busy(){return this.isRequestPending()||this.operations.size>0||this.pendingCleanup>0||[...this.peers.values()].some(r=>r.collecting||r.diskPending||r.queueDepth||r.q&&(active.has(r.q.status)||r.q.fileCommitted||irreversible.has(r.q.fileState?.status)));}
 canStart(){return !this.busy();}
 snapshot(){const proposals=this.history.map(x=>clone(x.proposal)),files=this.history.filter(x=>x.file).map(x=>clone(x.file));for(const r of this.peers.values())if(r.q){proposals.push(this._view(r,r.q));if(r.q.fileState)files.push({...clone(r.q.fileState),...this._binding(r,r.q),...this._display(r,r.q)});}return {proposals,files,...this.availability(),busy:this.busy(),requestBusy:this.requestBusy(),resources:{peers:this.peers.size,history:this.history.length,pendingCleanup:this.pendingCleanup,pendingOperations:[...this.peers.values()].reduce((n,r)=>n+r.queueDepth+r.diskPending+Number(!!r.collecting),0)}};}
 forgetPeer(peer){const r=this.peers.get(peer);if(!r)return Promise.resolve(false);this.peers.delete(peer);this.clearTimer(r.helloTimer);r.collecting?.controller.abort();if(r.q){r.q.cancelRequested=true;this.clearTimer(r.q.timer);this.clearTimer(r.q.retryTimer);if(!r.q.fileCommitted&&!irreversible.has(r.q.fileState?.status)){r.q.status='disconnected';r.q.reason='连接结束，旧授权不复用';}}
  this.pendingCleanup++;const done=Promise.allSettled([Promise.resolve().then(()=>r.channel?.close()),r.queue]).finally(()=>{if(r.q)this._remember(r,r.q);this.pendingCleanup--;});return done.then(()=>true);
 }
 dispose(){if(this.disposal)return this.disposal;const peers=[...this.peers.keys()];this.closed=true;this.disposal=Promise.allSettled([...peers.map(peer=>this.forgetPeer(peer)),...this.operations]);return this.disposal;}
}

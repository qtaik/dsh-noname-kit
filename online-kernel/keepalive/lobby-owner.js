// Public discovery owns only unadopted attempts. Registered transports live in SessionRegistry.
const clone=value=>JSON.parse(JSON.stringify(value));
const MODES=new Set(['identity','guozhan','versus','doudizhu','single']);
const DEFAULT_CAPS={identity:8,guozhan:8,versus:8,doudizhu:3,single:2};
const modeOf=value=>{const mode=String(value||'identity');if(!MODES.has(mode))throw Error('不支持的模式: '+mode);return mode;};
export function projectLobbyMembers({mode='identity',nextMode=mode,capacity,caps=DEFAULT_CAPS,hostIdentity={},hostEntered=false,records=[],selectedPeers=null,roomCode=null,lobbyOpen=false}){
 mode=modeOf(mode);const limits={...DEFAULT_CAPS,...caps};
 capacity=Number.isSafeInteger(capacity)&&capacity>=2&&capacity<=64?capacity:limits[mode];
 const live=records.filter(r=>r.live!==false).sort((a,b)=>a.joinOrdinal-b.joinOrdinal);
 // A plugin-room place is not an enrollment in a native round.
 const selected=new Set(selectedPeers===null?live.slice(0,capacity-1).map(r=>r.peerId):selectedPeers);
 const list=[{peerId:'host',...hostIdentity,role:'host',entered:hostEntered===true,queued:false},...live.map(r=>({peerId:r.peerId,...r.identity,name:r.identity?.name||'',role:'guest',entered:r.entered===true,queued:!selected.has(r.peerId)}))];
 return {list,mode,nextMode,capacity,caps:limits,lobbyOpen,roomCode};
}
const roomCode=()=>[...crypto.getRandomValues(new Uint8Array(6))].map(b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%32]).join('');
export class LobbyOwner {
 constructor({boot,connector,sessions,coordinator={},bridge,onRegistered=()=>{},onMembers=()=>{},newCode=roomCode}){
  if(!connector||!sessions||!bridge)throw TypeError('Connector, Registry and bridge required');
  this.boot=clone(boot||{});this.connector=connector;this.sessions=sessions;this.coordinator=coordinator;this.bridge=bridge;
  this.onRegistered=onRegistered;this.onMembers=onMembers;this.newCode=newCode;this.lobby=null;this.publication=null;this.publicationOperation=null;this.createOperation=null;this.publicationContext=null;
  this.lobbyEpoch=0;this.publicationEpoch=0;this.role='';this.nextMode='identity';this.members=new Map();this.invites=[];this.inviteSequence=0;this.joinAttempt=null;this.joinKind=null;this.pendingOffers=new Map();this.acceptedRoomPeers=new Map();this.offerTimes=new Map();this.sessionEpoch=0;
 }
 _context(context){return context||this.bridge.captureContext?.()||this.bridge;}
 _live(context){return context.isCurrent?.()!==false;}
 _error(error,detail={},context=this._context()){context.emit('error',{message:error?.message||String(error),...detail});}
 _current(lobby){return !!lobby&&lobby===this.lobby&&lobby.open;}
 // Local display metadata only. The peer roomCode remains the open-lobby sentinel.
 _roomAvailability(){return this._current(this.lobby)&&!!this.publication&&(!this.publicationContext||this._live(this.publicationContext))&&this.publication.code===this.lobby.code&&this.publication.publicationEpoch===this.publicationEpoch&&this.publication.snapshot?.()?.closed!==true;}
 capacities(){return {...DEFAULT_CAPS,...this.boot.modeCaps};}
 _phase(context=this._context()){if(!this._live(context))return;const continuation=this.coordinator.continuationSnapshot?.()??null;
  const phase=this.role==='guest'?(this.sessions.list().length?'connected':this.joinAttempt?'joining':'idle'):
   this.lobby?.open?(this.invites.some(x=>x.status==='answering')?'connecting':this.invites.some(x=>x.status==='pending')?'invite_ready':'room_open'):continuation?'room_open':'idle';
  context.setPhase(phase,{roomCode:this.lobby?.open?this.lobby.code:null,roomCodeAvailable:this._roomAvailability(),lobbyOpen:!!this.lobby?.open,nextMode:this.nextMode,continuation});}
 memberState(){const actual=this.coordinator.lobbySnapshot?.()??{};return projectLobbyMembers({...actual,mode:actual.mode||this.nextMode,nextMode:this.nextMode,caps:this.capacities(),hostIdentity:actual.hostIdentity||this.boot.identity,records:this.sessions.list(),lobbyOpen:!!this.lobby?.open,roomCode:this.lobby?.open?this.lobby.code:null});}
 _members(context=this._context()){
  if(!this._live(context))return null;
  // Guests publish only the validated Host projection received by the coordinator.
  const data=this.role==='host'?this.memberState():null;
  if(data)context.emit('room_members',data);this._phase(context);try{const task=this.onMembers(data&&clone(data));if(task?.then)task.catch(error=>this._error(error,{},context));}catch(error){this._error(error,{},context);}
  return data;
 }
 async _ready(lobby,connection,row=null,publicationEpoch=null,offerKey=null,context=this._context()){
  if(!this._live(context)||!this._current(lobby)||row?.status==='dead'||publicationEpoch!==null&&publicationEpoch!==this.publicationEpoch){connection.closeUnentered('Retired public discovery');return;}
  const record=this.sessions.registerReady(connection);this.members.set(record.peerId,{queued:true});
  if(offerKey)this.acceptedRoomPeers.set(offerKey,record.peerId);
  if(row){row.status='used';row.peerId=record.peerId;row.guest=record.identity.name||'';row.attempt=null;}
  this._members(context);await this.onRegistered({...record,role:'host',source:'public-lobby'});
 }
 _publish(lobby,context=this._context()){
  if(!this._live(context)||!this._current(lobby))return Promise.reject(Error('大厅已失效，发布已取消'));
  if(this.publicationOperation){
   if(this.publicationOperation.lobby===lobby&&this.publicationOperation.code===lobby.code)return this.publicationOperation.promise;
   return Promise.reject(Error('房号发布正在进行，请稍后重试'));
  }
  const operation={lobby,code:lobby.code,promise:null};this.publicationOperation=operation;
  const epoch=++this.publicationEpoch;this.publication?.endAndClearRetained();this.publication=null;
  this.offerTimes.clear();this.acceptedRoomPeers.clear();
  this._phase(context);
  operation.promise=(async()=>{const publication=await this.connector.listenRoom({code:operation.code,publicationEpoch:epoch,signal:lobby.controller.signal,
   onFailure:error=>{if(this._live(context)&&this._current(lobby)&&epoch===this.publicationEpoch)this._error(error,{},context);},
   onOffer:async (message,actualPublication)=>{
    if(!this._live(context)||!this._current(lobby)||epoch!==this.publicationEpoch)return;
    if(!/^[0-9a-z]{4,12}$/.test(message?.guestId)||message?.sdp?.type!=='offer')return;
    const key=epoch+':'+message.guestId,last=this.pendingOffers.get(key),peer=this.acceptedRoomPeers.get(key),now=Date.now();
    if(last||peer&&this.sessions.isLive(peer)||now-(this.offerTimes.get(key)||0)<1500)return;
    this.offerTimes.set(key,now);if(this.offerTimes.size>64){const oldest=this.offerTimes.keys().next().value;this.offerTimes.delete(oldest);}
    this.pendingOffers.set(key,{at:Date.now(),attempt:null});let attempt=null;
    try{attempt=await this.connector.answerRoomOffer({publication:actualPublication,message,signal:lobby.controller.signal,
      onReady:connection=>this._ready(lobby,connection,null,epoch,key,context),
      onTerminal:()=>{lobby.attempts.delete(attempt);this.pendingOffers.delete(key);},
      onFailure:error=>{if(this._live(context)&&this._current(lobby)&&epoch===this.publicationEpoch)this._error(error,{},context);}});
     if(!this._live(context)||!this._current(lobby)||epoch!==this.publicationEpoch)attempt.closeUnentered('Publication retired');
     else if(!attempt.snapshot().closed)lobby.attempts.add(attempt);
    }catch(error){this.pendingOffers.delete(key);if(this._live(context)&&this._current(lobby)&&epoch===this.publicationEpoch)this._error(error,{},context);}
   }});
  if(!this._live(context)||!this._current(lobby)||epoch!==this.publicationEpoch||this.publicationOperation!==operation){publication.endAndClearRetained();throw Error('大厅发布已退休，结果已取消');}
  this.publication=publication;this.publicationContext=context;
  })().finally(()=>{if(this.publicationOperation===operation)this.publicationOperation=null;});
  return operation.promise;
 }
 async createInternetRoom(mode,signaling='mqtt',context=this._context()){
  if(!this._live(context))throw Error('原绑定的建房操作已失效');
  mode=modeOf(mode);
  if(this.createOperation){
   if(this.createOperation.mode===mode&&this.createOperation.signaling===signaling)return await this.createOperation.promise;
   throw Error('建房正在进行，请完成或取消后重试');
  }
  if(this.coordinator.blocksNewPublicRoom?.())throw Error('当前对局不能创建另一个公开大厅');
  this.nextMode=mode;this.role='host';
  const created=!this.lobby?.open;
  if(created)this.lobby={open:true,code:this.newCode(),epoch:++this.lobbyEpoch,controller:new AbortController(),attempts:new Set()};
  const lobby=this.lobby,operation={lobby,mode,signaling,created,promise:null};this.createOperation=operation;
  operation.promise=(async()=>{try{
   // Manual invitation creation needs the logical lobby, not public discovery.
   if(signaling!=='invite'&&!this._roomAvailability())await this._publish(lobby,context);
   if(!this._live(context)||!this._current(lobby)||this.createOperation!==operation)throw Error('建房操作已退休，结果已取消');
   this._members(context);if(signaling==='invite')await this.refreshInvite('invite',undefined,context);
   if(!this._live(context)||!this._current(lobby)||this.createOperation!==operation)throw Error('建房操作已退休，结果已取消');
   return this.snapshot();
  }catch(error){
   // Initial public failure closes only its own new lobby. An existing private
   // lobby and its invitations/registered transports survive a failed upgrade.
   if(created&&signaling!=='invite'&&this.createOperation===operation&&this._current(lobby)){
    lobby.open=false;this.lobby=null;lobby.controller.abort();this._phase(context);
   }else if(this._current(lobby))this._phase(context);
   throw error;
  }})().finally(()=>{if(this.createOperation===operation)this.createOperation=null;});
  return await operation.promise;
 }
 openRoom(mode,signaling){return this.createInternetRoom(mode,signaling);}
 _invite(id){return id==null?[...this.invites].reverse().find(r=>r.status==='pending'):this.invites.find(r=>r.id===id);}
 async refreshInvite(kind,id,context=this._context()){
  if(!this._live(context))throw Error('原绑定的邀请码操作已失效');
  const sessionEpoch=this.sessionEpoch,lobby=this.lobby;if(!this._current(lobby))throw Error('大厅已解散，不能接受新成员');
  if(kind==='cancel'){const row=this._invite(id);if(!row||row.status==='used')throw Error('邀请码已经使用或不存在');row.status='dead';row.note='已作废';row.attempt?.closeUnentered(row.note);row.attempt=null;this._phase(context);return true;}
  if(kind!=='invite'){
   if(this.createOperation||this.publicationOperation)throw Error('房号发布正在进行，请稍后重试');
   lobby.code=this.newCode();try{await this._publish(lobby,context);if(!this._current(lobby))throw Error('大厅已失效，换号已取消');this._members(context);return true;}
   catch(error){if(this._current(lobby))this._phase(context);throw error;}
  }
  if(this.createOperation?.created&&this.createOperation.signaling!=='invite')throw Error('公开建房正在进行，请完成或取消后重试');
  const pending=this.invites.filter(r=>r.status==='pending');if(pending.length>=6)await this.refreshInvite('cancel',pending[0].id,context);
  const row={id:++this.inviteSequence,status:'pending',at:Date.now(),guest:'',note:'',attempt:null};this.invites.push(row);
  while(this.invites.length>12){const i=this.invites.findIndex(r=>['used','dead'].includes(r.status));if(i<0)break;this.invites.splice(i,1);}
  let attempt=null;
  try{attempt=await this.connector.makeInvite({signal:lobby.controller.signal,
    onReady:connection=>this._ready(lobby,connection,row,null,null,context),
    onTerminal:summary=>{if(sessionEpoch!==this.sessionEpoch)return;lobby.attempts.delete(attempt);row.attempt=null;if(!summary.adopted&&row.status!=='used'){row.status='dead';row.note=summary.reason;}this._phase(context);},
    onFailure:error=>{if(this._current(lobby))this._error(error,{inviteId:row.id},context);}});
   if(!this._live(context)||!this._current(lobby)||row.status==='dead'){row.status='dead';row.note='Invitation retired';attempt.closeUnentered(row.note);return false;}
   if(!attempt.snapshot().closed){row.attempt=attempt;lobby.attempts.add(attempt);}
   context.emit('invite_ready',{id:row.id,code:attempt.offerText});this._phase(context);return true;
  }catch(error){if(sessionEpoch===this.sessionEpoch){row.status='dead';row.note=error.message;this._phase(context);}throw error;}
 }
 async acceptAnswer(id,code,context=this._context()){const sessionEpoch=this.sessionEpoch,row=this._invite(id);if(!row||row.status!=='pending'||!row.attempt)throw Error('没有待应答的邀请码');row.status='answering';this._phase(context);
  try{return await row.attempt.acceptAnswer(code);}catch(error){if(sessionEpoch!==this.sessionEpoch)throw error;if(row.status!=='used'){row.status='dead';row.note=error.message;row.attempt?.closeUnentered('Invalid answer');row.attempt=null;}this._phase(context);throw error;}}
 setRoomMode(mode){if(!this.lobby?.open&&!this.sessions.hasEnteredConnections())throw Error('没有可用大厅或原连接组');this.nextMode=modeOf(mode);this._members();}
 async joinByRoomCode(code,context=this._context()){return this._join('room',code,context);}
 async joinByInvite(code,context=this._context()){return this._join('invite',code,context);}
 async _join(kind,code,context=this._context()){
  if(!this._live(context))throw Error('原绑定的加入操作已失效');
  if(this.coordinator.blocksReplacementJoin?.()||this.sessions.hasEnteredConnections())throw Error('当前原连接仍在使用，不能重新加入替换');
  this.cancelJoin();this.role='guest';this.joinKind=kind;const marker={controller:new AbortController(),attempt:null,epoch:this.sessionEpoch};let registeredPeerId=null;this.joinAttempt=marker;this._phase(context);
  const onReady=async connection=>{if(!this._live(context)||this.joinAttempt!==marker){connection.closeUnentered('Join superseded');return;}
   const record=this.sessions.registerReady(connection);registeredPeerId=record.peerId;this.joinAttempt=null;this.members.set(record.peerId,{queued:true});this._phase(context);await this.onRegistered({...record,role:'guest',source:kind});};
  const options={code,signal:marker.controller.signal,onReady,onTerminal:summary=>{
   marker.attempt=null;if(!summary.adopted&&this.joinAttempt===marker){this.joinAttempt=null;this.joinKind=null;this._phase(context);}},onFailure:(error,detail)=>{
   if(!this._live(context)||marker.epoch!==this.sessionEpoch)return;this._error(error,{scope:'initial-attempt',attemptId:detail?.attemptId,peerId:registeredPeerId,retired:this.joinAttempt!==marker&&!registeredPeerId},context);}};
  try{const attempt=await (kind==='room'?this.connector.joinRoom(options):this.connector.joinInvite({...options,onAnswerCode:answer=>{
     if(!this._live(context)||this.joinAttempt!==marker)return;context.setPhase('answer_ready');context.emit('answer_ready',{code:answer});}}));
   marker.attempt=attempt;if(!this._live(context)||this.joinAttempt!==marker){if(this.joinAttempt===marker)this.joinAttempt=null;attempt.closeUnentered('Join no longer pending');}return true;
  }catch(error){if(this.joinAttempt===marker){this.joinAttempt=null;this.joinKind=null;marker.controller.abort();this._phase(context);}throw error;}
 }
 cancelJoin(){const marker=this.joinAttempt;this.joinAttempt=null;marker?.controller.abort();marker?.attempt?.closeUnentered('Join cancelled');
  if(this.role==='guest'){this.sessions.closeOnlyNeverEntered('Join cancelled');if(!this.sessions.list().length)this.joinKind=null;}this._phase();}
 async cancelAll(){++this.sessionEpoch;if(this.role!=='host')return this.cancelJoin();const lobby=this.lobby;if(lobby)lobby.open=false;
  ++this.publicationEpoch;this.createOperation=null;this.publicationOperation=null;this.publication?.endAndClearRetained('Lobby dissolved');this.publication=null;lobby?.controller.abort();
  for(const row of this.invites)if(row.status!=='used'){row.status='dead';row.note='大厅已解散';row.attempt?.closeUnentered(row.note);row.attempt=null;}
  for(const attempt of lobby?.attempts||[])attempt.closeUnentered('Lobby dissolved');lobby?.attempts.clear();this.pendingOffers.clear();this.acceptedRoomPeers.clear();this.offerTimes.clear();
  this.sessions.closeOnlyNeverEntered('Lobby dissolved');this.lobby=null;this.bridge.emit('cancelled',{scope:'public lobby'});this._members();
 }
 resetSession(){if(this.sessions.list().length||this.lobby||this.joinAttempt||this.publication)throw Error('原会话尚未完全关闭');
  ++this.sessionEpoch;this.role='';this.joinKind=null;this.createOperation=null;this.publicationOperation=null;this.members.clear();this.invites=[];this.pendingOffers.clear();this.acceptedRoomPeers.clear();this.offerTimes.clear();this._members();}
 async restartRoom(mode){if(!this.coordinator.restartRoom)throw Error('当前联机环境不支持受控续局');return this.coordinator.restartRoom(modeOf(mode||this.nextMode));}
 setQueued(peerId,queued){if(!this.sessions.get(peerId))throw Error('Unknown actual registered peer');this.members.set(peerId,{queued:queued===true});this._members();}
 onSessionChanged(){for(const id of this.members.keys())if(!this.sessions.get(id))this.members.delete(id);for(const [key,id]of this.acceptedRoomPeers)if(!this.sessions.isLive(id))this.acceptedRoomPeers.delete(key);
  for(const row of this.invites)if(row.status==='used'&&row.peerId){const record=this.sessions.get(row.peerId);if(record)row.guest=record.identity.name||'';}this._members();}
 inviteMetadata(){return this.invites.map(({id,status,at,guest,note})=>({id,status,at,guest,note}));}
 snapshot(){return {role:this.role,lobbyOpen:!!this.lobby?.open,roomCode:this.lobby?.open?this.lobby.code:null,roomCodeAvailable:this._roomAvailability(),joinKind:this.joinKind,nextMode:this.nextMode,invites:this.inviteMetadata(),members:this.sessions.list()};}
 resourceSnapshot(){return {attempts:this.lobby?.attempts.size||0,pendingOffers:this.pendingOffers.size,acceptedOfferMetadata:this.acceptedRoomPeers.size,offerRateMetadata:this.offerTimes.size,memberMetadata:this.members.size,invitationMetadata:this.invites.length};}
}


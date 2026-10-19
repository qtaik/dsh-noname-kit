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
  this.onRegistered=onRegistered;this.onMembers=onMembers;this.newCode=newCode;this.lobby=null;this.publication=null;
  this.lobbyEpoch=0;this.publicationEpoch=0;this.role='';this.nextMode='identity';this.members=new Map();this.invites=[];this.inviteSequence=0;this.joinAttempt=null;this.pendingOffers=new Map();this.acceptedRoomPeers=new Map();this.offerTimes=new Map();this.sessionEpoch=0;
 }
 _error(error,detail={}){this.bridge.emit('error',{message:error?.message||String(error),...detail});}
 _current(lobby){return !!lobby&&lobby===this.lobby&&lobby.open;}
 capacities(){return {...DEFAULT_CAPS,...this.boot.modeCaps};}
 _phase(){const continuation=this.coordinator.continuationSnapshot?.()??null;
  const phase=this.role==='guest'?(this.sessions.list().length?'connected':this.joinAttempt?'joining':'idle'):
   this.lobby?.open?(this.invites.some(x=>x.status==='answering')?'connecting':this.invites.some(x=>x.status==='pending')?'invite_ready':'room_open'):continuation?'room_open':'idle';
  this.bridge.setPhase(phase,{roomCode:this.lobby?.open?this.lobby.code:null,lobbyOpen:!!this.lobby?.open,nextMode:this.nextMode,continuation});}
 memberState(){const actual=this.coordinator.lobbySnapshot?.()??{};return projectLobbyMembers({...actual,mode:actual.mode||this.nextMode,nextMode:this.nextMode,caps:this.capacities(),hostIdentity:actual.hostIdentity||this.boot.identity,records:this.sessions.list(),lobbyOpen:!!this.lobby?.open,roomCode:this.lobby?.open?this.lobby.code:null});}
 _members(){
  // Guests publish only the validated Host projection received by the coordinator.
  const data=this.role==='host'?this.memberState():null;
  if(data)this.bridge.emit('room_members',data);this._phase();try{const task=this.onMembers(data&&clone(data));if(task?.then)task.catch(error=>this._error(error));}catch(error){this._error(error);}
  return data;
 }
 async _ready(lobby,connection,row=null,publicationEpoch=null,offerKey=null){
  if(!this._current(lobby)||row?.status==='dead'||publicationEpoch!==null&&publicationEpoch!==this.publicationEpoch){connection.closeUnentered('Retired public discovery');return;}
  const record=this.sessions.registerReady(connection);this.members.set(record.peerId,{queued:true});
  if(offerKey)this.acceptedRoomPeers.set(offerKey,record.peerId);
  if(row){row.status='used';row.peerId=record.peerId;row.guest=record.identity.name||'';row.attempt=null;}
  this._members();await this.onRegistered({...record,role:'host',source:'public-lobby'});
 }
 async _publish(lobby){
  const epoch=++this.publicationEpoch;this.publication?.endAndClearRetained();this.publication=null;
  this.offerTimes.clear();this.acceptedRoomPeers.clear();
  const publication=await this.connector.listenRoom({code:lobby.code,publicationEpoch:epoch,signal:lobby.controller.signal,
   onFailure:error=>{if(this._current(lobby)&&epoch===this.publicationEpoch)this._error(error);},
   onOffer:async (message,actualPublication)=>{
    if(!this._current(lobby)||epoch!==this.publicationEpoch)return;
    if(!/^[0-9a-z]{4,12}$/.test(message?.guestId)||message?.sdp?.type!=='offer')return;
    const key=epoch+':'+message.guestId,last=this.pendingOffers.get(key),peer=this.acceptedRoomPeers.get(key),now=Date.now();
    if(last||peer&&this.sessions.isLive(peer)||now-(this.offerTimes.get(key)||0)<1500)return;
    this.offerTimes.set(key,now);if(this.offerTimes.size>64){const oldest=this.offerTimes.keys().next().value;this.offerTimes.delete(oldest);}
    this.pendingOffers.set(key,{at:Date.now(),attempt:null});let attempt=null;
    try{attempt=await this.connector.answerRoomOffer({publication:actualPublication,message,signal:lobby.controller.signal,
      onReady:connection=>this._ready(lobby,connection,null,epoch,key),
      onTerminal:()=>{lobby.attempts.delete(attempt);this.pendingOffers.delete(key);},
      onFailure:error=>{if(this._current(lobby)&&epoch===this.publicationEpoch)this._error(error);}});
     if(!this._current(lobby)||epoch!==this.publicationEpoch)attempt.closeUnentered('Publication retired');
     else if(!attempt.snapshot().closed)lobby.attempts.add(attempt);
    }catch(error){this.pendingOffers.delete(key);if(this._current(lobby)&&epoch===this.publicationEpoch)this._error(error);}
   }});
  if(!this._current(lobby)||epoch!==this.publicationEpoch){publication.endAndClearRetained();return;}
  this.publication=publication;
 }
 async createInternetRoom(mode,signaling='mqtt'){
  if(this.coordinator.blocksNewPublicRoom?.())throw Error('当前对局不能创建另一个公开大厅');
  this.nextMode=modeOf(mode);this.role='host';
  if(!this.lobby?.open){const lobby={open:true,code:this.newCode(),epoch:++this.lobbyEpoch,controller:new AbortController(),attempts:new Set()};this.lobby=lobby;
   try{await this._publish(lobby);}catch(error){if(this._current(lobby)){lobby.open=false;this.lobby=null;this._phase();}throw error;}}
  this._members();if(signaling==='invite')await this.refreshInvite('invite');return this.snapshot();
 }
 openRoom(mode,signaling){return this.createInternetRoom(mode,signaling);}
 _invite(id){return id==null?[...this.invites].reverse().find(r=>r.status==='pending'):this.invites.find(r=>r.id===id);}
 async refreshInvite(kind,id){
  const sessionEpoch=this.sessionEpoch,lobby=this.lobby;if(!this._current(lobby))throw Error('大厅已解散，不能接受新成员');
  if(kind==='cancel'){const row=this._invite(id);if(!row||row.status==='used')throw Error('邀请码已经使用或不存在');row.status='dead';row.note='已作废';row.attempt?.closeUnentered(row.note);row.attempt=null;this._phase();return true;}
  if(kind!=='invite'){lobby.code=this.newCode();await this._publish(lobby);this._members();return true;}
  const pending=this.invites.filter(r=>r.status==='pending');if(pending.length>=6)await this.refreshInvite('cancel',pending[0].id);
  const row={id:++this.inviteSequence,status:'pending',at:Date.now(),guest:'',note:'',attempt:null};this.invites.push(row);
  while(this.invites.length>12){const i=this.invites.findIndex(r=>['used','dead'].includes(r.status));if(i<0)break;this.invites.splice(i,1);}
  let attempt=null;
  try{attempt=await this.connector.makeInvite({signal:lobby.controller.signal,
    onReady:connection=>this._ready(lobby,connection,row),
    onTerminal:summary=>{if(sessionEpoch!==this.sessionEpoch)return;lobby.attempts.delete(attempt);row.attempt=null;if(!summary.adopted&&row.status!=='used'){row.status='dead';row.note=summary.reason;}this._phase();},
    onFailure:error=>{if(this._current(lobby))this._error(error,{inviteId:row.id});}});
   if(!this._current(lobby)||row.status==='dead'){attempt.closeUnentered('Invitation retired');return false;}
   if(!attempt.snapshot().closed){row.attempt=attempt;lobby.attempts.add(attempt);}
   this.bridge.emit('invite_ready',{id:row.id,code:attempt.offerText});this._phase();return true;
  }catch(error){if(sessionEpoch===this.sessionEpoch){row.status='dead';row.note=error.message;this._phase();}throw error;}
 }
 async acceptAnswer(id,code){const sessionEpoch=this.sessionEpoch,row=this._invite(id);if(!row||row.status!=='pending'||!row.attempt)throw Error('没有待应答的邀请码');row.status='answering';this._phase();
  try{return await row.attempt.acceptAnswer(code);}catch(error){if(sessionEpoch!==this.sessionEpoch)throw error;if(row.status!=='used'){row.status='dead';row.note=error.message;row.attempt?.closeUnentered('Invalid answer');row.attempt=null;}this._phase();throw error;}}
 setRoomMode(mode){if(!this.lobby?.open&&!this.sessions.hasEnteredConnections())throw Error('没有可用大厅或原连接组');this.nextMode=modeOf(mode);this._members();}
 async joinByRoomCode(code){return this._join('room',code);}
 async joinByInvite(code){return this._join('invite',code);}
 async _join(kind,code){
  if(this.coordinator.blocksReplacementJoin?.()||this.sessions.hasEnteredConnections())throw Error('当前原连接仍在使用，不能重新加入替换');
  this.cancelJoin();this.role='guest';const marker={controller:new AbortController(),attempt:null,epoch:this.sessionEpoch};let registeredPeerId=null;this.joinAttempt=marker;this._phase();
  const onReady=async connection=>{if(this.joinAttempt!==marker){connection.closeUnentered('Join superseded');return;}
   const record=this.sessions.registerReady(connection);registeredPeerId=record.peerId;this.joinAttempt=null;this.members.set(record.peerId,{queued:true});this._phase();await this.onRegistered({...record,role:'guest',source:kind});};
  const options={code,signal:marker.controller.signal,onReady,onTerminal:summary=>{
   marker.attempt=null;if(!summary.adopted&&this.joinAttempt===marker){this.joinAttempt=null;this._phase();}},onFailure:(error,detail)=>{
   if(marker.epoch!==this.sessionEpoch)return;this._error(error,{scope:'initial-attempt',attemptId:detail?.attemptId,peerId:registeredPeerId,retired:this.joinAttempt!==marker&&!registeredPeerId});}};
  try{const attempt=await (kind==='room'?this.connector.joinRoom(options):this.connector.joinInvite({...options,onAnswerCode:answer=>{
     if(this.joinAttempt!==marker)return;this.bridge.setPhase('answer_ready');this.bridge.emit('answer_ready',{code:answer});}}));
   marker.attempt=attempt;if(this.joinAttempt!==marker)attempt.closeUnentered('Join no longer pending');return true;
  }catch(error){if(this.joinAttempt===marker){this.joinAttempt=null;marker.controller.abort();this._phase();}throw error;}
 }
 cancelJoin(){const marker=this.joinAttempt;this.joinAttempt=null;marker?.controller.abort();marker?.attempt?.closeUnentered('Join cancelled');
  if(this.role==='guest')this.sessions.closeOnlyNeverEntered('Join cancelled');this._phase();}
 async cancelAll(){++this.sessionEpoch;if(this.role!=='host')return this.cancelJoin();const lobby=this.lobby;if(lobby)lobby.open=false;
  ++this.publicationEpoch;this.publication?.endAndClearRetained('Lobby dissolved');this.publication=null;lobby?.controller.abort();
  for(const row of this.invites)if(row.status!=='used'){row.status='dead';row.note='大厅已解散';row.attempt?.closeUnentered(row.note);row.attempt=null;}
  for(const attempt of lobby?.attempts||[])attempt.closeUnentered('Lobby dissolved');lobby?.attempts.clear();this.pendingOffers.clear();this.acceptedRoomPeers.clear();this.offerTimes.clear();
  this.sessions.closeOnlyNeverEntered('Lobby dissolved');this.lobby=null;this.bridge.emit('cancelled',{scope:'public lobby'});this._members();
 }
 resetSession(){if(this.sessions.list().length||this.lobby||this.joinAttempt||this.publication)throw Error('原会话尚未完全关闭');
  ++this.sessionEpoch;this.role='';this.members.clear();this.invites=[];this.pendingOffers.clear();this.acceptedRoomPeers.clear();this.offerTimes.clear();this._members();}
 async restartRoom(mode){if(!this.coordinator.restartRoom)throw Error('当前联机环境不支持受控续局');return this.coordinator.restartRoom(modeOf(mode||this.nextMode));}
 setQueued(peerId,queued){if(!this.sessions.get(peerId))throw Error('Unknown actual registered peer');this.members.set(peerId,{queued:queued===true});this._members();}
 onSessionChanged(){for(const id of this.members.keys())if(!this.sessions.get(id))this.members.delete(id);for(const [key,id]of this.acceptedRoomPeers)if(!this.sessions.isLive(id))this.acceptedRoomPeers.delete(key);
  for(const row of this.invites)if(row.status==='used'&&row.peerId){const record=this.sessions.get(row.peerId);if(record)row.guest=record.identity.name||'';}this._members();}
 inviteMetadata(){return this.invites.map(({id,status,at,guest,note})=>({id,status,at,guest,note}));}
 snapshot(){return {role:this.role,lobbyOpen:!!this.lobby?.open,roomCode:this.lobby?.open?this.lobby.code:null,nextMode:this.nextMode,invites:this.inviteMetadata(),members:this.sessions.list()};}
 resourceSnapshot(){return {attempts:this.lobby?.attempts.size||0,pendingOffers:this.pendingOffers.size,acceptedOfferMetadata:this.acceptedRoomPeers.size,offerRateMetadata:this.offerTimes.size,memberMetadata:this.members.size,invitationMetadata:this.invites.length};}
}


// Actual carrier/coordinator and renderer with deterministic PC/DC/MQTT fixtures.
// These regressions do not provide physical two-machine, native WebRTC or real game evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fixture,until,drain,deferred,enter,enrollment,CarrierRuntime,runCases} from './fixtures/keepalive-lifecycle.mjs';
import {createEngineOperationPort} from '../online-kernel/keepalive/engine-operation-port.js';
globalThis.require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL('../client.js',import.meta.url),'utf8');
const support=source.slice(source.indexOf('function onlinePickEvent('),source.indexOf('    function OnlinePanel('));
const modal=source.slice(source.indexOf('function ModalFrame('),source.indexOf('    function renderRadioGroup('));
const batchStart=source.indexOf('function renderBatchProposals('),batchEnd=source.indexOf('function renderManifestCard(',batchStart);
assert.ok(batchStart>=0&&batchEnd>batchStart,'the actual shared transfer renderer must be extracted');
const batch=source.slice(batchStart,batchEnd);
const limitStart=source.indexOf('function renderTransferLimit(');
assert.ok(limitStart>=0&&limitStart<batchStart,'the actual transfer limit renderer must be extracted');
const limit=source.slice(limitStart,batchStart);
const manifest=source.slice(source.indexOf('function renderManifestCard('),source.indexOf('function leaveRoom('));
const room=source.slice(source.indexOf('function roomBrief()'),source.indexOf('      function renderOnlinePanel()'));
const render=new Function('bridge','evs','isRoomHost','roomMode','onlineRound','onlineNext','onlineRoom','roomCode','MODE_MAX','ONLINE_MODES','SEAT_COLORS','h','e','sendCmd','setRoomMode','setRoomPopupOpen','setNote','copyText','leaveRoom','renderInviteCard','ModalFrame','roomOpenerRef','onlineScope','note','bridgeOnline','batchUi','setBatchUi','window','status','transferLimitDraft','setTransferLimitDraft',support+limit+batch+manifest+room+';return renderRoomModal();');
const caps={identity:8,guozhan:8,versus:8,doudizhu:3,single:2},modes=Object.keys(caps).map(id=>({id,name:id}));
const h=(tag,props,...children)=>typeof tag==='function'?tag({...props,children:children.flat(Infinity)}):({tag,props:props||{},children:children.flat(Infinity)}),e=(tag,className,...children)=>h(tag,{className},...children);
const ModalFrame=new Function('React','h',modal+';return ModalFrame;')({useRef:value=>({current:value}),useEffect(){}},h);
const nodes=x=>x&&typeof x==='object'?[x,...x.children.flatMap(nodes)]:[],text=x=>x&&typeof x==='object'?x.children.map(text).join(''):String(x??'');
const latest=k=>k.bridge.events.findLast(e=>e.type==='room_members')?.data;
function draw(data,host=true){return render({cfg:{transferLimitMB:128}},[{type:'room_members',data}],host,data.mode,null,null,null,data.roomCode,caps,modes,['red'],h,e,()=>{throw Error('Rendering must not send a command');},()=>{},()=>{},()=>{},()=>{},()=>{},()=>null,ModalFrame,{current:null},'lobby-members-room','',true,{},()=>{},{},{batchRecovery:{status:'none'}},'128',()=>{throw Error('Rendering must not change the transfer-limit draft');});}
async function connected(mode,profiles={}){
 const f=fixture(),runtimes=[];
 function make(name){const bridge=f.bridge(),native={onInvalidated:()=>()=>{},snapshot:async()=>({})},ipc={on(){},removeListener(){}},nnk={state:{},modules:{rtc:f.rtc,signaling:f.signaling,bridge}};
  const runtime=new CarrierRuntime({nnk,native,ipc,profile:profiles[name]||{config:{onlineName:name,onlineAvatar:'caocao'},identity:{}}});const k={runtime,bridge};runtimes.push(k);return k;}
 const host=make('Host');
 async function join(name){const guest=make(name),pending=guest.runtime.joinByRoomCode(host.runtime.lobby.snapshot().roomCode);await until(()=>[...f.timers.timers.values()].some(x=>x.ms===40),'actual connector room delay');f.timers.fire(40);await pending;await until(()=>guest.runtime.coordinator.remoteLobby!==undefined,'validated Host lobby-state');await drain();return guest;}
 await host.runtime.createInternetRoom(mode);const guest=await join('Guest');
 async function close(){for(const k of runtimes)k.runtime.dispose();for(const k of runtimes){for(const r of k.runtime.sessions.snapshot())k.runtime.sessions.getOwner(r.peerId)?.stopTransport('fixture cleanup');k.runtime.lobby.publication?.endAndClearRetained('fixture cleanup');for(const a of [...k.runtime.connector.attempts])a.closeUnentered('fixture cleanup');}await f.close();}
 return {f,host,guest,join,close};
}
// Real carrier/coordinator/operation-port code; native documents and settlement
// observations below are deterministic fixtures, not native or physical two-machine coverage.
function simulatedDocuments(f){
 const adapters=[];for(const [side,role]of [[f.host,'host'],[f.guest,'guest']]){
  const runtime=side.runtime,manager=runtime.engines,db=new Map([['nnk_onlineName',role==='host'?'Host':'Guest'],['nnk_onlineAvatar','caocao']]),bindings=[];let generation=0;
  manager.create=async round=>{
   const scope={sessionId:round.partySessionId,roundId:round.roundId,documentGeneration:++generation,bindingId:crypto.randomUUID(),bindingNonce:crypto.randomUUID(),expectedOrigin:'http://fixture'},b={windowId:generation+(role==='host'?100:200),lease:round,scope,pending:new Map(),closed:false,error:null,port:null,status:{role,capacity:2,waiting:role==='host',environmentProofReady:true,seats:[{playerid:'1'}],clients:[],peerProofs:[]}};
   const config={connect_nickname:db.get('connect_nickname')||db.get('nnk_onlineName'),connect_avatar:db.get('connect_avatar')||db.get('nnk_onlineAvatar')},env={lib:{db:{},version:'fixture',config,translate:{}},get:{connectNickname:()=>config.connect_nickname},game:{saveConfig(key,value,local,done){db.set(key+(local?'_mode_config_'+local:''),value);config[key]=value;done();},getDB(_store,key,done){done(db.get(key));}}};
   const nnk={env,modules:{config:{defaults:{onlineName:'',onlineAvatar:''},get:key=>db.get('nnk_'+key)||''},compat:{hasCharacter:()=>true,applyIdentity(){config.connect_nickname=db.get('nnk_onlineName')||config.connect_nickname;config.connect_avatar=db.get('nnk_onlineAvatar')||config.connect_avatar;}}}};
   b.fixtureEnv=env;b.operations=createEngineOperationPort(nnk,{scope,isCurrent:()=>manager.current===b&&!b.closed,onEvent:(name,data)=>manager.onModuleEvent(b,name,data)});manager.current=b;bindings.push(b);return b;
  };
  manager.operation=(action,args,b=manager.current)=>b.operations.execute(action,args);
  manager.wait=async(b,condition)=>{try{await until(condition,'simulated native boundary for '+role);}catch(error){error.message+=' '+JSON.stringify({round:runtime.coordinator.round,members:[...runtime.coordinator.members.values()],status:b.status,events:runtime.events.slice(-8)});throw error;}assert.equal(manager.current,b);};
  manager.command=async(command,args={},b=manager.current)=>{
   assert.equal(manager.current,b);if(command==='next-plan')return {scope:b.scope,mode:args.mode,capacity:caps[args.mode],admission:true,configDigest:'2'.repeat(64)};
   if(command==='next-admission')return {scope:b.scope,admission:true};
   if(command==='reserve-start-peer')return {reserved:true};
   if(command==='prepare-host'){b.status.waiting=true;b.status.capacity=caps[args.mode];}
   if(command==='prepare-guest'){b.status.online=true;b.status.onlineID='simulated-seat';b.status.seats=[{playerid:'1'},{playerid:'simulated-seat'}];b.status.peerProofs=[{peerId:args.peerId,handshakeOrderInvalid:false,handshakeOrder:'in:opened,out:init,in:init,out:inited'}];}
   if(command==='admit'){b.status.clients=[{id:'simulated-seat',peerId:args.peerId,inited:true}];b.status.seats=[{playerid:'1'},{playerid:'simulated-seat'}];b.status.peerProofs=[{peerId:args.peerId,handshakeOrderInvalid:false,handshakeOrder:'out:opened,in:init,out:init,in:inited'}];}
   if(command==='confirm-seat')return {confirmed:true,peerId:args.peerId};if(command==='activate-seat')return {activated:true,peerId:args.peerId};return {};
  };
  manager.retire=async()=>{const b=manager.current;if(b){b.closed=true;b.operations.dispose();manager.current=null;}return {windowId:b?.windowId,confirmation:{confirmed:true},errors:[]};};
  adapters.push({runtime,manager,db,bindings});
 }
 return {adapters,async start(){await f.host.runtime.restartRoom('single');await until(()=>f.host.runtime.sessions.snapshot()[0]?.entered&&f.guest.runtime.sessions.snapshot()[0]?.entered,'production coordinator simulated initial seating');},async returnRoom(){
  const h=f.host.runtime.coordinator,g=f.guest.runtime.coordinator,hp=h.sessions.snapshot()[0].peerId,b=f.host.runtime.engines.current;for(const c of [h,g]){c.round.phase='settled';c.round.settlementReady=true;}
  const fence={hostScope:b.scope,barrierId:'fixture-barrier',revision:1,rosterDigest:'1'.repeat(64)};h.settlement.host={round:h.round,peers:[hp],...fence,acks:new Map([[hp,{}]]),fences:new Map()};g.settlement.guest={round:g.round,acked:true,data:fence};
  await f.host.runtime.coordinator.returnToPluginRoom();await until(()=>g.room.ready(),'production Guest returned to plugin room');
 },close(){for(const a of adapters){for(const b of a.bindings)b.operations.dispose();a.manager.current=null;}}};
}
const cases=[];
for(const [mode,capacity]of Object.entries(caps))cases.push(['first real carrier lobby '+mode+' shares two admitted members and correct capacity with its actual renderer',async()=>{
 const f=await connected(mode);try{const host=latest(f.host),guest=latest(f.guest);assert.equal(host.list.length,2);assert.equal(host.list.filter(p=>!p.queued).length,2);assert.equal(host.capacity,capacity);assert.equal(guest.capacity,capacity);assert.deepEqual(guest.list,host.list);assert.equal(host.list.some(p=>p.entered),false);
  for(const [data,isHost]of [[host,true],[guest,false]]){const tree=draw(data,isHost),all=nodes(tree),grid=all.find(n=>n.props.className==='nnk-rm-seats');assert.equal(grid.children.length,capacity);assert.equal(all.filter(n=>n.props.className==='nnk-seat nnk-seat-empty').length,capacity-2);assert.match(text(tree),new RegExp('2/'+capacity+' 人在房'));
   const limitControls=all.filter(n=>n.props['data-nnk-transfer-limit']===true);assert.equal(limitControls.length,1,'the room manifest must render its real transfer limit control');
   const limitNodes=nodes(limitControls[0]),limitInput=limitNodes.find(n=>n.tag==='input'),limitSave=limitNodes.find(n=>n.tag==='button');
   assert.match(text(limitControls[0]),/本机单批补传上限（MiB）/);assert.equal(limitInput.props.min,1);assert.equal(limitInput.props.max,1024);assert.equal(limitInput.props.value,'128');assert.equal(limitSave.props.disabled,true,'an unchanged confirmed limit must not send a redundant write');}
  assert.equal(f.host.runtime.engines.current,null);assert.equal(f.guest.runtime.engines.current,null);assert.equal(f.host.runtime.coordinator.members.size,0);assert.equal(f.guest.bridge.phases.at(-1).phase,'lobby_waiting');
 }finally{await f.close();}
}]);
cases.push(['real capacity overflow is a separate queue; expanding mode reuses actual Owners without native enrollment',async()=>{
 const f=await connected('single');try{const second=await f.join('Guest2'),before=f.host.runtime.sessions.snapshot().map(r=>f.host.runtime.sessions.getOwner(r.peerId).actualIdentity()),data=latest(f.host),tree=draw(data),all=nodes(tree),grid=all.find(n=>n.props.className==='nnk-rm-seats'),queue=all.find(n=>n.props.className==='nnk-rm-queue');
  assert.equal(data.list.filter(p=>!p.queued).length,2);assert.equal(grid.children.length,2);assert.equal(queue.children.filter(n=>n&&typeof n==='object'&&n.props.className?.includes('nnk-seat-queued')).length,1);assert.equal(second.bridge.phases.at(-1).phase,'queued');
  f.host.runtime.setRoomMode('doudizhu');await drain();const expanded=latest(f.host);assert.equal(expanded.capacity,3);assert.equal(expanded.list.filter(p=>!p.queued).length,3);assert.equal(latest(second).capacity,3);assert.equal(second.bridge.phases.at(-1).phase,'lobby_waiting');assert.deepEqual(f.host.runtime.sessions.snapshot().map(r=>f.host.runtime.sessions.getOwner(r.peerId).actualIdentity()),before);assert.equal(f.host.runtime.engines.current,null);assert.equal(f.host.runtime.coordinator.members.size,0);
 }finally{await f.close();}
}]);
cases.push(['Guest local session/identity notifications cannot publish a synthetic local room or overwrite Host mode capacity',async()=>{
 const f=await connected('single');try{const before=f.guest.bridge.events.filter(e=>e.type==='room_members').length;f.guest.runtime.lobby.onSessionChanged();f.guest.runtime.lobby._members();f.guest.runtime.update();assert.equal(f.guest.bridge.events.filter(e=>e.type==='room_members').length,before);
  for(const mode of ['guozhan','doudizhu','identity','versus','single']){f.host.runtime.setRoomMode(mode);await drain();const host=latest(f.host),guest=latest(f.guest);assert.equal(guest.mode,mode);assert.equal(guest.capacity,caps[mode]);assert.deepEqual(guest.list,host.list);assert.equal(guest.list[0].role,'host');assert.equal(guest.roomCode,host.roomCode);}
 }finally{await f.close();}
}]);
cases.push(['active round admission and returned frozen roster remain authoritative over spare lobby capacity',async()=>{
 const f=await connected('doudizhu');try{await f.join('Guest2');const c=f.host.runtime.coordinator,records=c.sessions.snapshot(),chosen=records[1].peerId;c.round={partySessionId:'fixture-party',roundId:'fixture-round',operationId:'fixture-operation',phase:'playing',mode:'doudizhu',failed:false};c.members.set(chosen,{peerId:chosen,phase:'entered',timer:null});f.host.runtime.engines.current={status:{capacity:3,seats:[{playerid:'1'}]}};
  f.host.runtime.lobby._members();let view=latest(f.host);assert.equal(view.list.find(p=>p.peerId===chosen).queued,false);assert.equal(view.list.find(p=>p.peerId===records[0].peerId).queued,true);assert.equal(c.members.size,1);
  f.host.runtime.engines.current=null;c.members.clear();c.round.phase='plugin-room';c.room.receipt={complete:true,round:c.round,peers:[chosen],plans:{doudizhu:{capacity:3}}};f.host.runtime.lobby._members();view=latest(f.host);assert.equal(view.list.find(p=>p.peerId===chosen).queued,false);assert.equal(view.list.find(p=>p.peerId===records[0].peerId).queued,true);assert.equal(c.members.size,0);
 }finally{f.host.runtime.engines.current=null;f.host.runtime.coordinator.room.receipt=null;await f.close();}
}]);
cases.push(['validated Host view rejects malformed capacity/recipient metadata and legacy null capacity follows the mode',async()=>{
 const f=await connected('identity');try{const c=f.guest.runtime.coordinator,owner=c.sessions.getOwner(c.guestPeer),view=latest(f.host),base={protocol:'nnk-round/1',requestId:crypto.randomUUID(),partySessionId:null,roundId:null,operationId:null,roomCode:view.roomCode,hostIdentity:{name:'Host',avatar:'caocao'},mode:view.mode,nextMode:view.nextMode,members:view.list,capacity:view.capacity,caps:view.caps,targetPeerId:view.list[1].peerId};
  assert.equal(c.validate(owner,{type:'lobby-state',data:base}),true);
  for(const bad of [{capacity:1},{capacity:65},{caps:{...caps,identity:0}},{caps:'invalid'},{nextMode:'invalid'},{targetPeerId:'not-a-room-member'}])assert.notEqual(c.validate(owner,{type:'lobby-state',data:{...base,...bad}}),true);
  const legacy={...base,capacity:null};delete legacy.caps;delete legacy.nextMode;delete legacy.targetPeerId;assert.equal(c.validate(owner,{type:'lobby-state',data:legacy}),true);await c.control(owner,{type:'lobby-state',data:legacy});assert.equal(latest(f.guest).capacity,8);
 }finally{await f.close();}
}]);
cases.push(['changed Host identity reaches both shared member lists and its current transport identity',async()=>{
 const f=await connected('single');try{f.host.runtime.confirmProfile({config:{...f.host.runtime.profile.config,onlineName:'Updated Host',onlineAvatar:'liubei'}});f.host.runtime.lobby.onSessionChanged();await drain();assert.equal(latest(f.host).list[0].name,'Updated Host');assert.equal(latest(f.guest).list[0].name,'Updated Host');assert.equal(latest(f.guest).list[0].avatar,'liubei');assert.equal(f.guest.runtime.sessions.get(f.guest.runtime.coordinator.guestPeer).identity.name,'Updated Host');assert.equal(f.host.runtime.engines.current,null);
 }finally{await f.close();}
}]);
cases.push(['enrolled Guest identity result updates Host authority and both projections on the same actual transport',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0],gp=g.sessions.snapshot()[0],ho=h.sessions.getOwner(hp.peerId),go=g.sessions.getOwner(gp.peerId),before=[ho.actualIdentity(),go.actualIdentity()];enter(h.sessions,hp,ho,{local:1,remote:1});enter(g.sessions,gp,go,{local:1,remote:1});
  const r={...enrollment,mode:'single',phase:'waiting',failed:false};h.coordinator.round={...r};g.coordinator.round={...r};h.coordinator.members.set(hp.peerId,{peerId:hp.peerId,phase:'entered',timer:null});const binding={scope:{roundId:r.roundId},pending:new Map(),closed:false};g.engines.current=binding;
  g.engines.operation=async()=>({profile:{config:{onlineName:'UpdatedGuest',onlineAvatar:'liubei'},identity:{name:'UpdatedGuest',avatar:'liubei'}}});await g.dispatch({action:'set_identity',args:{name:'UpdatedGuest',avatar:'liubei'}});await drain();
  assert.deepEqual(h.sessions.get(hp.peerId).identity,{name:'UpdatedGuest',avatar:'liubei'});assert.equal(latest(f.host).list[1].name,'UpdatedGuest');assert.deepEqual(latest(f.guest).list,latest(f.host).list);assert.equal(g.coordinator.identityAcknowledged,1);assert.equal(g.coordinator.identityPending,null);assert.equal(h.coordinator.identityVersions.size,1);assert.equal(h.sessions.isEntered(hp.peerId),true);assert.equal(g.sessions.isEntered(gp.peerId),true);assert.deepEqual([ho.actualIdentity(),go.actualIdentity()],before);assert.equal(ho.snapshot().negotiations,1);assert.equal(go.snapshot().negotiations,1);
  assert.equal(h.coordinator.validate(ho,{type:'party-request',data:{protocol:'nnk-round/1',requestId:'cannot-rejoin',partySessionId:null,roundId:null,operationId:null,identity:{name:'Wrong',avatar:'caocao'}}}),false);
 }finally{f.guest.runtime.engines.current=null;await f.close();}
}]);
cases.push(['Guest persistence through actual operation port, control update, return protocol and next document preserves the transport and enrollment',async()=>{
 const f=await connected('single'),docs=simulatedDocuments(f);try{await docs.start();const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0].peerId,gp=g.sessions.snapshot()[0].peerId,owners=[h.sessions.getOwner(hp),g.sessions.getOwner(gp)],before=owners.map(o=>o.actualIdentity()),oldDocument=g.engines.current;
  const result=await g.dispatch({action:'set_identity',args:{name:'RenamedGuest',avatar:'liubei'}});assert.equal(result.applied.name,'RenamedGuest');await drain();assert.deepEqual(h.sessions.get(hp).identity,{name:'RenamedGuest',avatar:'liubei'});assert.equal(g.coordinator.identityAcknowledged,1);assert.equal(g.coordinator.identityPending,null);assert.equal(h.sessions.isEntered(hp),true);assert.equal(g.sessions.isEntered(gp),true);assert.equal(g.engines.current,oldDocument);
  for(const side of [f.host,f.guest]){const member=latest(side).list.find(m=>m.role==='guest');assert.equal(member.name,'RenamedGuest');assert.equal(member.avatar,'liubei');}
  await docs.returnRoom();assert.equal(h.engines.current,null);assert.equal(g.engines.current,null);assert.equal(latest(f.host).list[1].name,'RenamedGuest');assert.deepEqual(latest(f.guest).list,latest(f.host).list);
  h.setRoomMode('identity');await h.restartRoom('identity');await until(()=>g.sessions.isEntered(gp),'next simulated native document entered');assert.notEqual(g.engines.current,oldDocument);assert.equal(g.engines.current.scope.documentGeneration,2);const profile=await g.engines.operation('profile',{},g.engines.current);assert.equal(profile.identity.name,'RenamedGuest');assert.equal(profile.identity.avatar,'liubei');assert.deepEqual(h.sessions.get(hp).identity,{name:'RenamedGuest',avatar:'liubei'});assert.deepEqual(latest(f.guest).list,latest(f.host).list);assert.deepEqual(owners.map(o=>o.actualIdentity()),before);for(const owner of owners){assert.equal(owner.snapshot().negotiations,1);assert.equal(owner.snapshot().reconnectAttempts,0);assert.equal(owner.snapshot().pcConstructions,1);assert.equal(owner.snapshot().attaches,2);}
 }finally{docs.close();await f.close();}
}]);
cases.push(['boot native identity wins over nonempty workshop values in both authoritative member views',async()=>{
 const profiles=Object.fromEntries(['Host','Guest'].map(role=>[role,{config:{onlineName:'Workshop'+role,onlineAvatar:'caocao'},identity:{connectNickname:'Engine'+role,connectAvatar:'liubei'}}])),f=await connected('single',profiles);try{
  assert.deepEqual(f.host.runtime.coordinator.getLocalIdentity(),{name:'EngineHost',avatar:'liubei'});assert.deepEqual(f.guest.runtime.coordinator.getLocalIdentity(),{name:'EngineGuest',avatar:'liubei'});
  for(const side of [f.host,f.guest]){assert.deepEqual(latest(side).list.map(m=>({name:m.name,avatar:m.avatar})),[{name:'EngineHost',avatar:'liubei'},{name:'EngineGuest',avatar:'liubei'}]);}
 }finally{await f.close();}
}]);
cases.push(['empty avatar uses the successful native identity through authority, plugin return and next document',async()=>{
 const f=await connected('single',{Guest:{config:{onlineName:'Guest',onlineAvatar:'caocao'},identity:{connectNickname:'Guest',connectAvatar:'caocao'}}}),docs=simulatedDocuments(f);try{await docs.start();const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0].peerId,gp=g.sessions.snapshot()[0].peerId,owners=[h.sessions.getOwner(hp),g.sessions.getOwner(gp)],before=owners.map(o=>o.actualIdentity()),binding=g.engines.current,env=binding.fixtureEnv;
  env.game.saveConfig('connect_avatar','liubei',false,()=>{});env.game.saveConfig('connect_avatar','liubei','connect',()=>{});
  const reply=await g.dispatch({action:'set_identity',args:{name:'ChosenGuest',avatar:''}});await drain();assert.equal(reply.profile.config.onlineAvatar,'');assert.equal(reply.applied.avatar,'liubei');assert.equal(reply.profile.identity.avatar,'liubei');assert.equal(g.profile.identity.connectAvatar,'caocao');assert.deepEqual(g.coordinator.getLocalIdentity(),{name:'ChosenGuest',avatar:'liubei'});assert.deepEqual(h.sessions.get(hp).identity,{name:'ChosenGuest',avatar:'liubei'});assert.equal(g.engines.current,binding);assert.equal(g.sessions.isEntered(gp),true);assert.equal(h.sessions.isEntered(hp),true);assert.equal(g.coordinator.identityAcknowledged,1);assert.equal(f.guest.bridge.events.findLast(e=>e.type==='identity_applied').data.avatar,'liubei');
  for(const side of [f.host,f.guest])assert.equal(latest(side).list.find(m=>m.role==='guest').avatar,'liubei');await docs.returnRoom();assert.equal(latest(f.host).list.find(m=>m.role==='guest').avatar,'liubei');h.setRoomMode('identity');await h.restartRoom('identity');await until(()=>g.sessions.isEntered(gp),'next empty-avatar document entered');const next=await g.engines.operation('profile',{},g.engines.current);assert.equal(next.config.onlineAvatar,'');assert.equal(next.identity.avatar,'liubei');assert.equal(g.engines.current.scope.documentGeneration,2);assert.deepEqual(latest(f.guest).list,latest(f.host).list);assert.equal(latest(f.host).list.find(m=>m.role==='guest').avatar,'liubei');assert.deepEqual(owners.map(o=>o.actualIdentity()),before);for(const owner of owners){assert.equal(owner.snapshot().negotiations,1);assert.equal(owner.snapshot().reconnectAttempts,0);assert.equal(owner.snapshot().pcConstructions,1);}
 }finally{docs.close();await f.close();}
}]);
cases.push(['successful config profile preserves native manual name and avatar despite nonempty workshop settings',async()=>{
 const f=await connected('single',{Guest:{config:{onlineName:'Guest',onlineAvatar:'caocao'},identity:{connectNickname:'Guest',connectAvatar:'caocao'}}}),docs=simulatedDocuments(f);try{await docs.start();const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0].peerId,gp=g.sessions.snapshot()[0].peerId,owners=[h.sessions.getOwner(hp),g.sessions.getOwner(gp)],before=owners.map(o=>o.actualIdentity()),env=g.engines.current.fixtureEnv;
  for(const [key,value]of [['connect_nickname','EngineGuest'],['connect_avatar','liubei']]){env.game.saveConfig(key,value,false,()=>{});env.game.saveConfig(key,value,'connect',()=>{});}
  const reply=await g.dispatch({action:'set_config',args:{key:'unlockUIExtensions',value:true}});await drain();assert.equal(reply.profile.config.onlineName,'Guest');assert.equal(reply.profile.config.onlineAvatar,'caocao');assert.deepEqual(g.coordinator.getLocalIdentity(),{name:'EngineGuest',avatar:'liubei'});assert.deepEqual(h.sessions.get(hp).identity,{name:'EngineGuest',avatar:'liubei'});assert.equal(g.coordinator.identityAcknowledged,1);for(const side of [f.host,f.guest])assert.equal(latest(side).list.find(m=>m.role==='guest').avatar,'liubei');await docs.returnRoom();h.setRoomMode('identity');await h.restartRoom('identity');await until(()=>g.sessions.isEntered(gp),'next manual-choice document entered');const next=await g.engines.operation('profile',{},g.engines.current);assert.equal(next.identity.name,'EngineGuest');assert.equal(next.identity.avatar,'liubei');assert.equal(next.config.onlineName,'Guest');assert.equal(next.config.onlineAvatar,'caocao');assert.deepEqual(latest(f.guest).list,latest(f.host).list);assert.equal(latest(f.host).list.find(m=>m.role==='guest').name,'EngineGuest');assert.deepEqual(owners.map(o=>o.actualIdentity()),before);for(const owner of owners){assert.equal(owner.snapshot().negotiations,1);assert.equal(owner.snapshot().reconnectAttempts,0);assert.equal(owner.snapshot().pcConstructions,1);}
 }finally{docs.close();await f.close();}
}]);
cases.push(['identity update rejects old revisions, duplicate requests, wrong sessions, malformed values and foreign Owners without reopening party admission',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0].peerId,ho=h.sessions.getOwner(hp),go=g.sessions.getOwner(g.coordinator.guestPeer);g.confirmProfile({config:{onlineName:'CurrentGuest',onlineAvatar:'liubei'}});await drain();const sent=JSON.parse(go.actualIdentity().link.sent.findLast(raw=>JSON.parse(raw).type==='identity-update')),before=h.sessions.get(hp).identity;
  assert.equal(h.coordinator.validate(ho,sent),false);assert.equal(h.coordinator.validate({},sent),false);assert.equal(g.coordinator.validate(go,sent),false);
  const next={...sent,seq:sent.seq+100,data:{...sent.data,requestId:crypto.randomUUID(),revision:sent.data.revision+1}};assert.equal(h.coordinator.validate(ho,next),true);
  for(const patch of [{revision:0},{revision:sent.data.revision},{revision:1000000001},{revision:1.1},{requestId:sent.data.requestId},{requestId:''},{connectionSessionId:'another-pair'},{protocol:'nnk-round/1'},{partySessionId:'round'},{identity:{name:'x'.repeat(13),avatar:'liubei'}},{identity:{name:'Good',avatar:'x'.repeat(25)}},{identity:{name:'Good',avatar:'liubei',other:true}},{identity:null},{extra:true}]){const bad={...next,data:{...next.data,...patch}};assert.equal(h.coordinator.validate(ho,bad),false);assert.equal(await h.coordinator.control(ho,bad),false);}
  assert.equal(h.coordinator.validate(ho,{...next,sourcePeer:'host'}),false);assert.equal(h.coordinator.validate(ho,{...next,sessionId:'another-pair'}),false);assert.deepEqual(h.sessions.get(hp).identity,before);
  const rejected=ho.snapshot().rejected;go.sendControl('identity-update',{...sent.data,revision:sent.data.revision+1,requestId:crypto.randomUUID(),identity:{name:'too-long-name-here',avatar:'liubei'}});await drain();assert.equal(ho.snapshot().rejected,rejected+1);assert.deepEqual(h.sessions.get(hp).identity,before);assert.equal(ho.stopped,false);assert.equal(go.stopped,false);
 }finally{await f.close();}
}]);
cases.push(['Guest accepts only the current request-correlated Host identity acknowledgement',async()=>{
 const f=await connected('single');try{const g=f.guest.runtime,c=g.coordinator,owner=g.sessions.getOwner(c.guestPeer);g.confirmProfile({config:{onlineName:'AwaitingGuest',onlineAvatar:'liubei'}});const pending=c.identityPending,frame={type:'identity-updated',sessionId:pending.connectionSessionId,sourcePeer:'host',seq:pending.afterHostSequence+1,data:{protocol:'nnk-identity/1',partySessionId:null,roundId:null,operationId:null,requestId:crypto.randomUUID(),updateRequestId:pending.requestId,connectionSessionId:pending.connectionSessionId,revision:pending.revision,identity:{...pending.identity}}};assert.equal(c.validate(owner,frame),true);
  for(const patch of [{updateRequestId:'other'},{revision:pending.revision+1},{connectionSessionId:'other'},{identity:{name:'Other',avatar:'liubei'}}])assert.equal(c.validate(owner,{...frame,data:{...frame.data,...patch}}),false);assert.equal(c.validate({},frame),false);assert.equal(c.validate(owner,{...frame,seq:pending.afterHostSequence}),false);await drain();assert.equal(c.identityPending,null);assert.equal(c.identityAcknowledged,pending.revision);assert.equal(c.validate(owner,frame),false);
 }finally{await f.close();}
}]);
cases.push(['late uncorrelated identity notifications and out-of-order operation results cannot roll back a newer Guest profile',async()=>{
 const f=await connected('single');try{const g=f.guest.runtime,round={...enrollment,mode:'single',phase:'waiting'},binding={scope:{roundId:enrollment.roundId},closed:false,pending:new Map()};g.coordinator.round=round;g.engines.current=binding;const first=deferred(),second=deferred(),profile=name=>({config:{onlineName:name,onlineAvatar:'liubei'},identity:{name,avatar:'liubei'}});g.engines.operation=(_action,args)=>args.name==='OldGuest'?first.promise:second.promise;
  const old=g.dispatch({action:'set_identity',args:{name:'OldGuest',avatar:'liubei'}}),current=g.dispatch({action:'set_identity',args:{name:'NewGuest',avatar:'liubei'}});second.resolve({profile:profile('NewGuest')});await current;await drain();g.engines.onModuleEvent(binding,'identity_applied',{profile:profile('OldGuest'),name:'OldGuest',avatar:'liubei'});first.resolve({profile:profile('OldGuest')});await old;await drain();assert.equal(g.coordinator.getLocalIdentity().name,'NewGuest');assert.equal(latest(f.host).list[1].name,'NewGuest');assert.equal(latest(f.guest).list[1].name,'NewGuest');assert.equal(g.coordinator.identityRevision,1);assert.equal(g.profileOperations.size,0);
  const retired=deferred();g.engines.operation=()=>retired.promise;const late=g.dispatch({action:'set_identity',args:{name:'RetiredGuest'}});g.engines.current={...binding,scope:{roundId:'new-document'}};g.engines.onModuleEvent(binding,'identity_applied',{profile:profile('RetiredGuest')});retired.resolve({profile:profile('RetiredGuest')});await assert.rejects(late,/文档已退休/);assert.equal(g.coordinator.getLocalIdentity().name,'NewGuest');assert.equal(g.profileOperations.size,0);
 }finally{f.guest.runtime.engines.current=null;await f.close();}
}]);
cases.push(['identity acknowledgement timeout and transport retirement release their bounded state without reconnecting',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,g=f.guest.runtime,hp=h.sessions.snapshot()[0].peerId,ho=h.sessions.getOwner(hp),go=g.sessions.getOwner(g.coordinator.guestPeer),link=ho.actualIdentity().link,original=link.send;link.send=function(raw){if(JSON.parse(raw).type!=='identity-updated')return original.call(this,raw);};g.confirmProfile({config:{onlineName:'AckLost',onlineAvatar:'liubei'}});await drain();assert.ok(g.coordinator.identityPending);assert.equal(h.sessions.get(hp).identity.name,'AckLost');f.f.timers.fire(10000);assert.equal(g.coordinator.identityPending,null);assert.equal(f.guest.bridge.events.filter(e=>e.type==='error'&&e.data.identityRevision===1).length,1);assert.equal(go.snapshot().reconnectAttempts,0);link.send=original;
  g.confirmProfile({config:{onlineName:'NextGuest',onlineAvatar:'caocao'}});await drain();assert.equal(g.coordinator.identityAcknowledged,2);assert.equal(h.sessions.get(hp).identity.name,'NextGuest');go.stopTransport('explicit fixture retirement');await drain();assert.equal(h.coordinator.identityVersions.size,0);assert.equal(g.coordinator.identityPending,null);assert.equal(ho.snapshot().reconnectAttempts,0);
 }finally{await f.close();}
}]);
cases.push(['explicit same-value identity save can obtain a fresh correlated acknowledgement after a lost acknowledgement',async()=>{
 const f=await connected('single');try{const g=f.guest.runtime,h=f.host.runtime,owner=h.sessions.getOwner(h.sessions.snapshot()[0].peerId),link=owner.actualIdentity().link,send=link.send,binding={scope:{roundId:'fixture-round'},pending:new Map(),closed:false};g.coordinator.round={...enrollment,phase:'waiting'};g.engines.current=binding;const profile={config:{onlineName:'SameGuest',onlineAvatar:'liubei'},identity:{name:'SameGuest',avatar:'liubei'}};g.engines.operation=async()=>({profile});link.send=function(raw){if(JSON.parse(raw).type!=='identity-updated')return send.call(this,raw);};await g.dispatch({action:'set_identity',args:{name:'SameGuest',avatar:'liubei'}});await drain();f.f.timers.fire(10000);assert.equal(g.coordinator.identityPending,null);link.send=send;await g.dispatch({action:'set_identity',args:{name:'SameGuest',avatar:'liubei'}});await drain();assert.equal(g.coordinator.identityAcknowledged,2);assert.equal(g.coordinator.identityPending,null);assert.equal(owner.snapshot().negotiations,1);
 }finally{f.guest.runtime.engines.current=null;await f.close();}
}]);
cases.push(['profile operation request state is bounded and retired completions cannot commit',async()=>{
 const f=await connected('single');try{const g=f.guest.runtime,binding={scope:{roundId:'fixture-round'},pending:new Map(),closed:false},gates=Array.from({length:8},deferred);g.engines.current=binding;let called=0;g.engines.operation=()=>gates[called++].promise;const pending=gates.map(()=>g.dispatch({action:'set_identity',args:{name:'Bounded'}}));await assert.rejects(g.dispatch({action:'set_identity',args:{name:'Ninth'}}),/上限/);assert.equal(g.profileOperations.size,8);binding.closed=true;for(const gate of gates)gate.resolve({profile:{config:{onlineName:'Retired',onlineAvatar:'liubei'}}});for(const task of pending)await assert.rejects(task,/文档已退休/);assert.equal(g.profileOperations.size,0);assert.equal(g.coordinator.getLocalIdentity().name,'Guest');assert.equal(g.coordinator.identityRevision,0);
 }finally{f.guest.runtime.engines.current=null;await f.close();}
}]);
cases.push(['coordinator failed cleanup releases only its rejected cache and explicit retirement reconciles the retained exact owner',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,c=h.coordinator,round={...enrollment,phase:'waiting',mode:'single',failed:false},binding={closed:false,scope:null,status:{},pending:new Map(),port:null};c.round=round;h.engines.current=binding;const owner=h.sessions.getOwner(h.sessions.snapshot()[0].peerId),before=owner.actualIdentity();let calls=0;h.engines.retire=async()=>{assert.equal(h.engines.current,binding);binding.closed=true;if(++calls===1)throw Error('temporary native confirmation failure');h.engines.current=null;return {confirmation:{confirmed:true},errors:[]};};c.fail(round,Error('actual operation failed'));const failed=c.cleanupPromise;await assert.rejects(failed,/temporary native confirmation/);assert.equal(c.cleanupPromise,null);assert.match(round.cleanupError,/temporary native confirmation/);assert.equal(h.engines.current,binding);assert.equal(binding.closed,true);assert.ok(f.host.bridge.events.some(e=>e.type==='error'&&e.data.message.includes('回收未完成')));const retried=await c.retire('single explicit exact-owner retry');assert.equal(retried.confirmation.confirmed,true);assert.equal(calls,2);assert.equal(h.engines.current,null);assert.deepEqual(owner.actualIdentity(),before);assert.equal(owner.snapshot().negotiations,1);
 }finally{f.host.runtime.engines.current=null;await f.close();}
}]);
cases.push(['late rejected old coordinator cleanup cannot clear a newer cleanup Promise',async()=>{
 const f=await connected('single');try{const c=f.host.runtime.coordinator,round={...enrollment,phase:'waiting',failed:false},held=deferred();c.round=round;c.retire=()=>held.promise;c.fail(round,Error('old failure'));const old=c.cleanupPromise,newer=Promise.resolve('newer exact-owner cleanup');c.cleanupPromise=newer;held.reject(Error('old cleanup rejected late'));await assert.rejects(old,/old cleanup rejected late/);assert.equal(c.cleanupPromise,newer);assert.match(round.cleanupError,/old cleanup rejected late/);
 }finally{await f.close();}
}]);
// Exercise the complete production OnlinePanel, including its real hooks,
// derived role/state, event handlers and main cards. Only React scheduling,
// polling and HTTP are fixtures; no browser, game, native or physical two-machine coverage.
function onlinePanelFixture(){
 const section=source.slice(source.indexOf('    var ONLINE_MODES = ['),source.indexOf('    // ── 工坊页('));
 assert.ok(section.includes('function OnlinePanel()'));
 const state=[],refs=[],commands=[];let cursor=0,refCursor=0,dirty=false,effects=[],current,tree;
 const React={useId:()=> 'lobby-members-panel',useRef(initial){const index=refCursor++;if(!(index in refs))refs[index]={current:initial};return refs[index];},useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{const next=typeof value==='function'?value(state[index]):value;if(!Object.is(next,state[index])){state[index]=next;dirty=true;}}];},
  // Supplied status snapshots replace only the two mount-time network polls.
  // Ordinary dependency-free effects run to convergence on every render.
  useEffect(callback,deps){if(deps===undefined)effects.push(callback);}};
 const request=async(url,options)=>{assert.equal(url,'/noname-kit-api/online/command','renderer fixture must not access a real endpoint');commands.push(JSON.parse(options.body));return {json:async()=>({ok:true})};};
 const Panel=new Function('React','h','e','fetch','location','navigator','window','ModalFrame',section+';return OnlinePanel;')(React,h,e,request,{port:'0'},{},{confirm:()=>true},ModalFrame);
 function drawStatus(status=current){current=status;state[0]=status;for(let i=0;i<30;i++){cursor=0;refCursor=0;dirty=false;effects=[];tree=Panel();for(const effect of effects)effect();if(!dirty){assert.equal(nodes(tree).some(n=>n.props.className==='nnk-err'&&text(n).includes('联机页渲染出错')),false,'production renderer must not hide a fixture error');return tree;}}throw Error('OnlinePanel fixture did not settle');}
 function click(match){const found=nodes(tree).filter(n=>n.tag==='button'&&match(text(n)));assert.equal(found.length,1,'one actual rendered button required');assert.notEqual(found[0].props.disabled,true);found[0].props.onClick();return drawStatus();}
 return {draw:drawStatus,click,commands,get tree(){return tree;}};
}
function panelStatus({role='guest',phase='lobby_waiting',roomCode='ABC234',continuation=null,events}={}){
 const data={mode:'single',nextMode:'single',capacity:2,caps,roomCode:'ABC234',list:[{peerId:'host',role:'host',name:'Host',queued:false,entered:false},{peerId:'fixture-guest',role:'guest',name:'Guest',queued:false,entered:false}]};
 return {active:true,kernel:{state:'ok'},bridge:{online:true,role,state:{phase,roomCode,continuation},events:events||[{type:'room_members',data}],cfg:{}}};
}
const roomButtons=tree=>nodes(tree).filter(n=>n.tag==='button'&&/^🏛 插件房间\(/.test(text(n)));
const isRoomModeInput=n=>n.tag==='input'&&typeof n.props.name==='string'&&n.props.name.endsWith('-room-mode');
const hostControls=tree=>nodes(tree).filter(n=>isRoomModeInput(n)||n.tag==='button'&&/解散|载入到游戏|生成邀请码|换一个房号/.test(text(n)));
const roomModals=tree=>nodes(tree).filter(n=>n.props.className==='nnk-modal'&&text(n).includes('🏛 NONAME-KIT 插件房间'));
async function rejoinSameGuest(f,method){
 const h=f.host.runtime,g=f.guest.runtime;
 if(method==='invite'){
  await h.refreshInvite('invite');const invitation=f.host.bridge.events.findLast(e=>e.type==='invite_ready').data;
  await g.joinByInvite(invitation.code);const answer=f.guest.bridge.events.findLast(e=>e.type==='answer_ready').data;
  await h.acceptAnswer(invitation.id,answer.code);
 }else{
  const pending=g.joinByRoomCode(h.lobby.snapshot().roomCode);await until(()=>[...f.f.timers.timers.values()].some(t=>t.ms===40),'same Guest explicit room join delay');f.f.timers.fire(40);await pending;
 }
 await until(()=>g.sessions.snapshot().length===1&&g.coordinator.guestPeer===g.sessions.snapshot()[0].peerId&&g.coordinator.remoteLobby?.selfPeerId,'same actual carrier accepts a fresh Guest owner');await drain();
}
cases.push(['unentered Guest cancel retires its actual owner and all lobby association without dissolving the Host public room',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,g=f.guest.runtime,stayer=await f.join('Stayer'),lobby=h.lobby.lobby,publication=h.lobby.publication,code=h.lobby.snapshot().roomCode,peer=g.coordinator.guestPeer,old=g.sessions.getOwner(peer),actual=old.actualIdentity(),stayerOwner=stayer.runtime.sessions.getOwner(stayer.runtime.coordinator.guestPeer),stayerIdentity=stayerOwner.actualIdentity();assert.ok(g.coordinator.requestTimer!==null);
  await g.cancelAll();await drain();g.update();const phase=f.guest.bridge.phases.at(-1);
  assert.deepEqual({sessions:g.sessions.snapshot().length,guestPeer:g.coordinator.guestPeer??null,remoteLobby:g.coordinator.remoteLobby??null,requestTimer:g.coordinator.requestTimer,phase:phase.phase,roomCode:phase.data.roomCode,lobbyOpen:phase.data.lobbyOpen},{sessions:0,guestPeer:null,remoteLobby:null,requestTimer:null,phase:'idle',roomCode:null,lobbyOpen:false});
  assert.equal(old.stopped,true);assert.equal(actual.pc.connectionState,'closed');assert.equal(actual.link.readyState,'closed');assert.equal(actual.ping.readyState,'closed');assert.equal(h.lobby.lobby,lobby);assert.equal(h.lobby.publication,publication);assert.equal(h.lobby.snapshot().roomCode,code);assert.equal(h.lobby.snapshot().lobbyOpen,true);assert.equal(h.sessions.snapshot().length,1);assert.equal(stayerOwner.stopped,false);assert.deepEqual(stayerOwner.actualIdentity(),stayerIdentity);
 }finally{await f.close();}
}]);
for(const method of ['room','invite'])cases.push(['same unentered Guest can explicitly leave and rejoin via '+method+'; old Owner lobby-state cannot replace the new Host projection',async()=>{
 const f=await connected('single');try{const h=f.host.runtime,g=f.guest.runtime,peer=g.coordinator.guestPeer,old=g.sessions.getOwner(peer),actual=old.actualIdentity(),late=actual.link.onmessage,oldHost=h.sessions.getOwner(h.sessions.snapshot()[0].peerId),frame=JSON.parse(oldHost.actualIdentity().link.sent.findLast(raw=>JSON.parse(raw).type==='lobby-state')),publication=h.lobby.publication,code=h.lobby.snapshot().roomCode;
  await g.cancelAll();await drain();await rejoinSameGuest(f,method);const fresh=g.sessions.getOwner(g.coordinator.guestPeer);assert.notEqual(fresh,old);assert.notEqual(g.coordinator.guestPeer,peer);assert.equal(fresh.snapshot().negotiations,1);assert.equal(fresh.snapshot().reconnectAttempts,0);assert.equal(h.lobby.publication,publication);assert.equal(h.lobby.snapshot().roomCode,code);assert.equal(h.lobby.snapshot().lobbyOpen,true);assert.equal(h.sessions.snapshot().length,1);assert.equal(g.engines.current,null);
  const before=structuredClone(g.coordinator.remoteLobby),events=f.guest.bridge.events.filter(e=>e.type==='room_members').length;frame.data.mode='doudizhu';frame.data.nextMode='doudizhu';frame.data.roomCode='XYZ234';assert.notEqual(g.coordinator.validate(old,frame),true);late({data:JSON.stringify(frame)});await drain();g.update();assert.deepEqual(g.coordinator.remoteLobby,before);assert.equal(f.guest.bridge.events.filter(e=>e.type==='room_members').length,events);assert.deepEqual(latest(f.guest).list,latest(f.host).list);assert.equal(old.stopped,true);assert.equal(f.guest.bridge.phases.at(-1).phase,'lobby_waiting');
 }finally{await f.close();}
}]);
cases.push(['Guest explicit exit after a completed round closes the original transport and clears its Host association',async()=>{
 const f=await connected('single'),docs=simulatedDocuments(f);try{await docs.start();await docs.returnRoom();const h=f.host.runtime,g=f.guest.runtime,peer=g.coordinator.guestPeer,owner=g.sessions.getOwner(peer),before=owner.actualIdentity(),oldCoordinator=g.coordinator;assert.equal(g.sessions.wasEverEntered(peer),true);await g.cancelAll();await drain();g.update();assert.equal(owner.stopped,true);assert.equal(before.pc.connectionState,'closed');assert.equal(before.link.readyState,'closed');assert.equal(before.ping.readyState,'closed');assert.notEqual(g.coordinator,oldCoordinator);assert.equal(g.coordinator.guestPeer,null);assert.equal(g.coordinator.remoteLobby??null,null);assert.equal(g.sessions.snapshot().length,0);assert.equal(h.sessions.snapshot().length,0);assert.equal(h.lobby.snapshot().lobbyOpen,true);assert.equal(owner.snapshot().negotiations,1);assert.equal(f.guest.bridge.phases.at(-1).phase,'idle');assert.equal(f.guest.bridge.phases.at(-1).data.roomCode,null);
 }finally{docs.close();await f.close();}
}]);
cases.push(['Guest explicit exit during active gameplay is rejected and preserves original P2P transports',async()=>{
 const f=await connected('single'),docs=simulatedDocuments(f);try{await docs.start();const h=f.host.runtime,g=f.guest.runtime,oldCoordinator=g.coordinator,owners=[h.sessions.getOwner(h.sessions.snapshot()[0].peerId),g.sessions.getOwner(g.coordinator.guestPeer)],before=owners.map(owner=>owner.actualIdentity());for(const runtime of [h,g]){runtime.coordinator.round.phase='playing';runtime.engines.current.status.playing=true;}await assert.rejects(g.cancelAll(),/对局|尚未结束/);assert.equal(g.coordinator,oldCoordinator);assert.equal(g.leaving,false);assert.equal(g.coordinator.round.phase,'playing');assert.deepEqual(owners.map(owner=>owner.actualIdentity()),before);assert.ok(owners.every(owner=>!owner.stopped));assert.equal(h.sessions.snapshot().length,1);assert.equal(g.sessions.snapshot().length,1);
 }finally{docs.close();await f.close();}
}]);
cases.push(['complete OnlinePanel respects explicit Guest role even during a Host-like phase',async()=>{
 const ui=onlinePanelFixture();ui.draw(panelStatus());ui.click(t=>/^🏛 插件房间\(/.test(t));assert.equal(roomModals(ui.tree).length,1);
 for(const phase of ['room_open','invite_ready','connecting','host_booting','mqtt_waiting','hosting']){const tree=ui.draw(panelStatus({role:'guest',phase}));assert.equal(hostControls(tree).length,0,'explicit Guest must not acquire Host actions from phase '+phase);assert.equal(ui.commands.length,0);}
}]);
cases.push(['complete OnlinePanel drops an idle stale room and modal while old room_members history remains',async()=>{
 for(const role of ['guest','host']){const ui=onlinePanelFixture(),active=panelStatus({role,phase:role==='guest'?'lobby_waiting':'room_open'});ui.draw(active);ui.click(t=>/^🏛 插件房间\(/.test(t));assert.equal(roomModals(ui.tree).length,1);const idle={...active,bridge:{...active.bridge,state:{phase:'idle',roomCode:'ABC234',continuation:null}}},tree=ui.draw(idle);assert.equal(roomModals(tree).length,0,role+' idle stale room must not remain open');assert.equal(roomButtons(tree).length,0,role+' stale room must not offer re-entry');assert.equal(hostControls(tree).length,0,role+' idle stale room must not offer destructive Host controls');assert.equal(ui.commands.length,0);}
}]);
cases.push(['complete OnlinePanel actual Guest exit handler sends cancel and removes later stale room affordances',async()=>{
 const ui=onlinePanelFixture(),active=panelStatus();ui.draw(active);ui.click(t=>/^🏛 插件房间\(/.test(t));ui.click(t=>t==='🚪 退出房间');assert.deepEqual(ui.commands,[{action:'cancel',args:{}}]);assert.equal(roomModals(ui.tree).length,1,'exit must wait for kernel acknowledgement');assert.ok(text(ui.tree).includes('正在退出，等待内核确认'));const idle={...active,bridge:{...active.bridge,role:'',state:{phase:'idle',roomCode:null,continuation:null}}};ui.draw(idle);assert.equal(roomButtons(ui.tree).length,0);assert.equal(hostControls(ui.tree).length,0);assert.equal(roomModals(ui.tree).length,0);
}]);
cases.push(['complete OnlinePanel preserves legal Host, Guest and original-connection continuation controls',async()=>{
 for(const role of ['host','guest'])for(const continuation of [false,true]){const ui=onlinePanelFixture(),status=panelStatus({role,phase:role==='host'?'room_open':continuation?'connected':'lobby_waiting',roomCode:continuation?null:'ABC234',continuation:continuation?{room:{complete:true},next:{retryAvailable:false}}:null});ui.draw(status);assert.equal(roomButtons(ui.tree).length,1);ui.click(t=>/^🏛 插件房间\(/.test(t));assert.equal(roomModals(ui.tree).length,1);if(role==='host'){assert.equal(nodes(ui.tree).filter(isRoomModeInput).length,5);assert.ok(nodes(ui.tree).some(n=>n.tag==='button'&&/载入到游戏/.test(text(n))));assert.ok(nodes(ui.tree).some(n=>n.tag==='button'&&text(n)==='🗑 解散房间'));}else{assert.equal(hostControls(ui.tree).length,0);assert.ok(nodes(ui.tree).some(n=>n.tag==='button'&&text(n)==='🚪 退出房间'));}assert.equal(ui.commands.length,0);}
 const legacy=onlinePanelFixture();legacy.draw(panelStatus({role:'',phase:'room_open'}));legacy.click(t=>/^🏛 插件房间\(/.test(t));assert.equal(nodes(legacy.tree).filter(isRoomModeInput).length,5,'legacy missing-role Host phase remains supported');
}]);
cases.push(['complete OnlinePanel only offers public invitations while open, including an automatically returned room modal',async()=>{
 const ui=onlinePanelFixture(),active=panelStatus({role:'host',phase:'room_open',continuation:{room:{complete:true,returnId:'fixture-return'},next:{retryAvailable:false}}});active.bridge.state.lobbyOpen=true;
 ui.draw(active);const modal=roomModals(ui.tree)[0];assert.ok(modal,'actual returnId effect automatically opens the room');
 assert.equal(nodes(modal).filter(n=>n.props.className==='nnk-inv-box').length,1);
 const invite=nodes(modal).filter(n=>n.tag==='button'&&text(n)==='📨 生成邀请码');assert.equal(invite.length,1);assert.notEqual(invite[0].props.disabled,true);invite[0].props.onClick();await drain();
 assert.deepEqual(ui.commands,[{action:'invite_refresh',args:{kind:'invite'}}],'open lobby invitation handler remains usable');
 const closed={...active,bridge:{...active.bridge,state:{...active.bridge.state,roomCode:null,lobbyOpen:false}}};ui.draw(closed);
 for(let i=0;i<2;i++){
  const room=roomModals(ui.tree)[0];assert.ok(room);assert.match(text(room),/原连接房间/);assert.equal(nodes(room).some(n=>n.props.className==='nnk-inv-box'),false);
  assert.equal(nodes(ui.tree).some(n=>n.tag==='button'&&/生成邀请码|换一个房号|复制邀请码|连接回执/.test(text(n))),false);
  assert.throws(()=>ui.click(t=>/生成邀请码/.test(t)),/one actual rendered button/);assert.equal(ui.commands.length,1,'no invitation command can be sent through closed rendered controls');
  const load=nodes(room).find(n=>n.tag==='button'&&/载入到游戏/.test(text(n)));assert.ok(load);assert.notEqual(load.props.disabled,true);
  ui.click(t=>t==='收起(连接继续保持,可随时再打开)');assert.equal(roomButtons(ui.tree).length,1);ui.click(t=>/^🏛 插件房间\(/.test(t));
 }
 ui.draw(active);assert.equal(nodes(roomModals(ui.tree)[0]).filter(n=>n.props.className==='nnk-inv-box').length,1,'a newly available public lobby may show invitations again');assert.equal(ui.commands.length,1);
}]);
await runCases(cases);

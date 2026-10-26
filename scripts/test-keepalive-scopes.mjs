import testPaths from './fixtures/test-paths.cjs';
// Actual current product modules, isolated fake external resources. No app.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';import {pathToFileURL,fileURLToPath} from 'node:url';
const W=testPaths.sourceRoot(),out=testPaths.tempPrefix('keepalive-scopes-')+new Date().toISOString().replace(/[:.]/g,'-');
fs.mkdirSync(out);fs.copyFileSync(fileURLToPath(import.meta.url),path.join(out,'test-root-p22-extra.mjs'));
const files=['engine-binding.js','initial-party.js','round-settlement.js','native-settlement.js','round-continuation.js','plugin-room.js','carrier-runtime.js','transport-owner.js','initial-connector.js','session-registry.js','lobby-owner.js','lobby-manifest.js','manifest-compare.js','lobby-inventory.js','party-recovery.js','carrier-transfer.js','transfer-display.js','batch-activation.js','transfer-limit-config.js','signaling-config.js'];
const hashes={};for(const file of files){const source=path.join(W,'online-kernel/keepalive',file);fs.copyFileSync(source,path.join(out,file));hashes[file]=createHash('sha256').update(fs.readFileSync(source)).digest('hex');}
fs.writeFileSync(path.join(out,'package.json'),' {"type":"module"}');fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(hashes,null,2));
const {EngineBindingManager}=await import(pathToFileURL(path.join(out,'engine-binding.js'))),{InitialPartyCoordinator}=await import(pathToFileURL(path.join(out,'initial-party.js'))),{CarrierRuntime}=await import(pathToFileURL(path.join(out,'carrier-runtime.js')));
const tests=[],observations=[];const observe=(name,value)=>{const row={at:Date.now(),name,value};observations.push(row);fs.appendFileSync(path.join(out,'observations.jsonl'),JSON.stringify(row)+'\n');};
async function test(name,fn){try{await fn();tests.push({name,ok:true});console.log('ok',name);}catch(error){tests.push({name,ok:false,error:String(error),stack:error.stack});console.error('FAIL',name,error);}}
const scope=(round,generation)=>({sessionId:'party',roundId:round,documentGeneration:generation,bindingId:'binding-'+generation,bindingNonce:'nonce-'+generation,expectedOrigin:'http://localhost:8089'});
const binding=(round,id)=>({closed:false,windowId:id,scope:scope(round,id),lease:{partySessionId:'party',roundId:round,operationId:'op-'+round},pending:new Map(),error:null,status:{proof:round},port:null});
await test('Real IPC port listener captures old binding when snapshot rejects after replacement',async()=>{
  let rejectSnapshot,requests=0,closed=0;const failures=[],ipc=new EventEmitter(),native={onInvalidated:()=>()=>{},snapshot:()=>{requests++;return new Promise((_resolve,reject)=>rejectSnapshot=reject);}};
  const manager=new EngineBindingManager({native,ipc,onFailure:(b,error)=>failures.push({b,error}),onEvent:observe}),old=binding('old',1),next=binding('new',2);manager.current=old;
  const candidate={close(){closed++;},start(){throw Error('Old candidate must not attach');}};
  ipc.emit('nnk-keepalive-port',{ports:[candidate]},{sourceWindowId:1,scope:old.scope});assert.equal(requests,1);
  old.closed=true;manager.current=next;rejectSnapshot(Error('Late old native snapshot failed'));for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(closed,1);assert.equal(next.error,null);assert.equal(next.status.proof,'new');assert.equal(next.port,null);assert.equal(failures.length,0);
  observe('old-snapshot-rejection',{closed,nextError:next.error,currentWindowId:manager.current.windowId,failures:failures.length});manager.dispose();
});
await test('Late resolving old snapshot closes candidate without attaching or failing new endpoint',async()=>{
  let resolveSnapshot,closed=0;const ipc=new EventEmitter(),manager=new EngineBindingManager({native:{onInvalidated:()=>()=>{},snapshot:()=>new Promise(resolve=>resolveSnapshot=resolve)},ipc,onEvent:observe}),old=binding('old',1),next=binding('new',2);manager.current=old;
  ipc.emit('nnk-keepalive-port',{ports:[{close(){closed++;},start(){throw Error('Old port started');}}]},{sourceWindowId:1,scope:old.scope});old.closed=true;manager.current=next;
  resolveSnapshot({currentEngine:{windowId:1,scope:old.scope}});for(let i=0;i<12;i++)await Promise.resolve();assert.equal(closed,1);assert.equal(next.error,null);assert.equal(next.port,null);manager.dispose();
});
await test('Current snapshot rejection fails its captured current binding and closes only candidate',async()=>{
  let closed=0;const ipc=new EventEmitter(),failures=[],manager=new EngineBindingManager({native:{onInvalidated:()=>()=>{},snapshot:async()=>{throw Error('Current failed');}},ipc,onFailure:b=>failures.push(b),onEvent:observe}),current=binding('current',3);manager.current=current;
  ipc.emit('nnk-keepalive-port',{ports:[{close(){closed++;}}]},{sourceWindowId:3,scope:current.scope});for(let i=0;i<12;i++)await Promise.resolve();assert.equal(closed,1);assert.equal(current.error.message,'Current failed');assert.equal(failures[0],current);manager.dispose();
});
const envelope=(extra={})=>({protocol:'nnk-round/1',partySessionId:null,roundId:null,operationId:null,requestId:'request',...extra});
await test('Empty public lobby has no live round and may promote without dereferencing null',async()=>{
  const coordinator=new InitialPartyCoordinator({sessions:{snapshot:()=>[]},engines:{current:null},onEvent:observe});coordinator.setRole('host');
  try{assert.equal(coordinator.live(null),false);await coordinator.promote();assert.equal(coordinator.round,null);}finally{coordinator.dispose();}
});
await test('Guest party acceptance requires prior supported-peer capability/lobby schema',async()=>{
  const actualOwner={},otherOwner={},sent=[],sessions={peerForActualOwner:o=>o===actualOwner?'actual-host':o===otherOwner?'foreign':null,isLive:()=>true,
    setIdentity(_id,owner,value){assert.equal(owner,actualOwner);assert.equal(value.name,'Host');},sendControl:(...v)=>sent.push(v)};
  const coordinator=new InitialPartyCoordinator({sessions,engines:{current:null},onEvent:observe});coordinator.setRole('guest');coordinator.guestPeer='actual-host';
  const accepted={type:'party-accepted',data:envelope({partySessionId:'party',roundId:'round',operationId:'operation',targetPeerId:'local-guest',slot:1,mode:'single'})};
  assert.notEqual(coordinator.validate(actualOwner,accepted),true);
  const lobby={type:'lobby-state',data:envelope({roomCode:'ABCDEF',hostIdentity:{name:'Host',avatar:'caocao'},mode:'single',capacity:2,members:[{peerId:'host',name:'Host',role:'host',entered:true,queued:false}]})};
  assert.equal(coordinator.validate(actualOwner,lobby),true);assert.notEqual(coordinator.validate(otherOwner,lobby),true);
  for(const change of [{hostIdentity:{name:'Host'}},{members:[{peerId:'host',name:'Host',entered:true,queued:false}]},{protocol:'wrong'},{requestId:''},{roundCapabilities:'nnk-settle/1,nnk-next/1'},{roundCapabilities:['nnk-next/1','nnk-next/1']},{roundCapabilities:[null]}])assert.notEqual(coordinator.validate(actualOwner,{...lobby,data:{...lobby.data,...change}}),true);
  await coordinator.control(actualOwner,lobby);assert.equal(coordinator.supportedPeers.has('actual-host'),true);assert.equal(coordinator.validate(actualOwner,accepted),true);coordinator.dispose();
});
class Channel{constructor(label){this.label=label;this.readyState='connecting';this.sent=[];}send(raw){this.sent.push(raw);}open(){this.readyState='open';this.onopen?.();}close(){this.readyState='closed';}}
class PC{constructor(){this.connectionState='connected';this.channels=[];this.localDescription=null;}createDataChannel(label){const channel=new Channel(label);this.channels.push(channel);return channel;}createOffer(){return Promise.resolve({type:'offer',sdp:'external-fake-offer-'+crypto.randomUUID()});}setLocalDescription(value){this.localDescription=value;return Promise.resolve();}setRemoteDescription(value){this.remoteDescription=value;return Promise.resolve();}close(){this.connectionState='closed';}}
const rtc={RTCPeerConnection:PC,encodeCode:(kind,sdp,hosts)=>JSON.stringify({k:kind,sdp,hosts}),decodeCode:raw=>JSON.parse(raw),waitGather:async()=>{},startPing:()=>({stop(){}}),directHosts:()=>[]};
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function runtimeFixture(){
  const emitted=[],nnk={state:{},modules:{rtc,signaling:{},bridge:{emit:(name,data)=>{emitted.push({name,data});observe('bridge-'+name,data);},setPhase(){},stop(){}}}},native={onInvalidated:()=>()=>{},snapshot:async()=>({})},ipc=new EventEmitter();
  const runtime=new CarrierRuntime({nnk,native,ipc,profile:{config:{onlineName:'Host',onlineAvatar:'caocao'},identity:{}}}),owners=[];
  const original=runtime.connector.createOwner;runtime.connector.createOwner=cfg=>{const owner=original(cfg);owners.push(owner);return owner;};
  runtime.coordinator.setRole('host');runtime.lobby.role='host';runtime.lobby.lobby={open:true,code:'ABCDEF',epoch:1,controller:new AbortController(),attempts:new Set()};
  runtime.lobby.publication={endAndClearRetained:()=>observe('publication-ended',{})};
  return {runtime,owners,emitted,async ready(){const before=owners.length;await runtime.lobby.refreshInvite('invite');const owner=owners[before],invite=runtime.lobby.invites.at(-1);await runtime.lobby.acceptAnswer(invite.id,rtc.encodeCode('answer',{type:'answer',sdp:'external-fake-answer'},[]));for(const channel of owner.pc.channels)channel.open();owner.link.onmessage({data:JSON.stringify({protocol:'keepalive/1',kind:'control',sessionId:owner.sessionId,sourcePeer:'guest',seq:1,type:'hello',data:{capabilities:['keepalive/1'],role:'guest'}})});await flush();const peer=runtime.sessions.peerForActualOwner(owner);assert.ok(peer);assert.equal(owner.ready,true);return {owner,peer};},cleanup(){runtime.dispose();for(const owner of owners)owner.stopTransport('external test cleanup');}};
}
function receive(owner,type,data,seq){owner.link.onmessage({data:JSON.stringify({protocol:'keepalive/1',kind:'control',sessionId:owner.sessionId,sourcePeer:'guest',seq,type,data})});}
await test('Real Owner rejects malformed/unknown/old/future typed controls before sequence advance',async()=>{
  const f=runtimeFixture();try{const {owner,peer}=await f.ready(),c=f.runtime.coordinator;c.round={partySessionId:'party',roundId:'current',operationId:'operation',phase:'playing',failed:false};
    const base=owner.snapshot().lastAcceptedControlSeq;
    for(const bad of [{identity:null},{identity:{name:'Guest'}},{identity:{name:'x'.repeat(13),avatar:''}},{identity:{name:'Guest',avatar:'x'.repeat(25)}},{identity:{name:1,avatar:''}},{identity:{name:'Guest',avatar:''},protocol:'invalid'},{identity:{name:'Guest',avatar:''},requestId:''}]){receive(owner,'party-request',envelope(bad),900);assert.equal(owner.snapshot().lastAcceptedControlSeq,base);assert.equal(c.supportedPeers.has(peer),false);}
    receive(owner,'unknown',envelope({partySessionId:'party',roundId:'current',operationId:'operation'}),999);assert.equal(owner.snapshot().lastAcceptedControlSeq,base);
    receive(owner,'document-ready',envelope({partySessionId:'party',roundId:'old',operationId:'old-operation',targetPeerId:peer,documentGeneration:1}),1000);assert.equal(owner.snapshot().lastAcceptedControlSeq,base);
    receive(owner,'document-ready',envelope({partySessionId:'party',roundId:'future',operationId:'future-operation',targetPeerId:peer,documentGeneration:999}),1001);assert.equal(owner.snapshot().lastAcceptedControlSeq,base);
    receive(owner,'party-request',envelope({identity:{name:'Guest',avatar:''}}),base+1);await flush();assert.equal(owner.snapshot().lastAcceptedControlSeq,base+1);assert.equal(c.supportedPeers.has(peer),true);assert.equal(f.runtime.sessions.get(peer).identity.name,'Guest');
    observe('real-owner-before-sequence',{before:base,after:owner.snapshot().lastAcceptedControlSeq,rejected:owner.snapshot().rejected,stopped:owner.stopped});assert.equal(owner.stopped,false);
  }finally{f.cleanup();}
});
await test('Carrier queued/unleased/stale-enrollment transport stop cannot fail entered current game',async()=>{
  const f=runtimeFixture();try{const entered=await f.ready(),queued=await f.ready(),unleased=await f.ready(),stale=await f.ready(),leasedQueue=await f.ready(),r={partySessionId:'party',roundId:'current',operationId:'operation',phase:'playing',mode:'single',failed:false};f.runtime.coordinator.round=r;
    f.runtime.coordinator.members.set(entered.peer,{peerId:entered.peer,phase:'entered',timer:null});f.runtime.sessions.bindEnrollment(entered.peer,r);entered.owner.attachEngine({roundId:r.roundId,documentGeneration:1},{remoteDocumentGeneration:1});
    f.runtime.sessions.markEntered(entered.peer,r,{hostClientInited:true,guestInited:true,ordered:true,seated:true,roundId:r.roundId,hostDocumentGeneration:1,guestDocumentGeneration:1,hostClientId:'guest-id',guestOnlineID:'guest-id',hostSeats:['1','guest-id'],guestSeats:['1','guest-id']});
    f.runtime.coordinator.members.set(unleased.peer,{peerId:unleased.peer,phase:'seating',timer:null});f.runtime.coordinator.members.set(stale.peer,{peerId:stale.peer,phase:'seating',timer:null});f.runtime.sessions.bindEnrollment(stale.peer,{partySessionId:'old-party',roundId:'old-round',operationId:'old-operation'});
    f.runtime.sessions.bindEnrollment(leasedQueue.peer,r);
    const actual=entered.owner.actualIdentity();for(const item of [queued,unleased,stale,leasedQueue]){item.owner.stopTransport('queued/old peer native failure');assert.equal(r.failed,false);assert.equal(entered.owner.stopped,false);assert.equal(entered.owner.actualIdentity().pc,actual.pc);}
    assert.equal(f.runtime.sessions.isEntered(entered.peer),true);assert.equal(f.runtime.sessions.resourceSnapshot().liveOwners,1);assert.equal(f.emitted.filter(row=>row.name==='error').length,0);
    observe('queued-native-close-isolation',{roundFailed:r.failed,currentOwnerLive:!entered.owner.stopped,remaining:f.runtime.sessions.snapshot()});
  }finally{f.cleanup();}
});
await test('Actual public-lobby dissolve stops never-entered owner and preserves entered PC/DC and scope',async()=>{
  const f=runtimeFixture();try{const entered=await f.ready(),queued=await f.ready(),r={partySessionId:'party',roundId:'current',operationId:'operation',phase:'playing',mode:'single',failed:false};f.runtime.coordinator.round=r;f.runtime.coordinator.members.set(entered.peer,{peerId:entered.peer,phase:'entered',timer:null});
    f.runtime.sessions.bindEnrollment(entered.peer,r);entered.owner.attachEngine({roundId:r.roundId,documentGeneration:2},{remoteDocumentGeneration:3});f.runtime.sessions.markEntered(entered.peer,r,{hostClientInited:true,guestInited:true,ordered:true,seated:true,roundId:r.roundId,hostDocumentGeneration:2,guestDocumentGeneration:3,hostClientId:'guest-id',guestOnlineID:'guest-id',hostSeats:['1','guest-id'],guestSeats:['1','guest-id']});
    const actual=entered.owner.actualIdentity(),before=entered.owner.snapshot();await f.runtime.lobby.cancelAll();
    assert.equal(queued.owner.stopped,true);assert.equal(entered.owner.stopped,false);assert.equal(r.failed,false);assert.equal(f.runtime.sessions.wasEverEntered(entered.peer),true);assert.equal(f.runtime.lobby.snapshot().lobbyOpen,false);
    const now=entered.owner.actualIdentity();assert.equal(now.pc,actual.pc);assert.equal(now.link,actual.link);assert.equal(now.ping,actual.ping);assert.equal(entered.owner.snapshot().roundId,before.roundId);assert.equal(entered.owner.snapshot().documentGeneration,before.documentGeneration);assert.equal(entered.owner.snapshot().negotiations,1);
    observe('actual-lobby-cancel-owner-preservation',{before,after:entered.owner.snapshot(),queuedStopped:queued.owner.stopped,registry:f.runtime.sessions.resourceSnapshot()});
  }finally{f.cleanup();}
});
await test('Actual enrolled participant stop does fail its current round, proving selective gate is active',async()=>{
  const f=runtimeFixture();try{const entered=await f.ready(),r={partySessionId:'party',roundId:'current',operationId:'operation',phase:'playing',mode:'single',failed:false};f.runtime.coordinator.round=r;
    f.runtime.coordinator.members.set(entered.peer,{peerId:entered.peer,phase:'entered',timer:null});f.runtime.sessions.bindEnrollment(entered.peer,r);entered.owner.attachEngine({roundId:r.roundId,documentGeneration:1},{remoteDocumentGeneration:1});
    f.runtime.sessions.markEntered(entered.peer,r,{hostClientInited:true,guestInited:true,ordered:true,seated:true,roundId:r.roundId,hostDocumentGeneration:1,guestDocumentGeneration:1,hostClientId:'guest-id',guestOnlineID:'guest-id',hostSeats:['1','guest-id'],guestSeats:['1','guest-id']});
    entered.owner.stopTransport('current entered peer actual native failure');await f.runtime.coordinator.cleanupPromise;assert.equal(r.failed,true);assert.match(r.error,/current entered peer actual native failure/);assert.equal(f.runtime.sessions.resourceSnapshot().liveOwners,0);assert.ok(f.emitted.some(row=>row.name==='error'));
    observe('enrolled-transport-failure',{roundFailed:r.failed,roundError:r.error,remaining:f.runtime.sessions.snapshot()});
  }finally{f.cleanup();}
});
await test('Original participant transport failure in plugin room still fails the party after enrollment retirement',async()=>{
 const f=runtimeFixture();try{const entered=await f.ready(),r={partySessionId:'party',roundId:'current',operationId:'operation',phase:'plugin-room',mode:'single',failed:false,continuationPeers:[entered.peer]};f.runtime.coordinator.round=r;
  f.runtime.sessions.bindEnrollment(entered.peer,r);f.runtime.sessions.retireEnrollment(entered.peer,r);assert.equal(f.runtime.sessions.get(entered.peer).lease,null);
  entered.owner.stopTransport('original participant failed between rounds');await f.runtime.coordinator.cleanupPromise;assert.equal(r.failed,true);assert.match(r.error,/between rounds/);assert.ok(f.emitted.some(row=>row.name==='error'));
 }finally{f.cleanup();}
});
await test('Host mode selection publishes to original Guest without a game document; Guest cannot select mode',async()=>{
 const f=runtimeFixture();try{const entered=await f.ready(),c=f.runtime.coordinator,owner=entered.owner;assert.equal(f.runtime.engines.current,null);const before=owner.link.sent.length;f.runtime.setRoomMode('guozhan');const sent=owner.link.sent.slice(before).map(raw=>JSON.parse(raw));assert.ok(sent.some(frame=>frame.type==='lobby-state'&&frame.data.mode==='guozhan'));assert.equal(f.runtime.lobby.nextMode,'guozhan');assert.equal(f.runtime.engines.current,null);c.role='guest';assert.throws(()=>f.runtime.setRoomMode('single'),/只有房主/);
 }finally{f.cleanup();}
});
await test('Concurrent return and failure cleanup share a single native owner retirement',async()=>{
 let resolveClose,closes=0,confirms=0;const ipc=new EventEmitter(),manager=new EngineBindingManager({ipc,native:{onInvalidated:()=>()=>{},closeGame:async()=>{closes++;return new Promise(r=>resolveClose=r);},confirmClosed:async()=>{confirms++;return {confirmed:true};}},onEvent:observe});const b=binding('current',3);manager.current=b;
 const a=manager.retire('return plugin room'),second=manager.retire('failure cleanup');assert.equal(a,second);assert.equal(closes,1);resolveClose({rejected:false});const [one,two]=await Promise.all([a,second]);assert.equal(one,two);assert.equal(confirms,1);assert.equal(manager.current,null);assert.equal(b.scope,null);assert.equal(b.status,null);manager.dispose();
});
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual copied product modules; synthetic external RTC/native/DB resources. No app/native/physical or settlement claim.',sourceHashes:hashes,tests},null,2));
console.log(JSON.stringify({out,passed:tests.filter(row=>row.ok).length,total:tests.length,sourceHashes:hashes}));if(tests.some(row=>!row.ok))process.exitCode=1;

if(!tests.some(x=>!x.ok))console.log('全部通过: '+tests.length+' 项');

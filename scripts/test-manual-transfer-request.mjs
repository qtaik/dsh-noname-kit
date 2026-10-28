import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {CarrierRuntime} from '../online-kernel/keepalive/carrier-runtime.js';
import {CarrierTransfer,TRANSFER_TYPES} from '../online-kernel/keepalive/carrier-transfer.js';
import {LobbyManifest} from '../online-kernel/keepalive/lobby-manifest.js';
import {fixture,drain,until,deferred,runCases} from './fixtures/keepalive-lifecycle.mjs';

const require=createRequire(import.meta.url),core=require('../online-kernel/lib/batch-files.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const binding=row=>Object.fromEntries(['session','peerSession','proposal','digest','peerId','scope'].map(key=>[key,clone(row[key])]));
const inventory=(names,installed=names)=>({exts:names,installed,packs:[],cards:[],kernel:'fixture',identity:{name:'fixture',avatar:''},inventoryVersion:1,contents:Object.fromEntries(installed.map(name=>[name,{digest:hash(name),count:1,total:1}]))});
const batch=(names,version)=>core.normalize({extensions:names.map(name=>{const bytes=Buffer.from(name+version);return {name,files:[{path:'extension.js',size:bytes.length,sha256:hash(bytes)}]};})});

async function world(){
  const f=fixture(),nodes={},events=[],phases=[];let p,serial=0,now=100000;
  try{
    const route=role=>(owner,frame)=>TRANSFER_TYPES.has(frame.type)?nodes[role].runtime.transfer.control(owner,frame):nodes[role].runtime.manifest.control(owner,frame);
    const validate=role=>(owner,frame)=>{const transfer=nodes[role]?.runtime.transfer.validate(owner,frame);return transfer===null?nodes[role].runtime.manifest.validate(owner,frame):transfer;};
    p=await f.pair({hostOptions:{validateControl:frame=>validate('host')(p.host,frame)===true,onControl:frame=>route('host')(p.host,frame)},guestOptions:{validateControl:frame=>validate('guest')(p.guest,frame)===true,onControl:frame=>route('guest')(p.guest,frame)}});
    for(const role of ['host','guest']){
      const sessions=role==='host'?p.hs:p.gs,peerId=role==='host'?p.hostRecord.peerId:p.guestRecord.peerId,owner=role==='host'?p.host:p.guest;
      const node={peerId,owner,inventory:role==='host'?inventory(['FixtureA']):inventory([],[]),inventoryCalls:0,collectCalls:[],version:1,inventoryGate:null,collectGate:null,sourceCalls:0,receiverCalls:0};
      const runtime=Object.assign(Object.create(CarrierRuntime.prototype),{nnk:{state:{},modules:{bridge:{emit:(name,data)=>events.push({role,name,data:clone(data)}),setPhase:(phase,data)=>phases.push({role,phase,data:clone(data)})}}},stopped:false,leaving:false,files:{},profile:{config:{autoTransfer:true}},carrierSessionId:'manual-'+role,partyEpoch:0,transferRequest:null,manualManifestRows:new WeakMap(),manifestCollection:null,autoHealthSeen:new Set(),autoHealthPending:false,sessions,engines:{current:null,snapshot:()=>({})},nativeSnapshot:{transfer:{available:true}},coordinator:{role,closed:false,round:null,next:{pending:false,committed:false},room:{pending:false,ready:()=>false},snapshot:()=>({round:null,members:[]})},lobby:{snapshot:()=>({role,roomCode:'ABC234',lobbyOpen:true,nextMode:'identity'}),inviteMetadata:()=>[],resourceSnapshot:()=>({})},recovery:{status:()=>({})},connector:{resourceSnapshot:()=>({})},event:(name,data)=>events.push({role,name,data:clone(data)}),onDisplay:()=>{},transportIdentity:()=>[]});
      runtime.maybeAutoHealth=()=>{};node.runtime=runtime;nodes[role]=node;
      runtime.transfer=new CarrierTransfer({sessions,getRole:()=>runtime.coordinator.role,getScope:()=>runtime.manifestScope(),canTransfer:()=>runtime.transferEligibility(),isRequestPending:()=>!!runtime.transferRequest,now:()=>now,newId:()=>String(++serial).padStart(32,'0'),collect:async(names,{signal})=>{node.collectCalls.push(names.slice());if(node.collectGate)await node.collectGate.promise;if(signal.aborted)throw Error('fixture cancelled');return batch(names,node.version);},normalize:core.normalize,digest:core.manifestDigest,createChannel:()=>{throw Error('No guest consent was given');},source:async()=>{node.sourceCalls++;throw Error('No guest consent was given');},receiver:async()=>{node.receiverCalls++;throw Error('No guest consent was given');},emit:(name,data)=>{events.push({role,name,data:clone(data)});runtime.update();}});
      const checker=new LobbyManifest({sessions,getRole:()=>runtime.coordinator.role,getScope:()=>runtime.manifestScope(),now:()=>now,collect:async()=>{node.inventoryCalls++;if(node.inventoryGate)await node.inventoryGate.promise;return clone(node.inventory);},emit:(name,data)=>runtime.manifestEvent(checker,name,data)});runtime.manifest=checker;runtime.coordinator.lobbyTransfer=runtime.transfer;
      sessions.setIdentity(peerId,owner,{name:role==='host'?'Guest Name':'Host Name',avatar:''});runtime.manifest.setPeerCapability(peerId);
    }
    for(const node of Object.values(nodes))node.runtime.transfer.setPeerCapability(node.peerId);
    await until(()=>Object.values(nodes).every(node=>node.runtime.transfer.availability().available),'existing owners complete transfer capability handshake');await drain();
    const h=nodes.host.runtime,g=nodes.guest.runtime;
    const args=()=>({peerId:nodes.host.peerId,scope:h.manifestScope()});
    const request=()=>h.dispatch({action:'batch_request',args:args()});
    const pending=()=>g.transfer.snapshot().proposals.at(-1);
    async function close(){for(const node of Object.values(nodes)){if(node.runtime.transferRequest)node.runtime.clearTransferRequest(node.runtime.transferRequest);node.runtime.manifest.dispose();await node.runtime.transfer.dispose();}await f.close();}
    return {f,p,nodes,h,g,events,phases,args,request,pending,advance:ms=>{now+=ms;},close};
  }catch(error){for(const node of Object.values(nodes)){if(node.runtime.transferRequest)node.runtime.clearTransferRequest(node.runtime.transferRequest);node.runtime.manifest?.dispose();await node.runtime.transfer?.dispose();}await f.close();throw error;}
}

const cases=[];
cases.push(['manual request works without a previous proposal and preserves the original PC, link and ping',async()=>{
  const w=await world();try{const before=[w.p.host.actualIdentity(),w.p.guest.actualIdentity()];assert.deepEqual(await w.request(),{requested:true});await until(()=>w.pending()?.status==='pending');await until(()=>!w.h.transferRequest);assert.deepEqual(w.nodes.host.collectCalls,[['FixtureA']]);assert.equal(w.nodes.host.inventoryCalls,1);assert.equal(w.nodes.guest.inventoryCalls,1);assert.equal(w.nodes.host.sourceCalls+w.nodes.guest.receiverCalls,0);assert.deepEqual([w.p.host.actualIdentity(),w.p.guest.actualIdentity()],before);assert.equal(w.p.host.snapshot().negotiations,1);assert.equal(w.p.guest.snapshot().reconnectAttempts,0);const state=w.phases.filter(row=>row.role==='host').at(-1).data;assert.deepEqual(state.transferPeers,[{peerId:w.nodes.host.peerId,name:'Guest Name',peerIdentity:{name:'Guest Name',avatar:''},peerLabel:'Guest Name（客机 1）',peerOrdinal:1}]);assert.equal(state.transferRequestPending,false);assert.equal(state.transferBusy,true);}finally{await w.close();}
}]);
cases.push(['a declined same-digest batch gets a fresh proposal and never inherits guest consent',async()=>{
  const w=await world();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);const old=clone(w.pending());assert.equal(w.g.transfer.decide({...binding(old),yes:false}),true);await until(()=>w.h.transfer.snapshot().proposals.at(-1).status==='declined');await drain();w.advance(1600);assert.deepEqual(await w.request(),{requested:true});await until(()=>w.pending()?.proposal!==old.proposal&&w.pending()?.status==='pending');assert.equal(w.pending().digest,old.digest);assert.notEqual(w.pending().proposal,old.proposal);assert.equal(w.g.transfer.decide({...binding(old),yes:true}),false);assert.equal(w.nodes.host.collectCalls.length,2);assert.equal(w.nodes.guest.receiverCalls,0);}finally{await w.close();}
}]);
cases.push(['manual retry derives the fresh missing list instead of the old batch names',async()=>{
  const w=await world();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);w.g.transfer.decide({...binding(w.pending()),yes:false});await until(()=>w.h.transfer.snapshot().proposals.at(-1).status==='declined');await drain();w.nodes.host.inventory=inventory(['FixtureB']);w.advance(1600);await w.request();await until(()=>w.pending()?.batch.extensions[0]?.name==='FixtureB');assert.deepEqual(w.nodes.host.collectCalls,[['FixtureA'],['FixtureB']]);}finally{await w.close();}
}]);
cases.push(['a noncommitted failed attempt can be manually proposed again only under a new authorization',async()=>{
  const w=await world();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);const old=clone(w.pending()),r=w.h.transfer.peers.get(w.nodes.host.peerId);await w.h.transfer._finish(r,r.q,'failed','fixture source failed before file commit',true);await until(()=>w.pending()?.status==='failed');await drain();w.advance(1600);await w.request();await until(()=>w.pending()?.proposal!==old.proposal&&w.pending()?.status==='pending');assert.equal(w.g.transfer.decide({...binding(old),yes:true}),false);assert.equal(w.nodes.host.collectCalls.length,2);assert.equal(w.nodes.guest.receiverCalls,0);}finally{await w.close();}
}]);
cases.push(['fresh file collection changes the proposal digest when local bytes change',async()=>{
  const w=await world();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);const old=w.pending().digest;w.g.transfer.decide({...binding(w.pending()),yes:false});await until(()=>w.h.transfer.snapshot().proposals.at(-1).status==='declined');await drain();w.nodes.host.version++;w.advance(1600);await w.request();await until(()=>w.pending()?.digest!==old);assert.equal(w.nodes.host.collectCalls.length,2);}finally{await w.close();}
}]);
cases.push(['rapid repeated clicks create only one local ticket and cannot start a game or old retry',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.host.inventoryGate=gate;await w.request();assert.equal(w.h.transfer.busy(),true);assert.equal(w.h.transfer.canStart(),false);assert.equal(w.h.coordinator.lobbyTransfer.canStart(),false);await assert.rejects(w.request(),/正在进行/);await drain();assert.equal(w.nodes.host.inventoryCalls,1);assert.equal(w.h.transfer.snapshot().proposals.length,0);const state=w.phases.filter(row=>row.role==='host').at(-1).data;assert.equal(state.transferRequestPending,true);assert.equal(state.transferBusy,true);gate.resolve();await until(()=>w.pending()?.status==='pending');assert.equal(w.nodes.host.collectCalls.length,1);}finally{gate.resolve();await w.close();}
}]);
cases.push(['an existing batch retry cannot race a manual checking ticket',async()=>{
  const w=await world(),gate=deferred();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);w.g.transfer.decide({...binding(w.pending()),yes:false});await until(()=>w.h.transfer.snapshot().proposals.at(-1).status==='declined');await drain();const old=binding(w.h.transfer.snapshot().proposals.at(-1));w.advance(1600);w.nodes.host.inventoryGate=gate;await w.request();assert.equal(await w.h.transfer.retry(old),false);gate.resolve();await until(()=>w.pending()?.proposal!==old.proposal);}finally{gate.resolve();await w.close();}
}]);
cases.push(['unverified inventory never grants a manual file proposal',async()=>{
  const w=await world();try{w.nodes.guest.inventory.inventoryVersion=0;await w.request();await until(()=>!w.h.transferRequest);assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(w.pending(),undefined);assert.ok(w.events.some(row=>row.role==='host'&&row.name==='error'&&/未完整核验/.test(row.data.message||'')));}finally{await w.close();}
}]);
cases.push(['a healthy or disabled-only result is an informational no-op',async()=>{
  for(const enabled of [[],['FixtureA']]){const w=await world();try{w.nodes.guest.inventory=inventory(enabled,['FixtureA']);await w.request();await until(()=>!w.h.transferRequest);assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(w.pending(),undefined);assert.ok(w.events.some(row=>row.role==='host'&&row.name==='info'&&/无需重复下载/.test(row.data.message||'')));assert.equal(w.events.some(row=>row.role==='host'&&row.name==='error'),false);}finally{await w.close();}}
}]);
cases.push(['current active, committed and unknown batches cannot be overwritten manually',async()=>{
  for(const state of ['pending','committed','unknown','recovery_required']){const w=await world();try{await w.request();await until(()=>w.pending()?.status==='pending'&&!w.h.transferRequest);const q=w.h.transfer.peers.get(w.nodes.host.peerId).q;if(state!=='pending'){q.status='failed';q.fileState={status:state};q.fileCommitted=state==='committed';}await assert.rejects(w.request(),/正在进行/);assert.equal(w.nodes.host.inventoryCalls,1);assert.equal(w.nodes.host.collectCalls.length,1);}finally{await w.close();}}
}]);
cases.push(['local role, exact fields, current scope, native idle state and actual peer are checked before scanning',async()=>{
  const w=await world();try{for(const args of [{...w.args(),names:['FixtureA']},{...w.args(),scope:{...w.args().scope,extra:true}},{...w.args(),scope:{...w.args().scope,partyEpoch:1}},{...w.args(),peerId:'missing'}])await assert.rejects(w.h.dispatch({action:'batch_request',args}));w.h.coordinator.role='guest';await assert.rejects(w.request(),/房主/);w.h.coordinator.role='host';w.h.engines.current={};await assert.rejects(w.request(),/关闭/);w.h.engines.current=null;w.h.nativeSnapshot.transfer.available=false;await assert.rejects(w.request(),/事务/);assert.equal(w.nodes.host.inventoryCalls,0);assert.equal(w.nodes.host.collectCalls.length,0);}finally{await w.close();}
}]);
cases.push(['a running metadata check or retiring scan cannot be reused by a manual request',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.host.inventoryGate=gate;const ordinary=w.h.manifest.recheck({peerId:w.nodes.host.peerId});await until(()=>w.nodes.host.inventoryCalls===1);await assert.rejects(w.request(),/体检正在进行/);gate.resolve();await ordinary;await until(()=>w.h.manifest.readiness().pending===0);assert.equal(w.nodes.host.inventoryCalls,1);}finally{gate.resolve();await w.close();}
}]);
cases.push(['manual recheck onStarted binds rows before the first request is sent and returns pending metadata only',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;let rows;const sentBefore=w.p.host.link.sent.length;const result=await w.h.manifest.recheck({peerId:w.nodes.host.peerId},value=>{rows=value;assert.equal(w.p.host.link.sent.length,sentBefore);});assert.equal(result.requested,true);assert.match(result.verification,/pending/);assert.equal(rows.length,1);assert.equal(rows[0].peerId,w.nodes.host.peerId);assert.deepEqual(rows[0].scope,w.h.manifestScope());assert.equal(Number.isSafeInteger(rows[0].request),true);gate.resolve();await drain();}finally{gate.resolve();await w.close();}
}]);
cases.push(['a scope change while checking clears the ticket and late results cannot start a proposal',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;await w.request();await until(()=>w.nodes.guest.inventoryCalls===1);const ticket=w.h.transferRequest;w.h.partyEpoch++;w.h.update();assert.equal(w.h.transferRequest,null);gate.resolve();await drain();w.h.manifestEvent(ticket.manifest,'manifest_diff',{peerId:ticket.peerId,request:ticket.request,scope:ticket.scope,verification:'verified',inventoryVerified:true,exts:{needsFiles:['FixtureA']}});await drain();assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(w.pending(),undefined);}finally{gate.resolve();await w.close();}
}]);
cases.push(['a replaced actual owner or connection session cannot receive a late manual proposal',async()=>{
  for(const key of ['owner','connectionSessionId']){const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;await w.request();await until(()=>w.nodes.guest.inventoryCalls===1);const record=w.h.sessions.records.get(w.nodes.host.peerId),previous=record[key];record[key]=key==='owner'?{stopped:false}:previous+'-replacement';w.h.update();assert.equal(w.h.transferRequest,null);gate.resolve();await drain();assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(w.h.transfer.snapshot().proposals.length,0);record[key]=previous;}finally{gate.resolve();await w.close();}}
}]);
cases.push(['disconnect and explicit leave invalidate the checking ticket without reusing a dead connection',async()=>{
  for(const leave of [false,true]){const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;await w.request();await until(()=>w.nodes.guest.inventoryCalls===1);if(leave)w.h.leaving=true;else w.h.sessions.transportStopped(w.p.host,'fixture disconnect');w.h.update();assert.equal(w.h.transferRequest,null);gate.resolve();await drain();assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(w.h.transfer.snapshot().proposals.length,0);}finally{gate.resolve();await w.close();}}
}]);
cases.push(['manifest timeout releases the local ticket and a late manual row never falls back to automatic offer',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;await w.request();await until(()=>w.nodes.guest.inventoryCalls===1);const ticket=w.h.transferRequest;w.f.timers.fire(15000);await drain();assert.equal(w.h.transferRequest,null);assert.equal(w.h.transfer.busy(),false);w.h.manifestEvent(ticket.manifest,'manifest_diff',{peerId:ticket.peerId,request:ticket.request,scope:ticket.scope,verification:'verified',inventoryVerified:true,exts:{needsFiles:['FixtureA']}});assert.equal(w.nodes.host.collectCalls.length,0);gate.resolve();await drain();assert.equal(w.pending(),undefined);}finally{gate.resolve();await w.close();}
}]);
cases.push(['only the exact manual request row can initiate its proposal',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.guest.inventoryGate=gate;await w.request();await until(()=>w.nodes.guest.inventoryCalls===1);const ticket=w.h.transferRequest;w.h.manifestEvent(ticket.manifest,'manifest_diff',{peerId:ticket.peerId,request:ticket.request+1,scope:ticket.scope,verification:'verified',inventoryVerified:true,exts:{needsFiles:['Unexpected']}});await drain();assert.equal(w.nodes.host.collectCalls.length,0);gate.resolve();await until(()=>w.pending()?.status==='pending');assert.deepEqual(w.nodes.host.collectCalls,[['FixtureA']]);}finally{gate.resolve();await w.close();}
}]);
cases.push(['late file collection after an epoch change cannot publish a prepared batch',async()=>{
  const w=await world(),gate=deferred();try{w.nodes.host.collectGate=gate;await w.request();await until(()=>w.nodes.host.collectCalls.length===1);w.h.partyEpoch++;w.h.update();assert.equal(w.h.transferRequest,null);gate.resolve();await drain();assert.equal(w.h.transfer.snapshot().proposals.length,0);assert.equal(w.h.transfer.busy(),false);assert.equal(w.pending(),undefined);}finally{gate.resolve();await w.close();}
}]);
cases.push(['the public manual proposal API requires a verified inventory and an exact current scope',async()=>{
  const w=await world();try{const base={verification:'verified',inventoryVerified:true,scope:w.h.manifestScope(),exts:{needsFiles:['FixtureA']}};for(const diff of [{...base,scope:undefined},{...base,scope:{...base.scope,extra:true}},{...base,scope:{...base.scope,partyEpoch:1}},{...base,verification:'reference'},{...base,inventoryVerified:false}])assert.equal(await w.h.transfer.request(w.nodes.host.peerId,diff),false);assert.equal(w.nodes.host.collectCalls.length,0);assert.equal(await w.h.transfer.request(w.nodes.host.peerId,base),true);await until(()=>w.pending()?.status==='pending');assert.equal(w.nodes.guest.receiverCalls,0);}finally{await w.close();}
}]);

await runCases(cases);

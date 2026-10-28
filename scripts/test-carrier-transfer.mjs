import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {CarrierTransfer,TRANSFER_PROTOCOL,transferBudgetMs} from '../online-kernel/keepalive/carrier-transfer.js';
import {fixture,drain,until,deferred} from './fixtures/keepalive-lifecycle.mjs';
const require=createRequire(import.meta.url),{Channel}=require('../online-kernel/lib/batch-wire.cjs'),core=require('../online-kernel/lib/batch-files.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),clone=x=>JSON.parse(JSON.stringify(x));
const names=['Fixture'],contents=new Map([['extension.js',Buffer.from('export default {name:"fixture"};')],['data.txt',Buffer.from('content')]]);
const batch=core.normalize({extensions:[{name:'Fixture',files:[...contents].map(([path,bytes])=>({path,size:bytes.length,sha256:sha(bytes)}))}]});
const diff={verification:'verified',inventoryVerified:true,exts:{missing:names,changed:[],disabled:[],needsFiles:names}};
const binding=row=>Object.fromEntries(['session','peerSession','proposal','digest','peerId','scope'].map(key=>[key,clone(row[key])]));
async function world({sourceGate,chunkGate,collectGate,checkBatch=()=>{}}={}){
 const f=fixture();let h,g,p,now=1700000000000,serial=0;const events=[],counts={source:0,receiver:0,chunks:0,commits:0,aborts:0,closedSources:0,collects:0},nodes={};
 try{p=await f.pair({hostOptions:{validateControl:frame=>h?.validate(p.host,frame)===true,onControl:frame=>h.control(p.host,frame)},guestOptions:{validateControl:frame=>g?.validate(p.guest,frame)===true,onControl:frame=>g.control(p.guest,frame)}});
  const newId=()=> (++serial).toString(16).padStart(32,'0');
  for(const role of ['host','guest']){
   const registry=role==='host'?p.hs:p.gs,peer=role==='host'?p.hostRecord.peerId:p.guestRecord.peerId,owner=role==='host'?p.host:p.guest,scope={carrierSessionId:'carrier-'+role,partyEpoch:0},gate={available:true,reason:''};
   const options={sessions:registry,getRole:()=>role,getScope:()=>scope,canTransfer:()=>gate,now:()=>now,newId,
    collect:async()=>{counts.collects++;if(collectGate)await collectGate.promise;return clone(batch);},normalize:core.normalize,checkBatch:value=>checkBatch(role,value),digest:core.manifestDigest,
    createChannel:options=>new Channel({...options,now:()=>now,timers:{setTimeout:(...args)=>setTimeout(...args),clearTimeout:(...args)=>clearTimeout(...args)}}),
    source:async(grant,context)=>{counts.source++;assert.equal(context.owner,owner);assert.equal(context.isAuthorized(),true);if(sourceGate)await sourceGate.promise;const files=grant.batch.extensions.flatMap(ext=>ext.files);return {read(index,offset,length){assert.equal(context.isAuthorized(),true);return Buffer.from(contents.get(files[index].path).subarray(offset,offset+length));},close(){counts.closedSources++;}};},
    receiver:async(grant,context)=>{counts.receiver++;assert.equal(context.owner,owner);assert.equal(context.isAuthorized(),true);const files=grant.batch.extensions.flatMap(ext=>ext.files),received=files.map(()=>Buffer.alloc(0));let aborted=false;
     return {async chunk(index,offset,bytes){if(chunkGate)await chunkGate.promise;if(!context.isAuthorized()||aborted)throw Error('fixture authorization ended');assert.equal(received[index].length,offset);received[index]=Buffer.concat([received[index],bytes]);counts.chunks++;},commit(isLive,onCommitted){if(!isLive()||!context.isAuthorized()||aborted)throw Error('fixture cannot commit');for(const [index,file]of files.entries()){assert.equal(received[index].length,file.size);assert.equal(sha(received[index]),file.sha256);}counts.commits++;onCommitted({id:'fixture-transaction'});return {activated:false,reason:'文件整批提交，请自行启用并正常重启'};},abort(){counts.aborts++;aborted=true;return {status:'rolled_back'};}};},
    emit:(type,data)=>events.push({role,type,data:clone(data)})};const ctl=new CarrierTransfer(options);nodes[role]={ctl,registry,peer,owner,scope,gate,options};if(role==='host')h=ctl;else g=ctl;
  }
  h.setPeerCapability(nodes.host.peer);g.setPeerCapability(nodes.guest.peer);await until(()=>h.availability().available&&g.availability().available,'both current transfer nonces established');await drain();
  const offer=async()=>{assert.equal(await h.autoOffer(nodes.host.peer,diff),true);await until(()=>g.snapshot().proposals.at(-1)?.status==='pending','guest sees current explicit proposal');return binding(g.snapshot().proposals.at(-1));};
  const frame=(role,op,fields={})=>{const n=nodes[role],r=n.ctl.peers.get(n.peer);return {type:'transfer-consent',sessionId:n.registry.get(n.peer).connectionSessionId,sourcePeer:role==='host'?'guest':'host',seq:r.lastSequence+1,data:{protocol:TRANSFER_PROTOCOL,partySessionId:null,roundId:null,operationId:null,requestId:newId(),connectionSessionId:r.connectionSessionId,scope:clone(r.remoteScope),op,...fields}};};
  async function rotate(role){const node=nodes[role];await node.ctl.dispose();node.scope.partyEpoch++;node.ctl=new CarrierTransfer(node.options);if(role==='host')h=node.ctl;else g=node.ctl;node.ctl.setPeerCapability(node.peer);await until(()=>h.availability().available&&g.availability().available,'idle actual owners negotiate the next party epoch');await drain();}
  async function close(){await Promise.all([h.dispose(),g.dispose()]);await f.close();}
  return {f,p,get h(){return h;},get g(){return g;},nodes,counts,events,offer,frame,rotate,advance:ms=>{now+=ms;f.timers.fire(ms);},close};
 }catch(error){await h?.dispose();await g?.dispose();await f.close();throw error;}
}
let passed=0;async function test(label,fn){await fn();passed++;console.log('  ✓ '+label);}

await test('new capability handshakes reuse the exact existing encrypted PC/link/ping objects',async()=>{
 const w=await world();try{for(const n of Object.values(w.nodes)){const state=n.owner.snapshot();assert.equal(state.pcConstructions,1);assert.equal(state.negotiations,1);assert.equal(state.pingStarts,1);assert.equal(state.reconnectAttempts,0);assert.equal(n.ctl.capabilitySnapshot()[0].ready,true);}assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('missing files produce metadata only until the actual guest explicitly agrees',async()=>{
 const w=await world();try{await w.offer();assert.equal(w.counts.collects,1);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);assert.equal(w.counts.chunks,0);assert.equal(w.h.canStart(),false);assert.equal(w.g.canStart(),false);assert.equal(w.g.snapshot().proposals.at(-1).batch.count,2);}finally{await w.close();}
});
await test('a guest local batch policy rejects a valid wire offer explicitly and immediately clears host busy',async()=>{
 const w=await world({checkBatch:(role,value)=>{assert.equal(value.total,batch.total);if(role==='guest')throw Error('local capacity policy');}});try{assert.equal(await w.h.autoOffer(w.nodes.host.peer,diff),true);await until(()=>w.h.snapshot().proposals.at(-1)?.status==='cancelled');await drain();assert.equal(w.g.snapshot().proposals.length,0);assert.equal(w.h.busy(),false);assert.equal(w.g.busy(),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);assert.equal(w.p.host.snapshot().negotiations,1);assert.equal(w.p.guest.snapshot().negotiations,1);}finally{await w.close();}
});
await test('a disabled guest declines valid wire metadata without invoking its local batch policy',async()=>{
 let checked=0;const w=await world({checkBatch:role=>{if(role==='guest'){checked++;throw Error('local capacity policy');}}});try{await w.g.setEnabled(false);assert.equal(await w.h.autoOffer(w.nodes.host.peer,diff),true);await until(()=>w.h.snapshot().proposals.at(-1)?.status==='cancelled');await drain();assert.equal(checked,0);assert.equal(w.g.snapshot().proposals.length,0);assert.equal(w.h.busy(),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('a host local batch policy remains mandatory before any offer is sent',async()=>{
 const w=await world({checkBatch:role=>{if(role==='host')throw Error('local capacity policy');}});try{await assert.rejects(w.h.autoOffer(w.nodes.host.peer,diff),/local capacity policy/);await drain();assert.equal(w.h.snapshot().proposals.length,0);assert.equal(w.g.snapshot().proposals.length,0);assert.equal(w.h.busy(),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('consent automatically starts the existing v2 chunk channel and commits the complete verified batch',async()=>{
 const w=await world();try{const choice=await w.offer(),before=[w.p.host.actualIdentity(),w.p.guest.actualIdentity()];assert.equal(w.g.decide({...choice,yes:true}),true);await until(()=>w.g.snapshot().files.at(-1)?.status==='committed_activation_required','full batch committed without implicit activation');await drain();assert.equal(w.counts.receiver,1);assert.equal(w.counts.source,1);assert.equal(w.counts.commits,1);assert.equal(w.counts.chunks,2);const progress=w.events.filter(e=>e.role==='guest'&&e.type==='batch_files'&&e.data.status==='receiving').map(e=>e.data.received);assert.ok(progress.some(n=>n>0),'receiving UI reports actual verified bytes before commit');assert.equal(progress.at(-1),batch.total);assert.deepEqual(progress,[...progress].sort((a,b)=>a-b));assert.deepEqual([w.p.host.actualIdentity(),w.p.guest.actualIdentity()],before);assert.equal(w.g.snapshot().files.at(-1).received,batch.total);assert.equal(w.events.some(event=>event.type==='batch_reload'),false);assert.equal(w.g.canStart(),false);}finally{await w.close();}
});
await test('decline creates no receiver and the same automatic diff does not prompt again',async()=>{
 const w=await world();try{const choice=await w.offer();assert.equal(w.g.decide({...choice,yes:false}),true);await until(()=>w.h.snapshot().proposals.at(-1)?.status==='declined','host records exact decline');assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);const offers=w.events.filter(event=>event.role==='guest'&&event.type==='batch_consent'&&event.data.status==='pending').length;assert.equal(await w.h.autoOffer(w.nodes.host.peer,diff),false);assert.equal(w.events.filter(event=>event.role==='guest'&&event.type==='batch_consent'&&event.data.status==='pending').length,offers);}finally{await w.close();}
});
await test('an explicit retry always creates a new proposal and requires a new guest decision',async()=>{
 const w=await world();try{const old=await w.offer();w.g.decide({...old,yes:false});await until(()=>w.h.snapshot().proposals.at(-1).status==='declined');const previous=binding(w.h.snapshot().proposals.at(-1));assert.equal(await w.h.retry(previous),true);await until(()=>w.g.snapshot().proposals.at(-1).proposal!==old.proposal);assert.notEqual(w.g.snapshot().proposals.at(-1).proposal,old.proposal);assert.equal(w.g.snapshot().proposals.at(-1).status,'pending');assert.equal(w.g.decide({...old,yes:true}),false);assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('disabled-only and unverified metadata cannot automatically propose a file write',async()=>{
 const w=await world();try{for(const current of [{...diff,verification:'reference'},{...diff,inventoryVerified:false},{...diff,exts:{disabled:names,needsFiles:[]}},{...diff,scope:{carrierSessionId:'old',partyEpoch:0}}])assert.equal(await w.h.autoOffer(w.nodes.host.peer,current),false);assert.equal(w.counts.collects,0);assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('actual owner, connection session, role, party scope, fields and null leases are strict protocol boundaries',async()=>{
 const w=await world();try{const n=w.nodes.host,r=w.h.peers.get(n.peer),base=w.frame('host','hello',{nonce:r.remote});assert.equal(w.h.validate(n.owner,base),true);assert.notEqual(w.h.validate({},base),true);for(const patch of [{protocol:'legacy'},{connectionSessionId:'other'},{roundId:'game-round'},{partySessionId:'party'},{operationId:'old'},{scope:{carrierSessionId:'other',partyEpoch:0}},{extra:true},{nonce:r.local}])assert.notEqual(w.h.validate(n.owner,{...base,data:{...base.data,...patch}}),true);assert.notEqual(w.h.validate(n.owner,{...base,sourcePeer:'host'}),true);assert.notEqual(w.h.validate(n.owner,{...base,sessionId:'other'}),true);assert.equal(w.h.validate(n.owner,{type:'unrelated'}),null);}finally{await w.close();}
});
await test('replayed request IDs and monotonic sequence numbers cannot execute a control twice',async()=>{
 const w=await world();try{const n=w.nodes.host,r=w.h.peers.get(n.peer),frame=w.frame('host','hello',{nonce:r.remote});assert.equal(await w.h.control(n.owner,frame),true);assert.notEqual(w.h.validate(n.owner,frame),true);assert.notEqual(w.h.validate(n.owner,{...frame,seq:frame.seq+1}),true);assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('forged guest decisions with the wrong peer, local scope, proposal or digest are rejected',async()=>{
 const w=await world();try{const choice=await w.offer();for(const patch of [{peerId:'another-peer'},{scope:{...choice.scope,partyEpoch:1}},{session:'f'.repeat(32)},{peerSession:'e'.repeat(32)},{proposal:'d'.repeat(32)},{digest:'a'.repeat(64)},{yes:'true'}])assert.equal(w.g.decide({...choice,yes:true,...patch}),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('unsolicited accept and host-shaped decision cannot authorize a pending guest request',async()=>{
 const w=await world();try{const choice=await w.offer(),n=w.nodes.guest,r=w.g.peers.get(n.peer);const data={from:r.remote,to:r.local,proposal:choice.proposal,digest:choice.digest,remainingMs:120000};await w.g.control(n.owner,w.frame('guest','accept',data));assert.equal(w.g.snapshot().proposals.at(-1).status,'pending');assert.equal(w.counts.receiver,0);assert.notEqual(w.g.validate(n.owner,w.frame('guest','decision',{...data,yes:true})),true);}finally{await w.close();}
});
await test('expiration invalidates the local decision and never reuses its authorization',async()=>{
 const w=await world();try{const choice=await w.offer();w.advance(transferBudgetMs(batch.total));await drain();assert.equal(w.g.decide({...choice,yes:true}),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);assert.equal(w.g.snapshot().proposals.at(-1).status,'expired');}finally{await w.close();}
});
await test('a native playing or loading gate blocks proposals and decisions without touching the transport',async()=>{
 const w=await world();try{w.nodes.host.gate.available=false;w.nodes.host.gate.reason='playing';assert.equal(await w.h.autoOffer(w.nodes.host.peer,diff),false);w.nodes.host.gate.available=true;const choice=await w.offer();w.nodes.guest.gate.available=false;assert.equal(w.g.decide({...choice,yes:true}),false);assert.equal(w.counts.receiver,0);assert.equal(w.p.guest.stopped,false);assert.equal(w.p.host.stopped,false);}finally{await w.close();}
});
await test('file frames before consent, legacy versions and unexpected packet fields have no receiver',async()=>{
 const w=await world();try{const choice=await w.offer(),n=w.nodes.guest,r=w.g.peers.get(n.peer),base=w.frame('guest','hello',{nonce:r.remote});const packet={nnk_files:2,from:r.remote,to:r.local,proposal:choice.proposal,digest:choice.digest,kind:'data',seq:0,index:0,offset:0,end:true,data:'YQ=='};delete base.data.op;delete base.data.nonce;base.type='transfer-file';base.data.packet=packet;for(const p of [packet,{...packet,nnk_files:1},{...packet,extra:true}])assert.notEqual(w.g.validate(n.owner,{...base,data:{...base.data,packet:p}}),true);assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('a changed manifest under the same proposal cannot create or revive file authority',async()=>{
 const w=await world();try{const choice=await w.offer(),n=w.nodes.guest,r=w.g.peers.get(n.peer),changed=clone(batch);changed.extensions[0].files[0].sha256='f'.repeat(64);const frame=w.frame('guest','offer',{from:r.remote,to:r.local,proposal:choice.proposal,digest:choice.digest,batch:changed,ttlMs:transferBudgetMs(changed.total)});await w.g.control(n.owner,frame);assert.equal(w.g.snapshot().proposals.at(-1).status,'failed');assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('cancel invalidates authorization while an asynchronous disk chunk is held and prevents commit',async()=>{
 const gate=deferred(),w=await world({chunkGate:gate});try{const choice=await w.offer();w.g.decide({...choice,yes:true});await until(()=>w.counts.receiver===1&&w.g.peers.get(w.nodes.guest.peer).queueDepth>0,'actual chunk is awaiting disk');const cancel=w.g.cancel(choice);assert.equal(w.g.busy(),true);gate.resolve();assert.equal(await cancel,true);await drain();assert.equal(w.counts.commits,0);assert.ok(w.counts.aborts>0);}finally{gate.resolve();await w.close();}
});
await test('disconnect while source creation is held cannot grant a replacement owner and disposal waits for cleanup',async()=>{
 const gate=deferred(),w=await world({sourceGate:gate});try{const choice=await w.offer();w.g.decide({...choice,yes:true});await until(()=>w.counts.source===1,'source factory started under consent');let done=false;const closing=w.h.dispose().then(()=>{done=true;});await drain();assert.equal(done,false);assert.equal(w.h.busy(),true);gate.resolve();await closing;await drain();assert.equal(w.counts.commits,0);assert.equal(w.h.snapshot().resources.peers,0);assert.ok(w.counts.closedSources>0);}finally{gate.resolve();await w.close();}
});
await test('late collection after a party-epoch change cannot offer stale files or block current native game state forever',async()=>{
 const gate=deferred(),w=await world({collectGate:gate});try{const proposal=w.h.autoOffer(w.nodes.host.peer,diff);await until(()=>w.counts.collects===1);w.nodes.host.scope.partyEpoch++;assert.equal(w.h.busy(),true);gate.resolve();assert.equal(await proposal,false);assert.equal(w.counts.receiver,0);assert.equal(w.h.snapshot().proposals.length,0);assert.equal(w.h.busy(),false);}finally{gate.resolve();await w.close();}
});
await test('committed and unknown outcomes cannot be cancelled or retried as though rolled back',async()=>{
 const w=await world();try{const choice=await w.offer();w.g.decide({...choice,yes:true});await until(()=>w.g.snapshot().files.at(-1)?.status==='committed_activation_required');assert.equal(await w.g.cancel(choice),false);assert.equal(await w.h.retry(binding(w.h.snapshot().proposals.at(-1))),false);assert.equal(w.counts.commits,1);}finally{await w.close();}
});
await test('file-link backpressure terminates the attempt without constructing another connection',async()=>{
 const w=await world();try{const choice=await w.offer();w.p.host.link.bufferedAmount=3*1048576;w.g.decide({...choice,yes:true});await until(()=>w.h.snapshot().files.some(file=>['disconnected','failed','unknown'].includes(file.status)),'bounded link pressure stops file transfer');assert.equal(w.counts.commits,0);assert.equal(w.p.host.snapshot().pcConstructions,1);assert.equal(w.p.host.snapshot().negotiations,1);}finally{await w.close();}
});
await test('an adapter failure ends the old authority and explicit retry still requires a fresh guest approval',async()=>{
 const gate=deferred(),w=await world({sourceGate:gate});try{const old=await w.offer();w.g.decide({...old,yes:true});await until(()=>w.counts.source===1);gate.reject(Error('fixture source file changed'));await until(()=>w.h.snapshot().proposals.at(-1).status==='failed'&&['failed','cancelled'].includes(w.g.snapshot().proposals.at(-1).status),'both old authorities terminate after source failure');assert.equal(w.counts.commits,0);assert.equal(await w.h.retry(binding(w.h.snapshot().proposals.at(-1))),true);await until(()=>w.g.snapshot().proposals.at(-1).proposal!==old.proposal);assert.equal(w.g.snapshot().proposals.at(-1).status,'pending');assert.equal(w.g.decide({...old,yes:true}),false);assert.equal(w.counts.source,1);}finally{gate.resolve();await w.close();}
});
await test('a duplicate positive decision after expiry never resends accept or revives a source',async()=>{
 const gate=deferred(),w=await world({sourceGate:gate});try{const choice=await w.offer();w.g.decide({...choice,yes:true});await until(()=>w.counts.source===1);const accepts=()=>w.p.host.link.sent.map(raw=>JSON.parse(raw)).filter(frame=>frame.type==='transfer-consent'&&frame.data.op==='accept').length,before=accepts();w.advance(transferBudgetMs(batch.total));gate.resolve();await drain();const n=w.nodes.host,r=w.h.peers.get(n.peer);await w.h.control(n.owner,w.frame('host','decision',{from:r.remote,to:r.local,proposal:choice.proposal,digest:choice.digest,yes:true}));await drain();assert.equal(accepts(),before);assert.equal(w.counts.source,1);assert.equal(w.counts.commits,0);}finally{gate.resolve();await w.close();}
});
await test('guest command bindings reject extra fields instead of accepting a permissive authorization shape',async()=>{
 const w=await world();try{const choice=await w.offer();assert.equal(w.g.decide({...choice,yes:true,permanent:true}),false);assert.equal(await w.g.cancel({...choice,allPeers:true}),false);assert.equal(await w.h.retry({...binding(w.h.snapshot().proposals.at(-1)),automatic:true}),false);assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('a guest may still decline a current proposal after the native eligibility gate closes',async()=>{
 const w=await world();try{const choice=await w.offer();w.nodes.guest.gate.available=false;assert.equal(w.g.decide({...choice,yes:true}),false);assert.equal(w.g.decide({...choice,yes:false}),true);await until(()=>w.h.snapshot().proposals.at(-1).status==='declined');assert.equal(w.counts.receiver,0);assert.equal(w.counts.source,0);}finally{await w.close();}
});
await test('local disk failure paths are never serialized into a remote consent or file frame',async()=>{
 const gate=deferred(),w=await world({sourceGate:gate});try{const choice=await w.offer();w.g.decide({...choice,yes:true});await until(()=>w.counts.source===1);gate.reject(Error('open failed C:/Private/Game/extension/secret.js'));await until(()=>w.h.snapshot().proposals.at(-1).status==='failed');await drain();const frames=[...w.p.host.link.sent,...w.p.guest.link.sent];assert.equal(frames.some(raw=>raw.includes('C:/Private')),false);assert.ok(frames.some(raw=>JSON.parse(raw).type==='transfer-file'&&JSON.parse(raw).data.packet.reason?.includes('本次文件操作未完成')));assert.equal(w.counts.commits,0);}finally{gate.resolve();await w.close();}
});
await test('one active or collecting batch globally excludes another peer until the first declines',async()=>{
 const gate=deferred(),owners=new Map(['a','b'].map(peer=>[peer,{role:'host',stopped:false,link:{bufferedAmount:0},snapshot:()=>({lastAcceptedControlSeq:0})}])),records=new Map(['a','b'].map(peer=>[peer,{connectionSessionId:'connection-'+peer}])),out=[],scope={carrierSessionId:'carrier-host',partyEpoch:0};let scans=0;
 const sessions={get:peer=>records.get(peer),getOwner:peer=>owners.get(peer),peerForActualOwner:owner=>[...owners].find(([,actual])=>actual===owner)?.[0],isLive:peer=>owners.has(peer),sendControl:(peer,type,data)=>out.push({peer,type,data})};
 const ctl=new CarrierTransfer({sessions,getRole:()=> 'host',getScope:()=>scope,canTransfer:()=>({available:true}),collect:async()=>{if(++scans===1)await gate.promise;return batch;},normalize:core.normalize,digest:core.manifestDigest,createChannel:()=>{throw Error('No guest consent was supplied');},source:async()=>{throw Error('No guest consent was supplied');},receiver:async()=>{throw Error('No guest consent was supplied');}});
 const frame=(peer,seq,op,fields)=>({type:'transfer-consent',sessionId:'connection-'+peer,sourcePeer:'guest',seq,data:{protocol:TRANSFER_PROTOCOL,partySessionId:null,roundId:null,operationId:null,requestId:crypto.randomUUID(),connectionSessionId:'connection-'+peer,scope:{carrierSessionId:'carrier-'+peer,partyEpoch:0},op,...fields}});
 try{for(const peer of ['a','b']){ctl.setPeerCapability(peer);await ctl.control(owners.get(peer),frame(peer,1,'hello',{nonce:peer.repeat(32)}));}const first=ctl.autoOffer('a',diff);assert.equal(await ctl.autoOffer('b',diff),false);assert.equal(scans,1);gate.resolve();assert.equal(await first,true);assert.equal(await ctl.autoOffer('b',diff),false);const proposal=ctl.snapshot().proposals.at(-1);await ctl.control(owners.get('a'),frame('a',2,'decision',{from:proposal.peerSession,to:proposal.session,proposal:proposal.proposal,digest:proposal.digest,yes:false}));assert.equal(await ctl.autoOffer('b',diff),true);assert.equal(scans,2);}finally{gate.resolve();await ctl.dispose();}
});
await test('an idle higher party epoch renegotiates fresh nonces on the original owner without restoring old consent',async()=>{
 const w=await world();try{const old=await w.offer();w.g.decide({...old,yes:false});await until(()=>w.h.snapshot().proposals.at(-1).status==='declined');const before=[w.p.host.actualIdentity(),w.p.guest.actualIdentity()],oldHostNonce=w.h.peers.get(w.nodes.host.peer).local,oldGuestNonce=w.g.peers.get(w.nodes.guest.peer).local;await w.rotate('host');assert.deepEqual([w.p.host.actualIdentity(),w.p.guest.actualIdentity()],before);assert.notEqual(w.h.peers.get(w.nodes.host.peer).local,oldHostNonce);assert.notEqual(w.g.peers.get(w.nodes.guest.peer).local,oldGuestNonce);assert.equal(w.g.peers.get(w.nodes.guest.peer).remoteScope.partyEpoch,1);assert.equal(w.g.decide({...old,yes:true}),false);const current=await w.offer();assert.notEqual(current.session,old.session);assert.notEqual(current.peerSession,old.peerSession);assert.notEqual(current.proposal,old.proposal);assert.equal(w.counts.receiver,0);assert.equal(w.p.host.snapshot().negotiations,1);assert.equal(w.p.guest.snapshot().negotiations,1);const n=w.nodes.guest,stale=w.frame('guest','hello',{nonce:oldHostNonce});stale.data.scope.partyEpoch=0;assert.notEqual(w.g.validate(n.owner,stale),true);}finally{await w.close();}
});
await test('idle rehandshake rejects a changed same-epoch nonce, lower epoch, different carrier or reused nonce',async()=>{
 const w=await world();try{const n=w.nodes.guest,r=w.g.peers.get(n.peer);for(const [scope,value]of [[{...r.remoteScope},'c'.repeat(32)],[{...r.remoteScope,partyEpoch:-1},'c'.repeat(32)],[{carrierSessionId:'different-carrier',partyEpoch:1},'c'.repeat(32)],[{...r.remoteScope,partyEpoch:1},r.remote]]){const frame=w.frame('guest','hello',{nonce:value});frame.data.scope=scope;assert.notEqual(w.g.validate(n.owner,frame),true);}assert.equal(w.counts.receiver,0);}finally{await w.close();}
});
await test('pending consent and irreversible publication both reject higher-epoch rehandshake',async()=>{
 const w=await world();try{const choice=await w.offer(),n=w.nodes.guest;function changed(){const frame=w.frame('guest','hello',{nonce:'c'.repeat(32)});frame.data.scope.partyEpoch++;return frame;}assert.notEqual(w.g.validate(n.owner,changed()),true);w.g.decide({...choice,yes:true});await until(()=>w.g.snapshot().files.at(-1)?.status==='committed_activation_required');await drain();assert.notEqual(w.g.validate(n.owner,changed()),true);assert.equal(w.counts.commits,1);assert.equal(w.g.snapshot().files.at(-1).fileCommitted,true);}finally{await w.close();}
});
await test('registered participant labels reach local progress but never enter a consent or file frame',async()=>{
 const w=await world(),sent=[];
 try{
  w.nodes.host.registry.setIdentity(w.nodes.host.peer,w.nodes.host.owner,{name:'同名客人',avatar:'caocao'});
  w.nodes.guest.registry.setIdentity(w.nodes.guest.peer,w.nodes.guest.owner,{name:'测试房主',avatar:'liubei'});
  for(const node of Object.values(w.nodes)){const original=node.registry.sendControl.bind(node.registry);node.registry.sendControl=(peer,type,data)=>{sent.push({type,data:clone(data)});return original(peer,type,data);};}
  const choice=await w.offer();
  const host=w.h.snapshot().proposals.at(-1),guest=w.g.snapshot().proposals.at(-1);
  assert.equal(host.peerLabel,'同名客人（客机 1）');assert.equal(host.peerOrdinal,1);
  assert.equal(guest.peerLabel,'测试房主（房主）');assert.equal(host.peerIdentity.name,'同名客人');
  assert.equal(w.g.decide({...choice,yes:true}),true);
  await until(()=>w.h.snapshot().files.at(-1)?.status==='committed_activation_required','host observes the real final outcome');await drain();
  for(const event of w.events.filter(row=>row.type==='batch_files')){assert.equal(event.data.peerLabel,event.role==='host'?host.peerLabel:guest.peerLabel);assert.equal(event.data.peerOrdinal,1);}
  assert.equal(w.h.snapshot().files.at(-1).peerLabel,host.peerLabel);
  function check(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){assert.ok(!['peerLabel','peerIdentity','peerOrdinal','transferParticipants','peerDisplay'].includes(key),'local display field leaked to wire: '+key);check(item);}}
  assert.ok(sent.some(frame=>frame.type==='transfer-file'));for(const frame of sent)check(frame.data);
 }finally{await w.close();}
});
await test('a batch keeps its original participant label after rename, retry and disconnect',async()=>{
 const w=await world();
 try{
  const node=w.nodes.host;node.registry.setIdentity(node.peer,node.owner,{name:'原来名字',avatar:''});
  const oldChoice=await w.offer(),oldHost=w.h.snapshot().proposals.at(-1);
  node.registry.setIdentity(node.peer,node.owner,{name:'新名字',avatar:''});
  assert.equal(w.h.snapshot().proposals.at(-1).peerLabel,'原来名字（客机 1）');
  assert.equal(w.g.decide({...oldChoice,yes:false}),true);await until(()=>w.h.snapshot().proposals.at(-1).status==='declined');
  assert.equal(await w.h.retry(binding(w.h.snapshot().proposals.at(-1))),true);
  await until(()=>w.g.snapshot().proposals.at(-1)?.proposal!==oldChoice.proposal,'new immutable batch arrives');
  const current=w.h.snapshot().proposals.at(-1);assert.equal(current.peerLabel,'新名字（客机 1）');
  assert.equal(w.h.snapshot().proposals.find(row=>row.proposal===oldHost.proposal).peerLabel,'原来名字（客机 1）');
  node.registry.transportStopped(node.owner,'test disconnect');await w.h.forgetPeer(node.peer);
  assert.equal(w.h.snapshot().proposals.find(row=>row.proposal===current.proposal).peerLabel,'新名字（客机 1）');
 }finally{await w.close();}
});
console.log('\n全部通过: '+passed+' 项\n失败: 0 项');

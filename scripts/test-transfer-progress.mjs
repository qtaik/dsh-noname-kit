import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sourceRoot=process.env.NNK_TRANSFER_PROGRESS_SOURCE_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {createBridgeSession}=await import(pathToFileURL(resolve(sourceRoot,'src/online.js')).href);
const require=createRequire(import.meta.url),{Channel,VERSION,CHUNK}=require(resolve(sourceRoot,'online-kernel/lib/batch-wire.cjs'));
const clone=value=>JSON.parse(JSON.stringify(value));
let passed=0,failed=0;
async function test(label,run){try{await run();passed++;console.log('  ✓ '+label);}catch(error){failed++;console.error('  ✗ '+label+'\n'+(error.stack||error));}}

// Only the file adapters, clock and timers are controlled. Frames use the real
// Channel.handle queue, pending window, retries and source pump; no network or
// installed game directory is opened by this test.
async function sender({sizes=[CHUNK*10+17],pauseRead}={}){
 let clock=1000,timerId=0,authorized=true,sourceCloses=0,grant;
 const frames=[],reports=[],timers=new Map(),contents=sizes.map(size=>Buffer.alloc(size,0x61));
 const batch={extensions:[{name:'ProgressFixture',files:contents.map((bytes,index)=>({path:index===0?'extension.js':'file-'+index+'.txt',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))}],count:sizes.length,total:sizes.reduce((a,b)=>a+b,0)};
 grant={session:'a'.repeat(32),peerSession:'b'.repeat(32),proposal:'c'.repeat(32),digest:'d'.repeat(64),expires:clock+60000,batch};
 const channel=new Channel({role:'host',now:()=>clock,authorize:()=>authorized?grant:null,
  send:raw=>frames.push(JSON.parse(raw)),report:value=>reports.push(clone(value)),
  timers:{setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)},
  source:async()=>({async read(index,offset,length){if(pauseRead)await pauseRead(index,offset);return Buffer.from(contents[index].subarray(offset,offset+length));},close(){sourceCloses++;}}),
  receiver:async()=>{throw Error('A host must not create a receiver');}});
 const packet=(kind,fields={},binding=grant)=>JSON.stringify({nnk_files:VERSION,from:binding.peerSession,to:binding.session,proposal:binding.proposal,digest:binding.digest,kind,...fields});
 async function deliver(kind,fields={},binding=grant){assert.equal(channel.handle(packet(kind,fields,binding)),true);await channel.current?.queue;}
 const pending=()=>[...channel.current.pending].filter(([key,item])=>Number.isSafeInteger(key)&&typeof item.packet.data==='string');
 await channel.granted();
 return {channel,frames,reports,pending,deliver,packet,timers,get grant(){return grant;},get sourceCloses(){return sourceCloses;},advance:ms=>{clock+=ms;},revoke:()=>{authorized=false;},replace:()=>{grant={...clone(grant),session:'e'.repeat(32),peerSession:'f'.repeat(32),proposal:'1'.repeat(32),expires:clock+60000};},close:()=>channel.close()};
}
async function acknowledgeAll(f){let turns=0;while(f.pending().length){assert.ok(++turns<1000,'the authorized batch eventually drains');await f.deliver('ack',{seq:f.pending()[0][0]});}}
const sending=f=>f.reports.filter(row=>row.status==='sending');

await test('host bytes advance only for a first ACK of known local data and preserve the unchanged wire format',async()=>{
 const f=await sender();try{
  assert.equal(f.channel.snapshot().acknowledged,0);await f.deliver('ready');
  assert.equal(f.channel.snapshot().acknowledged,0,'queueing eight chunks is not acknowledged delivery');
  const [seq,item]=f.pending()[0],localBytes=Buffer.byteLength(item.packet.data,'base64');
  await f.deliver('ack',{seq:99999});assert.equal(f.channel.snapshot().acknowledged,0);
  await f.deliver('ack',{seq});assert.equal(f.channel.snapshot().acknowledged,localBytes);
  await f.deliver('ack',{seq});assert.equal(f.channel.snapshot().acknowledged,localBytes,'duplicate ACKs do not count twice');
  assert.equal(f.channel.snapshot().received,0,'host reports do not invent receiver write progress');
  for(const row of f.frames.filter(frame=>frame.kind==='data'))assert.deepEqual(Object.keys(row).sort(),['nnk_files','from','to','proposal','digest','kind','seq','index','offset','end','data'].sort());
 }finally{await f.close();}
});

await test('host progress is monotone, throttled for 250 ms and forced for the final ACK without claiming a commit',async()=>{
 const f=await sender();try{
  await f.deliver('ready');const initial=sending(f).length;
  await f.deliver('ack',{seq:f.pending()[0][0]});assert.equal(sending(f).length,initial+1);
  f.advance(100);await f.deliver('ack',{seq:f.pending()[0][0]});assert.equal(sending(f).length,initial+1);
  f.advance(149);await f.deliver('ack',{seq:f.pending()[0][0]});assert.equal(sending(f).length,initial+1);
  f.advance(1);await f.deliver('ack',{seq:f.pending()[0][0]});assert.equal(sending(f).length,initial+2);
  const total=f.grant.batch.total;
  assert.ok(f.channel.snapshot().acknowledged<total,'unsent or unacknowledged bytes cannot appear as 100%');
  await acknowledgeAll(f);
  assert.equal(sending(f).at(-1).acknowledged,total,'the final byte ACK is visible even within the throttle window');
  assert.equal(sending(f).length,initial+3);
  const bytes=sending(f).map(row=>row.acknowledged);assert.deepEqual(bytes,[...bytes].sort((a,b)=>a-b));
  assert.equal(f.channel.snapshot().status,'sending');assert.equal(f.channel.snapshot().fileCommitted,false);
  assert.equal(f.channel.current.finishSent,true);assert.ok(f.frames.some(frame=>frame.kind==='finish'));
  await f.deliver('result',{status:'activation_pending',reason:'durable batch receipt'});
  assert.equal(f.channel.snapshot().status,'activation_pending');assert.equal(f.channel.snapshot().fileCommitted,true);
  await f.deliver('result',{status:'committed',reason:'activation receipt'});
  assert.equal(f.channel.snapshot().status,'committed');assert.equal(f.channel.snapshot().acknowledged,total);
 }finally{await f.close();}
});

await test('zero byte files complete their ACK window without emitting one progress event per empty file',async()=>{
 const f=await sender({sizes:Array(24).fill(0)});try{
  await f.deliver('ready');const before=sending(f).length;await acknowledgeAll(f);
  assert.equal(f.channel.snapshot().acknowledged,0);assert.equal(f.channel.current.finishSent,true);
  assert.ok(sending(f).length-before<=2,'a zero-byte total must not force a progress report for every ACK');
  assert.equal(f.channel.snapshot().fileCommitted,false);
 }finally{await f.close();}
});

await test('trailing empty files do not repeat an already complete byte counter for every ACK',async()=>{
 const f=await sender({sizes:[7,...Array(24).fill(0)]});try{
  await f.deliver('ready');await f.deliver('ack',{seq:f.pending()[0][0]});const before=sending(f).length;
  await acknowledgeAll(f);assert.equal(f.channel.snapshot().acknowledged,7);
  assert.ok(sending(f).length-before<=1,'trailing empty files can force only the final completion update');
 }finally{await f.close();}
});

await test('expired, cancelled and disconnected channels preserve the real partial count and reject later ACK growth',async()=>{
 for(const status of ['expired','cancelled','disconnected']){
  const f=await sender();try{
   await f.deliver('ready');await f.deliver('ack',{seq:f.pending()[0][0]});const acknowledged=f.channel.snapshot().acknowledged,late=f.pending()[0][0];
   if(status==='expired')f.advance(60001);else await f.channel.stop(status,'controlled end');
   await f.deliver('ack',{seq:late});assert.equal(f.channel.snapshot().status,status);assert.equal(f.channel.snapshot().acknowledged,acknowledged);
   assert.ok(acknowledged>0&&acknowledged<f.grant.batch.total);assert.equal(f.channel.snapshot().fileCommitted,false);
  }finally{await f.close();}
 }
});

await test('cancellation during an asynchronous source read cannot be revived by a delayed progress report',async()=>{
 let release,blocked=false;const gate=new Promise(resolve=>{release=resolve;});
 const f=await sender({pauseRead:async(index,offset)=>{if(offset===CHUNK*8){blocked=true;await gate;}}});try{
  await f.deliver('ready');const next=f.deliver('ack',{seq:f.pending()[0][0]});
  for(let n=0;n<20&&!blocked;n++)await Promise.resolve();assert.equal(blocked,true);
  await f.channel.stop('cancelled','controlled end during read');release();await next;
  assert.equal(f.channel.snapshot().status,'cancelled');assert.equal(f.channel.snapshot().acknowledged,CHUNK);
  assert.equal(f.reports.at(-1).status,'cancelled');
 }finally{release();await f.close();}
});

await test('a replacement grant starts at zero and old bound ACKs cannot affect its progress',async()=>{
 const f=await sender();try{
  await f.deliver('ready');await f.deliver('ack',{seq:f.pending()[0][0]});const old=clone(f.grant),late=f.pending()[0][0];
  f.replace();await f.channel.granted();await f.deliver('ready');assert.equal(f.channel.snapshot().acknowledged,0);
  await f.deliver('ack',{seq:late},old);assert.equal(f.channel.snapshot().acknowledged,0);
  await f.deliver('ack',{seq:f.pending()[0][0]});assert.equal(f.channel.snapshot().acknowledged,CHUNK);
 }finally{await f.close();}
});

const binding={role:'host',session:'a'.repeat(32),peerSession:'b'.repeat(32),proposal:'c'.repeat(32),digest:'d'.repeat(64),peerId:'guest-one',scope:{carrierSessionId:'carrier-one',partyEpoch:0}};
function bridgeFixture(){let seq=0;const bridge=createBridgeSession({token:'local-progress-test'});return {bridge,poll(events){bridge.poll({kernel:{role:'host'},events});},event(type,data={},chosen){return {seq:chosen??++seq,type,data:clone(data),ts:1000+(chosen??seq)};},files(){return bridge.snapshot().events.filter(row=>row.type==='batch_files');}};}

await test('bridge coalesces repeated active updates without evicting the manifest or changing other event order',async()=>{
 const f=bridgeFixture(),check=f.event('manifest_check',{status:'pending',request:1}),diff=f.event('manifest_diff',{verification:'verified',request:1}),info=f.event('info',{message:'keep this notice'});
 f.poll([check,diff]);f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:0,total:1000})]);f.poll([info]);
 for(let n=1;n<=260;n++)f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:n,total:1000})]);
 const rows=f.bridge.snapshot().events;assert.equal(f.files().length,1);assert.equal(f.files()[0].data.acknowledged,260);
 assert.deepEqual(rows.filter(row=>row.type!=='batch_files').map(row=>row.type),['manifest_check','manifest_diff','info']);
 assert.equal(rows.at(-1).type,'batch_files');
});

await test('bridge keeps stage transitions and every failure or final event while merging each active stage',async()=>{
 const f=bridgeFixture();
 for(const status of ['starting','waiting_receiver','sending','committing','activation_pending'])for(let n=0;n<2;n++)f.poll([f.event('batch_files',{...binding,status,acknowledged:n})]);
 assert.deepEqual(f.files().map(row=>row.data.status),['starting','waiting_receiver','sending','committing','activation_pending']);
 for(const status of ['failed','cancelled','expired','disconnected','recovery_required','unknown','committed','committed_activation_required']){
  f.poll([f.event('batch_files',{...binding,status,reason:'first'}),f.event('batch_files',{...binding,status,reason:'second'})]);
  assert.equal(f.files().filter(row=>row.data.status===status).length,2);
 }
 const consent=f.event('batch_consent',{...binding,status:'authorized_paused'});f.poll([consent]);assert.ok(f.bridge.snapshot().events.some(row=>row.seq===consent.seq));
 const g=bridgeFixture();for(const status of ['sending','committing','sending'])g.poll([g.event('batch_files',{...binding,status,acknowledged:1})]);
 assert.deepEqual(g.files().map(row=>row.data.status),['sending','committing','sending'],'a later stage cannot delete an earlier occurrence of sending');
});

await test('bridge active updates require the full matching role, session, peer, proposal, digest and scope',async()=>{
 const variants=[{role:'guest'},{session:'e'.repeat(32)},{peerSession:'f'.repeat(32)},{proposal:'1'.repeat(32)},{digest:'2'.repeat(64)},{peerId:'guest-two'},{scope:{carrierSessionId:'carrier-two',partyEpoch:0}},{scope:{carrierSessionId:'carrier-one',partyEpoch:1}}];
 for(const patch of variants){const f=bridgeFixture();f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:1}),f.event('batch_files',{...binding,...patch,status:'sending',acknowledged:2})]);assert.equal(f.files().length,2,JSON.stringify(patch));}
 const f=bridgeFixture();f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:1}),f.event('batch_files',{...binding,scope:{partyEpoch:0,carrierSessionId:'carrier-one'},status:'sending',acknowledged:2})]);assert.equal(f.files().length,1,'scope identity does not depend on object key order');
 const g=bridgeFixture(),partial={status:'sending',acknowledged:1};g.poll([g.event('batch_files',partial),g.event('batch_files',partial)]);assert.equal(g.files().length,2,'incomplete legacy bindings must not accidentally coalesce');
});

await test('duplicate and older bridge sequences cannot overwrite newer progress',async()=>{
 const f=bridgeFixture();f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:300},100)]);
 f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:10},99),f.event('batch_files',{...binding,status:'sending',acknowledged:20},100)]);
 assert.equal(f.files().length,1);assert.equal(f.files()[0].data.acknowledged,300);assert.equal(f.files()[0].seq,100);
 f.poll([f.event('batch_files',{...binding,status:'sending',acknowledged:400},101)]);assert.equal(f.files().length,1);assert.equal(f.files()[0].data.acknowledged,400);
});

console.log(`\n${passed} transfer progress checks passed; ${failed} failed.`);
if(failed)process.exitCode=1;

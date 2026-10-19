import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const source=fs.readFileSync(new URL('../online-kernel/src/bridge.js',import.meta.url),'utf8');
const endpoint=port=>'http://127.0.0.1:'+port+'/noname-kit-api';
const config=(port,token='owner')=>({baseUrl:endpoint(port),token,intervalMs:700});
async function until(check){for(let n=0;n<400;n++){if(check())return;await Promise.resolve();}throw Error('Expected asynchronous bridge state was not reached');}
function fixture(initial=config(3001)){
 const intervals=new Map(),deadlines=new Map(),posted=[],reads=[],calls=[];let sequence=0,current=initial,postMode='ok',held=null,readGate=null;
 const nnk={version:'test',build:'test',state:{bootStage:'ready'},modules:{config:{get:key=>key==='transferLimitMB'?128:'',defaults:{}}}};
 const window={__nnk__:nnk,addEventListener(){}};
 function fetch(url,options){
  if(options.method!=='POST'){
   reads.push({url,signal:options.signal});
   if(readGate)return readGate.promise;
   return Promise.resolve({ok:!!current,json:async()=>current});
  }
  posted.push({url,body:JSON.parse(options.body),signal:options.signal});
  if(postMode==='fail')return Promise.reject(Error('Old listener unavailable'));
  if(postMode==='hold')return new Promise((resolve,reject)=>{held={resolve,reject};options.signal.addEventListener('abort',()=>reject(Error('Heartbeat deadline')),{once:true});});
  return Promise.resolve({ok:true,json:async()=>({commands:[]})});
 }
 vm.runInNewContext(source,{window,location:{origin:'http://localhost:8089'},console:{log(){},warn(){},error(){}},URL,AbortController,Promise,Date,fetch,
  setTimeout(fn){const id=++sequence;deadlines.set(id,fn);return id;},clearTimeout(id){deadlines.delete(id);},
  setInterval(fn){const id=++sequence;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);}});
 const bridge=nnk.modules.bridge;
 return {bridge,posted,reads,calls,intervals,deadlines,setConfig:value=>{current=value;},setPostMode:value=>{postMode=value;},
  holdRead(){let resolve;const promise=new Promise(r=>{resolve=r;});readGate={promise,resolve};},releaseRead(value=current){const gate=readGate;readGate=null;gate.resolve({ok:!!value,json:async()=>value});},
  completePost(commands=[]){assert(held);const row=held;held=null;row.resolve({ok:true,json:async()=>({commands})});},
  expire(){for(const fn of [...deadlines.values()])fn();},
  async init(){await bridge.init({dispatch:async cmd=>{calls.push(cmd.action);}});},
  async idle(){await until(()=>!bridge.snapshot().polling);},
  fireTick(){assert.equal(intervals.size,1);[...intervals.values()][0]();},
  async tick(){this.fireTick();await this.idle();},
  stop(){bridge.stop('test complete');}};
}
export async function runBridgeSerializationChecks(){
 const results=[];
 {
  const f=fixture();try{
   await f.init();await f.idle();
   const postedBefore=f.posted.length,readsBefore=f.reads.length;
   f.holdRead();f.fireTick();await until(()=>f.reads.length===readsBefore+1);
   f.bridge.emit('during-config-read',{value:1});
   for(let n=0;n<3;n++)f.fireTick();
   assert.equal(f.reads.length,readsBefore+1,'A pending configuration read must not start another read');
   assert.equal(f.posted.length,postedBefore,'No heartbeat may post before configuration resolves');
   assert.equal(f.bridge.snapshot().polling,true);
   f.releaseRead();await f.idle();
   assert.equal(f.posted.length,postedBefore+1);
   assert.deepEqual(f.posted.at(-1).body.events.map(row=>row.type),['during-config-read']);
   assert.equal(f.bridge.snapshot().backlog,0);
   await f.tick();assert.equal(f.posted.length,postedBefore+2);
   assert.equal(f.posted.at(-1).body.events.length,0,'Acknowledged events must not replay');
   results.push({name:'Pending configuration reads serialize ticks and preserve queued events',ok:true});
  }finally{f.stop();}
 }
 {
  const f=fixture();try{
   await f.init();await f.idle();
   const postedBefore=f.posted.length;
   f.setPostMode('hold');f.bridge.emit('before-held-post',{value:1});f.fireTick();
   await until(()=>f.posted.length===postedBefore+1);
   const readsDuring=f.reads.length,firstSequence=f.posted.at(-1).body.events[0].seq;
   f.bridge.emit('during-held-post',{value:2});
   for(let n=0;n<3;n++)f.fireTick();
   assert.equal(f.reads.length,readsDuring,'A pending POST must not start another configuration read');
   assert.equal(f.posted.length,postedBefore+1,'A pending POST must not overlap another heartbeat');
   assert.equal(f.bridge.snapshot().polling,true);
   assert.deepEqual(f.posted.at(-1).body.events.map(row=>row.type),['before-held-post']);
   f.completePost();await f.idle();
   assert.equal(f.bridge.snapshot().backlog,0);
   assert.equal(f.bridge.snapshot().events,1,'New events must survive acknowledgment of the earlier batch');
   f.setPostMode('ok');await f.tick();
   assert.equal(f.posted.length,postedBefore+2);
   assert.deepEqual(f.posted.at(-1).body.events.map(row=>row.type),['during-held-post']);
   assert(f.posted.at(-1).body.events[0].seq>firstSequence);
   assert.equal(f.bridge.snapshot().backlog,0);assert.equal(f.bridge.snapshot().events,0);
   results.push({name:'Pending POSTs serialize ticks and retain events for the next heartbeat',ok:true});
  }finally{f.stop();}
 }
 return results;
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
const results=[];
async function test(name,run){try{await run();results.push({name,ok:true});console.log('ok',name);}catch(error){results.push({name,ok:false});console.error('FAIL',name,error);}}
await test('A failed old listener is replaced from the binding file without restarting the document',async()=>{
 const f=fixture();try{f.setPostMode('fail');await f.init();await f.idle();f.bridge.emit('keep',{value:1});f.setConfig(config(3002));f.setPostMode('ok');await f.tick();assert.equal(f.posted.at(-1).url,endpoint(3002)+'/online/bridge');assert.equal(f.posted.at(-1).body.events[0].type,'keep');assert.equal(f.intervals.size,1);}finally{f.stop();}
});
await test('An explicit binding change is applied even while the previous listener still responds',async()=>{
 const f=fixture();try{await f.init();await f.idle();f.setConfig(config(3002));await f.tick();assert.equal(f.posted.at(-1).url,endpoint(3002)+'/online/bridge');assert.equal(f.posted.length,2);}finally{f.stop();}
});
await test('A late reply from the old binding cannot execute commands or leak old-owner events',async()=>{
 const f=fixture();try{f.setPostMode('hold');await f.init();await until(()=>f.posted.length===1);f.bridge.emit('private-event',{secret:'old-owner-only'});f.setConfig(config(3002,'new-owner'));f.completePost([{action:'old-command'}]);await f.idle();assert.deepEqual(f.calls,[]);f.setPostMode('ok');await f.tick();assert.equal(f.posted.at(-1).body.token,'new-owner');assert.equal(f.posted.at(-1).body.events.length,0);}finally{f.stop();}
});
await test('Stopping during configuration refresh prevents another heartbeat or command',async()=>{
 const f=fixture();try{await f.init();await f.idle();f.holdRead();[...f.intervals.values()][0]();f.stop();f.releaseRead();await f.idle();assert.equal(f.posted.length,1);assert.equal(f.intervals.size,0);assert.deepEqual(f.calls,[]);}finally{f.stop();}
});
await test('A missing bridge configuration can be supplied by explicit binding after startup',async()=>{
 const f=fixture(null);try{await f.init();await f.idle();assert.equal(f.posted.length,0);assert.equal(f.intervals.size,1);f.setConfig(config(3002));await f.tick();assert.equal(f.posted.length,1);assert.equal(f.posted[0].url,endpoint(3002)+'/online/bridge');}finally{f.stop();}
});
await test('Non-loopback, credential-bearing and malformed binding addresses never receive a token',async()=>{
 for(const bad of ['https://example.invalid/noname-kit-api','http://example.invalid/noname-kit-api','http://user@127.0.0.1:3002/noname-kit-api','http://127.0.0.1:3002/noname-kit-api?copy=token','invalid']){
  const f=fixture({baseUrl:bad,token:'private'});try{await f.init();await f.idle();assert.equal(f.posted.length,0);}finally{f.stop();}
 }
});
await test('A hanging previous listener has a deadline and does not block the next binding',async()=>{
 const f=fixture();try{f.setPostMode('hold');await f.init();await until(()=>f.posted.length===1);f.expire();await f.idle();f.setConfig(config(3002));f.setPostMode('ok');await f.tick();assert.equal(f.posted.at(-1).url,endpoint(3002)+'/online/bridge');}finally{f.stop();}
});
await test('Changing binding between commands stops the rest of the old response',async()=>{
 const f=fixture();try{f.setPostMode('hold');await f.init();await until(()=>f.posted.length===1);f.completePost([{action:'first'},{action:'second'}]);await until(()=>f.calls.length===1);f.setConfig(config(3002,'new-owner'));await f.idle();assert.deepEqual(f.calls,['first']);}finally{f.stop();}
});
await test('The same owner retains unsent events when only its local listening port changes',async()=>{
 const f=fixture();try{f.setPostMode('fail');await f.init();await f.idle();f.bridge.emit('event',{value:3});await f.tick();f.setConfig(config(3002));f.setPostMode('ok');await f.tick();assert.equal(f.posted.at(-1).body.events.length,1);assert.equal(f.posted.at(-1).body.events[0].data.value,3);assert.equal(f.bridge.snapshot().backlog,0);}finally{f.stop();}
});
for(const row of await runBridgeSerializationChecks()){results.push(row);console.log('ok',row.name);}
const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({passed,total:results.length,scope:'Production bridge with controlled local HTTP responses; no native or peer-network claim'}));if(passed!==results.length)process.exitCode=1;
}

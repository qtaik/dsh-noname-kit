import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {saveTransferLimit,validTransferLimit} from '../online-kernel/keepalive/transfer-limit-config.js';
import {CarrierRuntime} from '../online-kernel/keepalive/carrier-runtime.js';
import {createEngineOperationPort} from '../online-kernel/keepalive/engine-operation-port.js';
const require=createRequire(import.meta.url),core=require('../online-kernel/lib/batch-files.cjs');
const KEY='nnk_transferLimitMB',prefix='official-fixture_',configKey=prefix+'config';
const profile=useDB=>({configStorage:{prefix,useDB},config:{transferLimitMB:300,onlineName:'Guest'},identity:{name:'Guest',avatar:'caocao'}});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function local(config={extensions:['Existing'],theme:'unchanged',extension_Existing_enable:false,[KEY]:300}){const records=new Map([[configKey,JSON.stringify(config)]]);let writes=0,reads=0;return {records,get writes(){return writes;},get reads(){return reads;},getItem(key){reads++;return records.get(key)??null;},setItem(key,value){writes++;records.set(key,value);}};}
function database({mode='ok',hasConfig=true,keyPath=null,wrongReadback=false}={}){
 const data=new Map([['extensions',['Existing']],['extension_Existing_enable',false],['theme','unchanged'],[KEY,300]]),writes=[],opens=[],transactions=[];let aborted=0,closed=0,request;
 const db={objectStoreNames:{contains:name=>hasConfig&&name==='config'},close(){closed++;},transaction(names,mode){assert.deepEqual(names,['config']);const staged=new Map(data);let stopped=false,pending=0,queued=false;
  const tx={oncomplete:null,onabort:null,onerror:null,abort(){if(stopped)return;stopped=true;aborted++;queueMicrotask(()=>tx.onabort?.());},objectStore(name){assert.equal(name,'config');return {keyPath,autoIncrement:false,put(value,key){assert.equal(mode,'readwrite');writes.push({key,value});staged.set(key,value);finish();},get(key){pending++;const read={};queueMicrotask(()=>{if(!stopped){read.result=wrongReadback&&mode==='readonly'&&key===KEY?42:staged.get(key);read.onsuccess?.();}pending--;finish();});return read;}};}};
  function finish(){if(queued||stopped)return;queued=true;queueMicrotask(()=>{queued=false;if(stopped||pending)return;if(mode==='readwrite'){data.clear();for(const row of staged)data.set(...row);}stopped=true;tx.oncomplete?.();});}
  transactions.push(mode);return tx;
 }};
 const indexedDB={open(name,...versions){opens.push({name,versions});request={transaction:{abort(){aborted++;}},result:db};queueMicrotask(()=>{if(mode==='upgrade')request.onupgradeneeded?.();else if(mode==='blocked')request.onblocked?.();else if(mode==='error')request.onerror?.();else if(mode!=='stall')request.onsuccess?.();});return request;}};
 return {indexedDB,data,writes,opens,transactions,get aborted(){return aborted;},get closed(){return closed;},get request(){return request;}};
}
async function withLocal(storage,run){const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{return await run();}finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}}
function runtimeFixture({busy=false,nativeTransfer={available:true},useDB=false}={}){
 const events=[],updates=[],operations=[];let snapshots=0;const r=Object.assign(Object.create(CarrierRuntime.prototype),{stopped:false,leaving:false,partyEpoch:0,profile:profile(useDB),profileOperations:new Map(),profileOperationSequence:0,profileConfirmedSequence:0,transferLimitSaving:null,transferRequest:null,
  nativeSnapshot:{transfer:nativeTransfer},native:{async snapshot(){snapshots++;return {transfer:nativeTransfer};}},engines:{current:null,async operation(...args){operations.push(args);return {profile:{config:{transferLimitMB:args[1].value,onlineName:'Guest'},identity:{name:'Guest',avatar:'caocao'}}};}},
  coordinator:{closed:false,getLocalIdentity:()=>({name:'Guest',avatar:'caocao'}),localIdentityChanged(){assert.fail('capacity must not change identity');}},transfer:{busy:()=>busy||!!r.transferLimitSaving,setEnabled:async()=>{}},filePrimitives:{normalize:core.normalize},nnk:{state:{},modules:{bridge:{emit:(name,data)=>events.push({name,data})}}},update(){updates.push(!!this.transferLimitSaving);},maybeAutoHealth(){},event(){}});
 return {r,events,updates,operations,get snapshots(){return snapshots;},setBusy:value=>{busy=value;}};
}
const manifest=total=>({extensions:[{name:'Test',files:[{path:'extension.js',size:total,sha256:'a'.repeat(64)}]}]});
let count=0;async function test(name,run){await run();count++;console.log('  ✓ '+name);}
for(const value of [1,300,1024])await test('local persistence saves and reads back exact numeric capacity '+value,async()=>{
 const storage=local(),result=await saveTransferLimit({profile:profile(false),value,storage}),config=JSON.parse(storage.records.get(configKey));assert.deepEqual(result,{saved:true,value,storage:'localstorage'});assert.equal(config[KEY],value);assert.deepEqual(config.extensions,['Existing']);assert.equal(config.extension_Existing_enable,false);assert.equal(config.theme,'unchanged');assert.equal(Object.hasOwn(config,'extension_联机助手_transferLimitMB'),false);assert.equal(storage.writes,1);
});
for(const value of [0,1025,1073741825,-1,1.5,'1024',Infinity,NaN,null])await test('invalid capacity is rejected before any storage access: '+String(value),async()=>{
 const storage=local();assert.equal(validTransferLimit(value),false);await assert.rejects(saveTransferLimit({profile:profile(false),value,storage}),/1 至 1024/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);
});
await test('local malformed or missing configuration is preserved rather than replaced',async()=>{
 for(const raw of [null,'{broken','[]','null']){const storage=local();if(raw===null)storage.records.delete(configKey);else storage.records.set(configKey,raw);await assert.rejects(saveTransferLimit({profile:profile(false),value:1024,storage}),/原游戏配置/);assert.equal(storage.writes,0);}
});
await test('a failed or mismatched local readback never reports saved',async()=>{
 const storage=local();storage.setItem=()=>{};await assert.rejects(saveTransferLimit({profile:profile(false),value:1024,storage}),/读回不一致/);
});
await test('database writes only the fixed nnk key and verifies the completed transaction',async()=>{
 const db=database(),result=await saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB});assert.deepEqual(result,{saved:true,value:1024,storage:'indexeddb'});assert.deepEqual(db.opens,[{name:prefix+'data',versions:[]}]);assert.deepEqual(db.transactions,['readwrite','readonly']);assert.deepEqual(db.writes,[{key:KEY,value:1024}]);assert.equal(db.data.get(KEY),1024);assert.deepEqual(db.data.get('extensions'),['Existing']);assert.equal(db.data.get('extension_Existing_enable'),false);assert.equal(db.data.get('theme'),'unchanged');assert.equal(db.closed,1);
});
await test('missing database is aborted without creating or upgrading its schema',async()=>{
 const db=database({mode:'upgrade'});await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB}),/未找到/);assert.equal(db.aborted,1);assert.deepEqual(db.transactions,[]);assert.deepEqual(db.writes,[]);
});
for(const mode of ['error','blocked'])await test('database '+mode+' cannot fall back to local configuration',async()=>{
 const db=database({mode}),storage=local();await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB,storage}),/数据库/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);assert.equal(db.writes.length,0);
});
await test('missing config store and incompatible key paths are rejected',async()=>{
 for(const options of [{hasConfig:false},{keyPath:'key'}]){const db=database(options);await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB}),/存储/);assert.equal(db.writes.length,0);}
});
await test('database timeout bounds the operation and closes any late-open result',async()=>{
 const db=database({mode:'stall'});await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB,timeoutMs:5}),/超时/);db.request.onsuccess();assert.equal(db.closed,1);assert.equal(db.writes.length,0);
});
await test('database success requires exact readback and a still-current document',async()=>{
 const db=database({wrongReadback:true});await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:db.indexedDB}),/读回不一致/);const retired=database();let calls=0;await assert.rejects(saveTransferLimit({profile:profile(true),value:1024,indexedDB:retired.indexedDB,isCurrent:()=>++calls===1}),/失效/);assert.equal(retired.writes.length,0);
});
await test('no-engine runtime saves through official storage and updates its shared live profile',async()=>{
 const f=runtimeFixture(),originalProfile=f.r.profile,storage=local();await withLocal(storage,async()=>{const result=await f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}});assert.equal(f.r.profile,originalProfile);assert.equal(originalProfile.config.transferLimitMB,1024);assert.equal(result.profile.config.transferLimitMB,1024);assert.equal(JSON.parse(storage.records.get(configKey))[KEY],1024);assert.equal(f.snapshots,1);assert.equal(f.operations.length,0);assert.equal(f.events.length,1);assert.equal(f.events[0].name,'config_applied');assert.equal(f.events[0].data.value,1024);assert.deepEqual(f.updates,[true,false]);assert.equal(f.r.nnk.state.transferLimitSaving,false);});
});
await test('only the exact transfer capacity key can be saved without an engine',async()=>{
 const f=runtimeFixture(),storage=local();await withLocal(storage,async()=>{for(const args of [{key:'onlineName',value:'X'},{key:'transferLimitMB',value:1024,extra:true},{key:'transferLimitMB',value:1025},{key:'transferLimitMB',value:'1024'}])await assert.rejects(f.r.dispatch({action:'set_config',args}));assert.equal(storage.writes,0);assert.equal(f.operations.length,0);});
});
await test('busy, awaiting consent, active ownership and recovery reject changes before writes',async()=>{
 for(const options of [{busy:true},{nativeTransfer:{available:false,owned:true}},{nativeTransfer:{available:false,recoveryRequired:true}},{nativeTransfer:{available:false,cancelled:true}}]){const f=runtimeFixture(options),storage=local();await withLocal(storage,async()=>{await assert.rejects(f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}}),/尚未结束/);assert.equal(storage.writes,0);assert.equal(f.r.profile.config.transferLimitMB,300);});}
});
await test('fresh native recovery overrides a stale eligible snapshot',async()=>{
 const f=runtimeFixture(),storage=local();f.r.native.snapshot=async()=>({transfer:{available:false,recoveryRequired:true,reason:'需要恢复'}});await withLocal(storage,async()=>{await assert.rejects(f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}}),/需要恢复/);assert.equal(storage.writes,0);assert.equal(f.r.transferLimitSaving,null);assert.equal(f.r.profile.config.transferLimitMB,300);});
});
await test('in-flight save blocks a second save and transfer eligibility until its real result',async()=>{
 const f=runtimeFixture(),storage=local();let release;const gate=new Promise(resolve=>{release=resolve;});f.r.native.snapshot=async()=>{await gate;return {transfer:{available:true}};};
 await withLocal(storage,async()=>{const first=f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}});await flush();assert.equal(f.r.transfer.busy(),true);assert.equal(f.r.transferEligibility().available,false);assert.match(f.r.transferEligibility().reason,/正在保存/);await assert.rejects(f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:128}}),/尚未结束/);release();await first;assert.equal(f.r.profile.config.transferLimitMB,1024);assert.equal(f.r.transfer.busy(),false);});
});
await test('retired no-engine operation cannot publish a successful profile',async()=>{
 const f=runtimeFixture(),storage=local();f.r.native.snapshot=async()=>{f.r.leaving=true;return {transfer:{available:true}};};await withLocal(storage,async()=>{await assert.rejects(f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}}),/失效/);assert.equal(storage.writes,0);assert.equal(f.events.length,0);assert.equal(f.r.profile.config.transferLimitMB,300);});
});
await test('an existing engine continues to use its original verified operation API',async()=>{
 const f=runtimeFixture(),binding={scope:{roundId:'current-round'}};f.r.engines.current=binding;const result=await f.r.dispatch({action:'set_config',args:{key:'transferLimitMB',value:1024}});assert.equal(f.operations.length,1);assert.deepEqual(f.operations[0],['set_config',{key:'transferLimitMB',value:1024},binding]);assert.equal(result.profile.config.transferLimitMB,1024);assert.equal(f.snapshots,0);
});
await test('saved capacity limits future canonical proposals without altering the global 1-GiB hard cap',async()=>{
 const f=runtimeFixture(),r=f.r;r.profile.config.transferLimitMB=1;assert.equal(r.normalizeTransferBatch(manifest(1048576)).total,1048576);assert.throws(()=>r.normalizeTransferBatch(manifest(1048577)),/当前补传容量/);r.profile.config.transferLimitMB=1024;assert.equal(r.normalizeTransferBatch(manifest(1073741824)).total,1073741824);assert.throws(()=>r.normalizeTransferBatch(manifest(1073741825)));assert.equal(core.normalize(manifest(1073741824)).total,1073741824);
});

function engineFixture(){
 const saved=new Map([[KEY,300]]),pendingSaves=[],pendingReads=[],events=[],calls=[],config={nnk_transferLimitMB:300};let alive=true;
 const nnk={env:{lib:{config,db:{},version:'official-fixture'},get:{connectNickname:()=> 'Guest'},game:{saveConfig(key,value,local,callback){assert.equal(local,false);calls.push({key,value});config[key]=value;pendingSaves.push(()=>{saved.set(key,value);callback();});},getDB(store,key,callback){assert.equal(store,'config');pendingReads.push(value=>callback(value===undefined?saved.get(key):value));}}},modules:{config:{defaults:{transferLimitMB:300},get:key=>config['nnk_'+key]??300}}};
 const port=createEngineOperationPort(nnk,{isCurrent:()=>alive,onEvent:(name,data)=>events.push({name,data})});
 return {port,saved,pendingSaves,pendingReads,events,calls,retire(){alive=false;port.dispose();}};
}
await test('real engine port waits for actual save completion and readback before capacity acknowledgement',async()=>{
 const f=engineFixture();try{const work=f.port.execute('set_config',{key:'transferLimitMB',value:1024});await flush();assert.deepEqual(f.calls,[{key:KEY,value:1024}]);assert.equal(f.events.length,0);assert.equal(f.saved.get(KEY),300);assert.equal(f.pendingReads.length,0);f.pendingSaves.shift()();await flush();assert.equal(f.events.length,0);assert.equal(f.pendingReads.length,1);f.pendingReads.shift()();const result=await work;assert.equal(result.persistence.storedKey,KEY);assert.equal(result.persistence.value,1024);assert.equal(result.profile.config.transferLimitMB,1024);assert.equal(f.events.length,1);assert.equal(f.events[0].name,'config_applied');assert.equal(f.events[0].data.value,1024);}finally{f.retire();}
});
await test('real engine port rejects invalid numbers and arbitrary keys before native writes',async()=>{
 const f=engineFixture();try{for(const value of [0,1025,1.5,'1024',null])await assert.rejects(f.port.execute('set_config',{key:'transferLimitMB',value}),/1 至 1024/);await assert.rejects(f.port.execute('set_config',{key:'extensions',value:[]}),/不允许/);assert.equal(f.calls.length,0);assert.equal(f.events.length,0);}finally{f.retire();}
});
await test('real engine port rejects mismatched persisted capacity without publishing success',async()=>{
 const f=engineFixture();try{const work=f.port.execute('set_config',{key:'transferLimitMB',value:1024});await flush();f.pendingSaves.shift()();await flush();f.pendingReads.shift()(300);await assert.rejects(work,/mismatch/);assert.equal(f.events.length,0);}finally{f.retire();}
});
await test('retired engine callbacks cannot acknowledge an old capacity change',async()=>{
 const f=engineFixture(),work=f.port.execute('set_config',{key:'transferLimitMB',value:1024});await flush();f.retire();await assert.rejects(work,/Retired/);f.pendingSaves.shift()();await flush();assert.equal(f.events.length,0);assert.equal(f.pendingReads.length,0);
});

await test('missing profile capacity retains the established 300-MiB default',async()=>{
 const {r}=runtimeFixture();delete r.profile.config.transferLimitMB;assert.equal(r.normalizeTransferBatch(manifest(300*1048576)).total,300*1048576);assert.throws(()=>r.normalizeTransferBatch(manifest(300*1048576+1)),/当前补传容量/);
});
console.log('\n全部通过: '+count+' 项\n失败: 0 项');
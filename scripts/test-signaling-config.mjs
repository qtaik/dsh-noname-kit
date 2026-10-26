#!/usr/bin/env node
// Isolated local persistence fixtures. No broker connection or native-game evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DEFAULT_SIGNALING_URL,normalizeSignalingUrl,saveSignalingUrl} from '../online-kernel/keepalive/signaling-config.js';
import {saveConfigValue} from '../online-kernel/keepalive/transfer-limit-config.js';

const KEY='nnk_mqttUrl',prefix='signaling-fixture_',configKey=prefix+'config',value='wss://custom.example:443/mqtt';
const profile=useDB=>({configStorage:{prefix,useDB},config:{mqttUrl:'wss://startup-custom.example/mqtt'}});
const original=()=>({extensions:['Existing'],extension_Existing_enable:false,connect_nickname:'Existing player',nnk_transferLimitMB:300,[KEY]:'wss://old.example/mqtt'});
function local(){const records=new Map([[configKey,JSON.stringify(original())]]);let reads=0,writes=0;return {records,get reads(){return reads;},get writes(){return writes;},getItem(key){reads++;return records.get(key)??null;},setItem(key,data){writes++;records.set(key,data);}};}
function database({mode='ok',hasConfig=true,keyPath=null,autoIncrement=false,wrongReadback=false,holdWrite=false,failWrite=false,failRead=false,onOpen=()=>{},onWrite=()=>{},onRead=()=>{}}={}){
 const data=new Map(Object.entries(original())),writes=[],opens=[],transactions=[];let closed=0,aborted=0,request;
 const db={objectStoreNames:{contains:name=>hasConfig&&name==='config'},close(){closed++;},transaction(names,mode){
  assert.deepEqual(names,['config']);const staged=new Map(data);let stopped=false;
  const tx={abort(){if(stopped)return;stopped=true;aborted++;queueMicrotask(()=>tx.onabort?.());},objectStore(name){assert.equal(name,'config');return {keyPath,autoIncrement,
   put(v,key){assert.equal(mode,'readwrite');writes.push({key,value:v});staged.set(key,v);const write={};if(!holdWrite)queueMicrotask(()=>{if(stopped)return;if(failWrite){tx.abort();return;}onWrite();write.onsuccess?.();if(stopped)return;data.clear();for(const row of staged)data.set(...row);stopped=true;tx.oncomplete?.();});return write;},
   get(key){assert.equal(mode,'readonly');const read={};queueMicrotask(()=>{if(stopped)return;if(failRead){tx.abort();return;}read.result=wrongReadback?'wss://wrong.example/mqtt':data.get(key);onRead();read.onsuccess?.();stopped=true;tx.oncomplete?.();});return read;}
  };}};transactions.push(mode);return tx;
 }};
 const indexedDB={open(name,...versions){opens.push({name,versions});request={result:db,transaction:{abort(){aborted++;}}};queueMicrotask(()=>{if(mode==='upgrade')request.onupgradeneeded?.();else if(mode==='error')request.onerror?.();else if(mode==='blocked')request.onblocked?.();else if(mode!=='stall'){onOpen();request.onsuccess?.();}});return request;}};
 return {indexedDB,data,writes,opens,transactions,get request(){return request;},get closed(){return closed;},get aborted(){return aborted;}};
}
const cases=[],test=(name,fn)=>cases.push([name,fn]);

test('the fixed empty-value default matches the real kernel config module',()=>{
 const nnk={env:{lib:{config:{}}},modules:{}};runInNewContext(readFileSync(new URL('../online-kernel/src/config.js',import.meta.url),'utf8'),{window:{__nnk__:nnk}});
 assert.equal(DEFAULT_SIGNALING_URL,nnk.modules.config.defaults.mqttUrl);assert.equal(normalizeSignalingUrl('   '),DEFAULT_SIGNALING_URL);
});
for(const input of ['ws://localhost:8083/mqtt','wss://custom.example/mqtt','wss://custom.example/a%23b','  '+value+'  '])test('valid address is trimmed without silent rewriting: '+input.trim(),()=>assert.equal(normalizeSignalingUrl(input),input.trim()));
for(const input of [null,undefined,123,true,{},['wss://example.com/mqtt']])test('only string input is accepted: '+String(input),async()=>{
 const storage=local();await assert.rejects(saveSignalingUrl({profile:profile(false),value:input,storage}),/字符串/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);
});
for(const input of ['https://example.com/mqtt','mqtt://example.com','wss://','wss:example.com','wss://example.com:65536/mqtt','wss://exa mple.com/mqtt','wss://example.com/\npath','wss://example.com/\tpath'])test('invalid websocket URL is rejected: '+JSON.stringify(input),async()=>{
 const storage=local();await assert.rejects(saveSignalingUrl({profile:profile(false),value:input,storage}),/有效.*ws:\/\//);assert.equal(storage.writes,0);assert.equal(storage.reads,0);
});
test('the 200-character bound is exact and longer input is never truncated',async()=>{
 const base='wss://example.com/',boundary=base+'x'.repeat(200-base.length);assert.equal(normalizeSignalingUrl(boundary),boundary);
 const storage=local();await assert.rejects(saveSignalingUrl({profile:profile(false),value:boundary+'x',storage}),/200/);assert.equal(storage.reads,0);
});
test('raw URL fragments are rejected before storage, including a trailing empty fragment',async()=>{
 const storage=local();for(const input of [value+'#fragment',value+'#'])await assert.rejects(saveSignalingUrl({profile:profile(false),value:input,storage}),/# 片段/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);
});
test('local save changes only nnk_mqttUrl and confirms the exact normalized string',async()=>{
 const storage=local(),before=original(),result=await saveSignalingUrl({profile:profile(false),value:' '+value+' ',storage,key:'extensions'});
 assert.deepEqual(result,{saved:true,value,storage:'localstorage'});assert.deepEqual(JSON.parse(storage.records.get(configKey)),{...before,[KEY]:value});assert.equal(storage.writes,1);
});
test('empty save resets to the fixed default rather than the startup custom value',async()=>{
 const storage=local(),result=await saveSignalingUrl({profile:profile(false),value:'',storage});assert.equal(result.value,DEFAULT_SIGNALING_URL);assert.equal(JSON.parse(storage.records.get(configKey))[KEY],DEFAULT_SIGNALING_URL);
});
test('malformed or missing local configuration is preserved without replacement',async()=>{
 for(const raw of [null,'{broken','[]','null']){const storage=local();raw===null?storage.records.delete(configKey):storage.records.set(configKey,raw);await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage}),/原游戏配置/);assert.equal(storage.writes,0);}
});
test('local write error and mismatched readback never return success',async()=>{
 const storage=local();storage.setItem=()=>{throw Error('fixture write denied');};await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage}),/write denied/);
 storage.setItem=()=>{};await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage}),/信令服务器地址保存读回不一致/);
});
test('retirement before a local write prevents storage changes',async()=>{
 const storage=local();await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage,isCurrent:()=>false}),/失效/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);
});
test('retirement during local readback suppresses success even after a write',async()=>{
 const storage=local(),set=storage.setItem.bind(storage);let current=true;storage.setItem=(...args)=>{set(...args);current=false;};
 await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage,isCurrent:()=>current}),/失效/);assert.equal(JSON.parse(storage.records.get(configKey))[KEY],value,'a completed local write cannot be rolled back by retiring its acknowledgement');
});
test('database persistence writes one fixed key and reads after the write transaction',async()=>{
 const db=database(),before=new Map(db.data),result=await saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB});
 assert.deepEqual(result,{saved:true,value,storage:'indexeddb'});assert.deepEqual(db.opens,[{name:prefix+'data',versions:[]}]);assert.deepEqual(db.transactions,['readwrite','readonly']);assert.deepEqual(db.writes,[{key:KEY,value}]);
 before.set(KEY,value);assert.deepEqual(db.data,before);assert.equal(db.closed,1);
});
test('opening a missing database is aborted without schema creation',async()=>{
 const db=database({mode:'upgrade'});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB}),/未找到/);assert.equal(db.aborted,1);assert.deepEqual(db.writes,[]);assert.deepEqual(db.transactions,[]);
});
for(const mode of ['blocked','error'])test('database '+mode+' never falls back to local storage',async()=>{
 const db=database({mode}),storage=local();await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,storage}),/数据库/);assert.equal(storage.reads,0);assert.equal(storage.writes,0);assert.equal(db.writes.length,0);
});
test('incompatible database stores cannot receive a write',async()=>{
 for(const options of [{hasConfig:false},{keyPath:'id'},{autoIncrement:true}]){const db=database(options);await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB}),/存储/);assert.equal(db.writes.length,0);}
});
for(const options of [{failWrite:true},{failRead:true},{wrongReadback:true}])test('database failure/readback mismatch cannot acknowledge saved: '+JSON.stringify(options),async()=>{
 const db=database(options);await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB}),/未保存|读回失败|读回不一致/);assert.equal(db.closed,1);
});
test('open timeout closes a late database without starting transactions',async()=>{
 const db=database({mode:'stall'});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,timeoutMs:5}),/信令服务器地址配置保存超时/);db.request.onsuccess();assert.equal(db.closed,1);assert.deepEqual(db.transactions,[]);
});
test('write timeout aborts only its owned transaction',async()=>{
 const db=database({holdWrite:true});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,timeoutMs:5}),/超时/);assert.equal(db.aborted,1);assert.equal(db.data.get(KEY),original()[KEY]);assert.equal(db.closed,1);
});
test('retirement before database open prevents a transaction',async()=>{
 let current=true;const db=database({onOpen:()=>{current=false;}});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,isCurrent:()=>current}),/失效/);assert.equal(db.writes.length,0);assert.equal(db.closed,1);
});
test('retirement during put success aborts the uncommitted write',async()=>{
 let current=true;const db=database({onWrite:()=>{current=false;}});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,isCurrent:()=>current}),/失效/);assert.equal(db.aborted,1);assert.equal(db.data.get(KEY),original()[KEY]);assert.equal(db.closed,1);
});
test('retirement after commit rejects the acknowledgement without claiming rollback',async()=>{
 let current=true;const db=database({onRead:()=>{current=false;}});await assert.rejects(saveSignalingUrl({profile:profile(true),value,indexedDB:db.indexedDB,isCurrent:()=>current}),/失效/);assert.equal(db.data.get(KEY),value);assert.equal(db.closed,1);
});
test('invalid metadata and callback arguments are rejected before storage access',async()=>{
 const storage=local();for(const configStorage of [null,{prefix:'',useDB:false},{prefix:'bad\u0000',useDB:false},{prefix:'x'.repeat(161),useDB:false},{prefix,useDB:'false'}])await assert.rejects(saveSignalingUrl({profile:{configStorage},value,storage}),/存储信息/);
 for(const options of [{timeoutMs:0},{timeoutMs:60001},{isCurrent:null}])await assert.rejects(saveSignalingUrl({profile:profile(false),value,storage,...options}),/保存参数/);assert.equal(storage.reads,0);
});
test('the shared primitive rejects arbitrary keys and wrong value types',async()=>{
 const storage=local();for(const [key,v]of [['extensions',[]],['__proto__',{}],['nnk_mqttUrl',123],['nnk_transferLimitMB','1024']])await assert.rejects(saveConfigValue({profile:profile(false),key,value:v,storage}));assert.equal(storage.reads,0);assert.equal(storage.writes,0);
});

let passed=0;for(const [name,fn]of cases){await fn();passed++;console.log('  ✓ '+name);}console.log('全部通过:'+passed+' 项; 失败:0');

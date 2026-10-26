// Execute the actual HTTP settings block with isolated storage and a command queue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeSignalingUrl,DEFAULT_SIGNALING_URL} from '../online-kernel/keepalive/signaling-config.js';
import {createEngineOperationPort} from '../online-kernel/keepalive/engine-operation-port.js';

const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const start=source.indexOf("          if (body.action === 'set_config' && body.args?.key === 'mqttUrl') {");
const end=source.indexOf("          if (body.action === 'set_identity')",start);
assert.ok(start>=0&&end>start);
const handler=new Function('body','normalizeSignalingUrl','readSettingsFile','writeJsonAtomicSync','settingsPath','json','enqueue',"let savedSignaling=null;"+source.slice(start,end)+"enqueue(body);return {savedSignaling};");
function request(value,options={}){
 const {failWrite=false,wrongReadback=false}=options,id=Object.hasOwn(options,'id')?options.id:'ui-save-1';
 let settings={other:{kept:true},onlineSignaling:{mqttUrl:'wss://old.example/mqtt'}},writes=0;const commands=[];
 const response=handler({action:'set_config',args:{key:'mqttUrl',value,...(id===undefined?{}:{requestId:id})}},normalizeSignalingUrl,()=>structuredClone(wrongReadback&&writes?{...settings,onlineSignaling:null}:settings),(_path,next)=>{writes++;if(failWrite)throw Error('isolated write failure');settings=structuredClone(next);},'isolated-settings.json',(status,body)=>({status,body}),body=>commands.push(body));
 return {response,settings,writes,commands};
}
let count=0;function test(name,fn){fn();count++;console.log('  ✓ '+name);}
test('API preserves the UI request identifier and normalizes before queueing',()=>{
 const f=request('  wss://test.example/mqtt  ');assert.equal(f.response.savedSignaling.mqttUrl,'wss://test.example/mqtt');assert.equal(f.commands.length,1);assert.deepEqual(f.commands[0].args,{key:'mqttUrl',value:'wss://test.example/mqtt',requestId:'ui-save-1'});assert.deepEqual(f.settings.other,{kept:true});assert.equal(f.writes,1);
});
test('restore-default persists an explicit default for later offline synchronization',()=>{
 const f=request('');assert.equal(f.settings.onlineSignaling.mqttUrl,DEFAULT_SIGNALING_URL);assert.equal(f.commands[0].args.value,DEFAULT_SIGNALING_URL);
});
test('legacy callers may omit a request identifier',()=>{
 const f=request('ws://test.example/mqtt',{id:undefined});assert.equal(f.commands.length,1);
});
test('bad URLs and oversized addresses cannot enter storage or the queue',()=>{
 for(const value of ['https://test.example','wss://','wss://test.example/'+ 'x'.repeat(201),null,{},42]){const f=request(value);assert.equal(f.response.status,400);assert.equal(f.writes,0);assert.equal(f.commands.length,0);}
});
test('invalid correlation identifiers are rejected before writing',()=>{
 for(const id of ['',42,'x'.repeat(161),'bad\nvalue']){const f=request('wss://test.example/mqtt',{id});assert.equal(f.response.status,400);assert.equal(f.writes,0);assert.equal(f.commands.length,0);}
});
test('write failure and mismatched readback return errors without queueing a false save',()=>{
 for(const options of [{failWrite:true},{wrongReadback:true}]){const f=request('wss://test.example/mqtt',options);assert.equal(f.response.status,500);assert.equal(f.commands.length,0);assert.match(f.response.body.error,/DSH/);}
});

const bridgeSource=fs.readFileSync(new URL('../online-kernel/src/bridge.js',import.meta.url),'utf8');
const a=bridgeSource.indexOf('\tasync function dispatchSafe(cmd) {'),z=bridgeSource.indexOf('\n\tasync function poll()',a);
assert.ok(a>=0&&z>a);
const errors=[];const safe=runInNewContext('('+bridgeSource.slice(a,z).trim()+')',{dispatch:async()=>{throw Error('isolated config failure');},emit:(type,data)=>errors.push({type,data}),console:{error(){}}});
await safe({action:'set_config',args:{key:'mqttUrl',requestId:'ui-save-2'}});
assert.equal(errors.length,1);assert.equal(errors[0].data.cmd,'set_config');assert.equal(errors[0].data.key,'mqttUrl');assert.equal(errors[0].data.requestId,'ui-save-2');count++;console.log('  ✓ bridge execution failures retain the current MQTT save identifier');

for(const useDB of [true,false]){
 const records=new Map([['nnk_mqttUrl','wss://previous.example/mqtt']]),events=[],config={nnk_mqttUrl:'wss://previous.example/mqtt'},localKey='signaling_engine_config';
 const storageRecords=new Map([[localKey,JSON.stringify({...config,theme:'preserved'})]]),original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storageRecords.get(key)??null,setItem:(key,value)=>storageRecords.set(key,value)}});
 let alive=true;
 const nnk={env:{lib:{config,configprefix:'signaling_engine_',db:useDB?{}:null},get:{connectNickname:()=> 'Guest'},game:{saveConfig(key,value,_local,callback){assert.equal(useDB,true);config[key]=value;queueMicrotask(()=>{records.set(key,value);callback();});},getDB(_store,key,callback){queueMicrotask(()=>callback(records.get(key)));}}},modules:{config:{defaults:{mqttUrl:'wss://previous.example/mqtt'},get:key=>config['nnk_'+key]}}};
 const port=createEngineOperationPort(nnk,{isCurrent:()=>alive,onEvent:(name,data)=>events.push({name,data})});
 try{
  const result=await port.execute('set_config',{key:'mqttUrl',value:'',requestId:'engine-default-'+useDB});
  assert.equal(result.profile.config.mqttUrl,DEFAULT_SIGNALING_URL);assert.equal(config.nnk_mqttUrl,DEFAULT_SIGNALING_URL);
  assert.equal(events[0].name,'config_applied');assert.equal(events[0].data.requestId,'engine-default-'+useDB);
  if(useDB)assert.equal(records.get('nnk_mqttUrl'),DEFAULT_SIGNALING_URL);else{const saved=JSON.parse(storageRecords.get(localKey));assert.equal(saved.nnk_mqttUrl,DEFAULT_SIGNALING_URL);assert.equal(saved.theme,'preserved');}
  const emitted=events.length;await assert.rejects(port.execute('set_config',{key:'mqttUrl',value:'wss://broken.example/#',requestId:'bad-url'}));assert.equal(events.length,emitted);
  alive=false;await assert.rejects(port.execute('set_config',{key:'mqttUrl',value:'wss://new.example/mqtt',requestId:'retired'}));assert.equal(events.length,emitted);
  count++;console.log('  ✓ ordinary/engine port '+(useDB?'database':'local-storage')+' path verifies default restoration, request matching and retirement');
 }finally{port.dispose();if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
}
console.log('\n全部通过: '+count+' 项\n失败: 0 项');

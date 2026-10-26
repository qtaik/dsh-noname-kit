import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import testPaths from './fixtures/test-paths.cjs';
import {FREE_CHOICE_MODES,FREE_CHOICE_CONFIG_KEY,FREE_CHOICE_ROOM_KEY,installFreeCharacterOptions} from '../online-kernel/keepalive/free-character-options.js';

const tests=[];
function test(name,run){try{run();tests.push({name,ok:true});console.log('ok '+name);}catch(error){tests.push({name,ok:false,error:String(error)});console.error('FAIL '+name+'\n'+error.stack);}}
function fixture({role='engine',engineRole='host',settings={},modes}={}){
  let live=true,writes=0;
  const lib={mode:modes||Object.fromEntries(FREE_CHOICE_MODES.map(mode=>[mode,{connect:{connect_player_number:{init:'8',connect:true},update(){}}}])),
    config:{mode_config:settings},configOL:{mode:'identity'}};
  const nnk={env:{lib,game:{saveConfig(){writes++;}}}};
  const lease={info:{role,engineRole},isCurrent:()=>live};
  return {nnk,lease,lib,retire:()=>{live=false;},writes:()=>writes};
}
function digest(lib,mode){
  const settings=lib.config.mode_config?.[mode]||{},options={};
  for(const key of Object.keys(settings).sort())if(key.startsWith('connect_'))options[key]=settings[key];
  return createHash('sha256').update(JSON.stringify({mode,options,extensions:[]})).digest('hex');
}
function descriptorValue(value){return value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptors(value):value;}
function descriptors(f){return {mode:Object.getOwnPropertyDescriptors(f.lib.mode),config:Object.getOwnPropertyDescriptors(f.lib.config),
  schemas:FREE_CHOICE_MODES.map(mode=>descriptorValue(f.lib.mode[mode].connect)),
  settings:descriptorValue(f.lib.config.mode_config),settingsValues:Object.fromEntries(Object.entries(f.lib.config.mode_config||{}).map(([mode,value])=>[mode,descriptorValue(value)]))};}

test('Public keys name a native connect option and its room value',()=>{
  assert.deepEqual(FREE_CHOICE_MODES,['identity','guozhan','versus','doudizhu','single']);
  assert.equal(Object.isFrozen(FREE_CHOICE_MODES),true);assert.equal(FREE_CHOICE_CONFIG_KEY,'connect_nnk_free_choose');assert.equal(FREE_CHOICE_ROOM_KEY,'nnk_free_choose');
});
for(const [role,engineRole] of [['ordinary','host'],['engine','guest'],['carrier','host'],['ordinary','guest']])test(role+'/'+engineRole+' never reads or mutates native configuration',()=>{
  const lease={info:{role,engineRole},isCurrent:()=>true};const nnk={get env(){throw Error('Ordinary and guest native state must not be inspected');}};
  const api=installFreeCharacterOptions(nnk,lease);assert.equal(api.installed,false);assert.equal(api.enabled(),false);assert.equal(api.dispose(),false);
});
test('Retired and failing leases cannot install options',()=>{
  const f=fixture(),before=descriptors(f);f.retire();assert.equal(installFreeCharacterOptions(f.nnk,f.lease).installed,false);assert.deepEqual(descriptors(f),before);
  f.lease.isCurrent=()=>{throw Error('retired native scope');};assert.equal(installFreeCharacterOptions(f.nnk,f.lease).installed,false);
});
test('Every supported host mode receives the same disabled native option',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease);
  assert.equal(api.installed,true);assert.equal(api.enabled(),false);
  for(const mode of FREE_CHOICE_MODES){const option=f.lib.mode[mode].connect[FREE_CHOICE_CONFIG_KEY];assert.equal(option.name,'自由选将');assert.equal(option.init,false);assert.equal(option.connect,true);assert.match(option.intro,/允许不同玩家选择同一武将/);for(const rule of ['人数','阵营','双将','征召','禁选','替补'])assert.ok(option.intro.includes(rule));assert.equal(f.lib.config.mode_config[mode][FREE_CHOICE_CONFIG_KEY],false);}
  assert.equal(f.writes(),0);assert.equal(Object.hasOwn(f.lib.config,'free_choose'),false);assert.equal(Object.hasOwn(f.lib.config,FREE_CHOICE_ROOM_KEY),false);api.dispose();
});
test('Enabled reads only the current owned host and exact true room setting',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease);
  for(const mode of FREE_CHOICE_MODES){f.lib.configOL.mode=mode;f.lib.configOL[FREE_CHOICE_ROOM_KEY]=true;assert.equal(api.enabled(),true);}
  for(const value of [false,undefined,null,0,1,'true']){f.lib.configOL[FREE_CHOICE_ROOM_KEY]=value;assert.equal(api.enabled(),false);}
  f.lib.configOL[FREE_CHOICE_ROOM_KEY]=true;f.lib.config.free_choose=false;assert.equal(api.enabled(),true);
  f.lib.configOL.mode='boss';assert.equal(api.enabled(),false);f.lib.configOL.mode='identity';f.retire();assert.equal(api.enabled(),false);api.dispose();
});
test('Replacing the captured environment disables the previous installation',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease);f.lib.configOL[FREE_CHOICE_ROOM_KEY]=true;assert.equal(api.enabled(),true);
  f.nnk.env={lib:f.lib};assert.equal(api.enabled(),false);api.dispose();
});
test('Missing, false and true native mode values have stable continuation digests',()=>{
  const values=[undefined,false,true],fixtures=values.map(value=>fixture({settings:Object.fromEntries(FREE_CHOICE_MODES.map(mode=>[mode,value===undefined?{}:{[FREE_CHOICE_CONFIG_KEY]:value}]))}));
  const apis=fixtures.map(f=>installFreeCharacterOptions(f.nnk,f.lease));
  for(const mode of FREE_CHOICE_MODES){assert.equal(digest(fixtures[0].lib,mode),digest(fixtures[1].lib,mode));assert.notEqual(digest(fixtures[1].lib,mode),digest(fixtures[2].lib,mode));assert.equal(fixtures[2].lib.config.mode_config[mode][FREE_CHOICE_CONFIG_KEY],true);}
  const fresh=fixture({settings:JSON.parse(JSON.stringify(fixtures[0].lib.config.mode_config))}),freshAPI=installFreeCharacterOptions(fresh.nnk,fresh.lease);
  for(const mode of FREE_CHOICE_MODES)assert.equal(digest(fixtures[0].lib,mode),digest(fresh.lib,mode));
  apis.forEach(api=>api.dispose());freshAPI.dispose();assert.ok(fixtures.every(f=>f.writes()===0));
});
test('Duplicate installation reuses the same API and restores original descriptors once',()=>{
  const f=fixture({settings:{identity:{connect_player_number:'6',[FREE_CHOICE_CONFIG_KEY]:true}}}),original={name:'Existing option',init:true};
  Object.defineProperty(f.lib.mode.identity.connect,FREE_CHOICE_CONFIG_KEY,{value:original,writable:true,enumerable:false,configurable:true});
  const before=descriptors(f),api=installFreeCharacterOptions(f.nnk,f.lease),option=f.lib.mode.identity.connect[FREE_CHOICE_CONFIG_KEY];
  assert.equal(installFreeCharacterOptions(f.nnk,f.lease),api);assert.equal(f.lib.mode.identity.connect[FREE_CHOICE_CONFIG_KEY],option);
  assert.equal(api.dispose(),true);assert.equal(api.dispose(),false);assert.equal(api.enabled(),false);assert.deepEqual(descriptors(f),before);
});
test('Other extensions replacing an installed schema retain their replacement',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease),replacement={name:'Other extension option'};
  f.lib.mode.identity.connect[FREE_CHOICE_CONFIG_KEY]=replacement;api.dispose();assert.equal(f.lib.mode.identity.connect[FREE_CHOICE_CONFIG_KEY],replacement);
});
test('A later descriptor change is not overwritten by cleanup',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease),owner=f.lib.mode.identity.connect;
  Object.defineProperty(owner,FREE_CHOICE_CONFIG_KEY,{...Object.getOwnPropertyDescriptor(owner,FREE_CHOICE_CONFIG_KEY),enumerable:false});
  const later=Object.getOwnPropertyDescriptor(owner,FREE_CHOICE_CONFIG_KEY);api.dispose();assert.deepEqual(Object.getOwnPropertyDescriptor(owner,FREE_CHOICE_CONFIG_KEY),later);
});
test('User changes and new mode fields survive removal of temporary defaults',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease);f.lib.config.mode_config.identity[FREE_CHOICE_CONFIG_KEY]=true;f.lib.config.mode_config.guozhan.connect_other=true;
  api.dispose();assert.deepEqual(f.lib.config.mode_config,{identity:{[FREE_CHOICE_CONFIG_KEY]:true},guozhan:{connect_other:true}});
});
test('New empty configuration containers are removed without touching original containers',()=>{
  const f=fixture();delete f.lib.config.mode_config;const before=Object.getOwnPropertyDescriptors(f.lib.config),api=installFreeCharacterOptions(f.nnk,f.lease);
  assert.ok(f.lib.config.mode_config.identity);api.dispose();assert.deepEqual(Object.getOwnPropertyDescriptors(f.lib.config),before);
});
test('A replaced configuration container remains untouched during cleanup',()=>{
  const f=fixture(),api=installFreeCharacterOptions(f.nnk,f.lease),replacement={identity:{[FREE_CHOICE_CONFIG_KEY]:true}};
  f.lib.config.mode_config=replacement;api.dispose();assert.equal(f.lib.config.mode_config,replacement);assert.equal(replacement.identity[FREE_CHOICE_CONFIG_KEY],true);
});
test('Native schema getters remain usable and unchanged',()=>{
  const f=fixture(),shared={name:'Native getter option',init:false};Object.defineProperty(f.lib.mode.guozhan.connect,'connect_native_getter',{get:()=>shared,enumerable:true,configurable:true});
  const before=Object.getOwnPropertyDescriptor(f.lib.mode.guozhan.connect,'connect_native_getter'),api=installFreeCharacterOptions(f.nnk,f.lease);
  assert.equal(f.lib.mode.guozhan.connect.connect_native_getter,shared);api.dispose();assert.deepEqual(Object.getOwnPropertyDescriptor(f.lib.mode.guozhan.connect,'connect_native_getter'),before);
});
test('Unavailable or incompatible native modes fail before changing another mode',()=>{
  for(const value of [null,false,[],{unexpected:true}]){const f=fixture();f.lib.mode.single.connect=value;const before=descriptors(f);assert.throws(()=>installFreeCharacterOptions(f.nnk,f.lease),/Native connect schema|Unsupported native connect option/);assert.deepEqual(descriptors(f),before);}
});
test('A write failure rolls back previously installed schemas and memory defaults',()=>{
  const f=fixture({settings:{single:Object.preventExtensions({})}}),before=descriptors(f);
  assert.throws(()=>installFreeCharacterOptions(f.nnk,f.lease));assert.deepEqual(descriptors(f),before);assert.equal(f.writes(),0);
});
test('Retirement during installation rolls back the entire installation',()=>{
  const f=fixture(),before=descriptors(f);let checks=0;f.lease.isCurrent=()=>++checks<3;
  assert.throws(()=>installFreeCharacterOptions(f.nnk,f.lease),/retired during/);assert.deepEqual(descriptors(f),before);
});
test('An owned configuration accessor is rejected without invoking it',()=>{
  const f=fixture(),before=descriptors(f);let reads=0;
  Object.defineProperty(f.lib.config.mode_config,'identity',{get(){reads++;return {};},configurable:true,enumerable:true});
  assert.throws(()=>installFreeCharacterOptions(f.nnk,f.lease),/accessor/);assert.equal(reads,0);
  for(let i=0;i<FREE_CHOICE_MODES.length;i++)assert.deepEqual(Object.getOwnPropertyDescriptors(f.lib.mode[FREE_CHOICE_MODES[i]].connect),before.schemas[i]);
});
test('Disposed and retired installations can be installed anew',()=>{
  const f=fixture(),first=installFreeCharacterOptions(f.nnk,f.lease);first.dispose();const second=installFreeCharacterOptions(f.nnk,f.lease);assert.notEqual(first,second);second.dispose();
  const third=installFreeCharacterOptions(f.nnk,f.lease);f.retire();const lease={info:{role:'engine',engineRole:'host'},isCurrent:()=>true};
  const fourth=installFreeCharacterOptions(f.nnk,lease);assert.notEqual(third,fourth);assert.equal(third.enabled(),false);fourth.dispose();
});
test('Official 1.11.6 native mode schemas accept the option including getter-backed modes',()=>{
  const base=testPaths.officialRoot('Latest'),manifest=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));assert.equal(manifest.version,'1.11.6');
  const source=fs.readFileSync(path.join(base,'noname/library/index.js'),'utf8'),require=createRequire(import.meta.url),{parse}=require('acorn');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});let mode;
  function walk(node){if(!node||typeof node!=='object')return;if(node.type==='PropertyDefinition'&&node.key?.name==='mode')mode=node.value;for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  walk(ast);assert.equal(mode?.type,'ObjectExpression');const context=vm.createContext({}),modes=vm.runInContext('('+source.slice(mode.start,mode.end)+')',context,{timeout:1000});context.lib={mode:modes};
  const f=fixture({modes}),api=installFreeCharacterOptions(f.nnk,f.lease);
  for(const name of FREE_CHOICE_MODES){const options=modes[name].connect;assert.equal(options[FREE_CHOICE_CONFIG_KEY].init,false);assert.ok(Object.entries(options).every(([key,value])=>key==='update'?typeof value==='function':key.startsWith('connect_')&&value&&typeof value==='object'));}
  api.dispose();assert.ok(FREE_CHOICE_MODES.every(name=>!Object.hasOwn(modes[name].connect,FREE_CHOICE_CONFIG_KEY)));
});

const passed=tests.filter(test=>test.ok).length;console.log('全部通过: '+passed+' 项');
if(passed!==tests.length)process.exitCode=1;

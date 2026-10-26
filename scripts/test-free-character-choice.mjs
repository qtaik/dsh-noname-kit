import assert from 'node:assert/strict';
import {installFreeCharacterChoice,legalCharacterPool,characterGroups} from '../online-kernel/keepalive/free-character-choice.js';
import {identityAdapter} from '../online-kernel/keepalive/free-character-identity.js';
import {guozhanAdapter} from '../online-kernel/keepalive/free-character-guozhan.js';
import {FREE_CHOICE_MODES} from '../online-kernel/keepalive/free-character-options.js';

const results=[];
function test(name,run){try{run();results.push({name,ok:true});console.log('ok '+name);}catch(error){results.push({name,ok:false,error:String(error)});console.error('FAIL '+name+'\n'+error.stack);}}
// The fixture process supplies deterministic versions of the native collection
// helpers. Production adapters never patch these prototypes or random helpers.
const arrayDescriptors=new Map();
for(const [key,value] of Object.entries({randomGets(count){return this.slice(0,count);},randomGet(){return this[0];},randomSort(){return this;}})){
  arrayDescriptors.set(key,Object.getOwnPropertyDescriptor(Array.prototype,key));
  Object.defineProperty(Array.prototype,key,{value,configurable:true,writable:true});
}

function fixture({mode='identity',submode='normal',on=true,role='host',double=false}={}){
  let live=true,invalidated=null,pauses=0;
  const registry=new Map(),announcements=new Map(),broadcasts=[],players=[{playerid:'p1',identity:'zhu'},{playerid:'p2',identity:'fan'}];
  const character=(group,extra={})=>Object.assign(['male',group,4,[]],extra);
  const characters={a:character('wei'),a2:character('wei'),b:character('wei'),c:character('shu'),d:character('shu'),banned:character('wei'),disabled:character('wei'),outside:character('qun'),gz_a:character('wei'),gz_b:character('wei'),gz_c:character('shu'),gz_d:character('shu'),gz_jun:character('wei',{jun:true}),gz_shibing1:character('wei'),gz_banned:character('wei')};
  const lib={mode:Object.fromEntries(FREE_CHOICE_MODES.map(name=>[name,{connect:{connect_number:{init:'8',connect:true}}}])),
    config:{mode_config:{},guozhan_banned:['gz_banned']},configOL:{mode,[mode+'_mode']:submode,nnk_free_choose:on,characterPack:['test'],banned:['banned'],double_character:double},
    character:characters,characterPack:{test:Object.fromEntries(['a','a2','b','c','d','banned','disabled'].map(id=>[id,characters[id]])),mode_guozhan:Object.fromEntries(Object.keys(characters).filter(id=>id.startsWith('gz_')).map(id=>[id,characters[id]]))},
    characterReplace:{family:['a','a2','outside','banned']},connectBanned:[],selectGroup:['shen'],filter:{characterDisabled(id){return id==='disabled';}},
    announce:{subscribe(name,fn){announcements.set(fn,name);return fn;},unsubscribe(name,fn){if(announcements.get(fn)===name)announcements.delete(fn);}}};
  const status={connectMode:true,mode:submode,event:null};
  const game={players,me:players[0],online:false,pause(){pauses++;status.paused=true;},broadcastAll(...args){broadcasts.push(args);return 'broadcast-result';},globalEventHandlers:{
    pushHandler(name,type,...rest){const handlers=typeof type==='string'?rest:[type,...rest];const list=registry.get(name)||[];list.push(...handlers);registry.set(name,list);},
    removeHandler(name,type,fn){const list=registry.get(name)||[],index=list.indexOf(fn);if(index>=0)list.splice(index,1);},
  }};
  const nativeCalls=[],aiCalls=[];
  game.getCharacterChoice=function(list,count){
    nativeCalls.push({receiver:this,list:list.slice(),count});
    const pair=list.find(id=>list.some(other=>other!==id&&lib.character[other][1]===lib.character[id][1]));
    if(count===2)return pair?[pair,list.find(id=>id!==pair&&lib.character[id][1]===lib.character[pair][1])]:[];
    return list.splice(0,count);
  };
  const env={lib,game,_status:status,ui:{},get:{is:{double:id=>!!characters[id]?.double,jun:id=>!!characters[id]?.jun}}};
  const nativeAI=function(){const ids=status.event.dialog.buttons.map(button=>button.link);aiCalls.push({event:status.event,ids});const first=ids.find(id=>ids.some(other=>other!==id&&lib.character[id][1]===lib.character[other][1]));return first?{bool:true,links:[first,ids.find(id=>id!==first&&lib.character[id][1]===lib.character[first][1])]}:undefined;};
  const nnk={env},lease={info:{role:'engine',engineRole:role},isCurrent:()=>live,native:{onInvalidated(fn){invalidated=fn;return ()=>{invalidated=null;};}}};
  function event(name,parent=null,fields={}){
    const handlers=[...(registry.get(name)||[])];
    return Object.assign({name,parent,finished:false,...(mode==='guozhan'&&name==='chooseButtonOL'?{processAI:nativeAI}:{}),getHandler(){return handlers;},pushHandler(...args){handlers.push(...(typeof args[0]==='string'?args.slice(1):args));},set(key,value){this[key]=value;(this._set??=[]).push([key,value]);return this;},fire(state){status.event=this;for(const handler of handlers.slice())handler(this,{state});}},fields);
  }
  const adapters=[identityAdapter,guozhanAdapter];
  function install(custom=adapters){return installFreeCharacterChoice(nnk,lease,custom);}
  function root(){const value=event('chooseCharacter',event('game'));value.fire('begin');return value;}
  function finish(root){root.finished=true;status.event=root.parent;for(const [fn,name] of announcements)if(name==='Noname.Game.Event.Changed')fn([root.parent,root]);}
  return {nnk,lease,env,lib,game,status,players,registry,announcements,broadcasts,nativeCalls,aiCalls,install,event,root,finish,pauses:()=>pauses,retire(){live=false;},invalidate(detail={scope:{}}){invalidated?.(detail);},invalidationListeners:()=>Number(invalidated!==null)};
}

try{
  test('ordinary, guest and retired leases leave native hooks untouched',()=>{
    for(const role of ['ordinary','guest']){const f=fixture({role}),before=f.game.broadcastAll;if(role==='ordinary')f.lease.info.role='ordinary';const api=f.install();assert.equal(api.installed,false);assert.equal(f.game.broadcastAll,before);assert.equal(f.registry.size,0);}
    const f=fixture();f.retire();assert.equal(f.install().installed,false);
  });
  test('off is a true no-op for selection content, callbacks and payloads',()=>{
    const f=fixture({on:false}),api=f.install(),root=f.root(),callback=()=>{},ids=['b'],child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[ids,'character']],1,true]],callback});
    child.fire('begin');assert.deepEqual(ids,['b']);assert.equal(child.callback,callback);assert.equal(api.resourceSnapshot().contexts,0);api.dispose();
  });
  test('ordinary singleplayer and remote guest events remain unchanged even with room setting',()=>{
    for(const connect of [false,true]){const f=fixture(),api=f.install();f.status.connectMode=connect;f.game.online=connect;const root=f.root(),ids=['b'],child=f.event('chooseButton',root,{createDialog:['choose',[ids,'character']]});child.fire('begin');assert.deepEqual(ids,['b']);assert.equal(api.resourceSnapshot().contexts,0);api.dispose();}
  });
  test('legal pool applies enabled packs, room and connect bans, native filters and alias families',()=>{
    const f=fixture();f.lib.connectBanned=['d'];const before=JSON.stringify(f.lib.characterReplace);
    assert.deepEqual(legalCharacterPool(f.env),['a','a2','b','c']);assert.deepEqual(legalCharacterPool(f.env,undefined,{canonical:true}),['family','b','c']);
    assert.deepEqual(legalCharacterPool(f.env,['family']),['a','a2']);assert.deepEqual(legalCharacterPool(f.env,['outside']),[]);assert.equal(JSON.stringify(f.lib.characterReplace),before);
  });
  test('explicit native mode lists still obey bans and filters without requiring room packs',()=>{
    const f=fixture();delete f.lib.configOL.characterPack;
    assert.deepEqual(legalCharacterPool(f.env,['outside','banned','disabled','missing'],{nativePool:true}),['outside']);
    assert.throws(()=>legalCharacterPool(f.env),/unavailable/);assert.throws(()=>legalCharacterPool(f.env,undefined,{nativePool:true}),/explicitly/);
  });
  test('dialog parser recognizes positional/object offers and excludes vcard/results/rosters',()=>{
    const ids=['a','b'];assert.equal(characterGroups(['title',[ids,'character']])[0].ids,ids);
    assert.equal(characterGroups([{}, {createDialog:['title',[ids,'characterx']]}])[0].ids,ids);
    assert.deepEqual(characterGroups({p1:ids,result:{links:ids},roster:ids}),[]);assert.deepEqual(characterGroups(['group',[[['','','group_wei']],'vcard']]),[]);
  });
  test('identity leader and parallel nonleader offers use the full same legal pool',()=>{
    const f=fixture({double:true}),api=f.install(),root=f.root(),leader=['b'],leaderEvent=f.event('chooseButton',root,{createDialog:['choose',[leader,'characterx']],selectButton:2});
    leaderEvent.fire('begin');assert.deepEqual(leader,['family','b','c','d']);assert.equal(leaderEvent.selectButton,2);
    root.list2=['b','c'];const first=['b'],second=['c'],callback=()=>{},filter=()=>true,ai=()=>1;
    const child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[first,'characterx']],2,true],[f.players[1],{createDialog:['choose',[second,'characterx']],selectButton:2,filterButton:filter}]],callback,processAI:ai});
    child.fire('begin');assert.deepEqual(first,leader);assert.deepEqual(second,leader);assert.notEqual(first,second);assert.equal(child.callback,callback);assert.equal(child.processAI,ai);assert.equal(child.list[1][1].filterButton,filter);assert.equal(child.list[1][1].selectButton,2);
    api.dispose();
  });
  test('identity faction dialogs and non-root character dialogs are not broadened',()=>{
    const f=fixture(),api=f.install(),root=f.root(),groups=[['','','group_wei']],group=f.event('chooseButton',root,{createDialog:['faction',[groups,'vcard']]});group.fire('begin');assert.deepEqual(groups,[['','','group_wei']]);
    const other=f.event('skill',root),ids=['b'],child=f.event('chooseButton',other,{createDialog:['unrelated',[ids,'character']]});child.fire('begin');assert.deepEqual(ids,['b']);api.dispose();
  });
  test('identity timeout fallback resolves native aliases and permits cross-player same characters',()=>{
    const f=fixture({double:true}),api=f.install(),root=f.root(),child=f.event('chooseButtonOL',root,{list:f.players.map(player=>[player,['choose',[['b'],'characterx']],2,true])});
    child.fire('begin');child.result={p1:'ai',p2:{}};child.fire('end');assert.deepEqual(child.result.p1,{bool:true,links:['a','b']});assert.deepEqual(child.result.p2,child.result.p1);assert.notEqual(child.result.p1.links[0],child.result.p1.links[1]);api.dispose();
  });
  test('identity normal results retain reference identity; retired fallback callbacks do nothing',()=>{
    const f=fixture(),api=f.install(),root=f.root(),child=f.event('chooseButtonOL',root,{list:f.players.map(player=>[player,['choose',[['b'],'characterx']],1,true])});
    child.fire('begin');const actual={bool:true,links:['c']};child.result={p1:actual,p2:'ai'};f.retire();child.fire('end');assert.equal(child.result.p1,actual);assert.equal(child.result.p2,'ai');api.dispose();
  });
  test('purple identity preserves chosen faction and excluded special characters for every role',()=>{
    const f=fixture({submode:'purple'});f.lib.character.lingju_test=['female','wei'];f.lib.character.dual=['male','wei'];f.lib.character.dual.double=true;f.lib.character.god=['male','shen'];Object.assign(f.lib.characterPack.test,{lingju_test:f.lib.character.lingju_test,dual:f.lib.character.dual,god:f.lib.character.god});
    const api=f.install(),root=f.root();Object.assign(root,{rZhu:'wei',bZhu:'shu',map:{wei:['a','a2','b'],shu:['c','d']}});f.players[0].identity='rZhu';f.players[1].identity='bZhong';
    const left=['a'],right=['c'],child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[left,'character']],true],[f.players[1],['choose',[right,'character']],true]]});child.fire('begin');assert.deepEqual(left,['a','a2','b']);assert.deepEqual(right,['c','d']);api.dispose();
  });
  test('purple shared map arrays remain the same objects used by native fallback',()=>{
    const f=fixture({submode:'purple'}),api=f.install(),root=f.root(),ids=['b'];f.players[0].identity='rZhu';Object.assign(root,{rZhu:'wei',map:{wei:['a','a2','b'],p1:ids}});
    const child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[ids,'character']],true]]});child.fire('begin');assert.equal(root.map.p1,ids);assert.deepEqual(root.map.p1,['a','a2','b']);child.result={p1:'ai'};child.fire('end');assert.deepEqual(child.result.p1.links,['a']);api.dispose();
  });
  test('stratagem and revealed-loyalist branches widen the offer without changing select count',()=>{
    for(const submode of ['stratagem','zhong']){const f=fixture({submode}),api=f.install(),root=f.root(),ids=['b'],child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[ids,'characterx']],1,true]]});child.fire('begin');assert.deepEqual(ids,['family','b','c','d']);assert.equal(child.list[0][2],1);api.dispose();}
  });
  test('guozhan uses its native mode pack with jun, soldier and room bans excluded',()=>{
    const f=fixture({mode:'guozhan'});f.lib.configOL.banned.push('gz_d');const original=f.game.getCharacterChoice,api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),offered=f.game.getCharacterChoice(source,7);
    assert.deepEqual(offered,['gz_a','gz_b','gz_c']);assert.deepEqual(source,offered);assert.equal(f.nativeCalls[0].count,3);assert.equal(f.nativeCalls[0].receiver,f.game);f.finish(root);assert.equal(f.game.getCharacterChoice,original);api.dispose();
  });
  test('guozhan parallel rows preserve original double filter, processAI and callback',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),filter=()=>true,callback=()=>{},ai=()=>({});
    const rows=f.players.map(player=>[player,['choose',[f.game.getCharacterChoice(source,7),'character']],2,true,()=>1,filter]);const child=f.event('chooseButtonOL',root,{list:rows,callback,processAI:ai});child.fire('begin');
    assert.deepEqual(rows[0][1][1][0],['gz_a','gz_b','gz_c','gz_d']);assert.deepEqual(rows[1][1][1][0],rows[0][1][1][0]);assert.equal(child.callback,callback);assert.equal(child.processAI,ai);assert.equal(rows[0][5],filter);assert.equal(rows[0][2],2);api.dispose();
  });
  test('guozhan timeout fallback calls the retained original AI and allows cross-player duplicate pairs',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),rows=f.players.map(player=>[player,['choose',[f.game.getCharacterChoice(source,7),'character']],2,true]);
    const child=f.event('chooseButtonOL',root,{list:rows});child.fire('begin');source.splice(0);child.result={p1:'ai',p2:{}};child.fire('end');assert.deepEqual(child.result.p1,{bool:true,links:['gz_a','gz_b']});assert.deepEqual(child.result.p2,child.result.p1);assert.equal(f.aiCalls.length,2);assert.ok(f.aiCalls.every(call=>call.event===child&&call.ids.length===4));assert.equal(Object.hasOwn(child,'dialog'),false);api.dispose();
  });
  test('guozhan fallback preserves the native AI main/deputy order and restores dialog descriptors',()=>{
    const f=fixture({mode:'guozhan'});f.lib.character.gz_ye=['male','ye'];f.lib.character.gz_double=Object.assign(['male','wei'],{double:true});Object.assign(f.lib.characterPack.mode_guozhan,{gz_ye:f.lib.character.gz_ye,gz_double:f.lib.character.gz_double});
    const api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),ids=f.game.getCharacterChoice(source,7),oldDialog={private:'preserved'},nativeResult={bool:true,links:['gz_ye','gz_double']};let calls=0;
    const ai=function(){calls++;assert.equal(f.status.event,child);assert.ok(child.dialog.buttons.some(button=>button.link==='gz_double'));return nativeResult;};
    const child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[ids,'character']],2,true]],processAI:ai});Object.defineProperty(child,'dialog',{value:oldDialog,writable:false,enumerable:true,configurable:true});const descriptor=Object.getOwnPropertyDescriptor(child,'dialog');child.fire('begin');child.result={p1:'ai'};child.fire('end');assert.equal(child.result.p1,nativeResult);assert.deepEqual(child.result.p1.links,['gz_ye','gz_double']);assert.equal(calls,1);assert.equal(child.processAI,ai);assert.deepEqual(Object.getOwnPropertyDescriptor(child,'dialog'),descriptor);api.dispose();
  });
  test('guozhan successful results and subsequent faction choices are unchanged',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),rows=f.players.map(player=>[player,['choose',[f.game.getCharacterChoice(source,7),'character']],2,true]),child=f.event('chooseButtonOL',root,{list:rows});child.fire('begin');const result={bool:true,links:['gz_c','gz_d']};child.result={p1:result,p2:result};child.fire('end');assert.equal(child.result.p1,result);assert.equal(child.result.p2,result);
    const groups=[['','','group_wei']],next=f.event('chooseButtonOL',root,{list:[[f.players[0],['faction',[groups,'vcard']],1,true]]});next.fire('begin');assert.deepEqual(groups,[['','','group_wei']]);api.dispose();
  });
  test('unknown guozhan preparation fails explicitly rather than silently claiming coverage',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[['gz_a'],'character']],2,true]]});assert.throws(()=>child.fire('begin'),/not observed/);assert.ok(api.diagnostics.some(item=>item.code==='adapter-error'));api.dispose();
  });
  test('registered preview adapter runs before exactly one original broadcast and retains its closure',()=>{
    const f=fixture(),closedOver={hits:0};const adapter={id:'fixture',matchesRoot:()=>true,begin(ctx){ctx.data.once=false;},beforeBroadcast(ctx,args){if(ctx.data.once||!Array.isArray(args[1]))return;ctx.data.once=true;ctx.replaceCandidates(args[1],['a','b']);}};
    const original=f.game.broadcastAll,api=f.install([adapter]);f.root();const ids=['a'],callback=()=>closedOver.hits++;assert.equal(f.game.broadcastAll(callback,ids),'broadcast-result');assert.equal(f.broadcasts.length,1);assert.equal(f.broadcasts[0][0],callback);assert.deepEqual(ids,['a','b']);f.broadcasts[0][0]();assert.equal(closedOver.hits,1);api.dispose();assert.equal(f.game.broadcastAll,original);
  });
  test('finished roots restore scoped functions and remove owned child handlers',()=>{
    const f=fixture({mode:'guozhan'}),original=f.game.getCharacterChoice,api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),rows=f.players.map(player=>[player,['choose',[f.game.getCharacterChoice(source,7),'character']],2,true]),child=f.event('chooseButtonOL',root,{list:rows});child.fire('begin');assert.equal(child.getHandler().length,2);assert.equal(api.resourceSnapshot().contexts,1);f.finish(root);assert.equal(child.getHandler().length,1);assert.equal(f.game.getCharacterChoice,original);assert.equal(api.resourceSnapshot().contexts,0);assert.equal(api.resourceSnapshot().bindings,1);api.dispose();
  });
  test('duplicate install is idempotent and dispose clears registered resources without timers',()=>{
    const f=fixture(),api=f.install();assert.equal(f.install(),api);f.root();assert.equal(api.resourceSnapshot().timers,0);assert.equal(api.resourceSnapshot().invalidationListeners,1);assert.equal(api.dispose(),true);assert.equal(api.dispose(),false);assert.deepEqual(api.resourceSnapshot(),{contexts:0,bindings:0,eventHandlers:0,registeredEventHandlers:0,ownedInstanceHandlers:0,nativeHandlerCopiesObservable:false,announceListeners:0,pagehideListeners:0,invalidationListeners:0,failureHandlerListeners:0,failed:false,timers:0});assert.equal(f.invalidationListeners(),0);assert.ok([...f.registry.values()].every(list=>list.length===0));
  });
  test('retired lease invalidation disposes; unrelated invalidation keeps the live manager',()=>{
    const f=fixture(),api=f.install();f.invalidate();assert.equal(api.resourceSnapshot().eventHandlers,4);f.retire();f.invalidate();assert.equal(api.resourceSnapshot().eventHandlers,0);assert.equal(f.invalidationListeners(),0);
  });
  test('exact native scope invalidation disposes before a still-current lease flips',()=>{
    const f=fixture();f.lease.info.scope={sessionId:'session',roundId:'round',documentGeneration:1,bindingId:'binding',bindingNonce:'nonce',expectedOrigin:'origin'};const api=f.install();f.invalidate({scope:{...f.lease.info.scope,documentGeneration:2}});assert.equal(api.resourceSnapshot().registeredEventHandlers,4);f.invalidate({scope:{...f.lease.info.scope}});assert.equal(api.resourceSnapshot().registeredEventHandlers,0);
  });
  test('pagehide releases only the owned listener and makes copied native handlers inert',()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'window'),listeners=new Map(),other=()=>{};listeners.set(other,'pagehide');
    Object.defineProperty(globalThis,'window',{value:{addEventListener(name,fn){listeners.set(fn,name);},removeEventListener(name,fn){if(listeners.get(fn)===name)listeners.delete(fn);}},configurable:true});
    try{const f=fixture(),api=f.install(),root=f.root(),ids=['b'],child=f.event('chooseButton',root,{createDialog:['choose',[ids,'character']]});assert.equal(api.resourceSnapshot().pagehideListeners,1);for(const [fn,name] of [...listeners])if(name==='pagehide'&&fn!==other)fn();assert.equal(api.resourceSnapshot().registeredEventHandlers,0);assert.equal(listeners.size,1);child.fire('begin');assert.deepEqual(ids,['b']);assert.equal(api.resourceSnapshot().nativeHandlerCopiesObservable,false);}finally{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;}
  });
  test('later function replacements survive cleanup',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),replacement=()=>[];f.game.getCharacterChoice=replacement;f.finish(root);assert.equal(f.game.getCharacterChoice,replacement);const broadcast=()=>{};f.game.broadcastAll=broadcast;api.dispose();assert.equal(f.game.broadcastAll,broadcast);
  });
  test('missing native event hooks fail before installing configuration changes',()=>{
    const f=fixture();delete f.game.globalEventHandlers;assert.throws(()=>f.install(),/hooks/);assert.equal(f.lib.mode.identity.connect.connect_nnk_free_choose,undefined);
  });
  test('unknown initial selection adapters produce a visible error',()=>{
    const f=fixture(),api=f.install([]);assert.throws(()=>f.root(),/no unique adapter/);assert.ok(api.diagnostics.some(item=>item.code==='unsupported-selection'));api.dispose();
  });
  test('selection failures pause and notify exactly once, then copied native handlers stay inert',()=>{
    const f=fixture(),api=f.install([]);let notices=0,received;api.setFailureHandler(error=>{notices++;received=error;});const root=f.event('chooseCharacter',f.event('game'));assert.throws(()=>root.fire('begin'),/no unique adapter/);assert.equal(f.pauses(),1);assert.equal(notices,1);assert.match(received.message,/no unique adapter/);assert.equal(api.resourceSnapshot().failed,true);assert.doesNotThrow(()=>root.fire('begin'));assert.doesNotThrow(()=>f.root());assert.equal(f.pauses(),1);assert.equal(notices,1);api.dispose();root.fire('begin');assert.equal(notices,1);assert.equal(api.resourceSnapshot().failureHandlerListeners,0);
  });
  test('a late failure listener receives the already paused failure only once',()=>{
    const f=fixture(),api=f.install([]);assert.throws(()=>f.root(),/no unique adapter/);let notices=0;const handler=()=>notices++;const off1=api.setFailureHandler(handler),off2=api.setFailureHandler(handler);assert.equal(notices,1);assert.equal(off1(),false);assert.equal(api.resourceSnapshot().failureHandlerListeners,1);assert.equal(off2(),true);assert.equal(off2(),false);assert.equal(f.pauses(),1);api.dispose();
  });
  test('normal, disabled and guest execution never pause',()=>{
    for(const options of [{},{on:false},{role:'guest'}]){const f=fixture(options),api=f.install();f.root();assert.equal(f.pauses(),0);api.dispose();assert.equal(f.pauses(),0);}
  });
  test('pause and notification failures are individually recorded without a retry storm',()=>{
    const f=fixture(),api=f.install([]);let pauseAttempts=0,notices=0;f.game.pause=()=>{pauseAttempts++;throw Error('pause fixture failure');};api.setFailureHandler(()=>{notices++;throw Error('notification fixture failure');});assert.throws(()=>f.root(),/no unique adapter/);assert.doesNotThrow(()=>f.root());assert.equal(pauseAttempts,1);assert.equal(notices,1);assert.ok(api.diagnostics.some(item=>item.code==='selection-pause-error'));assert.ok(api.diagnostics.some(item=>item.code==='failure-notification-error'));api.dispose();
  });
  test('guozhan fallback errors restore scoped AI input and enter the single failure channel',()=>{
    const f=fixture({mode:'guozhan'}),api=f.install(),root=f.root(),source=Object.keys(f.lib.characterPack.mode_guozhan),ids=f.game.getCharacterChoice(source,7);let notices=0;api.setFailureHandler(()=>notices++);const child=f.event('chooseButtonOL',root,{list:[[f.players[0],['choose',[ids,'character']],2,true]],processAI(){throw Error('native AI fixture failure');}});child.fire('begin');child.result={p1:'ai'};assert.throws(()=>child.fire('end'),/native AI fixture failure/);assert.equal(Object.hasOwn(child,'dialog'),false);assert.equal(f.pauses(),1);assert.equal(notices,1);assert.doesNotThrow(()=>child.fire('end'));assert.equal(f.pauses(),1);assert.equal(notices,1);api.dispose();
  });
}finally{
  for(const [key,descriptor] of arrayDescriptors){if(descriptor)Object.defineProperty(Array.prototype,key,descriptor);else delete Array.prototype[key];}
}
console.log(JSON.stringify({passed:results.filter(result=>result.ok).length,total:results.length,results},null,2));
if(results.some(result=>!result.ok))process.exitCode=1;

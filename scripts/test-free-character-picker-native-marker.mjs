import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import testPaths from './fixtures/test-paths.cjs';
import {markFreeCharacterPickerRow,markFreeCharacterPickerEvent,hasFreeCharacterPickerMark} from '../online-kernel/keepalive/free-character-picker-mark.js';
import {installFreeCharacterChoice} from '../online-kernel/keepalive/free-character-choice.js';
import {versusAdapter} from '../online-kernel/keepalive/free-character-versus.js';
import {FREE_CHOICE_MODES} from '../online-kernel/keepalive/free-character-options.js';

const results=[],evidence=[];
function method(source,signature,next){
  const start=source.indexOf('\n  '+signature+' {'),end=source.indexOf('\n  '+next,start+1);
  assert.ok(start>=0&&end>start,'Expected official method boundaries: '+signature);
  const segment=source.slice(start,end),close=segment.lastIndexOf('\n  }');assert.ok(close>0);
  return segment.slice(0,close+4);
}
function nativeMethods(root){
  const sources={};for(const name of ['player','gameEvent','content']){const file=path.join(root,'noname/library/element/'+name+'.js'),source=fs.readFileSync(file,'utf8');sources[name]=source;evidence.push({file,sha256:createHash('sha256').update(source).digest('hex')});}
  return {choose:method(sources.player,'chooseButton(params)','chooseButtonOL('),send:method(sources.gameEvent,'send()','sendAsync('),dispatch:method(sources.content,'async chooseButtonOL(event, trigger, player)','async chooseAnyOL(')};
}
function fixture(methods){
  const selected={bool:true,links:['caocao']},localSelected={bool:true,links:['liubei']},sent=[],remoteEvents=[];
  const makeScope=()=>{
    const defaultFilter=function defaultFilter(){return true;};
    const scope={lib:{filter:{filterButton:defaultFilter}},_status:{connectMode:true},get:{is:{object:value=>value!==null&&typeof value==='object'&&!Array.isArray(value)},itemtype(value){if(value?._nativeDialog)return 'dialog';if(Array.isArray(value)&&value.length===2&&value.every(Number.isFinite))return 'select';return null;},stringifiedResult:()=>({name:'chooseCharacter'}),skillState:()=>({})}};
    scope.game={createEvent(name){return {name,_set:[],set(key,value){this[key]=value;this._set.push([key,value]);return this;},isMine:()=>true,setContent(value){this.content=value;},forResult:()=>Promise.resolve(localSelected)};},pause(){scope.pauses=(scope.pauses||0)+1;},resume(){scope.resumes=(scope.resumes||0)+1;}};
    scope.context=vm.createContext(scope);scope.choose=vm.runInContext('({'+methods.choose+'}).chooseButton',scope.context);scope.send=vm.runInContext('({'+methods.send+'}).send',scope.context);scope.dispatch=vm.runInContext('({'+methods.dispatch+'}).chooseButtonOL',scope.context);return scope;
  };
  const host=makeScope(),guest=makeScope();
  const guestPlayer={playerid:'guest',applySkills(){},chooseButton(...args){const next=guest.choose.apply(this,args);remoteEvents.push(next);guest.last=next;return next;}};
  guest.game.me=guestPlayer;
  const clone=value=>{
    if(typeof value==='function')return vm.runInContext('('+value.toString()+')',guest.context);
    if(Array.isArray(value))return value.map(clone);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
    return value;
  };
  const remote={playerid:'guest',isOnline:()=>true,wait(fn){this.waiter=fn;},send(fn,...args){sent.push({fn,args});const callback=vm.runInContext('('+fn.toString()+')',guest.context);callback(...args.map(clone));},chooseButton(...args){return host.choose.apply(this,args);}};
  guest.game.resume=()=>{guest.resumes=(guest.resumes||0)+1;remote.waiter?.(selected);};
  const local={playerid:'host',isOnline:()=>false,chooseButton(...args){const next=host.choose.apply(this,args);host.last=next;return next;},wait(fn){this.waiter=fn;},unwait(value){this.waiter?.(value);}};host.game.me=local;
  return {host,guest,remote,local,selected,localSelected,sent,remoteEvents};
}
const business=event=>({forced:event.forced,complexSelect:event.complexSelect,selectButton:Array.from(event.selectButton),filterButton:event.filterButton.toString(),ai:event.ai.toString(),createDialog:JSON.parse(JSON.stringify(event.createDialog)),callback:event.callback?.toString(),switchToAuto:event.switchToAuto?.toString(),processAI:event.processAI?.toString(),forceDie:event.forceDie});
async function test(name,run){try{await run();results.push({name,ok:true});console.log('ok '+name);}catch(error){results.push({name,ok:false,error:String(error)});console.error('FAIL '+name+'\n'+error.stack);}}

for(const label of ['Old','Latest']){
  const root=testPaths.officialRoot(label);
  if(!fs.existsSync(path.join(root,'noname/library/element/player.js'))){results.push({name:label+' prepared official fixture',skipped:true});console.log('skip '+label+' prepared official fixture is unavailable');continue;}
  const methods=nativeMethods(root);
  await test(label+' native chooseButtonOL preserves positional arguments, functions, counts and results',async()=>{
    const ai=function chooseAI(){return 3;},filter=function chooseFilter(){return true;},callback=function chosenCallback(){},switchToAuto=function nativeAuto(){},processAI=function nativeProcessAI(){return {bool:true,links:['caocao']};};
    const descriptors=['请选择武将',[['caocao','liubei'],'characterx']],args=[descriptors,[1,2],true,false,ai,filter,'allowChooseAll'];
    let before;for(const marked of [false,true]){const f=fixture(methods),row=[f.remote,...args];if(marked){markFreeCharacterPickerRow(row,'identity');markFreeCharacterPickerRow(row,'identity');assert.equal(row.length,args.length+2);for(let i=0;i<args.length;i++)assert.equal(row[i+1],args[i]);}
      const event={list:[row],callback,switchToAuto,processAI};await f.host.dispatch(event);const remote=f.remoteEvents[0];assert.ok(remote);assert.equal(hasFreeCharacterPickerMark(remote,'identity'),marked);assert.equal(event.result.guest,f.selected);assert.deepEqual(Array.from(event.result.guest.links),['caocao']);assert.equal(f.sent.length,1);assert.equal(f.sent[0].args[1],callback);assert.equal(f.sent[0].args[2],switchToAuto);assert.equal(f.sent[0].args[3],processAI);if(marked)assert.deepEqual(business(remote),before);else before=business(remote);
    }
  });
  await test(label+' native single-params overload stays one argument and retains complex selection',async()=>{
    const filter=function nativeFilter(){return true;},ai=function nativeAI(){return 9;},callback=function nativeCallback(){},params={forced:true,complexSelect:false,selectButton:2,filterButton:filter,ai,createDialog:['请选择武将',[['caocao','liubei'],'character']],custom:{fixture:'retained'}};
    let before;for(const marked of [false,true]){const f=fixture(methods),row=[f.remote,params];if(marked){markFreeCharacterPickerRow(row,'doudizhu');assert.equal(row.length,2);assert.notEqual(row[1],params);for(const key of Object.keys(params))assert.equal(row[1][key],params[key]);}
      const event={list:[row],callback};await f.host.dispatch(event);assert.equal(f.remoteEvents[0]._args.length,1);assert.equal(hasFreeCharacterPickerMark(f.remoteEvents[0],'doudizhu'),marked);assert.equal(event.result.guest,f.selected);if(marked)assert.deepEqual(business(f.remoteEvents[0]),before);else before=business(f.remoteEvents[0]);
    }
  });
  await test(label+' native GameEvent.send carries direct event metadata through _set without changing business fields',async()=>{
    const f=fixture(methods),filter=function preservedFilter(){return true;},event=f.remote.chooseButton(['请选择武将',[['caocao'],'character']],1,true);event.set('filterButton',filter);const args=event._args;
    markFreeCharacterPickerEvent(event,'identity');markFreeCharacterPickerEvent(event,'identity');assert.equal(event._set.filter(row=>row[0]==='nnkFreeCharacterPicker').length,1);assert.equal(event._args,args);f.host.send.call(event);const remote=f.remoteEvents[0];assert.equal(hasFreeCharacterPickerMark(remote,'identity'),true);assert.equal(remote.filterButton.toString(),filter.toString());assert.equal(remote.forced,true);assert.deepEqual(Array.from(remote.selectButton),[1,1]);assert.equal(remote._modparent.name,'chooseCharacter');assert.equal(f.host.pauses,1);assert.equal(f.guest.resumes,1);
  });
  await test(label+' native local dispatcher preserves callbacks and returned selection references',async()=>{
    const f=fixture(methods),callback=function localCallback(){},row=[f.local,{createDialog:['请选择武将',[['caocao'],'character']],selectButton:1,forced:true}];markFreeCharacterPickerRow(row,'identity');const event={list:[row],callback};await f.host.dispatch(event);assert.equal(f.host.last.callback,callback);assert.equal(event.result.host,f.localSelected);assert.equal(hasFreeCharacterPickerMark(f.host.last,'identity'),true);
  });
  await test(label+' native 1v1 parser reaches core metadata through the exact open-dialog fallback without rewriting selection',async()=>{
    const f=fixture(methods),registry=new Map(),announcements=new Map(),{game,lib,_status}=f.host;
    Object.assign(lib,{mode:Object.fromEntries(FREE_CHOICE_MODES.map(mode=>[mode,{connect:{connect_number:{init:'2',connect:true}}}])),config:{mode_config:{}},configOL:{mode:'versus',versus_mode:'1v1',characterPack:['test'],nnk_free_choose:true},character:{caocao:['male','wei',4,[]],liubei:['male','shu',4,[]]},characterReplace:{},characterPack:{test:{caocao:['male','wei',4,[]],liubei:['male','shu',4,[]]}},announce:{subscribe(name,fn){announcements.set(fn,name);},unsubscribe(name,fn){announcements.delete(fn);}}});lib.filter.characterDisabled=()=>false;
    _status.postReconnect={};game.broadcastAll=()=>{};game.globalEventHandlers={pushHandler(name,fn){const list=registry.get(name)||[];list.push(fn);registry.set(name,list);},removeHandler(name,type,fn){const list=registry.get(name)||[],index=list.indexOf(fn);if(index>=0)list.splice(index,1);}};
    const env={game,lib,_status,ui:{dialog:{videoId:17}},get:f.host.get},lease={info:{role:'engine',engineRole:'host'},isCurrent:()=>true},core=installFreeCharacterChoice({env},lease,[versusAdapter]),fire=event=>{_status.event=event;for(const fn of registry.get(event.name)||[])fn(event,{state:'begin'});};
    f.local.storage={versuslist:[]};const root={name:'chooseCharacterOL',videoId:17,choosing:f.local,parent:{name:'game'},finished:false};fire(root);game.broadcastAll(()=>{},['caocao'],17,f.local);
    function make(first=17,parent=root){const event=f.local.chooseButton(first,1,true);event.parent=parent;event.set('selected',[]);return event;}
    const wrongId=make(18);fire(wrongId);assert.equal(hasFreeCharacterPickerMark(wrongId,'versus'),false);const skill=make(17,{name:'skill',parent:root});fire(skill);assert.equal(hasFreeCharacterPickerMark(skill,'versus'),false);env.ui.dialog.videoId=18;const wrongCurrent=make();fire(wrongCurrent);assert.equal(hasFreeCharacterPickerMark(wrongCurrent,'versus'),false);env.ui.dialog.videoId=17;const otherRoot=make(17,{name:'chooseCharacterOL',parent:{name:'game'}});fire(otherRoot);assert.equal(hasFreeCharacterPickerMark(otherRoot,'versus'),false);
    const event=make(),args=event._args,range=event.selectButton,selected=event.selected,filter=event.filterButton,ai=event.ai;assert.equal(event.dialog,undefined);assert.deepEqual(Array.from(range),[1,1]);fire(event);assert.equal(hasFreeCharacterPickerMark(event,'versus'),true);assert.equal(event.dialog,undefined);assert.equal(event._args,args);assert.deepEqual(Array.from(args),[17,1,true]);assert.equal(event.selectButton,range);assert.equal(event.selected,selected);assert.equal(event.filterButton,filter);assert.equal(event.ai,ai);assert.equal(event.result,undefined);const result={links:['caocao']};event.result=result;assert.equal(event.result,result);core.dispose();
  });
}
if(results.some(row=>row.ok===false))process.exitCode=1;
console.log(JSON.stringify({ok:!process.exitCode,checks:results.filter(row=>row.ok).length,scope:'Executed extracted official chooseButton, chooseButtonOL and GameEvent.send methods with modeled transport/result delivery; no game UI or real network',results,evidence}));

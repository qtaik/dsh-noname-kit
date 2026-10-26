import assert from 'node:assert/strict';
import {installFreeCharacterPicker} from '../online-kernel/keepalive/free-character-picker.js';
import {markFreeCharacterPickerEvent} from '../online-kernel/keepalive/free-character-picker-mark.js';
import {installFreeCharacterChoice} from '../online-kernel/keepalive/free-character-choice.js';
import {identityAdapter} from '../online-kernel/keepalive/free-character-identity.js';
import {FREE_CHOICE_MODES} from '../online-kernel/keepalive/free-character-options.js';

// A small DOM fixture exercises presentation state and event ownership. Native
// layout, event serialization and two-machine play require browser checks.
class Classes{
  values=new Set();
  add(...names){for(const name of names)this.values.add(name);}
  remove(...names){for(const name of names)this.values.delete(name);}
  contains(name){return this.values.has(name);}
  toggle(name,force){const on=force??!this.contains(name);if(on)this.add(name);else this.remove(name);return on;}
}
class Element extends EventTarget{
  children=[];style={};dataset={};attributes={};classList=new Classes();parentElement=null;_value='';textContent='';
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;}
  set className(value){this.classList=new Classes();this.classList.add(...value.split(/\s+/).filter(Boolean));}
  get className(){return [...this.classList.values].join(' ');}
  get value(){return this._value;}
  set value(value){this._value=this.tagName==='SELECT'&&!this.children.some(node=>node.value===value)?'':String(value);}
  get isConnected(){return this===this.ownerDocument.root||this.parentElement?.isConnected===true;}
  appendChild(node){node.remove();this.children.push(node);node.parentElement=this;return node;}
  insertBefore(node,before){node.remove();const index=this.children.indexOf(before);assert.ok(index>=0);this.children.splice(index,0,node);node.parentElement=this;return node;}
  replaceChildren(...nodes){for(const node of this.children.slice())node.remove();for(const node of nodes)this.appendChild(node);}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);}
  querySelector(selector){return walk(this).find(node=>selector==='[data-nnk-character-picker]'&&node.dataset.nnkCharacterPicker)||null;}
}
const walk=node=>node.children.flatMap(child=>[child,...walk(child)]);
function fixture({role='host',on=true,connect=true,started=false}={}){
  let current=true,invalidation=null;const handlers=[],observers=new Set(),registry=new Map([['chooseButton',handlers]]),announcements=new Map();
  const page=new EventTarget();page.MutationObserver=class{
    constructor(fn){this.fn=fn;}
    observe(){observers.add(this);}
    disconnect(){observers.delete(this);}
  };
  const doc={defaultView:page,createElement(tag){return new Element(tag,this);}};
  const arena=doc.createElement('div');doc.root=arena;arena.classList.add('choose-character');
  const character=(group)=>['male',group,4,[]];
  const lib={mode:Object.fromEntries(FREE_CHOICE_MODES.map(name=>[name,{connect:{connect_number:{init:'8',connect:true}}}])),config:{mode_config:{}},filter:{characterDisabled:()=>false},announce:{subscribe(name,fn){announcements.set(fn,name);},unsubscribe(name,fn){announcements.delete(fn);}},configOL:{mode:'identity',characterPack:['standard','refresh','mode_extension_自创(包)'],nnk_free_choose:on,gameStarted:true},character:{caocao:character('wei'),re_caocao:character('wei'),liubei:character('shu'),sunquan:character('wu'),custom:character('qun')},characterPack:{standard:{caocao:true,liubei:true,sunquan:true},refresh:{re_caocao:true},'mode_extension_自创(包)':{custom:true}},characterReplace:{caocao:['caocao','re_caocao']}};
  const translations={caocao:'曹操',re_caocao:'界曹操',liubei:'刘备',sunquan:'孙权',custom:'测试将',wei:'魏',shu:'蜀',wu:'吴',qun:'群',standard_character_config:'标准',refresh_character_config:'界限突破','mode_extension_自创(包)_character_config':'自创(包)'};
  const game={me:{playerid:'self'},broadcastAll(){},globalEventHandlers:{pushHandler(name,fn){const list=registry.get(name)||[];list.push(fn);registry.set(name,list);},removeHandler(name,type,fn){const list=registry.get(name)||[],index=list.indexOf(fn);if(index>=0)list.splice(index,1);}}};
  const status={connectMode:connect,gameStarted:started},ui={arena,selected:{buttons:[]}};
  const env={game,lib,_status:status,ui,get:{translation:id=>translations[id]||id,is:{double:()=>false},idDialog:id=>dialogs.get(id)}};
  const nnk={env},lease={info:{role:role==='ordinary'?'ordinary':'engine',engineRole:role},isCurrent:()=>current,native:{onInvalidated(fn){invalidation=fn;return ()=>{invalidation=null;};}}};
  const dialogs=new Map();let nextId=1;
  function dialog(ids=['caocao','liubei','sunquan','custom'],seeds=[]){
    const value=doc.createElement('div');value.buttons=[];value.contentContainer=doc.createElement('div');value.content=doc.createElement('div');value.appendChild(value.contentContainer);value.contentContainer.appendChild(value.content);
    const caption=doc.createElement('div');caption.textContent='请选择武将';value.content.appendChild(caption);
    function section(names){const container=doc.createElement('div');container.classList.add('buttons');value.content.appendChild(container);for(const id of names){const button=doc.createElement('div');button.classList.add('button','character');button.link=id;button._link=id;container.appendChild(button);value.buttons.push(button);}}
    section(ids);if(seeds.length)section(seeds);arena.appendChild(value);value.videoId=nextId++;dialogs.set(value.videoId,value);return value;
  }
  function event(dialogValue,fields={}){const instanceHandlers=[];return {name:'chooseButton',parent:{name:'chooseCharacter'},player:game.me,isMine:()=>true,dialog:dialogValue,finished:false,_set:[],set(key,value){this[key]=value;this._set.push([key,value]);return this;},pushHandler(fn){instanceHandlers.push(fn);},getHandler:()=>instanceHandlers,...fields};}
  const fire=(event,state='begin')=>{status.event=event;for(const handler of (registry.get(event.name)||[]).slice())handler(event,{state});};
  const controls=dialog=>{const bar=dialog.querySelector('[data-nnk-character-picker]');return bar?{bar,faction:walk(bar).find(n=>n.attributes['aria-label']==='按势力筛选'),pack:walk(bar).find(n=>n.attributes['aria-label']==='按武将包筛选'),search:walk(bar).find(n=>n.tagName==='INPUT'),clear:walk(bar).find(n=>n.tagName==='BUTTON'),count:walk(bar).find(n=>n.attributes['aria-live']==='polite')}:null;};
  return {nnk,lease,env,lib,game,status,ui,doc,page,handlers,observers,dialog,event,fire,controls,install:()=>installFreeCharacterPicker(nnk,lease),flush(){for(const observer of [...observers])observer.fn([]);},retire(){current=false;},invalidate(){current=false;invalidation?.({scope:{}});},notifyInvalidated:detail=>invalidation?.(detail),invalidationListeners:()=>Number(invalidation!==null)};
}
const emit=(node,type)=>node.dispatchEvent(new Event(type));
const visible=dialog=>dialog.buttons.filter(button=>!button.classList.contains('nnk-character-filtered')).map(button=>button.link);
let checks=0;const results=[];
function test(name,run){try{run();checks++;results.push({name,ok:true});console.log('ok '+name);}catch(error){results.push({name,ok:false});console.error('FAIL '+name+'\n'+error.stack);}}

test('current host and guest install one owned handler; ordinary and retired leases stay untouched',()=>{
  for(const role of ['host','guest']){const f=fixture({role}),api=f.install();assert.equal(api.installed,true);assert.equal(f.install(),api);assert.equal(f.handlers.length,1);api.dispose();assert.equal(f.handlers.length,0);}
  for(const role of ['ordinary','host']){const f=fixture({role});if(role==='host')f.retire();assert.equal(f.install().installed,false);assert.equal(f.handlers.length,0);}
});
test('precontent installs before the arena exists, then decorates native dialogs after arena creation',()=>{
  for(const role of ['host','guest']){const f=fixture({role}),arena=f.ui.arena;delete f.ui.arena;const api=f.install();assert.equal(api.installed,true);assert.equal(api.resourceSnapshot().observers,0);assert.equal(api.resourceSnapshot().pending,0);assert.equal(f.handlers.length,1);f.ui.arena=arena;const dialog=f.dialog(),event=f.event(dialog);markFreeCharacterPickerEvent(event,'identity');f.fire(event);const controls=f.controls(dialog);assert.ok(controls);assert.equal(controls.faction.style.background,'transparent');assert.equal(controls.clear.style.background,'transparent');controls.search.value='曹操';emit(controls.search,'input');assert.deepEqual(visible(dialog),['caocao']);api.dispose();assert.equal(f.handlers.length,0);assert.equal(f.controls(dialog),null);}
});
test('off, singleplayer, started, other-player and skill choices leave native dialogs untouched',()=>{
  for(const settings of [{on:false},{connect:false},{started:true},{}]){const f=fixture(settings),api=f.install(),dialog=f.dialog(),event=f.event(dialog);if(!Object.keys(settings).length){event.player={};event.isMine=()=>false;}f.fire(event);assert.equal(f.controls(dialog),null);api.dispose();}
  const f=fixture(),api=f.install(),dialog=f.dialog(),event=f.event(dialog,{parent:{name:'skill'}});f.ui.arena.classList.remove('choose-character');f.fire(event);assert.equal(f.controls(dialog),null);api.dispose();
});
test('classification preserves candidate and business references with pre-start configOL.gameStarted true',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog(),filter=()=>true,callback=()=>{},result={links:['caocao']},event=f.event(dialog,{selectButton:[1,2],filterButton:filter,callback,result:undefined}),buttons=dialog.buttons,original=buttons.slice(),caption=dialog.content.children[0];
  f.fire(event);assert.ok(f.controls(dialog));assert.equal(dialog.buttons,buttons);assert.deepEqual(dialog.buttons,original);assert.deepEqual(original.map(b=>[b.link,b._link]),[['caocao','caocao'],['liubei','liubei'],['sunquan','sunquan'],['custom','custom']]);assert.equal(event.filterButton,filter);assert.equal(event.callback,callback);assert.deepEqual(event.selectButton,[1,2]);assert.equal(dialog.content.children[0],caption);event.result=result;f.fire(event,'end');assert.equal(event.result,result);assert.equal(f.controls(dialog),null);api.dispose();
});
test('faction, custom pack and literal Chinese or ID search intersect and clear without losing candidates',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog();f.fire(f.event(dialog));const c=f.controls(dialog);c.faction.value='wei';emit(c.faction,'change');assert.deepEqual(visible(dialog),['caocao']);c.pack.value='standard';emit(c.pack,'change');c.search.value='曹操';emit(c.search,'input');assert.deepEqual(visible(dialog),['caocao']);c.search.value='[';emit(c.search,'input');assert.deepEqual(visible(dialog),[]);emit(c.clear,'click');assert.equal(visible(dialog).length,4);c.pack.value='mode_extension_自创(包)';emit(c.pack,'change');assert.deepEqual(visible(dialog),['custom']);emit(c.clear,'click');c.search.value='CAOCAO';emit(c.search,'input');assert.deepEqual(visible(dialog),['caocao']);api.dispose();assert.equal(visible(dialog).length,4);
});
test('selected and drafted buttons stay visible while native hidden states remain owned by native code',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog();dialog.buttons[1].classList.add('selected');dialog.buttons[2].classList.add('glow');dialog.buttons[3].classList.add('nodisplay');f.fire(f.event(dialog));const c=f.controls(dialog);c.search.value='曹操';emit(c.search,'input');assert.deepEqual(visible(dialog),['caocao','liubei','sunquan']);assert.ok(dialog.buttons[3].classList.contains('nodisplay'));api.dispose();assert.ok(dialog.buttons[3].classList.contains('nodisplay'));
});
test('native characterx replacement reclassifies the same button and retains version-switch state',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog();const button=dialog.buttons[0],refresh=()=>{},replacement=f.lib.characterReplace.caocao;button.refresh=refresh;button._replaceButton=true;f.fire(f.event(dialog));button.link='re_caocao';emit(dialog,'click');const c=f.controls(dialog);assert.ok(c.pack.children.some(node=>node.value==='refresh'));c.pack.value='refresh';emit(c.pack,'change');assert.deepEqual(visible(dialog),['re_caocao']);assert.equal(dialog.buttons[0],button);assert.equal(button._link,'caocao');assert.equal(button.refresh,refresh);assert.equal(button._replaceButton,true);assert.equal(f.lib.characterReplace.caocao,replacement);api.dispose();
});
test('a randomly displayed SP variant stays findable through the same native family without switching it',()=>{
  const f=fixture(),api=f.install();f.lib.character.sp_ol_caocao=['male','qun',4,[]];f.lib.characterPack.sp={sp_ol_caocao:true};const family=['caocao','sp_ol_caocao'];f.lib.characterReplace.caocao=family;
  const dialog=f.dialog(),button=dialog.buttons[0];button.link='sp_ol_caocao';button._replaceButton=true;f.fire(f.event(dialog));const c=f.controls(dialog);c.faction.value='wei';c.pack.value='standard';c.search.value='曹操';emit(c.search,'input');assert.deepEqual(visible(dialog),['sp_ol_caocao']);assert.equal(button.link,'sp_ol_caocao');assert.equal(button._link,'caocao');assert.equal(f.lib.characterReplace.caocao,family);assert.deepEqual(family,['caocao','sp_ol_caocao']);assert.ok(walk(c.bar).some(node=>node.textContent==='同组版本可点「切换」'));
  c.pack.value='sp';emit(c.pack,'change');assert.deepEqual(visible(dialog),[]);c.faction.value='qun';c.search.value='sp_ol_caocao';emit(c.search,'input');assert.deepEqual(visible(dialog),['sp_ol_caocao']);button.link='caocao';emit(dialog,'click');assert.deepEqual(visible(dialog),['caocao']);assert.equal(dialog.buttons[0],button);assert.equal(button.link,'caocao');api.dispose();
});
test('plain character buttons do not index family variants they cannot switch to',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog();f.fire(f.event(dialog));const c=f.controls(dialog);assert.equal(c.pack.children.some(node=>node.value==='refresh'),false);assert.equal(walk(c.bar).some(node=>node.textContent==='同组版本可点「切换」'),false);api.dispose();
});
test('shared videoId drafts filter only the unambiguous candidate section and preserve starting roster',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog(undefined,['liubei']),event=f.event(dialog.videoId,{canChoose:['caocao','liubei','sunquan','custom']});f.fire(event);const c=f.controls(dialog);assert.ok(c);c.search.value='曹操';emit(c.search,'input');assert.deepEqual(visible(dialog),['caocao','liubei']);assert.equal(dialog.buttons[4].classList.contains('nnk-character-filtered'),false);api.dispose();
  const a=fixture(),aa=a.install(),ambiguous=a.dialog(['caocao'],['liubei']);a.fire(a.event(ambiguous));assert.equal(a.controls(ambiguous),null);aa.dispose();
});
test('native point-selection classification is not duplicated',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog();dialog.getCurrentCapt=()=>{};f.fire(f.event(dialog));assert.equal(f.controls(dialog),null);assert.equal(api.resourceSnapshot().dialogs,0);assert.equal(api.resourceSnapshot().observers,0);api.dispose();
});
test('untranslated extension packages show their real extension name rather than an internal key',()=>{
  const f=fixture(),api=f.install();f.lib.characterPack.mode_extension_未译包={custom:true};const dialog=f.dialog();f.fire(f.event(dialog));const option=f.controls(dialog).pack.children.find(row=>row.value==='mode_extension_未译包');assert.equal(option.textContent,'未译包');api.dispose();
});
test('ordinary remote createDialog waits for native creation without patching UI methods',()=>{
  const f=fixture({role:'guest'}),api=f.install(),event=f.event(undefined,{parent:null,_modparent:{name:'chooseCharacter'},createDialog:['选择武将',[['caocao'],'character']]});markFreeCharacterPickerEvent(event,'identity');f.fire(event);assert.equal(api.resourceSnapshot().pending,1);assert.equal(api.resourceSnapshot().observers,1);event.dialog=f.dialog(['caocao']);f.flush();assert.ok(f.controls(event.dialog));assert.equal(api.resourceSnapshot().pending,0);event.dialog.remove();f.flush();assert.equal(api.resourceSnapshot().dialogs,0);assert.equal(api.resourceSnapshot().observers,0);api.dispose();
});
test('real guest timing accepts an exact marker with started flags, parent game and no arena choice class',()=>{
  for(const marked of [false,true]){const f=fixture({role:'guest',started:true}),api=f.install();f.ui.arena.classList.remove('choose-character');const event=f.event(undefined,{parent:{name:'game'},_args:['nnk-free-character-picker:v1:identity'],_modparent:undefined});if(!marked)event._args=[];f.fire(event);assert.equal(api.resourceSnapshot().pending,Number(marked));event.dialog=f.dialog();f.flush();assert.equal(!!f.controls(event.dialog),marked);api.dispose();}
});
test('wrong marker mode or version never uses the host ancestry fallback',()=>{
  for(const value of ['nnk-free-character-picker:v2:identity','nnk-free-character-picker:v1:doudizhu']){const f=fixture(),api=f.install(),dialog=f.dialog(),event=f.event(dialog,{_args:[value]});f.fire(event);assert.equal(f.controls(dialog),null);api.dispose();}
});
test('valid remote markers still require an enabled connected owned local-player choice',()=>{
  for(const settings of [{on:false},{connect:false},{role:'ordinary'},{}]){const f=fixture({...settings,started:true}),api=f.install(),dialog=f.dialog(),event=f.event(dialog,{parent:{name:'game'}});markFreeCharacterPickerEvent(event,'identity');if(!Object.keys(settings).length){event.player={};event.isMine=()=>false;}f.fire(event);assert.equal(f.controls(dialog),null);api.dispose();}
});
test('picker installed before the core handles host selection before its later marker and skips nested skills',()=>{
  const f=fixture(),api=f.install(),core=installFreeCharacterChoice(f.nnk,f.lease,[identityAdapter]),root={name:'chooseCharacter',parent:{name:'game'},finished:false};f.fire(root);
  const ids=['liubei'],event=f.event(undefined,{parent:root,createDialog:['选择武将',[ids,'character']]});f.fire(event);assert.equal(event.nnkFreeCharacterPicker,'nnk-free-character-picker:v1:identity');assert.equal(api.resourceSnapshot().pending,1);f.status.gameStarted=true;event.dialog=f.dialog(ids);f.flush();assert.ok(f.controls(event.dialog));event.result={links:['caocao']};f.fire(event,'end');
  f.status.gameStarted=false;const skillIds=['liubei'],skill=f.event(f.dialog(skillIds),{parent:{name:'skill',parent:root},createDialog:['技能选择',[skillIds,'character']]});f.fire(skill);assert.equal(skill.nnkFreeCharacterPicker,undefined);assert.equal(f.controls(skill.dialog),null);core.dispose();api.dispose();
});
test('the core marks only widened OL rows and preserves positional and single-object business values',()=>{
  const f=fixture(),core=installFreeCharacterChoice(f.nnk,f.lease,[identityAdapter]),root={name:'chooseCharacter',parent:{name:'game'},finished:false};f.fire(root);
  const first=['liubei'],second=['sunquan'],filter=()=>true,params={createDialog:['选择武将',[second,'character']],selectButton:1,forced:true,filterButton:filter,custom:{preserved:true}},other={playerid:'other'},row1=[f.game.me,['选择武将',[first,'character']],1,true],row2=[other,params],dispatcher=f.event(undefined,{name:'chooseButtonOL',parent:root,list:[row1,row2]});f.fire(dispatcher);
  assert.equal(row1.length,5);assert.equal(row1[4],'nnk-free-character-picker:v1:identity');assert.equal(row1[1][1][0],first);assert.equal(row2.length,2);assert.equal(row2[1].createDialog,params.createDialog);assert.equal(row2[1].filterButton,filter);assert.equal(row2[1].custom,params.custom);assert.equal(row2[1].nnkFreeCharacterPicker,'nnk-free-character-picker:v1:identity');assert.equal(params.nnkFreeCharacterPicker,undefined);
  const skillIds=['liubei'],skillRow=[other,['技能目标',[skillIds,'character']],1,true],skill=f.event(undefined,{name:'chooseButtonOL',parent:{name:'skill',parent:root},list:[skillRow]});f.fire(skill);assert.equal(skillRow.length,4);assert.deepEqual(skillIds,['liubei']);core.dispose();
});
test('shared numeric dialogs receive metadata only for the exact root id and recognized draft path',()=>{
  const f=fixture();f.lib.configOL.mode='single';f.lib.configOL.single_mode='normal';const adapter={id:'single-test',matchesRoot:()=>true,begin(ctx){ctx.stage='draft';ctx.root.videoIdx=17;},beforeChoose(){}};
  const core=installFreeCharacterChoice(f.nnk,f.lease,[adapter]),root={name:'chooseCharacter',parent:{name:'game'},finished:false};f.fire(root);const wrong=f.event(18,{parent:root,canChoose:['caocao']}),right=f.event(17,{parent:root,canChoose:['caocao']});f.fire(wrong);assert.equal(wrong.nnkFreeCharacterPicker,undefined);f.fire(right);assert.equal(right.nnkFreeCharacterPicker,'nnk-free-character-picker:v1:single');assert.equal(right._set[0][0],'nnkFreeCharacterPicker');core.dispose();
});
test('native shared-dialog fallback reads the same open dialog without assigning the event dialog or arguments',()=>{
  for(const role of ['host','guest']){const f=fixture({role,started:role==='guest'}),api=f.install(),dialog=f.dialog(),args=[dialog.videoId,1,true],event=f.event(undefined,{_args:args,parent:role==='host'?{name:'chooseCharacter'}:{name:'game'}});f.ui.dialog=dialog;if(role==='guest')markFreeCharacterPickerEvent(event,'identity');f.fire(event);assert.ok(f.controls(dialog));assert.equal(event.dialog,undefined);assert.equal(event._args,args);assert.deepEqual(args,[dialog.videoId,1,true]);api.dispose();}
  const f=fixture({role:'guest',started:true}),api=f.install(),dialog=f.dialog(),event=f.event(undefined,{_args:[dialog.videoId+1,1,true],parent:{name:'game'}});f.ui.dialog=dialog;markFreeCharacterPickerEvent(event,'identity');f.fire(event);assert.equal(f.controls(dialog),null);api.dispose();
});
test('Escape clears only presentation filters and keeps selected buttons and native event results',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog(),event=f.event(dialog);f.fire(event);const c=f.controls(dialog);c.search.value='曹操';emit(c.search,'input');const keyboard=new Event('keydown',{cancelable:true});Object.defineProperty(keyboard,'key',{value:'Escape'});c.bar.dispatchEvent(keyboard);assert.equal(c.search.value,'');assert.equal(visible(dialog).length,4);assert.equal(event.result,undefined);assert.equal(keyboard.defaultPrevented,true);api.dispose();
});
test('invalidation and pagehide remove local controls, listeners, owned observer and registration',()=>{
  for(const end of ['invalidate','pagehide']){const f=fixture(),api=f.install(),dialog=f.dialog();f.fire(f.event(dialog));assert.ok(api.resourceSnapshot().listeners>0);if(end==='invalidate')f.invalidate();else emit(f.page,'pagehide');assert.equal(f.controls(dialog),null);assert.deepEqual(api.resourceSnapshot(),{registeredEventHandlers:0,dialogs:0,listeners:0,observers:0,pending:0,pagehideListeners:0,invalidationListeners:0,timers:0});assert.equal(f.invalidationListeners(),0);assert.equal(api.dispose(),false);}
});
test('matching invalidation cleans a current lease while unrelated scopes leave its picker active',()=>{
  const f=fixture(),scope={sessionId:'s',roundId:'r',documentGeneration:1,bindingId:'b',bindingNonce:'n',expectedOrigin:'http://local'};f.lease.info.scope=scope;const api=f.install(),dialog=f.dialog();f.fire(f.event(dialog));f.notifyInvalidated({scope:{...scope,roundId:'other'}});assert.ok(f.controls(dialog));assert.equal(api.resourceSnapshot().registeredEventHandlers,1);f.notifyInvalidated({scope:{...scope}});assert.equal(f.controls(dialog),null);assert.equal(api.resourceSnapshot().registeredEventHandlers,0);
});
test('retired copied native handlers and pre-existing toolbar listeners cannot change presentation',()=>{
  const f=fixture(),api=f.install(),dialog=f.dialog(),event=f.event(dialog);f.fire(event);const c=f.controls(dialog),copied=f.handlers[0];f.retire();c.search.value='曹操';emit(c.search,'input');assert.equal(f.controls(dialog),null);assert.equal(visible(dialog).length,4);copied(event,{state:'begin'});assert.equal(f.controls(dialog),null);api.dispose();
});

if(results.some(row=>!row.ok))process.exitCode=1;
console.log(JSON.stringify({ok:!process.exitCode,checks,scope:'DOM-fixture presentation and lifecycle checks; no native game or physical P2P execution',results}));

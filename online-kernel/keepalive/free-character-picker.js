import {FREE_CHOICE_MODES} from './free-character-options.js';
import {hasFreeCharacterPickerMark,hasFreeCharacterPickerMetadata} from './free-character-picker-mark.js';

const installations=new WeakMap();
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const inactive=Object.freeze({installed:false,dispose:()=>false,resourceSnapshot:()=>({registeredEventHandlers:0,dialogs:0,listeners:0,observers:0,pending:0,pagehideListeners:0,invalidationListeners:0,timers:0})});

function ownedEngine(lease){
  try{return lease?.info?.role==='engine'&&['host','guest'].includes(lease.info.engineRole)&&lease.isCurrent?.()===true;}
  catch{return false;}
}

function initialChoice(event,env,role){
  if(event?.name!=='chooseButton'||event.finished)return false;
  try{if(event.player!==env.game.me||event.isMine?.()!==true)return false;}catch{return false;}
  if(hasFreeCharacterPickerMark(event,env.lib.configOL?.mode))return true;
  if(hasFreeCharacterPickerMetadata(event))return false;
  if(role!=='host'||env._status.gameStarted===true)return false;
  const seen=new Set();
  for(let current=event;current&&!seen.has(current);current=current.parent||current._modparent){
    if(['chooseCharacter','chooseCharacterOL'].includes(current.name))return true;
    if(!['chooseButton','chooseButtonOL'].includes(current.name))return false;
    seen.add(current);
  }
  return false;
}

function resolveDialog(event,env){
  let dialog=typeof event.dialog==='number'?env.get?.idDialog?.(event.dialog):event.dialog;
  if(dialog===undefined&&!event.createDialog&&Array.isArray(event._args)&&event._args.length===3&&
    Number.isSafeInteger(event._args[0])&&event._args[1]===1&&event._args[2]===true&&env.ui.dialog?.videoId===event._args[0])dialog=env.ui.dialog;
  return dialog&&Array.isArray(dialog.buttons)&&dialog.content?.ownerDocument?dialog:null;
}

function candidateButtons(dialog,event,lib){
  const restriction=Array.isArray(event.nnkFreeCandidates)?event.nnkFreeCandidates:Array.isArray(event.canChoose)?event.canChoose:null;
  const allowed=restriction?new Set(restriction):null,groups=new Map();
  for(const button of dialog.buttons){
    if(typeof button.link!=='string'||!lib.character?.[button.link]||!button.parentElement)continue;
    if(allowed&&!allowed.has(button.link)&&!allowed.has(button._link))continue;
    const group=groups.get(button.parentElement)||[];group.push(button);groups.set(button.parentElement,group);
  }
  if(!groups.size)return [];
  if(groups.size===1)return [...groups.values()][0];
  // Shared drafts also contain starting rosters. Only an explicitly identified,
  // unambiguous candidate section receives the presentation filter.
  if(!allowed)return [];
  const sorted=[...groups.values()].sort((a,b)=>b.length-a.length);
  return sorted[0].length>sorted[1].length?sorted[0]:[];
}

function createPicker(dialog,event,env,isActive){
  if(typeof dialog.getCurrentCapt==='function'||dialog.querySelector?.('[data-nnk-character-picker]'))return null;
  const buttons=candidateButtons(dialog,event,env.lib);
  if(!buttons.length)return null;
  const doc=dialog.content.ownerDocument,removers=[],hidden=new Set(),metadata=new Map();let disposed=false;
  const toolbar=doc.createElement('div');toolbar.dataset.nnkCharacterPicker='true';
  toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','自由选将筛选');
  Object.assign(toolbar.style,{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'center',gap:'6px',padding:'8px 4px',boxSizing:'border-box',maxWidth:'100%',fontFamily:'inherit'});
  const style=doc.createElement('style');
  style.textContent='.nnk-free-character-picker-dialog .nnk-character-filtered{display:none!important}.nnk-free-character-picker-dialog [data-nnk-character-picker] :focus-visible{outline:2px solid currentColor;outline-offset:2px}.nnk-free-character-picker-dialog [data-nnk-character-picker] option{background:Canvas;color:CanvasText}';
  toolbar.appendChild(style);
  const control=(tag,label)=>{
    const node=doc.createElement(tag);node.setAttribute('aria-label',label);
    node.className='tdnode pointerdiv reduce_radius';
    Object.assign(node.style,{position:'relative',font:'inherit',color:'inherit',background:'transparent',border:'1px solid currentColor',borderRadius:'4px',minWidth:'0',maxWidth:'100%',boxSizing:'border-box',margin:'0',padding:'4px 6px'});
    toolbar.appendChild(node);return node;
  };
  const faction=control('select','按势力筛选'),pack=control('select','按武将包筛选'),search=control('input','搜索武将');
  search.type='search';search.placeholder='搜索武将名或 ID';search.autocomplete='off';
  Object.assign(search.style,{flex:'1 1 160px',minWidth:'100px',width:'180px',background:'transparent',border:'1px solid currentColor',borderRadius:'4px'});
  const clear=control('button','清空筛选');clear.type='button';clear.textContent='清空';
  const count=doc.createElement('span');count.setAttribute('aria-live','polite');count.style.fontSize='0.85em';toolbar.appendChild(count);
  const versionHint=doc.createElement('span');versionHint.textContent='同组版本可点「切换」';versionHint.style.fontSize='0.8em';
  const translate=value=>{
    let result=env.lib.translate?.[value];if(typeof result!=='string'||!result)try{result=env.get?.translation?.(value);}catch{}
    return typeof result==='string'&&result?result:value;
  };
  const packLabel=value=>{
    if(value==='__other')return '其他武将包';
    const configured=translate(value+'_character_config');if(configured!==value+'_character_config')return configured;
    const direct=translate(value);if(direct!==value)return direct;
    return value.startsWith('mode_extension_')?value.slice(15):value;
  };
  function info(button){
    const id=button.link,cached=metadata.get(button),family=button._replaceButton===true?env.lib.characterReplace?.[button._link]:null;
    const ids=[...new Set([id,...(Array.isArray(family)?family.filter(name=>typeof name==='string'&&!!env.lib.character[name]):[])])];
    const key=JSON.stringify(ids);if(cached?.key===key)return cached;
    const variants=ids.map(name=>{
      const character=env.lib.character[name],groups=new Set();
      const group=character?.group??character?.[1];if(typeof group==='string'&&group)groups.add(group);
      try{const double=env.get?.is?.double?.(name,true);if(Array.isArray(double)&&double.length){groups.add('double');for(const value of double)if(typeof value==='string')groups.add(value);}}catch{}
      if(!groups.size)groups.add('__other');
      const packs=[];for(const [packName,values] of Object.entries(env.lib.characterPack||{}))if(values&&own(values,name))packs.push(packName);
      if(!packs.length)packs.push('__other');
      return {groups,packs,text:(translate(name)+' '+translate(name+'_ab')+' '+name).toLocaleLowerCase()};
    });
    const value={id,key,variants};metadata.set(button,value);return value;
  }
  function options(select,values,all,label){
    const previous=select.value;select.replaceChildren();
    for(const value of ['',...values]){const option=doc.createElement('option');option.value=value;option.textContent=value?label(value):all;select.appendChild(option);}
    select.value=values.includes(previous)?previous:'';
  }
  function refreshOptions(){
    const factions=new Set(),packs=new Set();let folded=false;
    for(const button of buttons){const value=info(button);folded||=value.variants.length>1;for(const variant of value.variants){for(const group of variant.groups)factions.add(group);for(const name of variant.packs)packs.add(name);}}
    const sort=(a,b)=>translate(a).localeCompare(translate(b),'zh-Hans-CN');
    options(faction,[...factions].sort(sort),'全部势力',value=>value==='__other'?'其他势力':value==='double'?'双势力':translate(value));
    options(pack,[...packs].sort(sort),'全部武将包',packLabel);
    if(folded&&!versionHint.parentElement)toolbar.appendChild(versionHint);else if(!folded)versionHint.remove();
  }
  function selected(button){return ['selected','selectedx','glow'].some(name=>button.classList.contains(name))||env.ui.selected?.buttons?.includes(button);}
  function apply(resetScroll=false){
    const query=search.value.trim().toLocaleLowerCase();let shown=0;
    for(const button of buttons){
      const value=info(button),visible=selected(button)||value.variants.some(variant=>(!faction.value||variant.groups.has(faction.value))&&(!pack.value||variant.packs.includes(pack.value))&&(!query||variant.text.includes(query)));
      button.classList.toggle('nnk-character-filtered',!visible);
      if(visible){hidden.delete(button);shown++;}else hidden.add(button);
    }
    count.textContent='显示 '+shown+' / '+buttons.length;
    if(resetScroll&&dialog.contentContainer)dialog.contentContainer.scrollTop=0;
  }
  function listen(target,type,listener,options){
    const guarded=e=>{if(!disposed&&isActive())listener(e);else cleanup();};
    target.addEventListener(type,guarded,options);removers.push(()=>target.removeEventListener(type,guarded,options));
  }
  for(const type of ['pointerdown','mousedown','touchstart','touchend','click','keyup'])listen(toolbar,type,e=>e.stopPropagation());
  listen(toolbar,'keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&(search.value||faction.value||pack.value)){e.preventDefault();search.value='';faction.value='';pack.value='';apply(true);}});
  listen(search,'input',()=>apply(true));listen(faction,'change',()=>apply(true));listen(pack,'change',()=>apply(true));
  listen(clear,'click',()=>{search.value='';faction.value='';pack.value='';apply(true);});
  // Native version switching refreshes the same button. Capture also follows
  // touchscreen handlers or extensions which stop the bubbling click.
  const refresh=()=>{let changed=false;for(const button of buttons){const before=metadata.get(button);if(info(button)!==before)changed=true;}if(changed)refreshOptions();apply();};
  let refreshQueued=false;
  for(const type of ['click','touchend']){
    listen(dialog,type,refresh);
    listen(dialog,type,()=>{
      if(refreshQueued)return;refreshQueued=true;
      Promise.resolve().then(()=>{refreshQueued=false;if(!disposed&&isActive())refresh();else cleanup();});
    },true);
  }
  const first=buttons[0].parentElement;
  let anchor=first;while(anchor.parentElement&&anchor.parentElement!==dialog.content)anchor=anchor.parentElement;
  if(anchor.parentElement!==dialog.content){for(const remove of removers)remove();return null;}
  function cleanup(){
    if(disposed)return;disposed=true;for(const remove of removers.splice(0))remove();
    for(const button of hidden)button.classList.remove('nnk-character-filtered');hidden.clear();metadata.clear();
    toolbar.remove();dialog.classList.remove('nnk-free-character-picker-dialog');
  }
  try{dialog.content.insertBefore(toolbar,anchor);dialog.classList.add('nnk-free-character-picker-dialog');refreshOptions();apply();}catch(error){cleanup();throw error;}
  return {dialog,event,get listeners(){return removers.length;},dispose:cleanup};
}

// Filters decorate native buttons only; their identity, legality and result
// callbacks remain under the original mode's chooseButton implementation.
export function installFreeCharacterPicker(nnk,lease){
  if(!ownedEngine(lease))return inactive;
  const env=nnk?.env,{game,lib,_status,ui}=env||{};
  if(!game||!lib||!_status||!ui)throw Error('Native character picker environment is unavailable');
  const previous=installations.get(game);if(previous?.current())return previous.api;previous?.api.dispose();
  const events=game.globalEventHandlers;
  if(typeof events?.pushHandler!=='function'||typeof events?.removeHandler!=='function')throw Error('Native character picker event hooks are unavailable');
  let pageWindow=ui.arena?.ownerDocument?.defaultView||globalThis.window;
  const pending=new Set(),records=new Map(),diagnostics=[];
  let disposed=false,observer=null,registered=false,pagehideOwned=false,offInvalidated=null;
  const current=()=>!disposed&&ownedEngine(lease)&&nnk.env===env&&env.game===game&&env.lib===lib;
  const enabled=()=>current()&&_status.connectMode===true&&lib.configOL?.nnk_free_choose===true&&FREE_CHOICE_MODES.includes(lib.configOL.mode);
  const qualifies=event=>initialChoice(event,env,lease.info.engineRole);
  function remove(event){const record=records.get(event);if(record){record.dispose();records.delete(event);}pending.delete(event);}
  function settleObserver(){
    if(!pending.size&&!records.size){observer?.disconnect();observer=null;return;}
    const arena=ui.arena;if(!arena?.ownerDocument)return;
    const view=arena.ownerDocument.defaultView||pageWindow,Observer=view?.MutationObserver||globalThis.MutationObserver;
    if(!observer&&typeof Observer==='function'){observer=new Observer(inspect);observer.observe(arena,{childList:true,subtree:true});}
  }
  function inspect(){
    if(!enabled()){for(const event of [...pending,...records.keys()])remove(event);settleObserver();return;}
    for(const [event,record] of [...records])if(!qualifies(event)||record.dialog.isConnected===false)remove(event);
    for(const event of [...pending]){
      if(!qualifies(event)){remove(event);continue;}
      const dialog=resolveDialog(event,env);if(!dialog||dialog.isConnected===false)continue;
      pending.delete(event);
      try{const record=createPicker(dialog,event,env,()=>enabled()&&qualifies(event));if(record)records.set(event,record);}catch(error){diagnostics.push(error?.message||String(error));}
    }
    settleObserver();
  }
  function onChoose(event,option){
    if(!current())return;
    if(!pagehideOwned){pageWindow=ui.arena?.ownerDocument?.defaultView||globalThis.window;if(typeof pageWindow?.addEventListener==='function'){pageWindow.addEventListener('pagehide',onPagehide,{once:true});pagehideOwned=true;}}
    if(option?.state==='begin'&&enabled()&&qualifies(event)){pending.add(event);inspect();}
    else if(option?.state==='end'){
      if(event.finished||event.result!==undefined)remove(event);
      inspect();
    }
  }
  function onInvalidated(detail){
    const scope=lease.info?.scope,fields=['sessionId','roundId','documentGeneration','bindingId','bindingNonce','expectedOrigin'];
    if(!current()||(scope&&fields.every(key=>scope[key]!==undefined&&scope[key]===detail?.scope?.[key])))dispose();
  }
  function onPagehide(){dispose();}
  function dispose(){
    if(disposed)return false;disposed=true;
    for(const event of [...pending,...records.keys()])remove(event);
    observer?.disconnect();observer=null;
    if(registered)events.removeHandler('chooseButton',undefined,onChoose);registered=false;
    if(pagehideOwned)pageWindow.removeEventListener('pagehide',onPagehide);pagehideOwned=false;
    offInvalidated?.();offInvalidated=null;
    if(installations.get(game)?.api===api)installations.delete(game);
    return true;
  }
  const api=Object.freeze({installed:true,dispose,diagnostics,resourceSnapshot:()=>({registeredEventHandlers:Number(registered),dialogs:records.size,listeners:[...records.values()].reduce((count,record)=>count+record.listeners,0),observers:Number(observer!==null),pending:pending.size,pagehideListeners:Number(pagehideOwned),invalidationListeners:Number(offInvalidated!==null),timers:0})});
  try{
    events.pushHandler('chooseButton',onChoose);registered=true;
    if(typeof pageWindow?.addEventListener==='function'){pageWindow.addEventListener('pagehide',onPagehide,{once:true});pagehideOwned=true;}
    if(typeof lease.native?.onInvalidated==='function'){offInvalidated=lease.native.onInvalidated(onInvalidated);if(typeof offInvalidated!=='function')throw Error('Native picker invalidation cleanup is unavailable');}
    installations.set(game,{current,api});return api;
  }catch(error){dispose();throw error;}
}

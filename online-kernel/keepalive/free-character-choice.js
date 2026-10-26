import {installFreeCharacterOptions,FREE_CHOICE_MODES} from './free-character-options.js';
import {markFreeCharacterPickerEvent,markFreeCharacterPickerRow} from './free-character-picker-mark.js';

const installations=new WeakMap();
const rootNames=new Set(['chooseCharacter','chooseCharacterOL']);
const choiceNames=new Set(['chooseButton','chooseButtonOL']);
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key);
const sameDescriptor=(a,b)=>!!a&&!!b&&a.value===b.value&&a.get===b.get&&a.set===b.set&&a.enumerable===b.enumerable&&a.configurable===b.configurable&&a.writable===b.writable;
const unique=values=>[...new Set(values)];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const inactive=Object.freeze({installed:false,dispose:()=>false,setFailureHandler:()=>()=>false,diagnostics:Object.freeze([]),resourceSnapshot:()=>({contexts:0,bindings:0,eventHandlers:0,registeredEventHandlers:0,ownedInstanceHandlers:0,nativeHandlerCopiesObservable:false,announceListeners:0,pagehideListeners:0,invalidationListeners:0,failureHandlerListeners:0,failed:false,timers:0})});

function ownedHost(lease){
  try{return lease?.info?.role==='engine'&&lease.info.engineRole==='host'&&lease.isCurrent?.()===true;}
  catch{return false;}
}

// A mode adapter may supply its native mode pack explicitly; ordinary offers use
// only the room's enabled packs. Neither path bypasses the native ban filter.
export function legalCharacterPool(env,ids,options={}){
  const {lib}=env,packNames=options.packNames??lib.configOL?.characterPack;
  if((!options.nativePool&&!Array.isArray(packNames))||typeof lib.filter?.characterDisabled!=='function')throw Error('Native legal character pool is unavailable');
  if(ids!==undefined&&!Array.isArray(ids))throw TypeError('Character pool intersection must be an array');
  if(options.nativePool&&!Array.isArray(ids))throw TypeError('A native mode pool must be supplied explicitly');
  const characters=Object.create(null);
  if(options.nativePool){
    for(const id of ids)if(lib.character?.[id])characters[id]=lib.character[id];
  }else{
    for(const packName of packNames){
      const pack=lib.characterPack?.[packName];
      if(!pack)continue;
      for(const id of Object.keys(pack))if(lib.character?.[id])characters[id]=pack[id];
    }
  }
  const banned=new Set([...(lib.connectBanned||[]),...(lib.configOL?.banned||[])]);
  const actual=Object.keys(characters).filter(id=>!banned.has(id)&&!lib.filter.characterDisabled(id,characters)&&(!options.predicate||options.predicate(id,lib.character[id])));
  const allowed=new Set(actual),aliases=lib.characterReplace||{},canonical=new Map();
  for(const [family,variants] of Object.entries(aliases)){
    if(!Array.isArray(variants))continue;
    for(const id of variants)if(allowed.has(id)&&!canonical.has(id))canonical.set(id,family);
  }
  let result=actual;
  if(ids!==undefined){
    const requested=new Set();
    for(const id of ids){
      if(allowed.has(id))requested.add(id);
      if(Array.isArray(aliases[id]))for(const variant of aliases[id])if(allowed.has(variant))requested.add(variant);
    }
    result=actual.filter(id=>requested.has(id));
  }
  return options.canonical?unique(result.map(id=>canonical.get(id)||id)):result;
}

export function replaceCandidates(array,pool){
  if(!Array.isArray(array)||!Array.isArray(pool)||pool.some(id=>typeof id!=='string'))throw TypeError('Character candidates must be string arrays');
  const replacement=unique(pool);
  if(!replacement.length)throw Error('No legal characters remain for this selection');
  array.splice(0,array.length,...replacement);
  return array;
}

// Parse only native character dialog descriptors, never arbitrary nested state
// such as results, rosters, bans, or replacement lists.
export function characterGroups(payload){
  const groups=[],seen=new Set();
  function dialog(value){
    if(!Array.isArray(value))return;
    const descriptors=Array.isArray(value[0])&&['character','characterx'].includes(value[1])?[value]:value;
    for(const entry of descriptors){
      if(!Array.isArray(entry)||!Array.isArray(entry[0])||!['character','characterx'].includes(entry[1]))continue;
      if(entry[0].some(id=>typeof id!=='string')||seen.has(entry[0]))continue;
      seen.add(entry[0]);groups.push({ids:entry[0],kind:entry[1],dialog:value});
    }
  }
  if(object(payload)){
    dialog(payload.createDialog);
    if(Array.isArray(payload._args))for(const arg of payload._args)dialog(arg);
  }else if(Array.isArray(payload)){
    dialog(payload);
    for(const arg of payload){
      if(object(arg)&&Object.hasOwn(arg,'createDialog'))dialog(arg.createDialog);
      else dialog(arg);
    }
  }
  return groups;
}

export function setChoiceValue(event,key,value){
  if(typeof event.set==='function')event.set(key,value);
  else event[key]=value;
  return value;
}

function parentOf(event){return event?.parent;}
function contains(root,event){
  const seen=new Set();
  while(event&&!seen.has(event)){
    if(event===root)return true;
    seen.add(event);event=parentOf(event);
  }
  return false;
}

export function installFreeCharacterChoice(nnk,lease,adapters=[]){
  if(!ownedHost(lease))return inactive;
  const env=nnk?.env,{game,lib,_status}=env||{};
  if(!game||!lib||!_status)throw Error('Native event environment is unavailable');
  const previous=installations.get(game);
  if(previous?.current())return previous.api;
  previous?.api.dispose();
  if(!Array.isArray(adapters)||adapters.some(adapter=>!adapter?.id||typeof adapter.matchesRoot!=='function'))throw TypeError('Invalid free-character adapter');
  const events=game.globalEventHandlers;
  if(typeof events?.pushHandler!=='function'||typeof events?.removeHandler!=='function'||typeof game.broadcastAll!=='function'||typeof lib.announce?.subscribe!=='function'||typeof lib.announce?.unsubscribe!=='function')throw Error('Native character selection hooks are unavailable');
  const options=installFreeCharacterOptions(nnk,lease),diagnostics=[],contexts=new Map(),handledChoices=new WeakSet(),bindings=[];
  let disposed=false,broadcastDepth=0,registeredHandlers=0,announceOwned=false,pagehideOwned=false,offInvalidated=null;
  let failed=false,failureError=null,failureHandler=null,failureNotified=false,failureRegistration=0;
  const pageWindow=globalThis.window;
  const current=()=>!disposed&&ownedHost(lease)&&nnk.env===env&&env.game===game&&env.lib===lib;
  const enabled=()=>!failed&&current()&&options.enabled()&&_status.connectMode===true&&game.online!==true;
  const activeEvent=()=>_status.eventManager?.getStatusEvent?.()||_status.event;
  function report(ctx,code,detail){diagnostics.push({mode:ctx?.mode||lib.configOL?.mode,adapter:ctx?.adapter?.id||null,stage:ctx?.stage??null,code,detail:detail??null});}
  function notifyFailure(){
    if(!failed||failureNotified||!failureHandler||!current())return;
    failureNotified=true;
    try{
      const result=failureHandler(failureError);
      if(result&&typeof result.then==='function')result.catch(error=>report(null,'failure-notification-error',error?.message||String(error)));
    }catch(error){report(null,'failure-notification-error',error?.message||String(error));}
  }
  function fail(ctx,error,method,code='adapter-error'){
    if(failed)return;
    failed=true;failureError=error instanceof Error?error:Error(String(error));
    report(ctx,code,{method,message:failureError.message});
    if(current()&&_status.connectMode===true&&game.online!==true){
      try{
        if(typeof game.pause!=='function')throw Error('Native pause is unavailable');
        game.pause();report(ctx,'selection-paused',null);
      }catch(pauseError){report(ctx,'selection-pause-error',pauseError?.message||String(pauseError));}
      notifyFailure();
      if(!failureNotified){
        report(ctx,'failure-handler-unavailable',failureError.message);
        try{console.error('[联机助手] 自由选将已停止，等待本轮引擎回收',failureError);}catch(consoleError){report(ctx,'failure-console-error',consoleError?.message||String(consoleError));}
      }
    }
  }
  function setFailureHandler(handler){
    if(typeof handler!=='function')throw TypeError('Free character failure handler must be a function');
    if(disposed)return ()=>false;
    const registration=++failureRegistration;
    failureHandler=handler;
    notifyFailure();
    return ()=>{if(failureRegistration!==registration||failureHandler!==handler)return false;failureHandler=null;return true;};
  }
  function invoke(ctx,method,...args){
    if(typeof ctx.adapter[method]!=='function')return;
    try{
      const result=ctx.adapter[method](ctx,...args);
      if(result&&typeof result.then==='function')throw Error('Character event adapters must run synchronously');
      return result;
    }catch(error){fail(ctx,error,method);throw error;}
  }
  function scoped(ctx){return enabled()&&!ctx.closed&&lib.configOL.mode===ctx.mode&&contains(ctx.root,activeEvent());}
  function restore(binding){
    if(!sameDescriptor(own(binding.owner,binding.key),binding.installed))return;
    if(binding.before)Object.defineProperty(binding.owner,binding.key,binding.before);
    else if(!Reflect.deleteProperty(binding.owner,binding.key))throw Error('Unable to remove native character hook: '+binding.key);
  }
  function wrap(owner,key,handler,ctx=null){
    const before=own(owner,key),original=owner?.[key];
    if(typeof original!=='function'||(before&&!Object.hasOwn(before,'value')))throw Error('Unsupported native character hook: '+key);
    function wrapped(...args){
      if(ctx?!scoped(ctx):!enabled())return Reflect.apply(original,this,args);
      try{return handler(original,this,args);}
      catch(error){fail(ctx,error,'native-hook:'+key);throw error;}
    }
    Object.defineProperty(owner,key,before?{...before,value:wrapped}:{value:wrapped,writable:true,enumerable:false,configurable:true});
    const binding={owner,key,before,installed:own(owner,key)};bindings.push(binding);
    if(ctx)ctx.bindings.push(binding);
    return ()=>restore(binding);
  }
  function close(ctx){
    if(ctx.closed)return;
    ctx.closed=true;
    const errors=[];
    try{invoke(ctx,'dispose');}catch(error){errors.push(error);}
    for(const binding of ctx.bindings.slice().reverse())try{restore(binding);}catch(error){errors.push(error);}
    for(const binding of ctx.bindings){const index=bindings.indexOf(binding);if(index>=0)bindings.splice(index,1);}
    ctx.bindings.length=0;
    for(const remove of ctx.handlerRemovers.splice(0))try{remove();}catch(error){errors.push(error);}
    contexts.delete(ctx.root);
    if(errors.length)throw new AggregateError(errors,'Character selection hooks could not be fully restored');
  }
  function contextFor(event){
    for(const ctx of contexts.values())if(!ctx.closed&&contains(ctx.root,event))return ctx;
    return null;
  }
  function onRoot(event,option){
    if(!enabled())return;
    let ctx=contexts.get(event);
    if(option?.state==='begin'&&!ctx){
      if(!rootNames.has(event.name)||contextFor(parentOf(event)))return;
      const mode=lib.configOL.mode;
      if(!FREE_CHOICE_MODES.includes(mode))return;
      let matches;
      try{matches=adapters.filter(adapter=>adapter.matchesRoot(event,env));}
      catch(error){fail(null,error,'matchesRoot');throw error;}
      if(matches.length!==1){
        const error=Error('Free character selection has no unique adapter for '+mode);
        fail(null,error,'matchesRoot','unsupported-selection');throw error;
      }
      ctx={env,root:event,mode,submode:lib.configOL[mode+'_mode']??_status.mode??'normal',adapter:matches[0],basePool:null,stage:null,ledger:new Map(),data:{},bindings:[],handlerRemovers:[],closed:false};
      ctx.legalPool=(ids,poolOptions)=>legalCharacterPool(env,ids,poolOptions);
      ctx.expandedCandidates=new WeakSet();
      ctx.replaceCandidates=(array,pool)=>{const result=replaceCandidates(array,pool);ctx.expandedCandidates.add(array);return result;};ctx.characterGroups=characterGroups;
      ctx.isActive=()=>scoped(ctx);
      ctx.report=(code,detail)=>report(ctx,code,detail);
      ctx.wrap=(owner,key,handler)=>wrap(owner,key,handler,ctx);
      ctx.addHandler=(target,handler)=>{
        if(typeof target?.pushHandler!=='function'||typeof target?.getHandler!=='function'||typeof handler!=='function')throw Error('Native event instance handler is unavailable');
        function wrappedHandler(...args){
          if(!scoped(ctx))return;
          try{
            const result=Reflect.apply(handler,this,args);
            if(result&&typeof result.then==='function')throw Error('Character instance handlers must run synchronously');
            return result;
          }catch(error){fail(ctx,error,'instance-handler');throw error;}
        }
        target.pushHandler(wrappedHandler);
        const remove=()=>{const handlers=target.getHandler(),index=handlers.indexOf(wrappedHandler);if(index>=0)handlers.splice(index,1);};
        ctx.handlerRemovers.push(remove);return remove;
      };
      contexts.set(event,ctx);
      try{invoke(ctx,'begin');}catch(error){close(ctx);throw error;}
    }
    if(ctx&&option?.state==='end'){
      invoke(ctx,'afterStep',event,option);
      if(event.finished)close(ctx);
    }
  }
  function onChoose(event,option){
    if(option?.state!=='begin'||!enabled()||handledChoices.has(event))return;
    const ctx=contextFor(event);
    if(!ctx)return;
    handledChoices.add(event);invoke(ctx,'beforeChoose',event);
    const expanded=payload=>ctx.characterGroups(payload).some(group=>ctx.expandedCandidates.has(group.ids));
    if(event.name==='chooseButtonOL'&&Array.isArray(event.list)){
      for(const row of event.list)if(expanded(row))markFreeCharacterPickerRow(row,ctx.mode);
    }else if(event.name==='chooseButton'){
      const nativeShared=event.parent===ctx.root&&ctx.mode==='versus'&&ctx.submode==='1v1'&&ctx.stage==='draft'&&
        ctx.data.dialogReady===true&&event.player===ctx.root.choosing&&event.dialog===undefined&&Array.isArray(event.selected)&&
        Array.isArray(event._args)&&event._args.length===3&&Number.isSafeInteger(ctx.root.videoId)&&
        event._args[0]===ctx.root.videoId&&event._args[1]===1&&event._args[2]===true&&env.ui?.dialog?.videoId===ctx.root.videoId;
      const shared=event.parent===ctx.root&&typeof event.dialog==='number'&&
        [ctx.root.videoId,ctx.root.videoIdx].includes(event.dialog)&&
        (ctx.mode==='single'&&['normal','changban'].includes(ctx.submode)&&ctx.stage==='draft'&&Array.isArray(event.canChoose)||
          ctx.mode==='versus'&&ctx.submode==='1v1'&&ctx.stage==='draft'&&Array.isArray(event.selected)||
          ctx.mode==='versus'&&ctx.submode==='4v4'&&Array.isArray(event.nnkFreeCandidates));
      if(expanded(event)||shared||nativeShared)markFreeCharacterPickerEvent(event,ctx.mode);
    }
  }
  function onChanged([event]){
    for(const ctx of [...contexts.values()])if(ctx.root.finished&&!contains(ctx.root,event))close(ctx);
  }
  function onPagehide(){dispose();}
  function onInvalidated(detail){
    const scope=lease.info?.scope,fields=['sessionId','roundId','documentGeneration','bindingId','bindingNonce','expectedOrigin'];
    if(!current()||(scope&&fields.every(key=>scope[key]!==undefined&&scope[key]===detail?.scope?.[key])))dispose();
  }
  function dispose(){
    if(disposed)return false;
    disposed=true;
    failureHandler=null;
    const errors=[];
    for(const ctx of [...contexts.values()])try{close(ctx);}catch(error){errors.push(error);}
    for(const name of rootNames)try{events.removeHandler(name,undefined,onRoot);}catch(error){errors.push(error);}
    for(const name of choiceNames)try{events.removeHandler(name,undefined,onChoose);}catch(error){errors.push(error);}
    registeredHandlers=0;
    try{lib.announce.unsubscribe('Noname.Game.Event.Changed',onChanged);}catch(error){errors.push(error);}
    announceOwned=false;
    if(pagehideOwned)try{pageWindow.removeEventListener('pagehide',onPagehide);}catch(error){errors.push(error);}
    pagehideOwned=false;
    if(offInvalidated)try{offInvalidated();}catch(error){errors.push(error);}
    offInvalidated=null;
    for(const binding of bindings.slice().reverse())try{restore(binding);}catch(error){errors.push(error);}
    bindings.length=0;
    try{options.dispose();}catch(error){errors.push(error);}
    if(installations.get(game)?.api===api)installations.delete(game);
    if(errors.length)throw new AggregateError(errors,'Free character selection could not be fully disposed');
    return true;
  }
  function resourceSnapshot(){
    const ownedInstanceHandlers=[...contexts.values()].reduce((count,ctx)=>count+ctx.handlerRemovers.length,0);
    // Native constructors copy global handlers into event instances. Unobserved
    // copies cannot be enumerated here; they become inert on disposal and are
    // reclaimed with their document. These counts describe owned registrations.
    return {contexts:contexts.size,bindings:bindings.length,eventHandlers:registeredHandlers+ownedInstanceHandlers,registeredEventHandlers:registeredHandlers,ownedInstanceHandlers,nativeHandlerCopiesObservable:false,announceListeners:Number(announceOwned),pagehideListeners:Number(pagehideOwned),invalidationListeners:Number(offInvalidated!==null),failureHandlerListeners:Number(failureHandler!==null),failed,timers:0};
  }
  const api=Object.freeze({installed:true,dispose,setFailureHandler,diagnostics,resourceSnapshot});
  try{
    for(const name of rootNames){events.pushHandler(name,onRoot);registeredHandlers++;}
    for(const name of choiceNames){events.pushHandler(name,onChoose);registeredHandlers++;}
    lib.announce.subscribe('Noname.Game.Event.Changed',onChanged);
    announceOwned=true;
    if(typeof pageWindow?.addEventListener==='function'&&typeof pageWindow?.removeEventListener==='function'){
      pageWindow.addEventListener('pagehide',onPagehide,{once:true});pagehideOwned=true;
    }
    if(typeof lease.native?.onInvalidated==='function'){
      offInvalidated=lease.native.onInvalidated(onInvalidated);
      if(typeof offInvalidated!=='function')throw Error('Native invalidation subscription must provide cleanup');
    }
    wrap(game,'broadcastAll',(original,thisArg,args)=>{
      const ctx=contextFor(activeEvent());
      if(ctx&&!broadcastDepth){broadcastDepth++;try{invoke(ctx,'beforeBroadcast',args);}finally{broadcastDepth--;}}
      return Reflect.apply(original,thisArg,args);
    });
    installations.set(game,{current,api});return api;
  }catch(error){
    try{dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Free character selection installation failed');}
    throw error;
  }
}

import {normalizeSignalingUrl,saveSignalingUrl} from './signaling-config.js';
import {saveConfigValue} from './transfer-limit-config.js';
// Operations run in the captured, real official document, never a carrier env.
export function createEngineOperationPort(nnk,{isCurrent,scope=null,onEvent=()=>{},timeoutMs=10000}={}) {
  if (!nnk?.env || typeof isCurrent!=='function') throw Error('A current official environment and lease guard are required');
  if (!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>10000) throw Error('Invalid operation deadline');
  const env=nnk.env, capturedScope=scope&&Object.freeze({...scope});
  const active=new Map(), nativePending=new Map(), timers=new Set();
  let disposed=false, serial=Promise.resolve(), nextId=0;
  const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function guard(op) { if(disposed||nnk.env!==env||!isCurrent()||op?.retired) throw Error('Retired engine operation'); }
  function resourceSnapshot(){return {disposed,pendingExecutions:active.size,pendingNative:nativePending.size,
    retiredNativePending:[...nativePending.values()].filter(value=>value.retired).length,
    timers:timers.size,scope:capturedScope,nativePendingKinds:[...nativePending.values()].map(value=>({kind:value.kind,retired:value.retired,timedOut:value.timedOut})),
    limits:'Native save/getDB work is not cancellable. A missing callback remains pending until it actually completes or the native document is destroyed.'};}
  async function emit(name,data,op){guard(op);await op.onEvent(name,clone(data));guard(op);}
  function nativeWait(op,kind,start) {
    guard(op);
    const token=++nextId, record={kind,retired:false,timedOut:false};nativePending.set(token,record);
    return new Promise((resolve,reject)=>{
      let settled=false,nativeDone=false,timer;
      function finish(error,value) {
        if(settled)return;settled=true;
        clearTimeout(timer);timers.delete(timer);op.cancels.delete(cancel);
        if(error)reject(error);else resolve(value);
      }
      function cancel(){record.retired=true;finish(Error('Retired engine operation'));}
      function callback(error,value){
        if(!nativeDone){nativeDone=true;nativePending.delete(token);}
        if(settled)return;
        try{guard(op);if(error)throw error;finish(null,value);}catch(failure){finish(failure);}
      }
      timer=setTimeout(()=>{record.timedOut=true;finish(Error(kind+' deadline exceeded'));},timeoutMs);timers.add(timer);op.cancels.add(cancel);
      try { guard(op);start(callback); }
      catch(error){callback(error);}
    });
  }
  async function saveVerified(op,key,value,local=false) {
    guard(op);
    if(typeof env.game.saveConfig!=='function'||typeof env.game.getDB!=='function'||!env.lib.db) throw Error('Real config persistence and database are unavailable');
    const storedKey=key+(local?'_mode_config_'+(typeof local==='string'?local:env.lib.config.mode):'');
    await nativeWait(op,'saveConfig:'+storedKey,done=>{
      // Official saveConfig returns undefined. Its fourth callback is the real
      // completion boundary; desired lib.config mutation is not that boundary.
      env.game.saveConfig(key,value,local,()=>done(null));
    });
    guard(op);
    const observed=await nativeWait(op,'getDB:'+storedKey,done=>{
      const pending=env.game.getDB('config',storedKey,result=>done(null,result),error=>done(error instanceof Error?error:Error('Config database read failed')));
      if(pending&&typeof pending.then==='function')pending.then(result=>done(null,result),error=>done(error));
    });
    guard(op);
    if(!equal(observed,value)) throw Error('Persisted configuration mismatch: '+storedKey);
    return {key,storedKey,value:clone(observed),deleted:value===undefined};
  }
  function profile(){
    const config=nnk.modules.config, keys=Object.keys(config?.defaults||{}), values={};
    for(const key of keys)values[key]=clone(config.get(key));
    return {config:values,identity:{name:env.get.connectNickname(),avatar:env.lib.config.connect_avatar||'',
      connectNickname:env.lib.config.connect_nickname||''},version:env.lib.version};
  }
  async function perform(action,args,op){
    guard(op);const config=nnk.modules.config, compat=nnk.modules.compat, manifest=nnk.modules.manifest;
    if(action==='get_config'||action==='config.get'||action==='profile')return profile();
    if(action==='set_config'||action==='config.set'){
      const allowed={unlockUIExtensions:'boolean',autoUnlockExtensions:'boolean',autoTransfer:'boolean',mqttUrl:'string',transferLimitMB:'number'};
      if(!Object.hasOwn(allowed,args.key))throw Error('不允许修改的配置: '+args.key);
      if(args.key==='autoTransfer'&&typeof args.value!=='boolean')throw Error('自动补传开关必须为布尔值');
      let value=args.value===true;
      if(allowed[args.key]==='number'){
        if(!Number.isSafeInteger(args.value)||args.value<1||args.value>1024)throw Error('补传容量须为 1 至 1024 MiB 的整数');
        value=args.value;
      }
      if(allowed[args.key]==='string'){
        if(args.requestId!==undefined&&(typeof args.requestId!=='string'||!args.requestId.length||args.requestId.length>160||/[\x00-\x1f\x7f]/.test(args.requestId)))throw Error('信令地址保存请求标识无效');
        value=normalizeSignalingUrl(args.value);
      }
      let persistence;
      if(args.key==='mqttUrl'&&!env.lib.db){
        persistence=await saveSignalingUrl({profile:{configStorage:{prefix:env.lib.configprefix,useDB:false}},value,isCurrent:()=>{guard(op);return true;},timeoutMs});
        guard(op);env.lib.config.nnk_mqttUrl=value;
      }else if(args.key==='autoTransfer'&&!env.lib.db){
        persistence=await saveConfigValue({profile:{configStorage:{prefix:env.lib.configprefix,useDB:false}},key:'nnk_autoTransfer',value,isCurrent:()=>{guard(op);return true;},timeoutMs});
        guard(op);env.lib.config.nnk_autoTransfer=value;
      }else persistence=await saveVerified(op,'nnk_'+args.key,value);
      guard(op);
      const actual=config.get(args.key);if(!equal(actual,value))throw Error('Current configuration differs from persisted readback');
      const valueProfile=profile();await emit('config_applied',{key:args.key,value:actual,profile:valueProfile,...(args.key==='mqttUrl'&&args.requestId?{requestId:args.requestId}:{})},op);
      return {persistence,profile:valueProfile};
    }
    if(action==='set_identity'||action==='identity.set'){
      if(!compat?.applyIdentity||!compat.hasCharacter)throw Error('Current identity compatibility module unavailable');
      const name=String(args.name||'').slice(0,12),avatar=String(args.avatar||'').slice(0,24);
      if(avatar&&!compat.hasCharacter(avatar))throw Error('头像武将「'+avatar+'」本机没有(扩展未装或未启用)');
      const persistence=[];
      persistence.push(await saveVerified(op,'nnk_onlineName',name));guard(op);
      persistence.push(await saveVerified(op,'nnk_onlineAvatar',avatar));guard(op);
      // Preserve applyIdentity's existing user-override and empty-value policy.
      compat.applyIdentity();guard(op);
      const nickname=env.lib.config.connect_nickname,actualAvatar=env.lib.config.connect_avatar;
      for(const [key,value] of [['connect_nickname',nickname],['connect_avatar',actualAvatar]]){
        persistence.push(await saveVerified(op,key,value));guard(op);
        persistence.push(await saveVerified(op,key,value,'connect'));guard(op);
      }
      for(const key of ['identityStamped','avatarStamped'])if(env.lib.config['nnk_'+key]!==undefined){
        persistence.push(await saveVerified(op,'nnk_'+key,env.lib.config['nnk_'+key]));guard(op);
      }
      const applied=profile();await emit('identity_applied',{name:applied.identity.name,avatar:applied.identity.avatar,
        avatarLabel:env.lib.translate?.[applied.identity.avatar]||applied.identity.avatar,profile:applied},op);
      return {requested:{name,avatar},applied:applied.identity,persistence,profile:applied};
    }
    if(action==='clear_quarantine'||action==='compat.clearQuarantine'){
      if(!compat?.clearQuarantine)throw Error('Current compatibility module unavailable');
      compat.clearQuarantine();guard(op);
      const persistence=await saveVerified(op,'nnk_unlockBlock',[]);guard(op);return {persistence,profile:profile()};
    }
    if(action==='compat_snapshot'||action==='compat.snapshot'){
      compat?.dumpExtensions?.();guard(op);return {profile:profile(),extensions:clone(env.lib.config.extensions||[])};
    }
    if(action==='manifest_recheck'||action==='manifest.recheck'){
      if(!manifest?.recheck)throw Error('Current manifest module unavailable');
      manifest.recheck();guard(op);return {requested:true,verification:'pending; actual module events supply the result',resources:manifest.resourceSnapshot?.()||null};
    }
    if(action==='manifest_fresh'||action==='health_fresh'||action==='manifest.fresh'){
      if(!manifest?.observed)throw Error('Current manifest module unavailable');
      const controller=new AbortController(),cancel=()=>controller.abort(Error('Retired engine operation'));op.cancels.add(cancel);
      let inventory;try{inventory=manifest.observedAsync?await manifest.observedAsync(true,controller.signal):manifest.observed(true);}finally{op.cancels.delete(cancel);}guard(op);
      return {inventory:clone(inventory),verification:inventory.inventoryError?'unverified':'local inventory only',admissionGate:false};
    }
    if(action==='host-policy'){
      const persistence=[];
      for(const key of ['check_versionLocal','check_extension']){persistence.push(await saveVerified(op,key,false,'connect'));guard(op);}
      return {persistence};
    }
    throw Error('Unknown current engine operation: '+action);
  }
  function execute(action,args={},operationEvent=onEvent){
    try{guard();if(typeof action!=='string'||active.size>=16)throw Error('Invalid or saturated current operation');}
    catch(error){return Promise.reject(error);}
    const op={id:++nextId,retired:false,cancels:new Set(),onEvent:operationEvent};active.set(op.id,op);
    // Serialize actual writes, including calls from the ordinary HTTP bridge.
    const result=serial.then(()=>{guard(op);return perform(action,clone(args)||{},op);});
    serial=result.catch(()=>{});
    return result.finally(()=>{active.delete(op.id);});
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const op of active.values()){op.retired=true;for(const cancel of [...op.cancels])cancel();}
    for(const value of nativePending.values())value.retired=true;
    for(const timer of timers)clearTimeout(timer);timers.clear();
  }
  return {execute,pendingSnapshot:resourceSnapshot,dispose,scope:capturedScope};
}

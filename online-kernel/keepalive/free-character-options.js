export const FREE_CHOICE_MODES=Object.freeze(['identity','guozhan','versus','doudizhu','single']);
export const FREE_CHOICE_CONFIG_KEY='connect_nnk_free_choose';
export const FREE_CHOICE_ROOM_KEY='nnk_free_choose';

const installations=new WeakMap();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(owner,key)=>Object.getOwnPropertyDescriptor(owner,key);
const sameDescriptor=(a,b)=>!!a&&!!b&&a.value===b.value&&a.get===b.get&&a.set===b.set&&a.writable===b.writable&&a.enumerable===b.enumerable&&a.configurable===b.configurable;
const inactive=Object.freeze({installed:false,enabled:()=>false,dispose:()=>false});
function ownedHost(lease){
  try{return lease?.info?.role==='engine'&&lease.info.engineRole==='host'&&lease.isCurrent?.()===true;}
  catch{return false;}
}
function dataValue(owner,key,label){
  const descriptor=own(owner,key);
  if(descriptor&&!Object.hasOwn(descriptor,'value'))throw Error('Unsupported native '+label+' accessor');
  return descriptor?.value;
}

// Native connect menus persist these options per mode and copy them to configOL.
export function installFreeCharacterOptions(nnk,lease){
  if(!ownedHost(lease))return inactive;
  const env=nnk?.env,lib=env?.lib;
  if(!object(lib)||!object(lib.mode)||!object(lib.config))throw Error('Native mode configuration is unavailable');
  const modes=lib.mode,config=lib.config,previous=installations.get(lib);
  if(previous?.current())return previous.api;
  previous?.api.dispose();
  const schemas=FREE_CHOICE_MODES.map(mode=>{
    const entry=dataValue(modes,mode,'mode entry');
    if(!object(entry))throw Error('Native mode entry is unavailable: '+mode);
    const schema=dataValue(entry,'connect','connect schema');
    if(!object(schema))throw Error('Native connect schema is unavailable: '+mode);
    for(const key of Object.keys(schema)){
      const value=schema[key];
      if(key==='update'&&typeof value==='function')continue;
      if(!key.startsWith('connect_')||!object(value))throw Error('Unsupported native connect option: '+mode+'.'+key);
    }
    return {mode,schema};
  });
  let disposed=false;
  const changes=[];
  const current=()=>!disposed&&ownedHost(lease)&&nnk.env===env&&env.lib===lib&&lib.mode===modes&&lib.config===config;
  function replace(owner,key,value,container=false){
    const before=own(owner,key);
    if(before&&!Object.hasOwn(before,'value'))throw Error('Unsupported native configuration accessor: '+key);
    const descriptor=before?{...before,value}:{value,writable:true,enumerable:true,configurable:true};
    Object.defineProperty(owner,key,descriptor);
    changes.push({owner,key,before,installed:own(owner,key),container});
  }
  function dispose(){
    if(disposed)return false;
    disposed=true;
    const errors=[];
    for(const change of changes.slice().reverse()){
      try{
        if(!sameDescriptor(own(change.owner,change.key),change.installed))continue;
        if(change.container&&Reflect.ownKeys(change.installed.value).length)continue;
        if(change.before)Object.defineProperty(change.owner,change.key,change.before);
        else if(!Reflect.deleteProperty(change.owner,change.key))throw Error('Unable to remove owned native option: '+change.key);
      }catch(error){errors.push(error);}
    }
    if(installations.get(lib)?.api===api)installations.delete(lib);
    if(errors.length)throw new AggregateError(errors,'Native free-character options could not be fully restored');
    return true;
  }
  const api=Object.freeze({installed:true,enabled:()=>current()&&FREE_CHOICE_MODES.includes(lib.configOL?.mode)&&lib.configOL?.[FREE_CHOICE_ROOM_KEY]===true,dispose});
  try{
    if(!current())throw Error('Owned host document retired before option installation');
    let settings=dataValue(config,'mode_config','mode configuration');
    if(settings===undefined){settings={};replace(config,'mode_config',settings,true);}
    else if(!object(settings))throw Error('Native mode configuration has an unsupported shape');
    for(const {mode,schema} of schemas){
      replace(schema,FREE_CHOICE_CONFIG_KEY,{name:'自由选将',init:false,connect:true,frequent:true,
        intro:'从本局启用且未禁用的合法武将中自由选择；允许不同玩家选择同一武将，保留当前玩法的人数、阵营、双将、征召、禁选和替补规则。'});
      let values=dataValue(settings,mode,'mode settings');
      if(values===undefined){values={};replace(settings,mode,values,true);}
      else if(!object(values))throw Error('Native mode settings have an unsupported shape: '+mode);
      // Give every mode the same explicit default before continuation digests run.
      if(!own(values,FREE_CHOICE_CONFIG_KEY))replace(values,FREE_CHOICE_CONFIG_KEY,false);
      else dataValue(values,FREE_CHOICE_CONFIG_KEY,'free-character setting');
    }
    if(!current())throw Error('Owned host document retired during option installation');
    installations.set(lib,{current,api});return api;
  }catch(error){
    try{dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Native free-character option installation failed');}
    throw error;
  }
}

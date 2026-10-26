const KEY='nnk_transferLimitMB';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function validTransferLimit(value){return Number.isSafeInteger(value)&&value>=1&&value<=1024;}
export async function saveTransferLimit({profile,value,indexedDB,storage,isCurrent,timeoutMs}={}){
 if(!validTransferLimit(value))throw Error('补传容量须为 1 至 1024 MiB 的整数');
 return await saveConfigValue({profile,value,indexedDB,storage,isCurrent,timeoutMs,key:KEY});
}
// Fixed local configuration fields only; callers cannot select arbitrary game keys.
export async function saveConfigValue({profile,key,value,indexedDB,storage,isCurrent=()=>true,timeoutMs=10000}={}){
 if(![KEY,'nnk_mqttUrl'].includes(key))throw Error('不允许修改的游戏配置字段');
 if(key===KEY&&!validTransferLimit(value))throw Error('补传容量须为 1 至 1024 MiB 的整数');
 if(key==='nnk_mqttUrl'&&typeof value!=='string')throw Error('信令服务器地址必须是字符串');
 const label=key===KEY?'补传容量':'信令服务器地址';
 const config=profile?.configStorage;
 if(!plain(config)||typeof config.prefix!=='string'||!config.prefix.length||config.prefix.length>160||/[\x00-\x1f\x7f]/.test(config.prefix)||typeof config.useDB!=='boolean')throw Error('缺少当前游戏的配置存储信息');
 if(typeof isCurrent!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw Error(label+'保存参数无效');
 const current=()=>{if(!isCurrent())throw Error('原'+label+'设置操作已失效');};
 current();
 if(!config.useDB){
  const local=storage===undefined?globalThis.localStorage:storage;
  if(typeof local?.getItem!=='function'||typeof local?.setItem!=='function')throw Error('当前环境无法访问游戏配置');
  const storageKey=config.prefix+'config';let live;
  try{live=JSON.parse(local.getItem(storageKey));}catch{throw Error('原游戏配置无法读取');}
  if(!plain(live))throw Error('原游戏配置格式无效');
  current();live[key]=value;local.setItem(storageKey,JSON.stringify(live));
  let actual;try{actual=JSON.parse(local.getItem(storageKey));}catch{}
  if(!plain(actual)||actual[key]!==value)throw Error(label+'保存读回不一致');
  current();
  return {saved:true,value,storage:'localstorage'};
 }
 const factory=indexedDB===undefined?globalThis.indexedDB:indexedDB;
 return new Promise((resolve,reject)=>{
  let ended=false,database=null,transaction=null;
  const timer=setTimeout(()=>{try{transaction?.abort();}catch{}finish(Error(label+'配置保存超时'));},timeoutMs);
  function finish(error){if(ended)return;ended=true;clearTimeout(timer);try{database?.close();}catch{}if(error)reject(error);else resolve({saved:true,value,storage:'indexeddb'});}
  function readBack(){
   if(ended)return;
   try{current();transaction=database.transaction(['config'],'readonly');const read=transaction.objectStore('config').get(key);let actual;
    read.onsuccess=()=>{actual=read.result;};transaction.onerror=()=>{};transaction.onabort=()=>finish(Error(label+'读回失败'));
    transaction.oncomplete=()=>{try{current();if(actual!==value)throw Error(label+'保存读回不一致');finish();}catch(error){finish(error);}};
   }catch(error){finish(error);}
  }
  try{
   if(typeof factory?.open!=='function')throw Error('当前环境无法访问游戏配置数据库');
   const request=factory.open(config.prefix+'data');
   request.onupgradeneeded=()=>{try{request.transaction?.abort();}catch{}finish(Error('未找到当前游戏的配置数据库'));};
   request.onblocked=()=>finish(Error('游戏配置数据库被占用'));request.onerror=()=>finish(Error('无法打开游戏配置数据库'));
   request.onsuccess=()=>{
    database=request.result;if(ended){try{database.close();}catch{}return;}
    try{current();if(!database.objectStoreNames.contains('config'))throw Error('游戏配置数据库缺少 config 存储区');
     transaction=database.transaction(['config'],'readwrite');const store=transaction.objectStore('config');
     if(store.keyPath!==null||store.autoIncrement)throw Error('游戏配置存储格式与当前版本不一致');
     current();const write=store.put(value,key);
     if(write)write.onsuccess=()=>{try{current();}catch(error){try{transaction.abort();}catch{}finish(error);}};
     transaction.onerror=()=>{};transaction.onabort=()=>finish(Error(label+'未保存'));transaction.oncomplete=readBack;
    }catch(error){try{transaction?.abort();}catch{}finish(error);}
   };
  }catch(error){finish(error);}
 });
}

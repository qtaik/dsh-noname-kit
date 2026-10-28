// NNK routing runs in extension precontent, before ordinary boot resumes.
const fs=require('node:fs'),path=require('node:path');
function assertCurrent(lease){if(!lease.isCurrent())throw Error('NNK startup Document retired');}
function saveAndRead(nnk,lease,key,value){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Configuration cleanup deadline: '+key)),10000);
    try{
      assertCurrent(lease);
      nnk.env.game.saveConfig(key,value,null,()=>{
        try{assertCurrent(lease);}catch(error){clearTimeout(timer);reject(error);return;}
        Promise.resolve(nnk.env.game.getDB('config',key)).then(actual=>{
          assertCurrent(lease);
          if(actual!==value)throw Error('Configuration cleanup readback mismatch: '+key);
          clearTimeout(timer);resolve();
        }).catch(error=>{clearTimeout(timer);reject(error);});
      });
    }catch(error){clearTimeout(timer);reject(error);}
  });
}
export async function prepareEngine(nnk,lease){
  if(lease.info.role!=='engine')return;
  assertCurrent(lease);
  const {lib}=nnk.env;
  // Boot this owned Document at the idle native online entry, so no saved
  // offline game event competes with the later current-round preparation.
  // These overrides leave saved user mode/splash preferences intact.
  lib.config.mode='connect';
  lib.config.show_splash='off';
  delete lib.config.directstartmode;
  // Only round/reentry markers; original safety/debug configuration is retained.
  for(const key of ['nnk_guest_pending','nnk_guest_reentry','nnk_host_game','nnk_host_pending','directstart'])localStorage.removeItem(lib.configprefix+key);
  for(const key of ['reconnect_info','tmp_user_roomId'])delete lib.config[key];
  await saveAndRead(nnk,lease,'reconnect_info',undefined);assertCurrent(lease);
  await saveAndRead(nnk,lease,'tmp_user_roomId',undefined);assertCurrent(lease);
}
function profile(nnk,lease){
  assertCurrent(lease);
  const config={};for(const key of Object.keys(nnk.modules.config.defaults))config[key]=nnk.modules.config.get(key);
  const file=path.join(lease.info.root,'extension','联机助手','nnk-bridge.json');
  const bridge=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  return {version:nnk.env.lib.version,build:nnk.build||null,root:lease.info.root,origin:lease.info.origin,config,configStorage:{prefix:nnk.env.lib.configprefix,useDB:!!nnk.env.lib.db},
    identity:{connectNickname:nnk.env.lib.config.connect_nickname,connectAvatar:nnk.env.lib.config.connect_avatar},
    inventory:nnk.modules.manifest?.collect?.()||null,stockExtensions:[...(nnk.env.lib.config.all?.stockextension||[])],stockPlays:[...(nnk.env.lib.config.all?.plays||[])],bridge};
}
export async function install(nnk,lease){
  const {native,info}=lease;let transition=null;
  nnk.keepaliveEntry={role:info.role,classification:info,documentToken:lease.documentToken,
    async beginCarrier(command,context=nnk.modules.bridge.captureContext?.()){
      if(info.role!=='ordinary')throw Error('Only an actual ordinary document may begin a carrier');
      if(transition)throw Error('A carrier transition is already pending');
      assertCurrent(lease);
      const first={...command,requestId:command.requestId||command.id||crypto.randomUUID()};
      transition={stage:'awaiting-ordinary-operations'};
      let accepted;
      // Acceptance intentionally retires ordinary validation. Check the local
      // Document lifetime and actual location before navigating its one ticket.
      try{
        await nnk.modules.bridge.beforeTransition();assertCurrent(lease);
        if(context&&!context.isCurrent())throw Error('原绑定的联机入口操作已失效');
        transition=native.request('beginCarrier',[info.bootCapability,profile(nnk,lease),first]);
        accepted=await transition;
        if(context&&!context.isCurrent())throw Error('原绑定的联机入口操作已失效');
        if(!lease.isDocumentAlive()||location.origin!==info.origin)throw Error('Ordinary transition source changed');
        await nnk.modules.bridge.stop('keepalive carrier transition');
        if(!lease.isDocumentAlive()||location.origin!==info.origin)throw Error('Ordinary transition source changed');
        location.assign(accepted.carrierURL);return accepted;
      }catch(error){
        if(accepted&&lease.isDocumentAlive())try{await native.request('cancelCarrierTransition',[accepted.transitionTicket]);}catch(cleanupError){console.error('[联机助手] 载体过渡清理失败',cleanupError);}
        transition=null;throw error;
      }
    }};
  if(!['ordinary','engine'].includes(info.role))return;
  let timer=setInterval(()=>{
    if(!lease.isCurrent()){clearInterval(timer);timer=null;return;}
    if(nnk.state.bootStage!=='ready'||nnk.env.lib.onload!==undefined||nnk.env._status.extensionLoading!==undefined||
      document.readyState!=='complete')return;
    // Ordinary documents can bridge from mode selection; engine endpoints need an actual arena.
    if(info.role==='engine'&&!nnk.env.ui.window?.isConnected)return;
    if(sessionStorage.getItem('isJITReloaded')!=='true'||!['true','false'].includes(sessionStorage.getItem('canUseTs')))return;
    clearInterval(timer);timer=null;
    if(info.role==='ordinary'){
      nnk.modules.bridge.init().catch(error=>console.error('[联机助手] 普通入口桥启动失败',error));
      return;
    }
    import('./engine-endpoint.js').then(module=>{
      assertCurrent(lease);return module.attachEngine(nnk,{native,info:{...info,role:info.engineRole,engineRoot:info.root}});
    }).catch(error=>{console.error('[联机助手] 当前引擎端点失败',error);native.report(info.scope,{type:'endpoint-failure',error:String(error)}).catch(reportError=>console.error('[联机助手] 失效端点报告',reportError));});
  },80);
  window.addEventListener('pagehide',()=>{if(timer!==null)clearInterval(timer);timer=null;},{once:true});
}

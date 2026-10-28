import {CarrierRuntime} from './carrier-runtime.js';
const path=require('node:path'),fs=require('node:fs'),ipc=require('electron').ipcRenderer;
// The original node initializer sets game __dirname only in index documents.
// A pure carrier first loads the already-installed primary service, which then
// classifies this actual window and supplies its registered actor root.
const root=path.join(process.resourcesPath,'app');
const native=require(path.join(root,'extension/联机助手/lib/keepalive-bootstrap.cjs')).connect({root,window,document});
const info=native.classifySync();
if(info.role!=='carrier')throw Error('NNK carrier requires an actual assigned native owner');
const metadata=fs.readFileSync(path.join(info.root,'extension/联机助手/extension.js'),'utf8');
const version=/version: "([^"]+)"/.exec(metadata)?.[1],build=/build: "([^"]+)"/.exec(metadata)?.[1];
const boot=await native.carrierStarted(crypto.randomUUID()),profile=boot.profile;
const nnk=window.__nnk__={version,build,modules:{},state:{bootStage:'carrier-loading',transferPaused:true},env:null,networkProfile:profile};
nnk.modules.config={defaults:structuredClone(profile.config),get:key=>profile.config[key],set(){throw Error('配置须由当前游戏文档确认落盘');}};
await new Promise(resolve=>{const script=document.createElement('script');script.src='../lib/mqtt.min.js';script.onload=script.onerror=resolve;document.head.appendChild(script);});
if(!window.mqtt&&typeof module==='object'&&typeof module.exports?.connect==='function')window.mqtt=module.exports;
for(const name of ['rtc','signaling','host','guest','bridge'])await import('../src/'+name+'.js');
const display=(text,error=false)=>{document.getElementById(error?'notice':'status').textContent=text;};
const runtime=new CarrierRuntime({nnk,native,ipc,profile,onDisplay:display});nnk.keepaliveRuntime=runtime;
nnk.state.bootStage='ready';
window.addEventListener('pagehide',()=>runtime.dispose(),{once:true});
await nnk.modules.bridge.init({dispatch:(command,context)=>runtime.dispatch(command,context),pendingCommands:boot.pendingCommands||[]});
runtime.update();

/* Actual current NNK modules with deterministic PC/DC/MQTT/engine fixtures.
 * This is runtime regression evidence, not native WebRTC or real game evidence. */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import testPaths from './test-paths.cjs';
import {runInNewContext} from 'node:vm';
import {TransportOwner} from '../../online-kernel/keepalive/transport-owner.js';
import {InitialConnector} from '../../online-kernel/keepalive/initial-connector.js';
import {SessionRegistry} from '../../online-kernel/keepalive/session-registry.js';
import {LobbyOwner} from '../../online-kernel/keepalive/lobby-owner.js';
import {InitialPartyCoordinator} from '../../online-kernel/keepalive/initial-party.js';
import {createEngineEndpoint} from '../../online-kernel/keepalive/engine-endpoint.js';
import {createEngineOperationPort} from '../../online-kernel/keepalive/engine-operation-port.js';
import {CarrierRuntime} from '../../online-kernel/keepalive/carrier-runtime.js';
export {TransportOwner,InitialConnector,SessionRegistry,LobbyOwner,InitialPartyCoordinator,createEngineEndpoint,createEngineOperationPort,CarrierRuntime};
const fixtureRequire=createRequire(import.meta.url),batchRuntime=fixtureRequire('../../online-kernel/lib/batch-runtime.cjs');
export const source=name=>readFileSync(new URL('../../online-kernel/src/'+name+'.js',import.meta.url),'utf8');
export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};}
export async function drain(count=12){for(let i=0;i<count;i++)await new Promise(r=>setImmediate(r));}
export async function until(condition,label='fixture asynchronous boundary'){for(let i=0;i<300;i++){if(condition())return;await drain(1);}throw Error(label+' not reached');}
// Dispatch through the real capture listeners before modeling the native UI's bubble callback.
export class FixtureStartButton extends EventTarget {
 constructor(nativeCallback){super();this.nativeCallback=nativeCallback;this.nativeCalls=0;this.ownedListeners=[];this.parentNode={};this.isConnected=true;this.style={};}
 addEventListener(type,callback,options){super.addEventListener(type,callback,options);this.ownedListeners.push({type,callback,capture:typeof options==='boolean'?options:options?.capture===true,passive:typeof options==='object'?options.passive:undefined});}
 removeEventListener(type,callback,options){super.removeEventListener(type,callback,options);const capture=typeof options==='boolean'?options:options?.capture===true;this.ownedListeners=this.ownedListeners.filter(x=>!(x.type===type&&x.callback===callback&&x.capture===capture));}
 fire(type='click'){const event=new Event(type,{bubbles:true,cancelable:true});const allowed=super.dispatchEvent(event);if(allowed&&!event.defaultPrevented){this.nativeCalls++;this.nativeCallback?.call(this,event);}return {allowed:allowed&&!event.defaultPrevented,event};}
 click(){return this.fire('click');}
 delete(){this.parentNode=null;this.isConnected=false;}
}
export function endpointEngineAdapter(k){
 const binding={scope:k.scope,get status(){return k.ep.snapshot();}},calls=[];
 return {current:binding,calls,async command(action,args={},candidate=binding){assert.equal(candidate,binding,'command must use captured current binding');calls.push({action,args});const result=await k.command(action,args);if(result?.ok!==true)throw Error(result?.error?.message||'Actual endpoint command failed');return result.value;},async retire(reason){return await k.ep.detach(reason);}};
}
export function clock(){let id=0;const timers=new Map();return {timers,setTimeout(fn,ms){timers.set(++id,{fn,ms,repeat:false});return id;},setInterval(fn,ms){timers.set(++id,{fn,ms,repeat:true});return id;},clear(id){timers.delete(id);},
 fire(ms){for(const [id,t]of [...timers])if(t.ms===ms){if(!t.repeat)timers.delete(id);t.fn();}},clearAll(){timers.clear();}};}
export function fixture({realTimers=false,Connector=InitialConnector,Registry=SessionRegistry}={}){
 const timers=clock(),saved={setTimeout,clearTimeout,setInterval,clearInterval};
 if(!realTimers){globalThis.setTimeout=timers.setTimeout;globalThis.setInterval=timers.setInterval;globalThis.clearTimeout=globalThis.clearInterval=id=>timers.clear(id);}
 const pcs=[],owners=[],connectors=[],registries=[],publications=[],endpoints=[],events=[],plans=[],pcMap=new Map();let nextPC=0;
 class Channel{constructor(label){this.label=label;this.readyState='connecting';this.bufferedAmount=0;this.sent=[];this.closes=0;}
  send(raw){if(this.readyState!=='open')throw Error('Fixture DC is not open');this.sent.push(raw);const peer=this.peer;if(peer)queueMicrotask(()=>{if(peer.readyState==='open')peer.onmessage?.({data:raw});});}
  open(){this.readyState='open';this.onopen?.();}
  close(){if(this.readyState==='closed')return;this.closes++;this.readyState='closed';this.onclose?.();if(this.peer&&this.peer.readyState!=='closed'){this.peer.readyState='closed';this.peer.onclose?.();}}
 }
 class PC{constructor(){this.id=++nextPC;this.channels=[];this.connectionState='new';this.iceGatheringState='complete';this.closed=0;this.locals=0;this.remotes=0;this.offers=0;this.answers=0;Object.assign(this,plans.shift()||{});pcs.push(this);pcMap.set(this.id,this);}
  createDataChannel(label){const c=new Channel(label);this.channels.push(c);return c;}
  async createOffer(){this.offers++;return this.offerGate?await this.offerGate.promise:{type:'offer',sdp:'fixture:'+this.id};}
  async createAnswer(){this.answers++;return this.answerGate?await this.answerGate.promise:{type:'answer',sdp:'fixture:'+this.id};}
  async setLocalDescription(desc){this.locals++;if(this.localGate)await this.localGate.promise;this.localDescription=desc;}
  async setRemoteDescription(desc){this.remotes++;if(this.remoteThrow)throw this.remoteThrow;if(this.remoteGate)await this.remoteGate.promise;this.remoteDescription=desc;this.remote=pcMap.get(Number(desc.sdp.split(':')[1]));
   if(desc.type==='answer'&&this.remote){const peer=this.remote;for(const mine of this.channels){const theirs=new Channel(mine.label);peer.channels.push(theirs);mine.peer=theirs;theirs.peer=mine;peer.ondatachannel?.({channel:theirs});}
    this.connectionState=peer.connectionState='connected';this.onconnectionstatechange?.();peer.onconnectionstatechange?.();for(const c of [...this.channels,...peer.channels])c.open();}}
  close(){if(this.closed)return;this.closed++;this.connectionState='closed';for(const c of this.channels)c.close();this.onconnectionstatechange?.();}
  fail(){this.connectionState='failed';this.onconnectionstatechange?.();}
 }
 const rtcNNK={modules:{config:{get:()=>[]}}},rtcContext={window:{__nnk__:rtcNNK},TextEncoder,TextDecoder,btoa,atob,Uint8Array,Date,console,
  setTimeout:(...a)=>globalThis.setTimeout(...a),clearTimeout:n=>globalThis.clearTimeout(n),setInterval:(...a)=>globalThis.setInterval(...a),clearInterval:n=>globalThis.clearInterval(n)};
 runInNewContext(source('rtc'),rtcContext);const rtc={...rtcNNK.modules.rtc,RTCPeerConnection:PC,directHosts:()=>[],addInjected:()=>0};
 const brokerSessions=new Set(),retained=new Map(),messages=[];let guestSequence=0;
 const signaling={roomTopic:(code,tail)=>code+'/'+tail,randomId:()=>String(++guestSequence).padStart(6,'0'),async openRoomSession(code,role,topics,callback,signal){
  let closed=false;const s={code,role,topics,callback,signal,ended:0,publishes:0,
   async publish(topic,message,retain){if(closed)throw Error('Fixture MQTT closed');this.publishes++;messages.push({topic,message,retain});if(retain)retained.set(topic,message);for(const other of brokerSessions)if(other.topics.includes(topic))queueMicrotask(()=>{if(!other.closed)other.callback(topic,message);});},
   publishRaw(topic,message,retain){messages.push({topic,message,retain,raw:true});if(retain&&message==='')retained.delete(topic);},
   end(){if(closed)return;closed=true;s.closed=true;s.ended++;brokerSessions.delete(s);signal?.removeEventListener('abort',s.end);}};
  brokerSessions.add(s);signal?.addEventListener('abort',s.end,{once:true});for(const topic of topics)if(retained.has(topic))queueMicrotask(()=>{if(!closed)callback(topic,retained.get(topic));});return s;
 }};
 function connector(options={}){let c;const registry=options.registry||new Registry();registries.push(registry);
  c=new Connector({rtc,signaling,...options,onEvent:(type,data)=>events.push({type,data}),createOwner:({role,offerer})=>{
   const owner=new TransportOwner({role,offerer,contextFromOffer:true,sessionId:'unshared:'+crypto.randomUUID(),peerId:role,remotePeerId:role==='host'?'guest':'host',rtc,iceConfig:[],validateControl:options.validateControl||(()=>true),onControl:options.onControl||(()=>{}),onGame:options.onGame||(()=>{}),onStopped:reason=>{c.transportStopped(owner,reason);registry.transportStopped(owner,reason);}});owners.push(owner);options.onOwner?.(owner);return owner;}});connectors.push(c);return c;
 }
 function bridge(){const b={events:[],phases:[],emit(type,data){this.events.push({type,data});},setPhase(phase,data){this.phases.push({phase,data});},stop(){}};return b;}
 function lobby(options={}){const sessions=options.sessions||new Registry();registries.push(sessions);return new LobbyOwner({boot:{identity:{name:'actual host',avatar:'caocao'}},connector:options.connector||connector({registry:sessions}),sessions,bridge:options.bridge||bridge(),newCode:()=> 'ABC234',...options});}
 async function pair({adopt=true,method='invite',hostOptions={},guestOptions={}}={}){const hs=new Registry(),gs=new Registry();registries.push(hs,gs);let hostRecord=null,guestRecord=null;
  const h=connector({registry:hs,...hostOptions}),g=connector({registry:gs,...guestOptions});const onHostReady=c=>{if(adopt)hostRecord=hs.registerReady(c);},onGuestReady=c=>{if(adopt)guestRecord=gs.registerReady(c);};let invitation,join,pub;
  if(method==='invite'){invitation=await h.makeInvite({onReady:onHostReady});join=await g.joinInvite({code:invitation.offerText,onReady:onGuestReady});await invitation.acceptAnswer(join.answerText);}
  else{pub=await h.listenRoom({code:'ABC234',onOffer:(message,publication)=>h.answerRoomOffer({publication,message,onReady:onHostReady})});publications.push(pub);const pending=g.joinRoom({code:'ABC234',onReady:onGuestReady});await until(()=>[...timers.timers.values()].some(x=>x.ms===40)||realTimers);if(!realTimers)timers.fire(40);join=await pending;}
  await Promise.all([join.readyPromise,...(invitation?[invitation.readyPromise]:[])]);await drain();return {h,g,hs,gs,hostRecord,guestRecord,host:hs.getOwner(hostRecord?.peerId)||owners.at(-2),guest:gs.getOwner(guestRecord?.peerId)||owners.at(-1),invitation,join,pub};
 }
 async function finishOwnTask(promise){if(realTimers)return await promise;let settled=false;promise.finally(()=>settled=true).catch(()=>{});for(let i=0;i<100&&!settled;i++){await drain(1);timers.fire(0);}assert.equal(settled,true,'fixture must execute actual owned 0ms cleanup task');return await promise;}
 async function close(){const errors=[];for(const e of endpoints){try{await finishOwnTask(e.detach('fixture retired'));}catch(error){errors.push(error);}}for(const p of publications)p.endAndClearRetained('fixture cleanup');for(const c of connectors)for(const a of [...c.attempts])a.closeUnentered('fixture cleanup');for(const o of owners)o.stopTransport('fixture cleanup');for(const s of [...brokerSessions])s.end();await drain();timers.clearAll();if(!realTimers)Object.assign(globalThis,saved);if(errors.length)throw new AggregateError(errors,'Fixture actual cleanup failed');}
 function endpoint({role='host',capacity=2,admission,modules={}}={}){const persisted=new Map(),posted=[],scope={sessionId:'party-fixture',roundId:'round-fixture',documentGeneration:1,bindingId:'binding-fixture',bindingNonce:'nonce-fixture',expectedOrigin:'http://fixture'},originals={};let nativeConnections=0,request=0,live=true;
  const env={lib:{version:'fixture-only',db:{},config:{mode:'connect',extensions:[]},configOL:{mode:'single',number:capacity},node:{clients:[]},element:{ws:{onopen(){},onmessage(){},onclose(){},onerror(){}}},onover:[],translate:{},init:{connection(socket){nativeConnections++;const client={id:'guest-seat-'+nativeConnections,ws:socket,inited:false};env.lib.node.clients.push(client);socket.on('message',()=>{});socket.on('close',()=>client.closed=true);admission?.(socket,client);}}},_status:{},ui:{create:{roomInfo(){},chat(){}},click:{exit(){}}},get:{connectNickname:()=> 'host-fixture'},game:{players:[],connectPlayers:[],saveConfig(key,value,local,callback){const stored=key+(local?'_mode_config_'+(typeof local==='string'?local:env.lib.config.mode):'');persisted.set(stored,value);env.lib.config[key]=value;callback?.();},getDB(_store,key,callback){callback(persisted.get(key));},createServer(){},switchMode(mode){env.lib.configOL={mode,number:capacity};env.game.createServer();env._status.waitingForPlayer=true;env.game.onlinezhu='1';env.game.connectPlayers=Array.from({length:capacity},(_,i)=>({playerid:i===0?'1':null,classList:{contains:()=>false}}));env.ui.connectStartButton=new FixtureStartButton(function(){if(env.game.connectPlayers.filter(p=>p.playerid).length<2)return;env.game.resume();this.clicked=true;this.delete();delete env.ui.connectStartButton;});},over(){env._status.over=true;for(const fn of env.lib.onover)fn();},reload(){},resume(){env._status.waitingForPlayer=false;env._status.paused=false;}}};
  for(const k of ['over','reload','resume'])originals[k]=env.game[k];originals.exit=env.ui.click.exit;
  const nnk={env,state:{},modules:{rtc,bridge:bridge(),config:{defaults:{},get:()=>''},compat:{unlockPacks(){},dumpExtensions(){}},...modules}},port={onmessage:null,closed:0,start(){},postMessage(value){posted.push(value);},close(){this.closed++;}},context={window:{__nnk__:nnk},crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob,Date,console,setTimeout:(...a)=>globalThis.setTimeout(...a),clearTimeout:n=>globalThis.clearTimeout(n),setInterval:(...a)=>globalThis.setInterval(...a),clearInterval:n=>globalThis.clearInterval(n)};
  runInNewContext(source('rtc'),context);
  if(!nnk.modules.batch){const root=mkdtempSync(testPaths.tempPrefix('keepalive-endpoint-')),storage=new Map();mkdirSync(root+'/extension',{recursive:true});nnk.modules.compat.gameRoot=()=>root;nnk.modules.batch=batchRuntime.createRuntime(nnk,{storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});}
  const ep=createEngineEndpoint(nnk,{info:{role,scope},port,isCurrent:()=>live,documentToken:'fixture-document'});endpoints.push(ep);
  return {ep,nnk,env,scope,posted,port,context,originals,stats:()=>({nativeConnections}),retire(){live=false;return finishOwnTask(ep.detach('test retired'));},async command(command,args={},requestId='request-'+(++request)){await ep.handleMessage({type:'command',scope,requestId,command,args});return posted.findLast(m=>m.type==='result'&&m.requestId===requestId);}};
 }
 return {rtc,rtcNNK,rtcContext,PC,Channel,pcs,plans,owners,connectors,registries,publications,endpoints,events,timers,signaling,brokerSessions,messages,connector,lobby,bridge,pair,endpoint,close};
}
export const enrollment={partySessionId:'actual-party-fixture',roundId:'actual-round-fixture',operationId:'actual-operation-fixture'};
export function enter(registry,record,owner,{local=3,remote=5}={}){registry.bindEnrollment(record.peerId,enrollment);owner.attachEngine({roundId:enrollment.roundId,documentGeneration:local},{remoteDocumentGeneration:remote});
 const h=owner.role==='host'?local:remote,g=owner.role==='host'?remote:local;return registry.markEntered(record.peerId,enrollment,{hostClientId:'guest-seat',guestOnlineID:'guest-seat',hostClientInited:true,guestInited:true,hostSeats:['1','guest-seat'],guestSeats:['guest-seat','1'],ordered:true,seated:true,hostDocumentGeneration:h,guestDocumentGeneration:g,roundId:enrollment.roundId});}
export async function runCases(cases){let passed=0,failed=0;for(const [name,fn]of cases){try{await fn();passed++;console.log('  ✓ '+name);}catch(error){failed++;console.error('  ✗ '+name+'\n'+error.stack);}}console.log(`全部通过:${passed} 项; 失败:${failed}`);if(failed)process.exitCode=1;return {passed,failed};}

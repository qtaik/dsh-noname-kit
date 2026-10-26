// Deterministic CarrierRuntime/RTC fixtures; no real network or native gameplay.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture,CarrierRuntime,drain,until,runCases} from './fixtures/keepalive-lifecycle.mjs';

globalThis.require=createRequire(import.meta.url);
const cases=[],test=(name,fn)=>cases.push([name,fn]);
async function isolated(fn){
 const f=fixture(),runtimes=[];let discoveryCalls=0,discoveryFails=true;
 const signaling={...f.signaling,async openRoomSession(...args){discoveryCalls++;if(discoveryFails)throw Error('Fixture broker unavailable');return f.signaling.openRoomSession(...args);}};
 const make=name=>{
  const bridge=f.bridge(),native={onInvalidated:()=>()=>{},snapshot:async()=>({})},ipc={on(){},removeListener(){}},nnk={state:{},modules:{rtc:f.rtc,signaling,bridge}};
  const runtime=new CarrierRuntime({nnk,native,ipc,profile:{config:{onlineName:name,onlineAvatar:'caocao'},identity:{}}});
  const value={runtime,bridge};runtimes.push(value);return value;
 };
 const pair=async(host,guest)=>{
  await host.runtime.createInternetRoom('single','invite');
  const invitation=host.bridge.events.findLast(e=>e.type==='invite_ready').data;
  await guest.runtime.joinByInvite(invitation.code);
  const answer=guest.bridge.events.findLast(e=>e.type==='answer_ready').data.code;
  await host.runtime.acceptAnswer(invitation.id,answer);
  await until(()=>host.runtime.sessions.snapshot().length===1&&guest.runtime.sessions.snapshot().length===1,'both actual fixture registries adopted');
  await until(()=>guest.runtime.coordinator.remoteLobby?.selfPeerId,'validated lobby projection');await drain();
  host.runtime.update();guest.runtime.update();
 };
 try{return await fn({f,make,pair,discoveryCalls:()=>discoveryCalls,allowDiscovery:()=>discoveryFails=false});}
 finally{
  for(const {runtime}of runtimes){
   await runtime.lobby.cancelAll();runtime.sessions.stopAll('fixture cleanup');runtime.dispose();
  }
  await f.close();
 }
}
const state=side=>side.bridge.phases.at(-1).data;
const actual=side=>side.runtime.sessions.snapshot().map(record=>({peerId:record.peerId,owner:side.runtime.sessions.getOwner(record.peerId),identity:side.runtime.sessions.getOwner(record.peerId).actualIdentity()}));
function unchanged(side,before){
 assert.equal(side.runtime.sessions.snapshot().length,before.length);
 for(const row of before){
  assert.equal(side.runtime.sessions.getOwner(row.peerId),row.owner);assert.equal(row.owner.stopped,false);
  const current=row.owner.actualIdentity();for(const key of ['pc','link','ping'])assert.equal(current[key],row.identity[key]);
 }
}

test('Broker failure leaves the host able to create a real invitation in the same carrier',()=>isolated(async({make,discoveryCalls})=>{
 const host=make('Host');await assert.rejects(host.runtime.createInternetRoom('single'),/broker unavailable/);
 host.runtime.update();assert.equal(state(host).lobbyOpen,false);assert.equal(state(host).roomCodeAvailable,false);
 const calls=discoveryCalls();await host.runtime.createInternetRoom('single','invite');host.runtime.update();
 assert.equal(discoveryCalls(),calls);assert.equal(state(host).lobbyOpen,true);assert.equal(state(host).roomCodeAvailable,false);
 assert.ok(host.bridge.events.some(e=>e.type==='invite_ready'&&e.data.code));
}));

test('Invitation handshake adopts both peers without discovery and preserves the original lobby wire',()=>isolated(async({make,pair,discoveryCalls})=>{
 const host=make('Host'),guest=make('Guest');await pair(host,guest);
 assert.equal(discoveryCalls(),0);
 for(const side of [host,guest]){assert.equal(state(side).lobbyOpen,true);assert.equal(state(side).roomCodeAvailable,false);assert.match(state(side).roomCode,/^[A-HJ-NP-Z2-9]{6}$/);}
 assert.equal(guest.runtime.lobby.snapshot().joinKind,'invite');
 const remote=guest.runtime.coordinator.remoteLobby;assert.equal(remote.roomCode,host.runtime.lobby.snapshot().roomCode);
 assert.equal(remote.members.length,2);assert.equal(state(guest).manifestAvailable,true);
 for(const side of [host,guest])assert.equal(side.runtime.coordinator.round,null);
}));

test('Failed public enablement preserves adopted transports; successful enablement does not reconnect',()=>isolated(async({make,pair,allowDiscovery})=>{
 const host=make('Host'),guest=make('Guest');await pair(host,guest);
 const beforeHost=actual(host),beforeGuest=actual(guest),lobby=host.runtime.lobby.lobby;
 await assert.rejects(host.runtime.createInternetRoom('single','mqtt'),/broker unavailable/);host.runtime.update();guest.runtime.update();
 assert.equal(host.runtime.lobby.lobby,lobby);assert.equal(state(host).lobbyOpen,true);assert.equal(state(host).roomCodeAvailable,false);
 unchanged(host,beforeHost);unchanged(guest,beforeGuest);
 allowDiscovery();await host.runtime.createInternetRoom('single','mqtt');await drain();host.runtime.update();guest.runtime.update();
 assert.equal(host.runtime.lobby.lobby,lobby);assert.equal(state(host).roomCodeAvailable,true);assert.equal(state(guest).roomCodeAvailable,false);
 assert.equal(state(guest).lobbyOpen,true);unchanged(host,beforeHost);unchanged(guest,beforeGuest);
}));

test('Room-number guests retain their code while publication retirement keeps registered peers alive',()=>isolated(async({f,make,allowDiscovery})=>{
 allowDiscovery();const host=make('Host'),guest=make('Guest');await host.runtime.createInternetRoom('single');
 const code=host.runtime.lobby.snapshot().roomCode,join=guest.runtime.joinByRoomCode(code);
 await until(()=>[...f.timers.timers.values()].some(t=>t.ms===40),'actual room discovery poll');f.timers.fire(40);await join;
 await until(()=>guest.runtime.coordinator.remoteLobby?.selfPeerId,'validated host projection');await drain();host.runtime.update();guest.runtime.update();
 assert.equal(guest.runtime.lobby.snapshot().joinKind,'room');assert.equal(state(host).roomCodeAvailable,true);assert.equal(state(guest).roomCodeAvailable,true);assert.equal(state(guest).roomCode,code);
 const beforeHost=actual(host),beforeGuest=actual(guest);
 host.runtime.lobby.publication.endAndClearRetained('fixture discovery outage');host.runtime.update();guest.runtime.update();
 unchanged(host,beforeHost);unchanged(guest,beforeGuest);assert.equal(state(host).lobbyOpen,true);assert.equal(state(guest).lobbyOpen,true);
}));

test('An active invitation lobby saves signaling durably without replacing registered transports',()=>isolated(async({make,pair})=>{
 const host=make('Host'),guest=make('Guest');await pair(host,guest);
 const runtime=host.runtime,before=actual(host),configKey='signaling_runtime_config',records=new Map([[configKey,JSON.stringify({theme:'preserved',nnk_mqttUrl:'wss://old.example/mqtt'})]]);
 runtime.profile.configStorage={prefix:'signaling_runtime_',useDB:false};
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)}});
 try{
  await runtime.dispatch({action:'set_config',args:{key:'mqttUrl',value:'wss://new.example/mqtt',requestId:'ui-runtime-save'}});
  const saved=JSON.parse(records.get(configKey));assert.equal(saved.nnk_mqttUrl,'wss://new.example/mqtt');assert.equal(saved.theme,'preserved');
  assert.equal(runtime.profile.config.mqttUrl,saved.nnk_mqttUrl);assert.equal(runtime.signalingSaving,null);
  const event=host.bridge.events.findLast(e=>e.type==='config_applied');assert.equal(event.data.requestId,'ui-runtime-save');assert.equal(event.data.value,saved.nnk_mqttUrl);
  unchanged(host,before);assert.equal(state(host).lobbyOpen,true);assert.equal(state(host).roomCodeAvailable,false);
  await runtime.dispatch({action:'set_config',args:{key:'mqttUrl',value:'',requestId:'ui-runtime-default'}});
  assert.equal(runtime.profile.config.mqttUrl,'wss://broker.emqx.io:8084/mqtt');unchanged(host,before);
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
}));

await runCases(cases);

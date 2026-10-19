import testPaths from './fixtures/test-paths.cjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {EventEmitter} from 'node:events';import {pathToFileURL,fileURLToPath} from 'node:url';
const W=testPaths.sourceRoot(),out=testPaths.tempPrefix('keepalive-entry-')+new Date().toISOString().replace(/[:.]/g,'-');
fs.mkdirSync(out);
for(const file of ['engine-binding.js','initial-party.js','round-settlement.js','native-settlement.js','round-continuation.js','plugin-room.js','lobby-owner.js'])fs.copyFileSync(path.join(W,'online-kernel/keepalive',file),path.join(out,file));fs.copyFileSync(path.join(W,'online-kernel/src/bridge.js'),path.join(out,'bridge.js'));
const {EngineBindingManager}=await import(pathToFileURL(path.join(out,'engine-binding.js')));
const {InitialPartyCoordinator}=await import(pathToFileURL(path.join(out,'initial-party.js')));
const tests=[];async function test(name,fn){try{await fn();tests.push({name,ok:true});console.log('ok',name);}catch(error){tests.push({name,ok:false,error:String(error),stack:error.stack});console.error('FAIL',name,error);}}
const scope=(round='r',generation=1)=>({sessionId:'p',roundId:round,documentGeneration:generation,bindingId:'b'+generation,bindingNonce:'n'+generation,expectedOrigin:'http://localhost:8089'});
function startupFixture(role,preference,current=true,savedMode='identity'){
 const config={show_splash:preference,mode:savedMode,directstartmode:'single',debug:false},db=new Map([['show_splash',preference],['mode',savedMode],['directstartmode','single'],['debug',false]]),writes=[],storage=new Map();
 const nnk={env:{lib:{config,configprefix:'noname_0.9_D_'},game:{saveConfig(key,value,_mode,done){writes.push(key);value===undefined?db.delete(key):db.set(key,value);queueMicrotask(done);},getDB:async(_store,key)=>db.get(key)}}};
 const context={require:name=>{if(name==='node:fs')return fs;if(name==='node:path')return path;throw Error('Unexpected startup dependency: '+name);},localStorage:{removeItem:key=>storage.delete(key)},setTimeout,clearTimeout};
 // Execute the actual startup function with ordinary callback/DB semantics.
 vm.runInNewContext(fs.readFileSync(path.join(W,'online-kernel/keepalive/entry.js'),'utf8').replace(/^export /gm,'')+';globalThis.startup=prepareEngine;',context);
 return {config,db,writes,run:()=>context.startup(nnk,{info:{role},isCurrent:()=>current})};
}
await test('Owned fresh engines boot at idle online entry without persisting mode/splash or touching safety config',async()=>{
 for(const preference of ['init','always','off'])for(const savedMode of ['identity','single','connect']){
  const f=startupFixture('engine',preference,true,savedMode);await f.run();assert.equal(f.config.show_splash,'off');assert.equal(f.db.get('show_splash'),preference);
  assert.equal(f.config.debug,false);assert.equal(f.db.get('debug'),false);assert.equal(f.config.mode,'connect');assert.equal(f.db.get('mode'),savedMode);
  assert.equal(Object.hasOwn(f.config,'directstartmode'),false);assert.equal(f.db.get('directstartmode'),'single');
  assert.deepEqual(f.writes,['reconnect_info','tmp_user_roomId']);
 }
});
await test('Ordinary and preliminary documents keep the saved splash behavior with no startup writes',async()=>{
 for(const role of ['ordinary','preliminary','retired']){const f=startupFixture(role,'always');await f.run();assert.equal(f.config.show_splash,'always');assert.equal(f.db.get('show_splash'),'always');assert.equal(f.config.mode,'identity');assert.equal(f.config.directstartmode,'single');assert.deepEqual(f.writes,[]);}
});
await test('Retired engine cannot alter its document startup configuration',async()=>{
 const f=startupFixture('engine','init',false);await assert.rejects(f.run(),/Document retired/);assert.equal(f.config.show_splash,'init');assert.equal(f.config.mode,'identity');assert.equal(f.config.directstartmode,'single');assert.deepEqual(f.writes,[]);
});
await test('Late old port callbacks and all six scope variants cannot change current endpoint',async()=>{
 const sent=[],ipc=new EventEmitter(),native={onInvalidated:()=>()=>{},snapshot:async()=>({currentEngine:{windowId:2,scope:scope('new',2)}})};
 const manager=new EngineBindingManager({native,ipc,onSend:(...args)=>sent.push(args),onEvent:()=>{}});
 const old={closed:false,scope:scope(),windowId:1,lease:{partySessionId:'p',roundId:'r'},pending:new Map(),error:null};manager.current=old;
 const delayed=value=>manager.receive(old,value);old.closed=true;
 const current={closed:false,scope:scope('new',2),windowId:2,lease:{partySessionId:'p',roundId:'new'},pending:new Map(),error:null,status:{proof:'current'},port:null};manager.current=current;
 delayed({type:'send',scope:old.scope,peerId:'peer',raw:'old'});delayed({type:'status',scope:old.scope,value:{error:'old'}});
 for(const key of Object.keys(current.scope)){const invalid={...current.scope,[key]:String(current.scope[key])+'wrong'};manager.receive(current,{type:'status',scope:invalid,value:{proof:'wrong'}});}
 assert.equal(sent.length,0);assert.equal(current.status.proof,'current');assert.equal(current.error,null);
 let closed=0;await manager.acceptPort({ports:[{close(){closed++;}}]},{sourceWindowId:2,scope:scope('new',99)});assert.equal(closed,1);assert.equal(current.port,null);manager.dispose();
});
await test('Endpoint operation rejects and clears pending request rather than swallowing false',async()=>{
 const ipc=new EventEmitter(),manager=new EngineBindingManager({native:{onInvalidated:()=>()=>{}},ipc,onEvent:()=>{}});
 const b={closed:false,scope:scope(),error:null,pending:new Map(),port:{postMessage(message){queueMicrotask(()=>manager.receive(b,{type:'result',scope:b.scope,requestId:message.requestId,ok:false,error:{message:'readback mismatch'}}));}}};manager.current=b;
 await assert.rejects(manager.command('prepare-host',{}),/readback mismatch/);assert.equal(b.pending.size,0);manager.dispose();
});
function fixture(){
 const records=['a','b','c'].map((peerId,index)=>({peerId,joinOrdinal:index+1,live:true,identity:{},lease:null})),controls=[],entered=[];
 const owners=new Map(records.map(r=>[r.peerId,{peerId:r.peerId,currentScope:null,attachEngine(local,{remoteDocumentGeneration}){assert.equal(this.currentScope,null);this.currentScope={...local};this.remoteDocumentGeneration=remoteDocumentGeneration;},detachEngineBinding(){this.currentScope=null;return true;}}]));
 const sessions={snapshot:()=>records.map(r=>({...r})),isLive:()=>true,wasEverEntered:()=>false,sendControl(peerId,type,data){controls.push({peerId,type,data});},getOwner:id=>owners.get(id),peerForActualOwner:owner=>owner?.peerId,
 bindEnrollment(id,r){records.find(x=>x.peerId===id).lease={partySessionId:r.partySessionId,roundId:r.roundId,operationId:r.operationId};},retireEnrollment(id){records.find(x=>x.peerId===id).lease=null;},markEntered(id,lease,proof){entered.push({id,lease,proof});}};
 let creates=0;const commands=[];const engines={current:null,async create(r){creates++;return this.current={lease:r,scope:{...scope(r.roundId,creates),sessionId:r.partySessionId},status:{waiting:true,capacity:2,wire:[],seats:[],clients:[]}};},
 async command(command,args){commands.push({command,args});return command==='reserve-start-peer'?{reserved:true}:command==='confirm-seat'?{confirmed:true,peerId:args.peerId}:command==='activate-seat'?{activated:true,peerId:args.peerId}:{ok:true};},async wait(b,fn){assert.ok(fn());},async retire(){this.current=null;}};
 const coordinator=new InitialPartyCoordinator({sessions,engines,getLobbyState:()=>({roomCode:'ABCDEF'}),onEvent:()=>{}});coordinator.setRole('host');for(const record of records)coordinator.supportedPeers.add(record.peerId);
 return {records,controls,entered,owners,sessions,engines,coordinator,commands,creates:()=>creates};
}
await test('Fresh real capacity reserves one Guest slot and queued peers do not create documents',async()=>{
 const f=fixture();await f.coordinator.start('single');assert.equal(f.creates(),1);assert.equal(f.coordinator.members.size,1);
 assert.deepEqual(f.controls.filter(x=>x.type==='party-accepted').map(x=>x.peerId),['a']);assert.equal(f.records[1].lease,null);assert.equal(f.records[2].lease,null);f.coordinator.dispose();
});
await test('Native admission requires both current document generations and bind-ready',async()=>{
 const f=fixture();await f.coordinator.start('single');const r=f.coordinator.round,o=f.owners.get('a'),d={protocol:'nnk-round/1',partySessionId:r.partySessionId,roundId:r.roundId,operationId:r.operationId,requestId:'q',targetPeerId:'a',documentGeneration:9};
 assert.equal(f.coordinator.validate(o,{type:'bind-ready',data:{...d,hostDocumentGeneration:1,guestDocumentGeneration:9}}),false);
 assert.equal(f.coordinator.validate(o,{type:'document-ready',data:d}),true);await f.coordinator.control(o,{type:'document-ready',data:d});
 assert.equal(f.commands.filter(x=>x.command==='admit').length,0);assert.equal(o.currentScope.roundId,r.roundId);
 assert.equal(f.coordinator.validate(o,{type:'bind-ready',data:{...d,hostDocumentGeneration:2,guestDocumentGeneration:9}}),false);
 const bound={...d,hostDocumentGeneration:f.engines.current.scope.documentGeneration,guestDocumentGeneration:9};assert.equal(f.coordinator.validate(o,{type:'bind-ready',data:bound}),true);
 await f.coordinator.control(o,{type:'bind-ready',data:bound});assert.equal(f.commands.filter(x=>x.command==='admit').length,1);
 await f.coordinator.control(o,{type:'bind-ready',data:bound});assert.equal(f.commands.filter(x=>x.command==='admit').length,1);f.coordinator.dispose();
});
await test('A peer ready label cannot grant entry without current Client.inited and matching actual seats',async()=>{
 const f=fixture();await f.coordinator.start('single');const r=f.coordinator.round,m=f.coordinator.members.get('a'),b=f.engines.current;m.phase='seating';m.documentGeneration=9;m.proof={guestOnlineID:'guest',guestInitComplete:true,guestSeatIds:['1','guest']};
 b.status={waiting:true,clients:[{peerId:'a',id:'guest',inited:false}],seats:[{playerid:'1'},{playerid:'guest'}],wire:[['out','opened'],['in','init'],['out','init'],['in','inited']].map(([direction,tag])=>({peerId:'a',direction,tag}))};
 await f.coordinator.trySeat('a');assert.equal(f.entered.length,0);b.status.clients[0].inited=true;m.proof.guestSeatIds=['1','wrong'];await f.coordinator.trySeat('a');assert.equal(f.entered.length,0);
 m.proof.guestSeatIds=['1','guest'];await f.coordinator.trySeat('a');assert.equal(f.entered.length,1);assert.equal(f.entered[0].proof.guestInited,true);assert.equal(m.phase,'entered');f.coordinator.dispose();
});
await test('Current operation failure detaches engines and retires enrollment, preserving healthy Owner',async()=>{
 const f=fixture();await f.coordinator.start('single');const r=f.coordinator.round,owner=f.owners.get('a');owner.currentScope={roundId:r.roundId,documentGeneration:1};
 f.coordinator.fail(r,Error('startup failed'));await f.coordinator.cleanupPromise;assert.equal(f.engines.current,null);assert.equal(owner.currentScope,null);assert.equal(f.records[0].lease,null);assert.equal(f.owners.get('a'),owner);assert.equal(r.failed,true);f.coordinator.dispose();
});
await test('Delayed native seat confirmation cannot label entry or alter a replacement round',async()=>{
 const f=fixture();await f.coordinator.start('single');const r=f.coordinator.round,m=f.coordinator.members.get('a'),b=f.engines.current;
 m.phase='seating';m.documentGeneration=9;m.proof={guestOnlineID:'guest',guestInitComplete:true,guestSeatIds:['1','guest']};
 b.status={waiting:true,clients:[{peerId:'a',id:'guest',inited:true}],seats:[{playerid:'1'},{playerid:'guest'}],wire:[['out','opened'],['in','init'],['out','init'],['in','inited']].map(([direction,tag])=>({peerId:'a',direction,tag}))};
 let resolve;f.engines.command=(action)=>{assert.equal(action,'confirm-seat');return new Promise(r=>resolve=r);};
 const pending=f.coordinator.trySeat('a');assert.equal(m.phase,'confirming');assert.equal(f.entered.length,0);
 r.failed=true;const newer={...r,roundId:'newer',operationId:'other',failed:false};f.coordinator.round=newer;f.coordinator.members.clear();
 resolve({confirmed:true});await pending;assert.equal(f.entered.length,0);assert.equal(newer.failed,false);clearTimeout(m.timer);m.timer=null;f.coordinator.dispose();
});
await test('Native start winning reservation race leaves unselected Guest queued without failing game',async()=>{
 const f=fixture();f.engines.command=async(action)=>{if(action==='reserve-start-peer')return {reserved:false,reason:'native-game-started'};return {ok:true};};
 await f.coordinator.start('single');assert.equal(f.coordinator.members.size,0);assert.equal(f.coordinator.round.failed,false);
 assert.equal(f.controls.filter(x=>x.type==='party-accepted').length,0);assert.equal(f.records.every(r=>r.lease===null),true);f.coordinator.dispose();
});
await test('Concurrent promotions reserve each selected actual peer once before party acceptance',async()=>{
 const f=fixture();await f.coordinator.start('single');const reserves=f.commands.filter(c=>c.command==='reserve-start-peer');
 assert.deepEqual(reserves.map(c=>c.args.peerId),['a']);await Promise.all([f.coordinator.promote(),f.coordinator.promote()]);
 assert.equal(f.commands.filter(c=>c.command==='reserve-start-peer').length,1);assert.equal(f.coordinator.members.size,1);f.coordinator.dispose();
});
function readySeat(f){
 const r=f.coordinator.round,m=f.coordinator.members.get('a'),b=f.engines.current;m.phase='seating';m.documentGeneration=9;m.proof={guestOnlineID:'guest',guestInitComplete:true,guestSeatIds:['1','guest']};
 b.status={waiting:true,clients:[{peerId:'a',id:'guest',inited:true}],seats:[{playerid:'1'},{playerid:'guest'}],wire:[['out','opened'],['in','init'],['out','init'],['in','inited']].map(([direction,tag])=>({peerId:'a',direction,tag}))};return {r,m,b};
}
await test('Native seat validation false or wrong peer cannot grant Registry entry',async()=>{
 for(const value of [{confirmed:false,peerId:'a'},{confirmed:true,peerId:'wrong'}]){
  const f=fixture();await f.coordinator.start('single');const {r}=readySeat(f);f.engines.command=async()=>value;
  await f.coordinator.trySeat('a');await f.coordinator.cleanupPromise;assert.equal(f.entered.length,0);assert.equal(r.failed,true);assert.equal(f.owners.has('a'),true);f.coordinator.dispose();
 }
});
await test('Registry retains verified connection before native start activation and confirmation is ordered after it',async()=>{
 const f=fixture();await f.coordinator.start('single');const {m}=readySeat(f);let activate;
 f.engines.command=async(action,args)=>{if(action==='confirm-seat')return {confirmed:true,peerId:args.peerId};assert.equal(action,'activate-seat');assert.equal(f.entered.length,1);return new Promise(r=>activate=r);};
 const pending=f.coordinator.trySeat('a');for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(f.entered.length,1);assert.equal(m.phase,'confirming');assert.equal(f.controls.filter(c=>c.type==='seating-confirmed').length,0);
 activate({activated:true,peerId:'a'});await pending;assert.equal(m.phase,'entered');assert.equal(f.controls.filter(c=>c.type==='seating-confirmed').length,1);f.coordinator.dispose();
});
await test('Native activation false fails current operation and cannot advertise ready',async()=>{
 const f=fixture();await f.coordinator.start('single');const {r}=readySeat(f);
 f.engines.command=async(action,args)=>action==='confirm-seat'?{confirmed:true,peerId:args.peerId}:{activated:false,peerId:args.peerId};
 await f.coordinator.trySeat('a');await f.coordinator.cleanupPromise;assert.equal(r.failed,true);assert.equal(f.controls.filter(c=>c.type==='seating-confirmed').length,0);assert.equal(f.owners.has('a'),true);f.coordinator.dispose();
});
await test('Only explicit current seat-list change asks for a new proof without granting entry or resetting timer',async()=>{
 const f=fixture();await f.coordinator.start('single');const {r,m}=readySeat(f),timer=m.timer;
 f.engines.command=async()=>({confirmed:false,peerId:'a',reason:'seat-list-changed'});await f.coordinator.trySeat('a');
 assert.equal(r.failed,false);assert.equal(m.phase,'seating');assert.equal(m.proof,null);assert.equal(m.timer,timer);assert.equal(f.entered.length,0);assert.equal(m.seatRechecks,1);
 const recheck=f.controls.find(c=>c.type==='seating-recheck');assert.equal(recheck.data.guestDocumentGeneration,9);assert.equal(recheck.data.hostDocumentGeneration,f.engines.current.scope.documentGeneration);f.coordinator.dispose();
});
await test('Guest recheck only accepts current pair generations and resends real native proof',async()=>{
 const f=fixture(),c=f.coordinator;c.role='guest';c.guestPeer='a';c.round={partySessionId:'p',roundId:'r',operationId:'o',phase:'seating',hostDocumentGeneration:7,failed:false};
 f.engines.current={scope:scope('r',9),status:{onlineID:'guest',seats:[{playerid:'1'},{playerid:'guest'},{playerid:'other'}],wire:[['in','opened'],['out','init'],['in','init'],['out','inited']].map(([direction,tag])=>({peerId:'a',direction,tag}))}};
 const owner=f.owners.get('a'),d={...c.envelope(c.round),reason:'seat-list-changed',hostDocumentGeneration:7,guestDocumentGeneration:9};
 assert.equal(c.validate(owner,{type:'seating-recheck',data:{...d,guestDocumentGeneration:8}}),false);assert.equal(c.validate(owner,{type:'seating-recheck',data:d}),true);
 c.round.sentGuestProof='previous';await c.control(owner,{type:'seating-recheck',data:d});assert.deepEqual(f.controls.find(x=>x.type==='seating-ready').data.proof.guestSeatIds,['1','guest','other']);c.dispose();
});
await test('Current per-peer native handshake evidence survives diagnostic ring rollover and an invalid counter cannot fallback',async()=>{
 const f=fixture();await f.coordinator.start('single');const {b}=readySeat(f);
 b.status.wire=[];b.status.peerProofs=[{peerId:'a',handshakeOrder:'out:opened,in:init,out:init,in:inited',handshakeOrderInvalid:true}];
 await f.coordinator.trySeat('a');assert.equal(f.entered.length,0);b.status.peerProofs[0].handshakeOrderInvalid=false;
 await f.coordinator.trySeat('a');assert.equal(f.entered.length,1);f.coordinator.dispose();
});
await test('Bridge serially awaits async commands and reports rejected commands',async()=>{
 const intervals=new Map(),calls=[],posted=[],events=[],nnk={version:'test',build:'test',state:{},modules:{config:{get:()=>'',defaults:{}}}};
  async function waitUntil(predicate){for(let i=0;i<1000;i++){if(predicate())return;await Promise.resolve();}assert.fail('Bridge fixture did not reach the expected asynchronous state');}
  let intervalSeq=0,postResolve;const ctx={window:{__nnk__:nnk,addEventListener(){}},location:{origin:'http://localhost'},document:{},console,AbortController,URL,Date,Promise,setTimeout,clearTimeout,fetch:(url,options)=>{
    if(options?.method!=='POST')return Promise.resolve({ok:true,json:async()=>({baseUrl:'http://127.0.0.1:3081/noname-kit-api',token:'t'})});posted.push(JSON.parse(options.body));return new Promise(resolve=>{postResolve=resolve;});},
 setInterval(fn){intervals.set(++intervalSeq,fn);return intervalSeq;},clearInterval(id){intervals.delete(id);}};
 vm.runInNewContext(fs.readFileSync(path.join(out,'bridge.js'),'utf8'),ctx);
 await nnk.modules.bridge.init({dispatch:async cmd=>{calls.push('start '+cmd.action);await Promise.resolve();if(cmd.action==='bad')throw Error('async rejected');calls.push('end '+cmd.action);}});
  await waitUntil(()=>posted.length===1);
  postResolve({ok:true,json:async()=>({commands:[{action:'bad'},{action:'good'}]})});await waitUntil(()=>!nnk.modules.bridge.snapshot().polling);
 assert.deepEqual(calls,['start bad','start good','end good']);assert.equal(nnk.modules.bridge.snapshot().events,1);
  [...intervals.values()][0]();await waitUntil(()=>posted.length===2);assert.equal(posted.at(-1).events[0].data.cmd,'bad');
  nnk.modules.bridge.stop('old');postResolve({ok:true,json:async()=>({commands:[{action:'late'}]})});await waitUntil(()=>!nnk.modules.bridge.snapshot().polling);assert.equal(calls.includes('start late'),false);assert.equal(intervals.size,0);
});
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual module behavior with synthetic external resources; no native/physical claim',tests},null,2));console.log(JSON.stringify({out,passed:tests.filter(x=>x.ok).length,total:tests.length}));if(tests.some(x=>!x.ok))process.exitCode=1;

if(!tests.some(x=>!x.ok))console.log('全部通过: '+tests.length+' 项');

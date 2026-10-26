#!/usr/bin/env node
// Deterministic lifecycle fixtures only. No network, native game or physical-pair evidence.
import assert from 'node:assert/strict';
import {fixture,deferred,drain,until,enter,SessionRegistry,runCases} from './fixtures/keepalive-lifecycle.mjs';

const cases=[],test=(name,fn)=>cases.push([name,fn]);
async function isolated(fn){
 const f=fixture(),lobbies=[];
 const make=options=>{const lobby=f.lobby(options?.connector?{sessions:options.connector.fixtureRegistry,...options}:options);lobbies.push(lobby);return lobby;};
 try{return await fn({f,make});}
 finally{for(const lobby of lobbies)await lobby.cancelAll();await f.close();}
}
function offline(f){let calls=0;return {...f.signaling,async openRoomSession(){calls++;throw Error('fixture MQTT unavailable');},calls:()=>calls};}
function actualConnector(f,options={}){const registry=new SessionRegistry(),connector=f.connector({...options,registry});connector.fixtureRegistry=registry;return connector;}
function publication(options){let closed=false,clears=0;return {code:options.code,publicationEpoch:options.publicationEpoch,endAndClearRetained(){if(closed)return false;closed=true;clears++;return true;},snapshot:()=>({closed,clears})};}
function controlled(connector,listenRoom){return {fixtureRegistry:connector.fixtureRegistry,listenRoom,makeInvite:connector.makeInvite.bind(connector),answerRoomOffer:connector.answerRoomOffer.bind(connector)};}
async function pair(host,guest){
 await host.createInternetRoom('single','invite');
 const invite=host.bridge.events.findLast(e=>e.type==='invite_ready').data;
 await guest.joinByInvite(invite.code);
 await host.acceptAnswer(invite.id,guest.bridge.events.findLast(e=>e.type==='answer_ready').data.code);
 await until(()=>host.sessions.list().length===1&&guest.sessions.list().length===1,'actual registry adoption');
 await drain();return {hostRecord:host.sessions.list()[0],guestRecord:guest.sessions.list()[0]};
}

test('invite-only room creates a real offer without invoking unavailable MQTT',()=>isolated(async({f,make})=>{
 const signaling=offline(f),connector=actualConnector(f,{signaling}),host=make({connector});
 await host.createInternetRoom('single','invite');
 assert.equal(signaling.calls(),0);assert.equal(f.pcs.length,1);assert.equal(f.pcs[0].offers,1);
 assert.ok(host.bridge.events.find(e=>e.type==='invite_ready')?.data.code);
 const state=host.snapshot();assert.equal(state.lobbyOpen,true);assert.match(state.roomCode,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(state.roomCodeAvailable,false);
 assert.equal(host.bridge.phases.at(-1).data.roomCodeAvailable,false);assert.equal(host.publication,null);
 assert.equal(Object.hasOwn(host.memberState(),'roomCodeAvailable'),false,'peer lobby projection stays unchanged');
 assert.equal(Object.hasOwn(host.memberState(),'joinKind'),false);
}));

test('first public failure closes the lobby and can retry through the invitation entrance',()=>isolated(async({f,make})=>{
 const signaling=offline(f),host=make({connector:actualConnector(f,{signaling})});
 await assert.rejects(host.createInternetRoom('single'),/MQTT unavailable/);
 assert.equal(host.lobby,null);assert.equal(host.snapshot().lobbyOpen,false);assert.equal(host.snapshot().roomCodeAvailable,false);assert.equal(host.bridge.phases.at(-1).phase,'idle');
 await host.createInternetRoom('single','invite');assert.equal(signaling.calls(),1);assert.equal(host.snapshot().lobbyOpen,true);assert.equal(host.invites.at(-1).status,'pending');
}));

test('real invitation pair adopts original transports while both MQTT paths are unavailable',()=>isolated(async({f,make})=>{
 const signaling=offline(f),host=make({connector:actualConnector(f,{signaling})}),guest=make({connector:actualConnector(f,{signaling})});
 const records=await pair(host,guest);
 assert.equal(signaling.calls(),0);assert.equal(f.pcs.length,2);assert.equal(guest.snapshot().joinKind,'invite');assert.equal(host.invites[0].status,'used');
 for(const [lobby,record]of [[host,records.hostRecord],[guest,records.guestRecord]]){const owner=lobby.sessions.getOwner(record.peerId);assert.equal(owner.ready,true);assert.equal(owner.snapshot().negotiations,1);assert.equal(owner.snapshot().pcConstructions,1);}
 await guest.cancelAll();await drain();assert.equal(guest.sessions.list().length,0);assert.equal(host.sessions.list().length,0,'the actual registry receives original Owner termination callbacks');
}));

test('failed private-to-public upgrade preserves invitations and registered transport identities',()=>isolated(async({f,make})=>{
 const signaling=offline(f),host=make({connector:actualConnector(f,{signaling})}),guest=make({connector:actualConnector(f,{signaling})});
 const records=await pair(host,guest),owner=host.sessions.getOwner(records.hostRecord.peerId),actual=owner.actualIdentity(),logical=host.lobby;
 enter(host.sessions,records.hostRecord,owner);await host.refreshInvite('invite');const pending=host.invites.at(-1),offerOwner=f.owners.at(-1);
 await assert.rejects(host.createInternetRoom('single'),/MQTT unavailable/);
 assert.equal(host.lobby,logical);assert.equal(host.snapshot().lobbyOpen,true);assert.equal(host.snapshot().roomCodeAvailable,false);assert.equal(pending.status,'pending');assert.equal(offerOwner.stopped,false);
 assert.equal(owner.stopped,false);assert.deepEqual(owner.actualIdentity(),actual);assert.equal(host.sessions.isEntered(records.hostRecord.peerId),true);
}));

test('concurrent public creates share one logical lobby and one publication',()=>isolated(async({f,make})=>{
 const gate=deferred();let calls=0;
 const signaling={...f.signaling,async openRoomSession(...args){calls++;await gate.promise;return f.signaling.openRoomSession(...args);}};
 const host=make({connector:actualConnector(f,{signaling})}),first=host.createInternetRoom('single'),logical=host.lobby,second=host.createInternetRoom('single');
 await drain();assert.equal(calls,1);assert.equal(host.lobby,logical);assert.equal(host.snapshot().roomCodeAvailable,false);
 gate.resolve();await Promise.all([first,second]);assert.equal(host.snapshot().roomCodeAvailable,true);assert.equal(f.brokerSessions.size,1);assert.equal(host.bridge.phases.at(-1).data.roomCodeAvailable,true);
}));

test('different entrance and invitation generation cannot race initial public failure cleanup',()=>isolated(async({f,make})=>{
 const gate=deferred(),connector=actualConnector(f),host=make({connector:controlled(connector,()=>gate.promise)});
 const pending=host.createInternetRoom('single'),failure=assert.rejects(pending,/MQTT unavailable/);
 await assert.rejects(host.createInternetRoom('single','invite'),/进行|重试/);
 await assert.rejects(host.refreshInvite('invite'),/进行|重试/);assert.equal(f.pcs.length,0);
 gate.reject(Error('fixture MQTT unavailable'));await failure;assert.equal(host.snapshot().lobbyOpen,false);
 await host.createInternetRoom('single','invite');assert.equal(host.snapshot().lobbyOpen,true);assert.equal(f.pcs.length,1);
}));

test('cancelled late publication is cleared and cannot replace a fresh invitation lobby',()=>isolated(async({f,make})=>{
 const gate=deferred(),connector=actualConnector(f);let options;
 const host=make({connector:controlled(connector,value=>{options=value;return gate.promise;})});
 const pending=host.createInternetRoom('single'),failure=assert.rejects(pending,/退休|失效|取消/);
 await host.cancelAll();await host.createInternetRoom('single','invite');const logical=host.lobby,offer=host.invites.at(-1);
 const late=publication(options);gate.resolve(late);await failure;
 assert.equal(late.snapshot().clears,1);assert.equal(host.lobby,logical);assert.equal(host.publication,null);assert.equal(offer.status,'pending');assert.equal(host.snapshot().roomCodeAvailable,false);
}));

test('old public rejection cannot clear a newer successful publication',()=>isolated(async({f,make})=>{
 const gate=deferred(),connector=actualConnector(f);let calls=0;
 const host=make({connector:controlled(connector,options=>++calls===1?gate.promise:connector.listenRoom(options))});
 const old=host.createInternetRoom('single'),failure=assert.rejects(old,/old failure/);
 await host.cancelAll();await host.createInternetRoom('single');const logical=host.lobby,current=host.publication;
 gate.reject(Error('old failure'));await failure;
 assert.equal(host.lobby,logical);assert.equal(host.publication,current);assert.equal(host.snapshot().roomCodeAvailable,true);assert.equal(current.snapshot().closed,false);
}));

test('failed room-code rotation advertises neither code and keeps invitation offers alive',()=>isolated(async({f,make})=>{
 let fail=false;const signaling={...f.signaling,async openRoomSession(...args){if(fail)throw Error('fixture rotation failure');return f.signaling.openRoomSession(...args);}};
 const codes=['ABC234','BCD345'],host=make({connector:actualConnector(f,{signaling}),newCode:()=>codes.shift()});
 await host.createInternetRoom('single');await host.refreshInvite('invite');const old=host.publication,offer=host.invites.at(-1),owner=f.owners.at(-1);
 fail=true;await assert.rejects(host.refreshInvite(),/rotation failure/);
 assert.equal(old.snapshot().closed,true);assert.equal(host.snapshot().lobbyOpen,true);assert.equal(host.snapshot().roomCodeAvailable,false);assert.equal(host.bridge.phases.at(-1).data.roomCodeAvailable,false);
 assert.equal(host.publication,null);assert.equal(offer.status,'pending');assert.equal(owner.stopped,false);assert.match(host.snapshot().roomCode,/^[A-HJ-NP-Z2-9]{6}$/);
}));

test('overlapping rotations do not change the in-flight code or start another publication',()=>isolated(async({f,make})=>{
 const gate=deferred(),connector=actualConnector(f),codes=['ABC234','BCD345','CDE456'];let calls=0;
 const host=make({connector:controlled(connector,async options=>{calls++;if(calls===2)await gate.promise;return connector.listenRoom(options);}),newCode:()=>codes.shift()});
 await host.createInternetRoom('single');const old=host.publication,pending=host.refreshInvite();await drain();const code=host.lobby.code;
 await assert.rejects(host.refreshInvite(),/进行|重试/);assert.equal(host.lobby.code,code);assert.equal(calls,2);assert.equal(host.snapshot().roomCodeAvailable,false);assert.equal(old.snapshot().closed,true);
 gate.resolve();await pending;assert.equal(host.snapshot().roomCodeAvailable,true);assert.equal(host.publication.code,code);
}));

test('retired onOffer callbacks cannot allocate an owner after rotation or cancellation',()=>isolated(async({f,make})=>{
 const connector=actualConnector(f),captured=[],codes=['ABC234','BCD345'];
 const host=make({connector:controlled(connector,options=>{captured.push(options);return connector.listenRoom(options);}),newCode:()=>codes.shift()});
 await host.createInternetRoom('single');const first=host.publication;await host.refreshInvite();const count=f.owners.length;
 const message={guestId:'123456',sdp:{type:'offer',sdp:'fixture:999'}};
 await captured[0].onOffer(message,first);assert.equal(f.owners.length,count);
 const current=host.publication;await host.cancelAll();await captured[1].onOffer(message,current);assert.equal(f.owners.length,count);
}));

test('cancelled invitation offer completion cannot emit a code into a fresh lobby',()=>isolated(async({f,make})=>{
 const gate=deferred(),host=make();f.plans.push({offerGate:gate});
 const pending=host.createInternetRoom('single','invite'),failure=assert.rejects(pending,/退休|失效|取消|retired|cancelled/i);
 await until(()=>f.pcs[0]?.offers===1);await host.cancelAll();await host.createInternetRoom('single','invite');const fresh=host.lobby,count=host.bridge.events.filter(e=>e.type==='invite_ready').length;
 gate.resolve({type:'offer',sdp:'fixture:1'});await failure;await drain();
 assert.equal(host.lobby,fresh);assert.equal(host.bridge.events.filter(e=>e.type==='invite_ready').length,count);assert.equal(f.pcs[0].locals,0);
}));

test('public room invitation creation keeps its original publication',()=>isolated(async({f,make})=>{
 const host=make();await host.createInternetRoom('single');const current=host.publication;
 await host.refreshInvite('invite');assert.equal(host.publication,current);assert.equal(current.snapshot().closed,false);assert.equal(host.snapshot().roomCodeAvailable,true);assert.equal(f.brokerSessions.size,1);assert.equal(f.pcs.length,1);
}));

test('guest room-code join remembers local source without adding peer projection fields',()=>isolated(async({f,make})=>{
 const host=make(),guest=make();await host.createInternetRoom('single');
 const pending=guest.joinByRoomCode(host.snapshot().roomCode);
 await until(()=>[...f.timers.timers.values()].some(t=>t.repeat&&t.ms===40),'discovery timer');f.timers.fire(40);await pending;
 await until(()=>host.sessions.list().length===1&&guest.sessions.list().length===1,'room registry adoption');
 assert.equal(guest.snapshot().joinKind,'room');assert.equal(Object.hasOwn(host.memberState(),'joinKind'),false);
 await guest.cancelAll();guest.resetSession();assert.equal(guest.snapshot().joinKind,null);
}));

test('guest invitation cancel and session reset clear the local join source',()=>isolated(async({f,make})=>{
 const host=make(),guest=make();await host.createInternetRoom('single','invite');
 await guest.joinByInvite(host.bridge.events.findLast(e=>e.type==='invite_ready').data.code);assert.equal(guest.snapshot().joinKind,'invite');
 await guest.cancelAll();assert.equal(guest.snapshot().joinKind,null);guest.resetSession();assert.equal(guest.snapshot().joinKind,null);assert.equal(guest.snapshot().roomCodeAvailable,false);
}));

test('dissolve keeps ever-entered registered transports and clears invitation resources',()=>isolated(async({f,make})=>{
 const host=make(),guest=make(),records=await pair(host,guest),owner=host.sessions.getOwner(records.hostRecord.peerId),actual=owner.actualIdentity();
 enter(host.sessions,records.hostRecord,owner);await host.refreshInvite('invite');
 await host.cancelAll();assert.equal(owner.stopped,false);assert.deepEqual(owner.actualIdentity(),actual);assert.equal(host.snapshot().lobbyOpen,false);assert.equal(host.snapshot().roomCodeAvailable,false);assert.equal(host.resourceSnapshot().attempts,0);assert.equal(host.connector.resourceSnapshot().activeAttempts,0);
}));

test('concurrent invitation creates share the original offer and logical lobby',()=>isolated(async({f,make})=>{
 const gate=deferred(),host=make();f.plans.push({offerGate:gate});
 const first=host.createInternetRoom('single','invite'),logical=host.lobby,second=host.createInternetRoom('single','invite');
 await until(()=>f.pcs[0]?.offers===1);assert.equal(f.pcs.length,1);assert.equal(host.lobby,logical);
 gate.resolve({type:'offer',sdp:'fixture:1'});await Promise.all([first,second]);assert.equal(host.invites.length,1);assert.equal(host.bridge.events.filter(e=>e.type==='invite_ready').length,1);
}));

test('public create during rotation joins its single current publication',()=>isolated(async({f,make})=>{
 const gate=deferred(),connector=actualConnector(f);let calls=0;
 const host=make({connector:controlled(connector,async options=>{if(++calls===2)await gate.promise;return connector.listenRoom(options);})});
 await host.createInternetRoom('single');const logical=host.lobby,rotate=host.refreshInvite();await drain();
 const create=host.createInternetRoom('single');await drain();assert.equal(calls,2);assert.equal(host.snapshot().roomCodeAvailable,false);
 gate.resolve();await Promise.all([rotate,create]);assert.equal(host.lobby,logical);assert.equal(host.snapshot().roomCodeAvailable,true);assert.equal(f.brokerSessions.size,1);
}));

test('successful private upgrade retains the same lobby and adopted transport',()=>isolated(async({f,make})=>{
 const host=make(),guest=make(),records=await pair(host,guest),logical=host.lobby,code=host.snapshot().roomCode;
 const owner=host.sessions.getOwner(records.hostRecord.peerId),actual=owner.actualIdentity();
 await host.createInternetRoom('single');assert.equal(host.lobby,logical);assert.equal(host.snapshot().roomCode,code);assert.equal(host.snapshot().roomCodeAvailable,true);
 assert.equal(host.sessions.getOwner(records.hostRecord.peerId),owner);assert.deepEqual(owner.actualIdentity(),actual);assert.equal(owner.stopped,false);assert.equal(f.pcs.length,2);
}));

test('late cancelled guest invitation SDP cannot clear a fresh room join source',()=>isolated(async({f,make})=>{
 const host=make(),guest=make(),oldGate=deferred(),freshGate=deferred();
 await host.createInternetRoom('single','invite');f.plans.push({remoteGate:oldGate});
 const old=guest.joinByInvite(host.bridge.events.findLast(e=>e.type==='invite_ready').data.code),oldFailure=assert.rejects(old);
 await until(()=>f.pcs[1]?.remotes===1);guest.cancelJoin();await host.createInternetRoom('single');
 f.plans.push({offerGate:freshGate});const fresh=guest.joinByRoomCode(host.snapshot().roomCode);
 await until(()=>f.pcs[2]?.offers===1);const marker=guest.joinAttempt;
 oldGate.resolve();await oldFailure;await drain();assert.equal(guest.joinAttempt,marker);assert.equal(guest.snapshot().joinKind,'room');assert.equal(f.pcs[1].locals,0);
 freshGate.resolve({type:'offer',sdp:'fixture:3'});await until(()=>[...f.timers.timers.values()].some(t=>t.repeat&&t.ms===40));f.timers.fire(40);await fresh;
 await until(()=>guest.sessions.list().length===1);assert.equal(guest.snapshot().joinKind,'room');
}));

test('cancelled invitation answer completion cannot adopt into a fresh private lobby',()=>isolated(async({f,make})=>{
 const gate=deferred(),host=make(),guest=make();f.plans.push({remoteGate:gate});
 await host.createInternetRoom('single','invite');const invite=host.bridge.events.findLast(e=>e.type==='invite_ready').data;
 await guest.joinByInvite(invite.code);const answer=host.acceptAnswer(invite.id,guest.bridge.events.findLast(e=>e.type==='answer_ready').data.code),failure=assert.rejects(answer);
 await until(()=>f.pcs[0]?.remotes===1);await host.cancelAll();await host.createInternetRoom('single','invite');const logical=host.lobby,latest=host.invites.at(-1),owner=f.owners.at(-1);
 gate.resolve();await failure;await drain();assert.equal(host.lobby,logical);assert.equal(latest.status,'pending');assert.equal(owner.stopped,false);assert.equal(host.sessions.list().length,0);assert.equal(host.snapshot().roomCodeAvailable,false);
}));

await runCases(cases);

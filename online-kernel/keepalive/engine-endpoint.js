import {createEngineOperationPort} from './engine-operation-port.js';
import {createNativeSettlement} from './native-settlement.js';

const SCOPE_KEYS=['sessionId','roundId','documentGeneration','bindingId','bindingNonce','expectedOrigin'];
const MODES=['identity','guozhan','versus','doudizhu','single'];
export function sameEngineScope(a,b){return !!a&&!!b&&Object.keys(a).length===6&&Object.keys(b).length===6&&SCOPE_KEYS.every(key=>a[key]===b[key]);}
const json=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
const errorJSON=error=>({message:error?.message||String(error),stack:error?.stack||null});
const byteLength=value=>new TextEncoder().encode(value).byteLength;
function retiredNativeServer(){throw Error('Retired engine document cannot create a native server');}

// The protocol core is independently testable with a synthetic env. Only
// attachEngine below binds the native port and reads real document evidence.
export function createEngineEndpoint(nnk,{native,info,port,isCurrent,documentToken,onRetire=()=>{},adapterResources=()=>({})}={}){
  if(!nnk?.env||!port||typeof isCurrent!=='function'||!sameEngineScope(info?.scope,info?.scope)||!['host','guest'].includes(info.role))throw Error('Invalid actual engine endpoint');
  const env=nnk.env,scope=Object.freeze({...info.scope}),role=info.role;
  const peers=new Map(),startRoster=new Set(),ownedFacades=new WeakSet(),timers=new Set(),requests=new Map(),requestHistory=[],waitingPromises=new Set(),retiredHandlerPeers=new Set();
  const wire=[];let wireBytes=0,wireCount=0,queueCount=0,queueBytes=0,closed=false,prepared=false,softCreated=false,mode=null;
  let preparePromise=null,prepareError=null,environmentProof={environmentProofReady:false},statusTimer=null,nativeReportPending=0,nativeReportPromise=null,detachPromise=null,bridgeRestore=null;
  let startButton=null,startGuard=null,releaseFreeChoiceFailure=null;
  const limits=Object.freeze({peerCount:16,perPeerFrames:128,perPeerBytes:1048576,aggregateFrames:512,aggregateBytes:4194304,
    queueTimeoutMs:5000,wireFrames:64,wireBytes:262144,requestPending:16,requestHistory:32,prepareTimeoutMs:12000});
  const current=()=>!closed&&nnk.env===env&&isCurrent();
  function guard(){if(!current())throw Error('Retired engine document');}
  function checkFileAdmission(socket){
    guard();const batch=nnk.modules.batch;
    if(typeof batch?.canEnter!=='function')throw Error('Current file-transaction admission module unavailable');
    if(batch.canEnter(socket)!==true)throw Error('本页文件事务尚未结案或文件已提交，须恢复或重新建立引擎文档后入座');
    guard();
  }
  function peerCurrent(peer){return current()&&!peer.retired&&peers.get(peer.peerId)===peer;}
  function post(value,allowClosed=false){if(!allowClosed)guard();port.postMessage(json({...value,scope}));}
  function ownTimeout(fn,delay){const timer=setTimeout(()=>{timers.delete(timer);fn();},delay);timers.add(timer);return timer;}
  function clearOwn(timer){if(timer!==null&&timer!==undefined){clearTimeout(timer);timers.delete(timer);}}
  function note(peer,direction,raw,seq=null){
    let tag=null;try{const value=JSON.parse(raw);if(Array.isArray(value)&&typeof value[0]==='string')tag=value[0];}catch{}
    const counterTag=['opened','init','inited','reinit','reinited','exec'].includes(tag)?tag:'other';
    if(['opened','init','inited'].includes(tag)){if(peer.handshakeOrder.length<4)peer.handshakeOrder.push(direction+':'+tag);else peer.handshakeOrderInvalid=true;}
    peer.tags[direction][counterTag]=(peer.tags[direction][counterTag]||0)+1;
    if(direction==='out'&&tag==='inited')peer.guestInitedSent={at:Date.now(),peerId:peer.peerId,tag:'inited'};
    const row={at:Date.now(),peerId:peer.peerId,direction,tag:tag&&tag.slice(0,80),seq,raw};const bytes=byteLength(raw);
    wireCount++;
    if(bytes<=limits.wireBytes){wire.push(row);wireBytes+=bytes;while(wire.length>limits.wireFrames||wireBytes>limits.wireBytes)wireBytes-=byteLength(wire.shift().raw);}
    return tag;
  }
  function capacity(){
    if(role!=='host'||!prepared||!softCreated||!env._status.waitingForPlayer||env.lib.configOL?.mode!==mode)return null;
    const number=Number.parseInt(env.lib.configOL.number,10)||Number.parseInt(env.lib.configOL.player_number,10);
    return Number.isSafeInteger(number)&&number>0?number:null;
  }
  function clients(){return (env.lib.node?.clients||[]).map(client=>({id:client.id||null,inited:client.inited===true,closed:client.closed===true,
    peerId:[...peers.values()].find(peer=>peer.facade===client.ws)?.peerId||null}));}
  function seats(){return (env.game.connectPlayers||[]).map(seat=>({playerid:seat.playerid||null,isMe:seat===env.game.me,
    unselectable:!!seat.classList?.contains('unselectable2')}));}
  function officialReferences(){return Number(!!env.game.ws&&ownedFacades.has(env.game.ws))+(env.lib.node?.clients||[]).filter(client=>client.ws&&ownedFacades.has(client.ws)).length;}
  function resources(){return {endpoint:{timers:timers.size+Number(statusTimer!==null),ports:Number(port!==null),portCallbacks:Number(!closed&&typeof port?.onmessage==='function'),
    approvedPeers:peers.size,facadeReferences:[...peers.values()].filter(peer=>peer.facade!==null).length,shimReferences:[...peers.values()].filter(peer=>peer.shim!==null).length,
    handshakeBuffer:queueCount,handshakeBufferBytes:queueBytes,requestsPending:[...requests.values()].filter(row=>!row.settled).length,
    requestHistory:requestHistory.length,preparationPending:Number(preparePromise!==null),nativeReportsPending:nativeReportPending,
    officialFacadeReferences:officialReferences(),retiredServerGuardReferences:Number(env.game.createServer===retiredNativeServer),
    pendingOfficialHandlers:[...new Set([...peers.values(),...retiredHandlerPeers])].reduce((sum,peer)=>sum+peer.pendingOfficialHandlers,0),
    retiredOfficialHandlers:[...retiredHandlerPeers].map(peer=>({peerId:peer.peerId,pending:peer.pendingOfficialHandlers})),wireFrames:wire.length,wireBytes,wireCount,...adapterResources(),
    peers:[...peers.values()].map(peer=>({peerId:peer.peerId,frames:peer.queue.length,bytes:peer.queueBytes,receivedSeq:peer.receivedSeq,appliedSeq:peer.appliedSeq,
      pendingOfficialHandlers:peer.pendingOfficialHandlers,retired:peer.retired,facadeAttached:!!peer.facade,seatValidated:peer.seatValidated,startConfirmed:peer.startConfirmed})),
    startGuardListeners:startGuard===null?0:2,startButtonReferences:Number(startButton!==null),startRosterScalars:startRoster.size},
    settlement:settlement.resources(),operations:operations.pendingSnapshot(),consent:nnk.modules.consent?.resourceSnapshot?.()||null,manifest:nnk.modules.manifest?.resourceSnapshot?.()||null,
    freeCharacterChoice:nnk.modules.freeCharacterChoice?.resourceSnapshot?.()||null,
    batch:{paused:nnk.modules.batch?.paused,internalResourcesObservable:typeof nnk.modules.batch?.resourceSnapshot==='function',
      internalResources:nnk.modules.batch?.resourceSnapshot?.()??null},
    limits:'Counts are own endpoint references. Official Client.ws/game.ws references remain counted until native destruction; native internal asynchronous engine work and unexposed batch I/O are not reported as zero.'};}
  function snapshot(){return {role,scope,version:env.lib.version,bootStage:nnk.state?.bootStage,documentToken,waiting:!!env._status.waitingForPlayer,
    playing:!env._status.over&&env.lib.configOL?.gameStarted===true&&(env.game.players||[]).length>0&&!!env._status.connectMode,
    over:!!env._status.over,phaseNumber:env.game.phaseNumber??null,playerCount:(env.game.players||[]).length,
    online:!!env.game.online,onlineID:env.game.onlineID||null,mode,capacity:capacity(),prepared,facadeAttached:[...peers.values()].some(peer=>!!peer.facade),
    clients:clients(),seats:seats(),paused:nnk.modules.batch?.paused,legacyPaused:nnk.modules.transfer?.paused,
    approvedPeers:[...peers.keys()],startRoster:[...startRoster],seatValidatedPeers:[...peers.values()].filter(peer=>peer.seatValidated).map(peer=>peer.peerId),startActivatedPeers:[...peers.values()].filter(peer=>peer.startConfirmed).map(peer=>peer.peerId),peerProofs:[...peers.values()].map(peer=>({peerId:peer.peerId,admitted:peer.admitted,
      clientId:(env.lib.node?.clients||[]).find(client=>client.ws===peer.facade)?.id||null,
      clientInited:(env.lib.node?.clients||[]).some(client=>client.ws===peer.facade&&client.inited===true),guestInitedSent:peer.guestInitedSent,
      receivedSeq:peer.receivedSeq,appliedSeq:peer.appliedSeq,seatValidated:peer.seatValidated,startConfirmed:peer.startConfirmed,handshakeOrder:peer.handshakeOrder.join(","),handshakeOrderInvalid:peer.handshakeOrderInvalid,handshake:json(peer.tags)})),
    settlement:settlement.snapshot(),wire:wire.slice(),resourceSnapshot:resources(),...environmentProof};}
  function reportStatus(type='current-status',extra={}){
    if(!current())return;
    const value={type,...snapshot(),...extra};post({type:'status',value});
    if(native?.report&&nativeReportPending===0){
      nativeReportPending++;
      nativeReportPromise=Promise.resolve().then(()=>{guard();return native.report(scope,value);}).catch(error=>{
        console.error('[联机助手] 当前引擎状态回执失败',error);
        if(current())post({type:'failure',requestId:null,error:errorJSON(error),stage:'native-report'});
      }).finally(()=>{nativeReportPending--;nativeReportPromise=null;});
    }
  }
  function moduleEvent(name,data){if(current())post({type:'module-event',name,data:json(data)});}
  const settlement=createNativeSettlement({env,role,scope,isCurrent:current,emit:moduleEvent,expectedPeers:()=>startRoster,
    actualRoster:()=>{const nativePlayers=[...new Set([...(env.game.players||[]),...(env.game.dead||[]),...(env.game.additionaldead||[])])],rows=[];
      for(const player of nativePlayers){if(player===env.game.me||!player.isOnline2?.())continue;
        const client=(env.lib.node?.clients||[]).find(value=>value.id===player.playerid&&value.inited===true&&value.closed!==true);
        const peer=client&&[...peers.values()].find(value=>value.facade===client.ws&&value.startConfirmed);
        if(!peer)throw Error('Actual native settlement player has no current approved Client');
        rows.push({peerId:peer.peerId,playerId:player.playerid,clientId:client.id,receivedSeq:peer.receivedSeq,appliedSeq:peer.appliedSeq,sequenceGap:peer.sequenceGap,pendingOfficialHandlers:peer.pendingOfficialHandlers});
      }return rows;}});
  const operations=createEngineOperationPort(nnk,{isCurrent:current,scope,onEvent:moduleEvent});
  // Keep the existing module event behavior and forward a scoped JSON copy.
  const bridge=nnk.modules.bridge;
  if(bridge){const original=bridge.emit;const forward=function(name,data){if(!current())return;moduleEvent(name,data);return typeof original==='function'?original.call(this,name,data):undefined;};
    bridge.emit=forward;bridgeRestore=()=>{if(bridge.emit===forward)bridge.emit=original;};}
  else {const owned={emit:moduleEvent,setPhase(phase,data){moduleEvent('engine-phase',{phase,...data});}};nnk.modules.bridge=owned;
    bridgeRestore=()=>{if(nnk.modules.bridge===owned)delete nnk.modules.bridge;};}
  function failure(error,{peerId=null,stage='protocol',requestId=null}={}){
    console.error('[联机助手] 当前引擎端点操作失败',error);
    if(current())post({type:'failure',peerId,stage,requestId,error:errorJSON(error)});
  }
  if(typeof nnk.modules.freeCharacterChoice?.setFailureHandler==='function')releaseFreeChoiceFailure=nnk.modules.freeCharacterChoice.setFailureHandler(error=>failure(error,{stage:'free-character-choice'}));
  function clearQueue(peer){clearOwn(peer.queueTimer);peer.queueTimer=null;queueCount-=peer.queue.length;queueBytes-=peer.queueBytes;peer.queue.length=0;peer.queueBytes=0;}
  function disposePeer(peer,errors){
    peer.retired=true;peer.seatValidated=false;peer.startConfirmed=false;peer.confirmedSeat=null;clearQueue(peer);
    if(peer.pendingOfficialHandlers)retiredHandlerPeers.add(peer);
    if(peer.shim){peer.shim.readyState='closed';peer.shim.onopen=peer.shim.onmessage=peer.shim.onclose=peer.shim.onerror=null;}
    if(peer.facade){try{peer.facade.dispose();}catch(error){errors.push(errorJSON(error));console.error('[联机助手] 当前 façade 回收失败',error);}
      peer.facade.onopen=peer.facade.onmessage=peer.facade.onclose=peer.facade.onerror=null;}
    peer.facade=null;peer.shim=null;
  }
  function detach(reason='round retired'){
    if(closed)return detachPromise||Promise.resolve({alreadyDetached:true});closed=true;const cleanupErrors=[];
    if(statusTimer!==null)clearInterval(statusTimer);statusTimer=null;
    releaseStartGuard();
    try{settlement.dispose();}catch(error){cleanupErrors.push(errorJSON(error));}
    try{releaseFreeChoiceFailure?.();}catch(error){cleanupErrors.push(errorJSON(error));}releaseFreeChoiceFailure=null;
    try{nnk.modules.freeCharacterPicker?.dispose();}catch(error){cleanupErrors.push(errorJSON(error));}
    try{nnk.modules.freeCharacterChoice?.dispose();}catch(error){cleanupErrors.push(errorJSON(error));}
    operations.dispose();
    for(const cancel of [...waitingPromises])cancel();
    for(const peer of peers.values())disposePeer(peer,cleanupErrors);peers.clear();startRoster.clear();
    for(const timer of timers)clearTimeout(timer);timers.clear();
    // Native switchMode/load work is not cancellable. Restoring the original
    // network server here would let its late callback start a listener after
    // retirement. A non-capturing refusal survives only in this retired realm.
    if(env.game.createServer===ownedCreateServer)env.game.createServer=retiredNativeServer;
    try{onRetire(reason);}catch(error){cleanupErrors.push(errorJSON(error));}
    try{bridgeRestore?.();}catch(error){cleanupErrors.push(errorJSON(error));}bridgeRestore=null;
    wire.length=0;wireBytes=0;requests.clear();requestHistory.length=0;
    port.onmessage=null;
    const report=nativeReportPromise;
    // JSON IPC has its own bounded timeout. Give only this endpoint report a
    // short cleanup grace; native save/getDB work remains honestly observable.
    detachPromise=(async()=>{
      let graceTimer=null,reportSettled=true;
      if(report){const result=await Promise.race([report.then(()=>true),new Promise(resolve=>{graceTimer=ownTimeout(()=>resolve(false),1000);})]);clearOwn(graceTimer);reportSettled=result;}
      // Canceled own operation queues reject through finite microtasks. Yield
      // one own task so they drain; no native I/O completion is awaited here.
      await new Promise(resolve=>ownTimeout(resolve,0));
      const closingPort=port;port=null;
      const value={reason,cleanupErrors,ownNativeReportSettled:reportSettled,
        moduleResources:{consent:nnk.modules.consent?.resourceSnapshot?.()||null,manifest:nnk.modules.manifest?.resourceSnapshot?.()||null},
        officialFacadeReferencesBeforeNativeDestruction:officialReferences(),ownedCleanup:resources(),
        portFinalization:'own port is synchronously closed after final acknowledgment is enqueued'};
      try{closingPort.postMessage(json({type:'detached',scope,...value}));}finally{closingPort.close();}
      return value;
    })();
    detachPromise.catch(error=>{console.error('[联机助手] 端点退休回执失败',error);if(port){port.close();port=null;}});
    return detachPromise;
  }
  function approvePeer(peerId){
    guard();if(typeof peerId!=='string'||!peerId||peerId.length>160)throw Error('Invalid approved logical peer');
    if(peers.has(peerId)){if(!peerCurrent(peers.get(peerId)))throw Error('A retired peer cannot be reapproved in this document');return {peerId,approved:true,reused:true};}
    if(peers.size>=limits.peerCount||role==='guest'&&peers.size>0)throw Error('Current endpoint peer limit exceeded');
    if(role==='host'&&capacity()===null)throw Error('A fresh native waiting room is required before approval');
    peers.set(peerId,{peerId,retired:false,shim:null,facade:null,admitted:false,queue:[],queueBytes:0,queueTimer:null,
      receivedSeq:0,appliedSeq:0,sequenceGap:false,pendingOfficialHandlers:0,guestInitedSent:null,seatValidated:false,startConfirmed:false,confirmedSeat:null,handshakeOrder:[],handshakeOrderInvalid:false,tags:{in:{},out:{}}});
    return {peerId,approved:true};
  }
  function shimFor(peer){
    const shim={readyState:'open',onopen:null,onmessage:null,onclose:null,onerror:null,
      send(raw){if(!peerCurrent(peer)||shim.readyState!=='open')throw Error('Retired façade cannot send');if(typeof raw!=='string')throw Error('Official payload must remain a raw string');
        const terminal=settlement.outgoing(peer.peerId,raw);note(peer,'out',raw);post({type:'send',peerId:peer.peerId,raw,...(terminal?{terminal}:{})});reportStatus('wire-sent');},
      close(){if(!peerCurrent(peer)||shim.readyState==='closed')return;shim.readyState='closed';post({type:'engine-close',peerId:peer.peerId});
        const errors=[];disposePeer(peer,errors);failure(Error('Native façade closed'),{peerId:peer.peerId,stage:'native-close'});}};
    peer.shim=shim;return shim;
  }
  function canDeliver(peer){return !!peer.facade&&typeof peer.shim?.onmessage==='function'&&typeof peer.facade.onmessage==='function';}
  function applyGame(peer,message){
    if(!peerCurrent(peer))throw Error('Retired peer handler');
    const before=settlement.beforeFrame(message.raw);note(peer,'in',message.raw,message.seq);peer.shim.onmessage({data:message.raw});
    if(peerCurrent(peer)){peer.appliedSeq=message.seq;settlement.afterFrame(peer.peerId,message.raw,message.seq,before);reportStatus('game-handler-returned',{peerId:peer.peerId,deliveredSeq:message.seq});}
  }
  function receiveGame(message){
    guard();const peer=peers.get(message.peerId);
    if(!peer||!peerCurrent(peer))throw Error('Game frame has no explicitly approved current peer');
    if(typeof message.raw!=='string'||!Number.isSafeInteger(message.seq)||message.seq<=peer.receivedSeq)throw Error('Invalid current game sequence or payload');
    if(peer.receivedSeq!==0&&message.seq!==peer.receivedSeq+1)peer.sequenceGap=true;
    if(canDeliver(peer)&&!peer.queue.length){peer.receivedSeq=message.seq;applyGame(peer,message);return;}
    const bytes=byteLength(message.raw);
    if(peer.queue.length>=limits.perPeerFrames||peer.queueBytes+bytes>limits.perPeerBytes||queueCount>=limits.aggregateFrames||queueBytes+bytes>limits.aggregateBytes)throw Error('Current handshake queue overflow');
    peer.receivedSeq=message.seq;peer.queue.push({seq:message.seq,raw:message.raw,at:Date.now()});peer.queueBytes+=bytes;queueCount++;queueBytes+=bytes;
    if(peer.queueTimer===null)peer.queueTimer=ownTimeout(()=>{peer.queueTimer=null;if(peerCurrent(peer)&&peer.queue.length){failure(Error('Current handshake queue expired'),{peerId:peer.peerId,stage:'handshake'});detach('handshake queue expired');}},limits.queueTimeoutMs);
    reportStatus('current-handshake-buffered',{peerId:peer.peerId});
  }
  function flush(peer){
    guard();if(!canDeliver(peer))throw Error('Native current façade handler is not ready');
    const values=peer.queue.slice();clearQueue(peer);for(const value of values)applyGame(peer,value);
  }
  function activeSeatIds(){
    return seats().filter(seat=>seat.playerid&&!seat.unselectable).map(seat=>seat.playerid).sort();
  }
  function hasActualHostSeat(){const host=env.game.connectPlayers?.[0];return !!host&&host.playerid==='1'&&env.game.onlinezhu==='1'&&!host.classList?.contains('unselectable2');}
  function actualConfirmedClient(peer){
    if(!peerCurrent(peer)||!peer.admitted||!peer.facade)return null;
    const matches=(env.lib.node?.clients||[]).filter(value=>value.ws===peer.facade);
    if(matches.length!==1)return null;
    const client=matches[0];
    return client.closed!==true&&client.inited===true&&typeof client.id==='string'&&client.id&&!peer.handshakeOrderInvalid&&peer.handshakeOrder.join(',')==='out:opened,in:init,out:init,in:inited'?client:null;
  }
  function reserveStartPeer(peerId){
    guard();if(role!=='host'||typeof peerId!=='string'||!peerId||peerId.length>160)throw Error('Invalid current Host start reservation');
    if(!env._status.waitingForPlayer||!startButton||!startGuard||env.ui.connectStartButton!==startButton||startButton.clicked===true)return {peerId,reserved:false,reason:'native-game-started'};
    const size=capacity();if(size===null)throw Error('Start reservation requires the actual current native waiting room');
    if(startRoster.has(peerId))return {peerId,reserved:true,reused:true};
    if(startRoster.size>=Math.min(size-1,limits.peerCount))throw Error('Actual native start roster capacity is full');
    startRoster.add(peerId);reportStatus('native-start-peer-reserved',{peerId});return {peerId,reserved:true};
  }
  function releaseStartPeer(peerId){
    guard();if(role!=='host'||typeof peerId!=='string'||!peerId||peerId.length>160)throw Error('Invalid current Host start reservation release');
    const peer=peers.get(peerId);
    if(peer&&(peer.admitted||peer.startConfirmed||peer.facade||!env._status.waitingForPlayer))throw Error('An actual approved or admitted game participant cannot be released from the start roster');
    const released=startRoster.delete(peerId);reportStatus('native-start-peer-reservation-released',{peerId});return {peerId,released};
  }
  const proofKeys=['hostClientId','guestOnlineID','hostClientInited','guestInited','ordered','seated','hostSeats','guestSeats','hostDocumentGeneration','guestDocumentGeneration','roundId'];
  function validateProofShape(peer,proof){
    const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160;
    const seatList=value=>Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(identifier)&&new Set(value).size===value.length;
    if(role!=='host'||!peer||!peerCurrent(peer)||!startRoster.has(peer.peerId)||!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).length!==proofKeys.length||proofKeys.some(key=>!Object.hasOwn(proof,key))||
      !identifier(proof.hostClientId)||proof.hostClientId!==proof.guestOnlineID||proof.hostClientInited!==true||proof.guestInited!==true||proof.ordered!==true||proof.seated!==true||
      proof.roundId!==scope.roundId||proof.hostDocumentGeneration!==scope.documentGeneration||!Number.isSafeInteger(proof.guestDocumentGeneration)||proof.guestDocumentGeneration<1||
      !seatList(proof.hostSeats)||!seatList(proof.guestSeats)||!proof.hostSeats.includes(proof.hostClientId)||!proof.guestSeats.includes(proof.hostClientId)||JSON.stringify([...proof.hostSeats].sort())!==JSON.stringify([...proof.guestSeats].sort()))throw Error('Invalid current canonical seating confirmation');
    return JSON.stringify(proofKeys.map(key=>proof[key]));
  }
  function confirmSeat(args){
    guard();const peer=peers.get(args.peerId),proof=args.proof,proofSignature=validateProofShape(peer,proof);
    const client=actualConfirmedClient(peer),actual=activeSeatIds(),host=[...proof.hostSeats].sort(),guest=[...proof.guestSeats].sort();
    if(!client||client.id!==proof.hostClientId||!actual.includes(client.id)||!hasActualHostSeat()||client.id==='1'||new Set(actual).size!==actual.length)throw Error('Seating confirmation does not match the actual current Client, fresh handshake and active seats');
    if(peer.seatValidated){if(peer.confirmedSeat?.proofSignature!==proofSignature)throw Error('Current seat was already validated with another canonical proof');return {confirmed:true,peerId:peer.peerId};}
    if(!env._status.waitingForPlayer)throw Error('New seating confirmation is outside the actual native waiting room');
    if(JSON.stringify(actual)!==JSON.stringify(host)||JSON.stringify(actual)!==JSON.stringify(guest))return {confirmed:false,peerId:peer.peerId,reason:'seat-list-changed'};
    peer.seatValidated=true;peer.confirmedSeat={clientId:client.id,roundId:scope.roundId,hostDocumentGeneration:scope.documentGeneration,guestDocumentGeneration:proof.guestDocumentGeneration,proofSignature};
    reportStatus('native-seat-validated',{peerId:peer.peerId});
    return {confirmed:true,peerId:peer.peerId};
  }
  function activateSeat(args){
    guard();const peer=peers.get(args.peerId),proofSignature=validateProofShape(peer,args.proof),client=actualConfirmedClient(peer),confirmed=peer.confirmedSeat,actual=activeSeatIds();
    if(!peer.seatValidated||!confirmed||confirmed.proofSignature!==proofSignature||!client||client.id!==confirmed.clientId||confirmed.roundId!==scope.roundId||confirmed.hostDocumentGeneration!==scope.documentGeneration||!actual.includes(client.id)||!hasActualHostSeat()||client.id==='1'||new Set(actual).size!==actual.length)throw Error('Current native seat was not validated or its actual Client/seat has changed');
    peer.startConfirmed=true;reportStatus('native-seat-start-activated',{peerId:peer.peerId});
    return {activated:true,peerId:peer.peerId};
  }
  function releaseStartGuard(){
    if(startButton&&startGuard){startButton.removeEventListener('click',startGuard,true);startButton.removeEventListener('touchend',startGuard,true);}
    startGuard=null;startButton=null;
  }
  function installStartGuard(){
    guard();if(role!=='host')throw Error('Native start guard is Host-only');
    const button=env.ui.connectStartButton;
    if(!button||typeof button.addEventListener!=='function'||typeof button.removeEventListener!=='function')throw Error('Actual native waiting-room start button is unavailable');
    if(startButton===button&&startGuard)return;
    if(startButton!==null)throw Error('Native waiting-room start button changed in the current document');
    const listener=function(event){
      const block=()=>{event.preventDefault();event.stopImmediatePropagation();};
      if(!current()){block();return;}
      const actual=activeSeatIds(),blocked=[...new Set([...startRoster,...peers.keys()])].filter(peerId=>{
        const peer=peers.get(peerId);if(!peer)return true;
        const client=actualConfirmedClient(peer),confirmed=peer.confirmedSeat;
        return !peer.startConfirmed||!client||!confirmed||confirmed.clientId!==client.id||confirmed.roundId!==scope.roundId||confirmed.hostDocumentGeneration!==scope.documentGeneration||!actual.includes(client.id);
      });
      if(env.ui.connectStartButton!==button||!env._status.waitingForPlayer||!hasActualHostSeat()||new Set(actual).size!==actual.length||blocked.length){
        block();if(current())nnk.modules.bridge.emit('info',{message:'本局玩家尚未完成实际入座确认，请等待后再次点击开始。',peerIds:blocked});return;
      }
      // Preserve the original target handler, resume call, alert and node deletion.
      // Its synchronous deletion is observed in an own microtask; no native flag
      // is written by this guard and a blocked click never consumes the button.
      queueMicrotask(()=>{if(current()&&startButton===button&&env.ui.connectStartButton!==button&&button.clicked===true)releaseStartGuard();});
    };
    button.addEventListener('click',listener,{capture:true,passive:false});
    try{button.addEventListener('touchend',listener,{capture:true,passive:false});}catch(error){button.removeEventListener('click',listener,true);throw error;}
    startButton=button;startGuard=listener;
  }
  function ownedCreateServer(){
    guard();if(role!=='host'||!prepared||!mode)throw Error('Native server creation is outside current host preparation');
    if(softCreated)return;softCreated=true;
    const {lib,game,ui}=env;lib.node=lib.node||{};
    lib.node.clients=[];lib.node.banned=[];lib.node.observing=[];lib.node.torespond={};lib.node.torespondtimeout={};lib.node.waitForResult={};
    lib.playerOL={};lib.cardOL={};lib.vcardOL={};lib.wsOL={};
    if(!lib.configOL||lib.configOL.mode!==mode)throw Error('Native mode configuration is not fresh');
    lib.configOL.observe=false;lib.configOL.choose_timeout='60';ui.create.roomInfo();ui.create.chat();game.ip='nnk://keepalive';
    nnk.modules.compat?.unlockPacks?.();nnk.modules.compat?.dumpExtensions?.();reportStatus('soft-server-created');
  }
  function waitWaitingRoom(){return new Promise((resolve,reject)=>{
    const started=Date.now();let timer=null,settled=false;
    function finish(error,value){if(settled)return;settled=true;clearOwn(timer);waitingPromises.delete(cancel);if(error)reject(error);else resolve(value);}
    function cancel(){finish(Error('Retired native waiting room preparation'));}waitingPromises.add(cancel);
    function poll(){try{guard();const size=capacity();if(size!==null&&Array.isArray(env.game.connectPlayers)&&env.game.connectPlayers.length){installStartGuard();finish(null,{mode,capacity:size,configOL:json(env.lib.configOL),seats:seats()});return;}
      if(Date.now()-started>=limits.prepareTimeoutMs)throw Error('Fresh native waiting room deadline exceeded');timer=ownTimeout(poll,50);
    }catch(error){finish(error);}}
    poll();
  });}
  function prepareHost(args){
    guard();if(role!=='host'||!MODES.includes(args.mode))throw Error('Unsupported allowed host mode');
    checkFileAdmission(undefined);
    if(prepared){if(prepareError)throw Error('Current preparation failed: '+prepareError.message);if(mode!==args.mode)throw Error('Current document already prepared for another mode');return preparePromise||Promise.resolve({mode,capacity:capacity(),prepared:true,reused:true});}
    prepared=true;mode=args.mode;
    if(args.startRoster){if(!Array.isArray(args.startRoster)||args.startRoster.length>limits.peerCount||args.startRoster.some(peer=>typeof peer!=='string'||!peer||peer.length>160)||new Set(args.startRoster).size!==args.startRoster.length)throw Error('Invalid frozen next-round start roster');for(const peer of args.startRoster)startRoster.add(peer);}
    preparePromise=(async()=>{await operations.execute('host-policy');guard();checkFileAdmission(undefined);env._status.connectMode=true;env.game.online=false;delete env.game.onlineID;
      env.game.createServer=ownedCreateServer;env.game.switchMode(mode);guard();const value=await waitWaitingRoom();guard();settlement.install();reportStatus('host-waiting-room-ready');return value;
    })().catch(error=>{prepareError=errorJSON(error);throw error;}).finally(()=>{preparePromise=null;});return preparePromise;
  }
  function prepareGuest(args){
    guard();if(role!=='guest')throw Error('Guest preparation is unavailable on a host');
    const peer=peers.get(args.peerId);if(!peer||!peerCurrent(peer))throw Error('Guest façade requires its explicitly approved Host peer');
    checkFileAdmission(peer.facade||undefined);
    if(prepared){if(prepareError||!peer.facade)throw Error('Guest preparation previously failed');return {peerId:peer.peerId,prepared:true,reused:true};}
    try{
    prepared=true;delete env.game.onlineID;env.game.online=false;env._status.ip='nnk://keepalive';
    const shim=shimFor(peer),facade=new nnk.modules.rtc.FakeWebSocket(shim,{asynchronousHealth:true,freshHealth:true,stablePeerId:peer.peerId,scope});peer.facade=facade;ownedFacades.add(facade);env.game.ws=facade;
    function callOfficial(name,args){if(!peerCurrent(peer)||env.game.ws!==facade)return;
      const handler=env.lib.element.ws[name];if(typeof handler!=='function')throw Error('Missing native Guest '+name+' handler');
      const result=handler.apply(facade,args);
      if(result&&typeof result.then==='function'){peer.pendingOfficialHandlers++;Promise.resolve(result).then(()=>{if(peerCurrent(peer))reportStatus('native-async-handler-completed',{peerId:peer.peerId});})
        .catch(error=>{if(peerCurrent(peer))failure(error,{peerId:peer.peerId,stage:'native-handler'});else console.error('[联机助手] 已退休原生 handler 失败',error);})
        .finally(()=>{peer.pendingOfficialHandlers--;if(!peer.pendingOfficialHandlers)retiredHandlerPeers.delete(peer);}).catch(error=>console.error('[联机助手] 原生 handler 失败回执错误',error));}
      return result;
    }
    facade.onopen=function(...args){callOfficial('onopen',args);};
    facade.onmessage=function(...args){callOfficial('onmessage',args);if(peerCurrent(peer))reportStatus('guest-native-handler-returned');};
    facade.onerror=function(...args){callOfficial('onerror',args);};
    facade.onclose=function(...args){callOfficial('onclose',args);};
    settlement.install();shim.onopen();facade.replay();flush(peer);reportStatus('guest-facade-attached');return {peerId:peer.peerId,prepared:true};
    }catch(error){prepareError=errorJSON(error);throw error;}
  }
  function admit(args){
    guard();const peer=peers.get(args.peerId),size=capacity();
    if(role!=='host'||!peer||!peerCurrent(peer)||size===null)throw Error('Admission requires an approved peer and fresh native waiting room');
    if(peer.admitted)return {peerId:peer.peerId,reused:true,clients:clients(),seats:seats()};
    if(peer.facade)throw Error('Previous native admission failed; a fresh document is required');
    if([...peers.values()].filter(value=>value.admitted&&!value.retired).length>=size-1)throw Error('Actual waiting room capacity is full');
    const shim=shimFor(peer),facade=new nnk.modules.rtc.HostBridge(shim,{asynchronousHealth:true,freshHealth:true,stablePeerId:peer.peerId,scope});peer.facade=facade;ownedFacades.add(facade);
    // No await may separate metadata consumer installation and native handler.
    env.lib.init.connection(facade);
    const client=(env.lib.node.clients||[]).find(value=>value.ws===facade);if(!client||typeof facade.onmessage!=='function')throw Error('Native admission did not create its actual Client');
    peer.admitted=true;flush(peer);reportStatus('host-native-admitted',{peerId:peer.peerId});return {peerId:peer.peerId,clientId:client.id,clients:clients(),seats:seats()};
  }
  async function command(action,args){
    if(action==='approve-peer')return approvePeer(args.peerId);
    if(action==='prepare-host')return prepareHost(args);
    if(action==='prepare-guest')return prepareGuest(args);
    if(action==='admit')return admit(args);
    if(action==='confirm-seat')return confirmSeat(args);
    if(action==='activate-seat')return activateSeat(args);
    if(action==='reserve-start-peer')return reserveStartPeer(args.peerId);
    if(action==='release-start-peer')return releaseStartPeer(args.peerId);
    if(action==='settlement-state'){guard();return settlement.state(args);}
    if(action==='settlement-proof'){guard();return {scope,over:!!env._status.over,settlement:settlement.snapshot(),queueCount,
      peers:[...peers.values()].map(peer=>({peerId:peer.peerId,receivedSeq:peer.receivedSeq,appliedSeq:peer.appliedSeq,sequenceGap:peer.sequenceGap,pendingOfficialHandlers:peer.pendingOfficialHandlers}))};}
    if(action==='next-admission'){guard();const native=settlement.snapshot();if(!env._status.over||!(role==='host'?native.host:native.guest)?.canonical)throw Error('Actual current native settlement required');checkFileAdmission(role==='guest'?[...peers.values()][0]?.facade:undefined);return {scope,admission:true};}
    if(action==='next-plan'){
      guard();if(role!=='host'||!MODES.includes(args.mode))throw Error('Invalid next-round mode planning');checkFileAdmission(undefined);
      const selected=args.mode,settings=env.lib.config.mode_config?.[selected]||{},options={};
      for(const key of Object.keys(settings).sort())if(key.startsWith('connect_'))options[key]=json(settings[key]);
      const extensions=(env.lib.config.extensions||[]).map(name=>[name,env.lib.config['extension_'+name+'_enable']===true]);
      const configDigest=require('node:crypto').createHash('sha256').update(JSON.stringify({mode:selected,options,extensions})).digest('hex');
      const caps={identity:8,guozhan:8,versus:8,doudizhu:3,single:2},capacity=selected==='single'?2:Math.max(2,Number.parseInt(options.connect_player_number,10)||caps[selected]);
      return {scope,admission:true,mode:selected,capacity,configDigest,policy:'ordinary native configuration; no health admission gate'};
    }
    if(action==='status'||action==='current-resource')return action==='status'?snapshot():resources();
    if(action==='detach')return {detaching:true};
    throw Error('Unknown engine command: '+action);
  }
  async function handleMessage(message){
    if(!current())return;
    if(!sameEngineScope(message?.scope,scope)){post({type:'refused',requestId:typeof message?.requestId==='string'?message.requestId:null,reason:'scope-mismatch'});return;}
    if(message.type==='game'){
      try{receiveGame(message);}catch(error){failure(error,{peerId:message.peerId,stage:'game-delivery'});if(/overflow/.test(error.message))detach('handshake queue overflow');}return;
    }
    if(message.type==='attached'){reportStatus('endpoint-ready');return;}
    if(message.type!=='command'&&message.type!=='operation'){post({type:'refused',reason:'unknown-port-type'});return;}
    if(typeof message.requestId!=='string'||!message.requestId||message.requestId.length>160){post({type:'refused',reason:'invalid-request-id'});return;}
    const action=message.command||message.operation||message.action,args=json(message.args||{}),signature=JSON.stringify([message.type,action,args]);
    let request=requests.get(message.requestId);
    if(request&&request.signature!==signature){post({type:'result',requestId:message.requestId,ok:false,error:errorJSON(Error('Request ID reused for another operation'))});return;}
    if(!request){
      if([...requests.values()].filter(row=>!row.settled).length>=limits.requestPending){post({type:'result',requestId:message.requestId,ok:false,error:errorJSON(Error('Current request limit exceeded'))});return;}
      request={signature,settled:false,promise:null};requests.set(message.requestId,request);
      request.promise=Promise.resolve().then(()=>{guard();return message.type==='operation'?operations.execute(action,args):command(action,args);})
        .then(value=>{guard();return {type:'result',requestId:message.requestId,ok:true,value:json(value)};})
        .catch(error=>({type:'result',requestId:message.requestId,ok:false,error:errorJSON(error)}))
        .finally(()=>{request.settled=true;if(!closed){requestHistory.push(message.requestId);while(requestHistory.length>limits.requestHistory){const old=requestHistory.shift();if(requests.get(old)?.settled)requests.delete(old);}}});
    }
    const result=await request.promise;if(!current())return;post(result);
    if(result.ok&&message.type==='command'&&action==='detach')detach(args.reason||'round retired');
  }
  port.onmessage=event=>{handleMessage(event.data).catch(error=>failure(error,{stage:'port-handler'}));};port.start();
  statusTimer=setInterval(()=>{try{reportStatus('periodic');}catch(error){failure(error,{stage:'periodic-status'});}},250);
  function documentReady(proof){guard();environmentProof=json({...proof,environmentProofReady:true});reportStatus('document-ready');post({type:'document-ready',value:snapshot()});}
  return {scope,detach,snapshot,resourceSnapshot:resources,documentReady,handleMessage,limits,reportFailure:failure};
}

export async function attachEngine(nnk,{native,info}){
  if(!native?.bind||!native.onInvalidated||!native.onBindRejected)throw Error('Actual NNK native binding API unavailable');
  const capturedDocument=document,env=nnk.env,scope=Object.freeze({...info.scope}),requestId='nnk-engine-bind-'+crypto.randomUUID();
  let channel=new MessageChannel(),retired=false,endpoint=null,unInvalidated=null,unRejected=null,pagehideOwned=false;
  const current=()=>!retired&&document===capturedDocument&&nnk.env===env;
  function retireAdapter(){if(retired)return;retired=true;
    if(pagehideOwned)window.removeEventListener('pagehide',onPagehide);pagehideOwned=false;
    unInvalidated?.();unInvalidated=null;unRejected?.();unRejected=null;
    if(channel){if(!endpoint)channel.port1.close();channel.port2.close();channel=null;}
  }
  function detach(reason){if(endpoint)endpoint.detach(reason);else retireAdapter();}
  function onPagehide(){detach('document unloaded');}
  window.addEventListener('pagehide',onPagehide,{once:true});pagehideOwned=true;
  try{
  unInvalidated=native.onInvalidated(detail=>{if(sameEngineScope(detail?.scope,scope))detach(detail.reason||'native scope invalidated');});
  unRejected=native.onBindRejected(detail=>{
    if(detail?.requestId===requestId&&sameEngineScope(detail.candidateScope,scope)&&sameEngineScope(detail.trustedCurrentScope,scope)){
      console.error('[联机助手] 当前初始引擎绑定被拒',detail);endpoint?.reportFailure(Error('Current native binding rejected: '+detail.reason),{stage:'native-bind'});detach('current native binding rejected');
    }
  });
  if(!current())throw Error('Retired engine document');
  endpoint=createEngineEndpoint(nnk,{native,info,port:channel.port1,isCurrent:current,documentToken:crypto.randomUUID(),onRetire:retireAdapter,
    adapterResources:()=>({pagehideListeners:Number(pagehideOwned),invalidationListeners:Number(unInvalidated!==null),bindingRejectListeners:Number(unRejected!==null),nativeMessageChannelReferences:Number(channel!==null)})});
    if(!current())throw Error('Retired engine document');
    native.bind(scope,requestId,channel.port2);
    channel=null;
    const security=await import('/noname/util/sandbox/initRealms.js');if(!current())throw Error('Retired engine document');
    const packageJSON=await env.game.promises.readFileAsText('package.json');if(!current())throw Error('Retired engine document');
    if(window.__dirname!==info.engineRoot||location.origin!==scope.expectedOrigin)throw Error('Actual engine root/origin mismatch');
    endpoint.documentReady({dirname:window.__dirname,rootURL:location.origin+'/',documentReady:document.readyState,sandboxEnabled:security.isSandboxEnabled(),
      actualPackageHash:require('node:crypto').createHash('sha256').update(packageJSON).digest('hex'),expectedEngineRoot:info.engineRoot});
  }catch(error){console.error('[联机助手] 当前引擎文档启动失败',error);if(current())endpoint?.reportFailure(error,{stage:'document-startup'});detach('endpoint startup failed');throw error;}
  return endpoint;
}

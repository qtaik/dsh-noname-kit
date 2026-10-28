const scopeKeys=['sessionId','roundId','documentGeneration','bindingId','bindingNonce','expectedOrigin'];
export const sameScope=(a,b)=>!!a&&!!b&&scopeKeys.every(k=>a[k]===b[k]);
const errorText=e=>e?.message||String(e);
const creationKeys=['role','partySessionId','roundId','operationId','operationGeneration'];
function creationLease(lease){
  const value=Object.fromEntries(creationKeys.map(key=>[key,lease?.[key]]));
  if(!['host','guest'].includes(value.role)||!['partySessionId','roundId','operationId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=160)||!Number.isSafeInteger(value.operationGeneration)||value.operationGeneration<=0)throw Error('Exact bounded game operation required');
  return Object.freeze(value);
}
export class EngineBindingManager {
  constructor({native,ipc,onSend,onStatus,onModuleEvent,onFailure,onEvent=()=>{}}) {
    Object.assign(this,{native,ipc,onSend,onStatus,onModuleEvent,onFailure,onEvent});
    this.current=null;this.pendingPorts=[];this.sequence=0;this.closed=false;
    this.portListener=(event,detail)=>{const captured=this.current;this.acceptPort(event,detail).catch(error=>{for(const port of event.ports||[])port.close();this.fail(captured,error);});};
    ipc.on('nnk-keepalive-port',this.portListener);
    this.offInvalidated=native.onInvalidated(value=>{
      const b=this.current;if(!b||value.sourceWindowId!==b.windowId||!sameScope(value.scope,b.scope))return;
      this.fail(b,Error('当前引擎文档已失效：'+value.reason));
    });
  }
  isCurrent(b){return !this.closed&&this.current===b&&!b.closed;}
  assert(b){if(!this.isCurrent(b))throw Error('旧引擎操作已失效');if(b.error)throw b.error;}
  fail(b,error){
    if(!b||!this.isCurrent(b))return;
    b.error=error instanceof Error?error:Error(errorText(error));
    for(const r of b.pending.values()){clearTimeout(r.timer);r.reject(b.error);}b.pending.clear();
    this.onEvent('engine-operation-failed',{scope:b.scope,error:errorText(error)});this.onFailure?.(b,b.error);
  }
  async create(lease){
    if(this.current)throw Error('旧原生引擎尚未回收');
    // Keep local round state and connection references outside the native IPC payload.
    const operation=creationLease(lease);
    const b={lease:operation,windowId:null,closeCapability:null,scope:null,port:null,status:null,closed:false,error:null,pending:new Map(),readyAt:null};this.current=b;
    try{
      const value=await this.native.createGame(operation);
      if(!Number.isSafeInteger(value?.windowId)||value.windowId<1||value.closeCapability?.operationId!==operation.operationId||value.closeCapability?.operationGeneration!==operation.operationGeneration)throw Error('原生创建回执未匹配当前操作');
      b.windowId=value.windowId;b.closeCapability=Object.freeze({...value.closeCapability});this.assert(b);
      for(const item of this.pendingPorts.splice(0)){if(item.binding===b)await this.acceptPort(item.event,item.detail);else for(const port of item.event.ports||[])port.close();}
      await this.wait(b,()=>b.port&&b.status?.environmentProofReady,'新引擎完整启动',20000);b.readyAt=Date.now();return b;
    }catch(error){this.fail(b,error);throw error;}
  }
  async acceptPort(event,detail){
    const ports=event.ports||[],b=this.current;
    if(b&&this.isCurrent(b)&&!b.error&&b.windowId===null&&ports.length===1&&this.pendingPorts.length===0&&detail.scope?.sessionId===b.lease.partySessionId&&detail.scope?.roundId===b.lease.roundId){this.pendingPorts.push({event,detail,binding:b});return;}
    const refuse=reason=>{for(const p of ports)p.close();this.onEvent('engine-port-rejected',{reason});};
    if(ports.length!==1||!b||!this.isCurrent(b)||b.port||detail.sourceWindowId!==b.windowId||detail.scope?.sessionId!==b.lease.partySessionId||detail.scope?.roundId!==b.lease.roundId)return refuse('wrong actual engine source or lease');
    const snapshot=await this.native.snapshot();
    if(!this.isCurrent(b)||!sameScope(snapshot.currentEngine?.scope,detail.scope)||snapshot.currentEngine?.windowId!==b.windowId)return refuse('scope no longer current');
    b.scope=Object.freeze({...detail.scope});b.port=ports[0];b.port.onmessage=e=>this.receive(b,e.data);b.port.start();b.port.postMessage({type:'attached',scope:b.scope});
    this.onEvent('engine-port-attached',{scope:b.scope,windowId:b.windowId});
  }
  receive(b,value){
    if(!this.isCurrent(b)||!sameScope(value?.scope,b.scope)){this.onEvent('retired-engine-message',{type:value?.type||null});return;}
    try{
      if(value.type==='result'){
        const r=b.pending.get(value.requestId);if(!r)return;b.pending.delete(value.requestId);clearTimeout(r.timer);
        value.ok===true?r.resolve(value.value):r.reject(Error(value.error?.message||value.error||'引擎操作失败'));
      }else if(value.type==='status'){
        b.status=value.value;if(['endpoint-operation-failed','endpoint-failure'].includes(value.value?.type))this.fail(b,Error(value.value.error));else this.onStatus?.(b,value.value);
      }else if(value.type==='document-ready'){b.status=value.value;this.onStatus?.(b,value.value);}
      else if(value.type==='failure')this.fail(b,Error(value.error?.message||value.error||'当前引擎操作失败'));
      else if(value.type==='refused'){
        const r=b.pending.get(value.requestId);if(r){b.pending.delete(value.requestId);clearTimeout(r.timer);r.reject(Error(value.reason||'当前请求被拒绝'));}
        this.onEvent('engine-request-refused',{requestId:value.requestId||null,reason:value.reason||null});
      }else if(value.type==='send')this.onSend?.(b,value.peerId,value.raw,value.terminal||null);
      else if(value.type==='module-event')this.onModuleEvent?.(b,value.name,value.data);
      else if(value.type==='detached')b.detachEvidence=value;
      else if(value.type==='engine-close')this.fail(b,Error('当前原生 socket 已关闭'));
      else throw Error('未知引擎端口消息：'+value.type);
    }catch(error){this.fail(b,error);}
  }
  async wait(b,condition,label,timeout=15000){
    const deadline=Date.now()+timeout;while(Date.now()<deadline){this.assert(b);const result=condition();if(result)return result;await new Promise(r=>setTimeout(r,50));}throw Error(label+'超时');
  }
  request(b,type,command,args={},timeout=15000){
    this.assert(b);if(!b.port)throw Error('引擎端口未就绪');const requestId='engine-'+(++this.sequence)+'-'+crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{b.pending.delete(requestId);const e=Error(command+'超时');reject(e);this.fail(b,e);},timeout);b.pending.set(requestId,{resolve,reject,timer});
      try{b.port.postMessage({type,scope:b.scope,requestId,command,action:command,args});}catch(error){clearTimeout(timer);b.pending.delete(requestId);reject(error);}
    });
  }
  command(command,args={},b=this.current){return this.request(b,'command',command,args);}
  operation(action,args={},b=this.current){return this.request(b,'operation',action,args);}
  game(peerId,raw,envelope,b=this.current){this.assert(b);if(!b.port)throw Error('当前游戏端点未绑定');b.port.postMessage({type:'game',scope:b.scope,peerId,seq:envelope.seq,raw});}
  retire(reason='round retired'){
    const b=this.current;if(!b)return Promise.resolve(null);
    if(!b.retirement){const task=this.retireBinding(b,reason);b.retirement=task;task.catch(()=>{if(b.retirement===task)b.retirement=null;});}
    return b.retirement;
  }
  async retireBinding(b,reason){
    const errors=[],warnings=[];
    if(b.port&&!b.error&&!b.closed){try{await this.command('detach',{reason},b);if(!b.detachEvidence)await this.wait(b,()=>b.detachEvidence,'端点释放确认',5000);}catch(e){errors.push(errorText(e));}}
    b.closed=true;for(const r of b.pending.values()){clearTimeout(r.timer);r.reject(Error(reason));}b.pending.clear();if(b.port){b.port.onmessage=null;b.port.close();b.port=null;}
    this.pendingPorts=this.pendingPorts.filter(item=>{if(item.binding!==b)return true;for(const port of item.event.ports||[])port.close();return false;});
    if(b.windowId===null){
      const receipt=await this.native.retireGameCreation(b.lease),fields=creationKeys;
      if(receipt?.cancelled!==true||!fields.every(k=>receipt.operation?.[k]===b.lease[k]))throw Error('原生创建回收回执未匹配原操作');
      if(receipt.confirmed===true&&receipt.ownerAbsent===true){if(this.current!==b)throw Error('原生创建回收期间当前操作已更换');this.current=null;b.status=null;b.scope=null;const result={windowId:receipt.windowId,confirmation:receipt,detachEvidence:b.detachEvidence||null,errors,warnings};this.onEvent('engine-retired',result);return result;}
      if(!Number.isSafeInteger(receipt.windowId)||receipt.windowId<1||!receipt.closeCapability)throw Error('原生创建回收尚未确认');
      b.windowId=receipt.windowId;b.closeCapability=Object.freeze({...receipt.closeCapability});
    }
    if(b.windowId!==null){
      let closed;try{closed=await this.native.closeGame(b.windowId,b.closeCapability);}catch(error){warnings.push('原生关闭回执丢失，待销毁确认：'+errorText(error));}
      if(closed?.rejected)throw Error('当前原生引擎关闭被拒绝');
      const deadline=Date.now()+5000;let proof;while(Date.now()<deadline){proof=await this.native.confirmClosed(b.windowId);if(proof.confirmed)break;await new Promise(r=>setTimeout(r,50));}if(!proof?.confirmed)throw Error('旧原生引擎未完成销毁');
      if(this.current!==b)throw Error('原生关闭确认期间当前操作已更换');this.current=null;b.status=null;b.scope=null;const result={windowId:b.windowId,confirmation:proof,detachEvidence:b.detachEvidence||null,errors,warnings};this.onEvent('engine-retired',result);return result;
    }throw Error('原生创建回收尚未确认');
  }
  snapshot(){const b=this.current;return {current:b&&{windowId:b.windowId,scope:b.scope,status:b.status,error:b.error&&errorText(b.error),pending:b.pending.size},pendingPorts:this.pendingPorts.length};}
  dispose(){this.closed=true;this.ipc.removeListener('nnk-keepalive-port',this.portListener);this.offInvalidated?.();for(const item of this.pendingPorts.splice(0))for(const p of item.event.ports||[])p.close();}
}

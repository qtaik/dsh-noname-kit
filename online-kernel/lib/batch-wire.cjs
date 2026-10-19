'use strict';
// Content frames are separate from consent and the native game protocol.
// Adapters provide current consent, disk operations and profile activation.
// v2 separates durable publication from activation completion. v1 peers must
// negotiate an upgrade rather than interpreting pending activation as failure.
const VERSION=2,CHUNK=32768,MAX_FRAME=65536,WINDOW=8,RETRY_MS=1500,RETRIES=5;
const crypto=require('node:crypto');
const nodeTimers=require('node:timers');
const terminal=new Set(['committed','committed_activation_required','cancelled','failed','expired','disconnected','recovery_required','unknown']);
class Channel {
  constructor({role,send,authorize,receiver,source,report,now=Date.now,timers=nodeTimers}){
    if(!['host','guest'].includes(role))throw Error('Invalid file role');Object.assign(this,{role,send,authorize,receiverFactory:receiver,sourceFactory:source,report:report||(()=>{}),now,timers});this.current=null;this.closed=false;
  }
  matches(a,b){return a&&b&&['session','peerSession','proposal','digest'].every(k=>a[k]===b[k])}
  currentGrant(){const a=this.authorize();return a&&a.expires>this.now()?a:null}
  frame(ctx,kind,fields={}){if(this.closed)throw Error('File channel closed');this.send(JSON.stringify({nnk_files:VERSION,from:ctx.grant.session,to:ctx.grant.peerSession,proposal:ctx.grant.proposal,digest:ctx.grant.digest,kind,...fields}))}
  state(ctx,status,reason=''){if(ctx.fileCommitted&&['cancelled','failed','expired','disconnected'].includes(status))return;ctx.status=status;ctx.reason=String(reason).slice(0,200);try{this.report(this.snapshot(ctx))}catch(error){/* A UI listener cannot stop resource cleanup. */}}
  snapshot(c=this.current){return c?{...c.grant,batch:{extensions:c.grant.batch.extensions.map(e=>({name:e.name,fileCount:e.files.length})),count:c.grant.batch.count,total:c.grant.batch.total},status:c.status,reason:c.reason||'',received:c.received||0,...(this.role==='host'?{acknowledged:c.acknowledged||0}:{}),total:c.grant.batch.total,role:this.role,fileCommitted:!!c.fileCommitted,transactionId:c.transactionId}:null}
  live(ctx){return !this.closed&&!ctx.fileCommitted&&this.current===ctx&&!terminal.has(ctx.status)&&this.matches(ctx.grant,this.currentGrant())}
  committed(ctx,result={}){
    ctx.fileCommitted=true;ctx.transactionId=result.id||ctx.transactionId;this.clear(ctx);
    this.state(ctx,'activation_pending','文件已同步，正在保存扩展启用配置；文件更新已不可撤销。');
    if(!this.closed&&this.current===ctx)this.retry(ctx,'activation',{kind:'result'},()=>this.frame(ctx,'result',{status:'activation_pending',reason:ctx.reason}));
  }
  clear(ctx){for(const item of ctx.pending.values())this.timers.clearTimeout(item.timer);ctx.pending.clear();this.timers.clearTimeout(ctx.deadline)}
  async stop(status='cancelled',reason='授权已结束'){
    const ctx=this.current;if(!ctx||terminal.has(ctx.status))return;
    if(ctx.fileCommitted){
      if(this.role==='guest')try{this.frame(ctx,'result',{status:ctx.status,reason:ctx.reason})}catch(error){/* The bound activation task keeps its outcome after disconnect. */}
      else if(status==='disconnected'){this.clear(ctx);this.state(ctx,'committed_activation_required','文件已同步，连接已结束；客人启用结果待确认。')}
      return;
    }
    this.state(ctx,this.role==='host'&&ctx.finishSent?'unknown':status,reason);this.clear(ctx);
    try{await ctx.source?.close?.()}catch(error){/* Sender read handles are best effort after termination. */}
    try{const result=await ctx.receiver?.abort?.();if(result?.status==='committed'){ctx.fileCommitted=true;ctx.transactionId=result.id;this.state(ctx,'committed_activation_required','文件已经整批提交，启用状态须确认；请检查所列扩展并启用、重启，无需重新下载。')}}
    catch(error){ctx.cleanupError=String(error.message).slice(0,200);if(ctx.status!=='recovery_required'||!ctx.reason)this.state(ctx,'recovery_required',ctx.cleanupError)}
    try{this.frame(ctx,this.role==='host'?'cancel':'result',{status:ctx.status,reason:ctx.reason})}catch(error){/* Peer expiry closes its own attempt. */}
  }
  close(){const done=this.stop('disconnected','连接结束，旧授权不复用');this.closed=true;if(this.current)this.clear(this.current);return done}
  async granted(){
    const grant=this.currentGrant();if(!grant||this.closed)return;
    if(this.current&&(this.current.fileCommitted||['unknown','recovery_required'].includes(this.current.status)||this.current.finishSent&&!terminal.has(this.current.status)))return;
    if(this.current&&this.matches(this.current.grant,grant))return;
    await this.stop('cancelled','提议已更换');
    if(!this.matches(grant,this.currentGrant())||this.closed)return;
    if(this.current&&this.matches(this.current.grant,grant))return;
    if(this.current)this.clear(this.current);
    const ctx={grant:JSON.parse(JSON.stringify(grant)),status:'starting',pending:new Map(),seen:new Map(),nextSeq:0,rxNext:0,rxFile:0,rxOffset:0,file:0,offset:0,received:0,acknowledged:0,finished:false};this.current=ctx;
    ctx.deadline=this.timers.setTimeout(()=>{if(this.current===ctx)this.stop('expired','文件授权已超时')},Math.max(0,grant.expires-this.now()));
    try{
      if(this.role==='guest'){
        const receiver=await this.receiverFactory(grant);ctx.receiver=receiver;
        if(!this.live(ctx)){await receiver.abort();return}
        this.state(ctx,'receiving');this.retry(ctx,'ready',{kind:'ready'},()=>this.frame(ctx,'ready'));
      }else{ctx.source=await this.sourceFactory(grant);if(!this.live(ctx)){await ctx.source.close?.();return}this.state(ctx,'waiting_receiver')}
    }catch(error){if(this.current===ctx)await this.stop(error.code==='BATCH_RECOVERY_REQUIRED'?'recovery_required':'failed',error.message)}
  }
  retry(ctx,key,packet,deliver){
    if(ctx.pending.has(key))return;const item={packet,deliver,attempts:0};ctx.pending.set(key,item);
    const send=()=>{if(this.current!==ctx||this.closed||!ctx.pending.has(key))return;
      try{deliver()}catch(error){this.ack(ctx,key);if(!terminal.has(ctx.status))this.stop('disconnected',error.message);return}
      if(++item.attempts>=RETRIES){item.timer=this.timers.setTimeout(()=>{this.ack(ctx,key);if(!terminal.has(ctx.status))this.stop('failed','文件回执重试已耗尽')},RETRY_MS);return}
      item.timer=this.timers.setTimeout(send,RETRY_MS);
    };send();
  }
  ack(ctx,key){const item=ctx.pending.get(key);if(!item)return false;this.timers.clearTimeout(item.timer);ctx.pending.delete(key);return true}
  handle(raw){
    if(typeof raw!=='string'||!raw.includes('"nnk_files"'))return false;
    if(raw.length>MAX_FRAME){this.stop('failed','文件帧超过上限');return true}
    let m;try{m=JSON.parse(raw)}catch(error){return true}if(!m||Array.isArray(m)||!Object.hasOwn(m,'nnk_files'))return false;
    const ctx=this.current;if(!ctx||this.closed)return true;
    if(m.nnk_files!==VERSION){this.stop('failed','文件协议不兼容，不退回旧补传');return true}
    if(m.from!==ctx.grant.peerSession||m.to!==ctx.grant.session||m.proposal!==ctx.grant.proposal||m.digest!==ctx.grant.digest)return true;
    // Ordered DataChannels still need a serial queue around async disk handlers.
    ctx.queue=(ctx.queue||Promise.resolve()).then(()=>this.receive(ctx,m)).catch(error=>{if(this.current===ctx)return this.stop(error.code==='BATCH_RECOVERY_REQUIRED'?'recovery_required':error.code==='BATCH_CANCELLED'?'cancelled':error.code==='BATCH_EXPIRED'?'expired':'failed',error.message)});return true;
  }
  async receive(ctx,m){
    if(this.current!==ctx||this.closed)return;
    if(m.kind==='result'&&this.role==='host'){
      if(!['activation_pending','committed','committed_activation_required','failed','cancelled','expired','recovery_required','disconnected'].includes(m.status))throw Error('Invalid batch outcome');
      if((m.status==='activation_pending'||m.status.startsWith('committed'))&&!ctx.finishSent)throw Error('Premature successful result');
      if(m.status==='activation_pending'){
        if(!ctx.status.startsWith('committed')){ctx.fileCommitted=true;this.clear(ctx);await ctx.source?.close?.();this.state(ctx,'activation_pending',m.reason)}
        this.frame(ctx,'result_ack',{status:'activation_pending'});return;
      }
      if(m.status.startsWith('committed'))ctx.fileCommitted=true;
      if(!terminal.has(ctx.status)||ctx.status==='unknown'||m.status.startsWith('committed')){this.clear(ctx);await ctx.source?.close?.();this.state(ctx,m.status,String(m.reason||'').slice(0,200))}
      this.frame(ctx,'result_ack');return;
    }
    if(m.kind==='result_ack'&&this.role==='guest'){this.ack(ctx,m.status==='activation_pending'?'activation':'result');return}
    if(terminal.has(ctx.status)){
      if(this.role==='guest'&&['finish','cancel'].includes(m.kind)&&ctx.status.startsWith('committed'))this.frame(ctx,'result',{status:ctx.status,reason:ctx.reason});return;
    }
    if(!this.live(ctx)){await this.stop('expired','授权不再有效');return}
    if(m.kind==='cancel'&&this.role==='guest'){await this.stop('cancelled','对端请求取消');return}
    if(m.kind==='result'){await this.stop(m.status==='cancelled'?'cancelled':'failed',String(m.reason||'对端终止').slice(0,200));return}
    if(this.role==='host'){
      if(m.kind==='ready'){
        this.frame(ctx,'ready_ack');if(ctx.status==='waiting_receiver'){this.state(ctx,'sending');await this.pump(ctx)}return;
      }
      if(m.kind==='ack'){
        if(!Number.isSafeInteger(m.seq)||m.seq<0)throw Error('Invalid chunk acknowledgement');
        const pending=ctx.pending.get(m.seq);
        if(this.ack(ctx,m.seq)&&pending&&typeof pending.packet.data==='string'){
          // Only the first acknowledgement of a locally queued chunk advances the display.
          ctx.acknowledged+=Buffer.byteLength(pending.packet.data,'base64');
          const at=this.now(),complete=ctx.file===ctx.grant.batch.count&&ctx.pending.size===0;
          if(ctx.status==='sending'&&(complete||ctx.lastProgressAt===undefined||at-ctx.lastProgressAt>=250)){ctx.lastProgressAt=at;this.state(ctx,'sending')}
        }
        await this.pump(ctx);return;
      }
      throw Error('Unexpected guest file frame');
    }
    if(m.kind==='ready_ack'){this.ack(ctx,'ready');return}
    if(m.kind==='data'){
      if(!Number.isSafeInteger(m.seq)||m.seq<0||typeof m.data!=='string'||m.data.length>CHUNK*4/3+4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data))throw Error('Invalid chunk encoding');
      const bytes=Buffer.from(m.data,'base64');if(bytes.toString('base64')!==m.data||bytes.length>CHUNK)throw Error('Noncanonical chunk');
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify([m.index,m.offset,m.end,m.data])).digest('hex');
      if(ctx.seen.has(m.seq)&&ctx.seen.get(m.seq)!==fingerprint||!ctx.seen.has(m.seq)&&m.seq!==ctx.rxNext)throw Error('Conflicting or out of order chunk sequence');
      if(!ctx.seen.has(m.seq)){
        const files=ctx.grant.batch.extensions.flatMap(e=>e.files),file=files[ctx.rxFile];
        if(!file||m.index!==ctx.rxFile||m.offset!==ctx.rxOffset||typeof m.end!=='boolean'||m.offset+bytes.length>file.size||m.end!==(m.offset+bytes.length===file.size)||!m.end&&!bytes.length)throw Error('Chunk does not advance the authorized manifest');
      }
      // The receiver rechecks duplicate bytes rather than trusting a sequence ID.
      await ctx.receiver.chunk(m.index,m.offset,bytes,m.end);
      if(!ctx.seen.has(m.seq)){ctx.seen.set(m.seq,fingerprint);ctx.rxNext++;ctx.received+=bytes.length;if(m.end){ctx.rxFile++;ctx.rxOffset=0}else ctx.rxOffset+=bytes.length;if(ctx.seen.size>ctx.grant.batch.count+Math.ceil(ctx.grant.batch.total/CHUNK)+WINDOW)throw Error('Too many chunks');const at=this.now();if(ctx.received===ctx.grant.batch.total||ctx.lastProgressAt===undefined||at-ctx.lastProgressAt>=250){ctx.lastProgressAt=at;this.state(ctx,'receiving')}}
      this.frame(ctx,'ack',{seq:m.seq});return;
    }
    if(m.kind==='finish'){
      if(ctx.rxFile!==ctx.grant.batch.count||ctx.received!==ctx.grant.batch.total)throw Error('Full batch has not arrived');
      if(ctx.finished)return;ctx.finished=true;this.ack(ctx,'ready');this.state(ctx,'committing');
      const result=await ctx.receiver.commit(()=>this.live(ctx),r=>this.committed(ctx,r));
      ctx.fileCommitted=true;
      const status=result.activated?'committed':'committed_activation_required';this.clear(ctx);this.state(ctx,status,result.reason||'');
      if(!this.closed&&this.current===ctx)this.retry(ctx,'result',{kind:'result'},()=>this.frame(ctx,'result',{status:ctx.status,reason:ctx.reason}));return;
    }
    throw Error('Unexpected host file frame');
  }
  async pump(ctx){
    if(ctx.pumping||ctx.status!=='sending')return;ctx.pumping=true;
    try{
      const files=ctx.grant.batch.extensions.flatMap(e=>e.files.map(f=>({name:e.name,...f})));
      while(this.live(ctx)&&ctx.pending.size<WINDOW&&ctx.file<files.length){
        const f=files[ctx.file],index=ctx.file,offset=ctx.offset,bytes=await ctx.source.read(index,offset,Math.min(CHUNK,f.size-offset));
        if(!this.live(ctx))return;if(!Buffer.isBuffer(bytes)||bytes.length!==Math.min(CHUNK,f.size-offset))throw Error('Source file changed or truncated');
        const end=offset+bytes.length===f.size,packet={seq:ctx.nextSeq++,index,offset,end,data:bytes.toString('base64')};
        this.retry(ctx,packet.seq,packet,()=>this.frame(ctx,'data',packet));
        if(end){ctx.file++;ctx.offset=0}else ctx.offset+=bytes.length;
      }
      if(this.live(ctx)&&ctx.file===files.length&&ctx.pending.size===0){ctx.finishSent=true;this.retry(ctx,'finish',{kind:'finish'},()=>this.frame(ctx,'finish'))}
    }finally{ctx.pumping=false}
  }
}
module.exports={Channel,VERSION,CHUNK,MAX_FRAME,WINDOW};

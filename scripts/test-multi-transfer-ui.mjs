// Actual UI and event bridge with synthetic participants only; no game, install, network or transfer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBridgeSession} from '../src/online.js';
const src=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const start=src.indexOf('function renderBatchProposals('),end=src.indexOf('      function renderManifestCard(',start);
const render=new Function('bridge','bridgeOnline','h','e','sendCmd','window','batchUi','setBatchUi','setNote',src.slice(start,end)+';return renderBatchProposals();');
const eventStart=src.indexOf('function onlineEventText('),eventEnd=src.indexOf('    function onlineKernelOfflineHint(',eventStart);
const eventText=new Function('ev',src.slice(eventStart,eventEnd)+';return onlineEventText(ev, []);');
const support=src.slice(src.indexOf('function onlinePickEvent('),src.indexOf('    function OnlinePanel('));
const manualStart=src.indexOf('function renderManifestCard('),manualEnd=src.indexOf('      function leaveRoom(',manualStart);
const manualRender=new Function('bridge','evs','hostFlow','inRoom','h','e','sendCmd','setNote','renderTransferLimit',support+src.slice(manualStart,manualEnd)+';return renderManifestCard(evs,hostFlow,inRoom);');
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)}),e=(tag,className,...children)=>h(tag,{className},...children);
const nodes=x=>x&&typeof x==='object'?[x,...x.children.flatMap(nodes)]:[],text=x=>x&&typeof x==='object'?x.children.map(text).join(''):String(x??'');
const scope={carrierSessionId:'multi-ui-carrier',partyEpoch:4};
const peer=(n,name='同名玩家')=>({peerId:'actual-peer-'+n,peerIdentity:{name,avatar:'caocao'},peerOrdinal:n,peerLabel:name?name+'（客机 '+n+'）':'未命名客机 '+n,scope,transferCapable:true});
const p1=peer(2),p2=peer(7),p3=peer(11,'');
const proposal=(p,fields={})=>({session:'a'.repeat(32),peerSession:String(p.peerOrdinal%10).repeat(32),proposal:'c'.repeat(31)+String(p.peerOrdinal%10),digest:'d'.repeat(64),peerId:p.peerId,peerIdentity:p.peerIdentity,peerOrdinal:p.peerOrdinal,peerLabel:p.peerLabel,scope,role:'host',status:'authorized_paused',batch:{extensions:[{name:'合成扩展🧩',fileCount:2}],count:2,total:300*1048576},...fields});
function draw({participants=[p1,p2,p3],proposals=[],files=[],events=[],role='host',online=true,state:extra={},ui={}}={}){
 const commands=[],state={transferScope:scope,manifestScope:scope,transferAvailable:true,transferParticipants:participants,transferPeers:participants,transferBusy:false,transferRequestPending:false,batchProposals:proposals,fileBatches:files,...extra};
 const bridge={role,online,events,state},tree=render(bridge,online,h,e,(...args)=>commands.push(args),{confirm:()=>true},ui,value=>Object.assign(ui,value),()=>{}),all=tree.flatMap(nodes);
 return {bridge,tree,all,commands,copy:tree.map(text).join('\n'),overview:all.find(n=>n.props['data-nnk-transfer-overview']),summaries:all.filter(n=>n.props['data-nnk-transfer-summary-peer']),summary:id=>all.find(n=>n.props['data-nnk-transfer-summary-peer']===id),cards:all.filter(n=>n.props['data-nnk-transfer']),button:(card,label)=>nodes(card).find(n=>n.tag==='button'&&text(n)===label)};
}
let count=0;function test(name,fn){fn();count++;console.log('  ✓ '+name);}
test('host overview includes every live participant without inventing missing packages',()=>{
 const f=draw();assert.equal(f.summaries.length,3);assert.match(text(f.overview),/3 位已连接客机/);assert.match(f.copy,/同名玩家（客机 2）/);assert.match(f.copy,/同名玩家（客机 7）/);assert.match(f.copy,/未命名客机 11/);for(const row of f.summaries){assert.match(text(row),/待体检 \/ 等待处理/);assert.doesNotMatch(text(row),/发现缺包|缺 \d+|\d+%/);}assert.deepEqual(f.commands,[]);
});
test('stable ordinals survive list reordering and disconnects',()=>{
 const f=draw({participants:[p3,p2]});assert.equal(f.summaries.length,2);assert.match(text(f.summaries[1]),/同名玩家（客机 7）/);assert.doesNotMatch(f.copy,/客机 1）|客机 2）/);
});
test('progress and consent stages remain independent across three guests',()=>{
 const q1=proposal(p1),q2=proposal(p2,{status:'pending'}),f=draw({proposals:[q1,q2],files:[{...q1,status:'sending',acknowledged:150*1048576,received:300*1048576,total:300*1048576}]});
 assert.match(text(f.summary(p1.peerId)),/客机已确认接收：50% · 150 MiB \/ 300 MiB/);assert.match(text(f.summary(p2.peerId)),/等待客机确认/);assert.doesNotMatch(text(f.summary(p2.peerId)),/\d+%/);assert.match(text(f.summary(p3.peerId)),/待体检/);assert.equal(nodes(f.overview).filter(n=>n.tag==='progress').length,1);assert.match(text(f.overview),/传输中 1 · 待确认 1 · 待体检或等待处理 1 · 已完成 0 · 结果待确认 0 · 失败 0/);
});
test('overview counts only each current latest result and never equates activation uncertainty with completion',()=>{
 const participants=Array.from({length:8},(_,i)=>peer(i+1)),statuses=['sending','pending',null,'committed','activation_pending','committed_activation_required','unknown','failed'],proposals=[proposal(participants[0],{proposal:'e'.repeat(32)})],files=[{...proposals[0],status:'committed',fileCommitted:true}];
 statuses.forEach((status,i)=>{if(!status)return;const q=proposal(participants[i],{status:status==='pending'?'pending':'authorized_paused'});proposals.push(q);if(status!=='pending')files.push({...q,status,acknowledged:0,total:100,fileCommitted:['committed','activation_pending','committed_activation_required'].includes(status)});});
 const f=draw({participants,proposals,files});assert.match(text(f.overview),/传输中 1 · 待确认 1 · 待体检或等待处理 1 · 已完成 1 · 结果待确认 3 · 失败 1/);
});
test('offline grace snapshots identify recent records and expose no live batch actions',()=>{
 const q=proposal(p1),f=draw({online:false,proposals:[q],files:[{...q,status:'sending',acknowledged:50,total:100}]});assert.match(text(f.overview),/3 位客机的最近记录 · 内核离线/);assert.match(text(f.overview),/离线前最近记录：传输中 1/);assert.match(text(f.summary(p1.peerId)),/离线前阶段：/);assert.doesNotMatch(text(f.overview),/已连接客机|当前批次/);assert.match(text(f.cards[0]),/最近批次记录（内核离线，不代表实时状态）/);for(const card of f.cards)for(const label of['终止本次补传','同意本批并接收','重新传输（需客机再次同意）'])assert.equal(f.button(card,label),undefined);assert.deepEqual(f.commands,[]);
});
test('declined cancelled expired and disconnected grants are ended rather than waiting or failed',()=>{
 const participants=[1,2,3,4].map(n=>peer(n)),proposals=['declined','cancelled','expired','disconnected'].map((status,i)=>proposal(participants[i],{status})),f=draw({participants,proposals});assert.match(text(f.overview),/传输中 0 · 待确认 0 · 待体检或等待处理 0 · 已完成 0 · 结果待确认 0 · 失败 0 · 已结束 4/);for(const row of f.summaries)assert.match(text(row),/本次结果：/);
});
test('opposite-role cards and collapsed state use distinct complete display bindings',()=>{
 const q=proposal(p1),other={...q,role:'guest',status:'pending'},ui={},f=draw({proposals:[q,other],ui});assert.equal(f.cards.length,2);assert.notEqual(f.cards[0].props.key,f.cards[1].props.key);f.button(f.cards[0],'收起提示').props.onClick();const updated=draw({proposals:[q,other],ui});assert.equal(updated.cards.length,1);assert.ok(updated.button(updated.cards[0],'同意本批并接收'));
});
test('emoji nicknames remain literal in overview, detailed identity and collapsed prompts',()=>{
 const p=peer(5,'🧩原名✅'),q=proposal(p),ui={},f=draw({participants:[p],proposals:[q],ui});assert.equal(nodes(f.summary(p.peerId)).find(n=>n.tag==='b').props['data-nnk-literal'],true);const identity=nodes(f.cards[0]).find(n=>text(n).startsWith('接收客机：'));assert.equal(identity.props['data-nnk-literal'],true);assert.match(text(identity),/🧩原名✅（客机 5）/);f.button(f.cards[0],'收起提示').props.onClick();const collapsed=draw({participants:[p],proposals:[q],ui}),line=collapsed.all.find(n=>n.props.className==='nnk-hint'&&text(n).includes('补传提示已收起'));assert.equal(line.props['data-nnk-literal'],true);assert.match(text(line),/🧩原名✅（客机 5）/);
});
test('host never derives a percentage from local received bytes',()=>{
 const q=proposal(p1),f=draw({proposals:[q],files:[{...q,status:'sending',received:300*1048576,total:300*1048576}]});assert.match(text(f.summary(p1.peerId)),/等待客机确认接收/);assert.equal(nodes(f.summary(p1.peerId)).some(n=>n.tag==='progress'),false);
});
test('one hundred percent waits for the actual outcome',()=>{
 const q=proposal(p1),f=draw({proposals:[q],files:[{...q,status:'sending',acknowledged:300*1048576,total:300*1048576}]});assert.match(text(f.summary(p1.peerId)),/100% 不代表补传完成/);assert.doesNotMatch(text(f.summary(p1.peerId)),/已自动启用/);
});
test('current terminal result is explicit and does not describe another guest as completed',()=>{
 const q=proposal(p1),f=draw({proposals:[q],files:[{...q,status:'committed',acknowledged:300*1048576,total:300*1048576,fileCommitted:true}]});assert.match(text(f.summary(p1.peerId)),/本次结果：本批扩展已自动启用/);assert.match(text(f.summary(p2.peerId)),/待体检/);
});
test('old same-peer batch remains history while the fresh batch owns the overview',()=>{
 const old=proposal(p1,{proposal:'e'.repeat(32),status:'failed',reason:'旧失败原因🧩'}),fresh=proposal(p1,{status:'pending'}),f=draw({proposals:[old,fresh],files:[{...old,status:'failed',acknowledged:25,total:100,reason:'旧文件失败原文🧩'}]});
 assert.match(text(f.summary(p1.peerId)),/等待客机确认/);assert.doesNotMatch(text(f.summary(p1.peerId)),/旧失败|旧文件|25%/);assert.equal(f.cards[0].props['data-nnk-transfer-context'],'history');assert.equal(f.cards[1].props['data-nnk-transfer-context'],'current');assert.match(text(f.cards[0]),/旧文件失败原文🧩/);assert.equal(f.button(f.cards[0],'重新传输（需客机再次同意）'),undefined);assert.ok(f.button(f.cards[1],'终止本次补传'));
});
test('an orphan file from another binding cannot replace a current proposal',()=>{
 const q=proposal(p1,{status:'pending'}),old={...q,proposal:'e'.repeat(32),status:'committed',fileCommitted:true,acknowledged:100,total:100},f=draw({proposals:[q],files:[old]});assert.match(text(f.summary(p1.peerId)),/等待客机确认/);assert.doesNotMatch(text(f.summary(p1.peerId)),/已自动启用|100%/);assert.equal(f.cards[1].props['data-nnk-transfer-context'],'history');
});
for(const change of[{session:'x'.repeat(32)},{peerSession:'x'.repeat(32)},{proposal:'x'.repeat(32)},{digest:'e'.repeat(64)},{peerId:p2.peerId},{role:'guest'},{scope:{...scope,partyEpoch:3}},{scope:{...scope,carrierSessionId:'retired-carrier'}}])test('overview progress matches the complete immutable binding '+JSON.stringify(change),()=>{
 const q=proposal(p1,{status:'pending'}),f=draw({proposals:[q],files:[{...q,...change,status:'sending',acknowledged:50,total:100}]});assert.doesNotMatch(text(f.summary(p1.peerId)),/50%/);
});
test('disconnected and retired-scope identities stay in history without adopting the new live name',()=>{
 const old=proposal(p1,{peerLabel:'旧昵称（客机 2）',scope:{...scope,partyEpoch:3},status:'failed'}),disconnected=proposal(peer(19,'已断开玩家'),{status:'failed'}),f=draw({proposals:[old,disconnected]});assert.equal(f.summaries.length,3);assert.doesNotMatch(text(f.overview),/旧昵称|已断开玩家/);assert.match(text(f.cards[0]),/旧昵称（客机 2）/);assert.match(text(f.cards[1]),/已断开玩家/);for(const card of f.cards){assert.equal(card.props['data-nnk-transfer-context'],'history');assert.equal(f.button(card,'重新传输（需客机再次同意）'),undefined);}
});
test('current participants exclude stale-scope rows and unsupported peers still await inspection',()=>{
 const unsupported={...p2,transferCapable:false},f=draw({participants:[p1,unsupported,{...p3,scope:{...scope,partyEpoch:3}}]});assert.equal(f.summaries.length,2);assert.match(text(f.summary(p2.peerId)),/待体检 \/ 等待处理；当前连接不支持新版补传/);assert.doesNotMatch(text(f.summary(p2.peerId)),/发现缺包/);
});
test('verified health evidence is isolated by peer, role, request and scope',()=>{
 const data={peerId:p1.peerId,role:'host',scope,request:4},events=[{type:'manifest_check',data:{...data,status:'pending'}},{type:'manifest_diff',data:{...data,verification:'verified',inventoryVerified:true,exts:{missing:['A']}}},{type:'manifest_check',data:{...data,status:'verified'}}],f=draw({events});assert.match(text(f.summary(p1.peerId)),/体检发现缺包或文件差异/);assert.match(text(f.summary(p2.peerId)),/待体检/);for(const change of[{peerId:'retired-peer'},{role:'guest'},{scope:{...scope,partyEpoch:3}},{request:5}]){const altered=events.map((ev,index)=>index?{...ev,data:{...ev.data,...change}}:ev);assert.doesNotMatch(text(draw({events:altered}).summary(p1.peerId)),/发现缺包/);}
});
test('a fresh pending inspection replaces an older verified missing result',()=>{
 const data={peerId:p1.peerId,role:'host',scope,request:4},events=[{type:'manifest_check',data:{...data,status:'pending'}},{type:'manifest_diff',data:{...data,verification:'verified',inventoryVerified:true,exts:{missing:['A']}}},{type:'manifest_check',data:{...data,status:'verified'}},{type:'manifest_check',data:{...data,request:5,status:'pending'}}];assert.match(text(draw({events}).summary(p1.peerId)),/正在体检；尚未确认/);assert.doesNotMatch(text(draw({events}).summary(p1.peerId)),/发现缺包/);
});
test('guests keep the original batch controls without a host overview',()=>{
 const q=proposal(p1,{role:'guest',status:'pending'}),f=draw({role:'guest',proposals:[q]});assert.equal(f.overview,undefined);assert.ok(f.button(f.cards[0],'同意本批并接收'));assert.ok(f.button(f.cards[0],'拒绝本批'));f.button(f.cards[0],'同意本批并接收').props.onClick();assert.equal(f.commands[0][0],'batch_decision');assert.equal(f.commands[0][1].peerId,p1.peerId);assert.deepEqual(f.commands[0][1].scope,scope);
});
test('named cancellation still sends only the complete displayed batch binding',()=>{
 const q=proposal(p2),f=draw({proposals:[q]});f.button(f.cards[0],'终止本次补传').props.onClick();assert.deepEqual(f.commands,[['batch_cancel',{session:q.session,peerSession:q.peerSession,proposal:q.proposal,digest:q.digest,peerId:p2.peerId,scope}]]);
});
test('manual controls retain stable names after reordering and exact peer targeting',()=>{
 const f=draw({participants:[p3,p2]}),commands=[],tree=manualRender(f.bridge,[],true,true,h,e,(...args)=>commands.push(args),()=>{},()=>null),manual=nodes(tree).find(n=>n.props['data-nnk-manual-transfer']),buttons=nodes(manual).filter(n=>n.tag==='button');assert.match(text(manual),/未命名客机 11/);assert.equal(buttons[1].props['aria-label'],'重新传输给同名玩家（客机 7）');buttons[1].props.onClick();assert.deepEqual(commands,[['batch_request',{peerId:p2.peerId,scope}]]);
});
test('named dynamic rows retain the original phase and exact failure text',()=>{
 assert.equal(eventText({type:'batch_files',data:{...proposal(p2),status:'failed',reason:'原始错误：路径🧩 / 不能写入'}}),'[同名玩家（客机 7）] 📦 本批补传：文件事务失败；原始错误：路径🧩 / 不能写入');assert.equal(eventText({type:'error',data:{peerLabel:p3.peerLabel,message:'独立错误🧩'}}),'[未命名客机 11] ❌ 独立错误🧩');assert.equal(eventText({type:'error',data:{message:'兼容原文'}}),'❌ 兼容原文');
});
test('three concurrent synthetic progress streams each collapse per binding and phase',()=>{
 const bridge=createBridgeSession({token:'isolated-multi-ui-test'});let seq=0;const event=(type,data)=>({type,data,seq:++seq,ts:Date.now()}),qs=[p1,p2,p3].map(p=>proposal(p));
 for(const q of qs)bridge.poll({events:[event('batch_files',{...q,status:'waiting_receiver',acknowledged:0,total:300})]});
 for(let i=1;i<=300;i++)for(const [index,q] of qs.entries())bridge.poll({events:[event('batch_files',{...q,status:'sending',acknowledged:Math.floor(i/(index+1)),total:300})]});
 bridge.poll({events:[event('error',{peerLabel:p2.peerLabel,message:'独立原始错误🧩'}),event('batch_files',{...qs[0],status:'failed',reason:'第一位失败原文🧩'})]});
 const events=bridge.snapshot().events;for(const q of qs){assert.equal(events.filter(ev=>ev.type==='batch_files'&&ev.data.peerId===q.peerId&&ev.data.status==='sending').length,1);assert.equal(events.filter(ev=>ev.type==='batch_files'&&ev.data.peerId===q.peerId&&ev.data.status==='waiting_receiver').length,1);}assert.equal(events.filter(ev=>ev.type==='batch_files'&&ev.data.status==='failed').length,1);assert.ok(events.some(ev=>ev.data.message==='独立原始错误🧩'));assert.equal(events.length,8);
});
test('malformed metadata and progress remain harmless',()=>{
 for(const participants of[null,'invalid',{},[null,{},p1,p1]])assert.doesNotThrow(()=>draw({participants,state:{transferPeers:[]}}));const q=proposal(p1);for(const acknowledged of[NaN,Infinity,-1,'100'])assert.doesNotMatch(text(draw({proposals:[q],files:[{...q,status:'sending',acknowledged,total:100}]}).overview),/NaN|Infinity|100%/);
});
console.log(`\n全部通过: ${count} 项（实际多人UI+桥事件合成验证；不替代真实多机补传验收）`);

// Actual shared package-health renderer with synthetic state; no game, network or file transfer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const support=src.slice(src.indexOf('function onlinePickEvent('),src.indexOf('    function OnlinePanel('));
const component=src.slice(src.indexOf('function renderManifestCard('),src.indexOf('      function leaveRoom('));
const factory=new Function('bridge','evs','hostFlow','inRoom','h','e','sendCmd','setNote','renderTransferLimit',support+component+';return renderManifestCard(evs,hostFlow,inRoom);');
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)}),e=(tag,className,...children)=>h(tag,{className},...children),nodes=x=>x&&typeof x==='object'?[x,...x.children.flatMap(nodes)]:[],text=x=>x&&typeof x==='object'?x.children.map(text).join(''):String(x??'');
const scope={carrierSessionId:'manual-ui-current-carrier',partyEpoch:2},peer={peerId:'actual-current-peer',name:'Guest A'};
function draw({state={},host=true,role=host?'host':'guest',online=true,events=[],inRoom=true}={}){
 const commands=[],notes=[],bridge={role,online,state:{transferScope:scope,manifestScope:scope,transferAvailable:true,transferPeers:[peer],transferBusy:false,transferRequestPending:false,manifestAvailable:true,...state}};
 const tree=factory(bridge,events,host,inRoom,h,e,(...args)=>commands.push(args),note=>notes.push(note),()=>null),all=nodes(tree),manual=all.find(n=>n.props['data-nnk-manual-transfer']);
 return {tree,all,manual,commands,notes,copy:text(tree),buttons:manual?nodes(manual).filter(n=>n.tag==='button'):[],rows:manual?nodes(manual).filter(n=>Object.hasOwn(n.props,'data-nnk-transfer-peer')):[]};
}
function assertBlocked(options){const f=draw(options);assert.equal(f.buttons.length,1);assert.equal(f.buttons[0].props.disabled,true);f.buttons[0].props.onClick();assert.deepEqual(f.commands,[]);assert.deepEqual(f.notes,[]);return f;}
const binding={session:'a'.repeat(32),peerSession:'b'.repeat(32),proposal:'c'.repeat(32),digest:'d'.repeat(64),peerId:peer.peerId,scope,role:'host'};
const check={peerId:peer.peerId,request:1,role:'host',scope};
const verifiedEvents=[{type:'manifest_check',data:{...check,status:'pending'}},{type:'manifest_diff',data:{...check,verification:'verified',inventoryVerified:true,exts:{missing:['Fixture'],changed:[],extra:[],disabled:[],unverified:[],matching:[],needsFiles:['Fixture']},cards:{missing:[]},packs:{missing:[]}}},{type:'manifest_check',data:{...check,status:'verified'}}];
let count=0;function test(name,fn){fn();count++;console.log('  ✓ '+name);}
test('host always has a manual request entry with no old proposal or health result',()=>{const f=draw();assert.equal(f.buttons.length,1);assert.equal(text(f.buttons[0]),'重新传输');assert.equal(f.buttons[0].props.disabled,false);assert.match(f.copy,/客机需再次同意/);assert.deepEqual(f.commands,[]);});
test('click sends only the actual peer and current scope, with no names, paths or reused grant',()=>{const f=draw();f.buttons[0].props.onClick();assert.deepEqual(f.commands,[['batch_request',{peerId:peer.peerId,scope}]]);assert.deepEqual(f.notes,['正在重新体检并申请补传，等待客机重新确认']);assert.doesNotMatch(f.notes.join(''),/已传输|成功|已完成/);});
test('main-page and room-card branches share the same manual control',()=>{for(const inRoom of[true,false])for(const events of[[],verifiedEvents]){const f=draw({inRoom,events});assert.equal(f.buttons.length,1);f.buttons[0].props.onClick();assert.equal(f.commands[0][0],'batch_request');}});
test('a previous noncommitted failure does not hide the fresh manual entry',()=>{const f=draw({state:{batchProposals:[{...binding,status:'failed'}]}});assert.equal(f.buttons[0].props.disabled,false);f.buttons[0].props.onClick();assert.equal(f.commands[0][0],'batch_request');});
test('multiple current guests each have their own named row and exact command target',()=>{const peers=[peer,{peerId:'actual-second-peer',name:'Guest B'}],f=draw({state:{transferPeers:peers}});assert.equal(f.rows.length,2);assert.match(text(f.rows[0]),/客机 1：Guest A/);assert.match(text(f.rows[1]),/客机 2：Guest B/);f.buttons[1].props.onClick();assert.deepEqual(f.commands,[['batch_request',{peerId:peers[1].peerId,scope}]]);assert.match(f.buttons[1].props['aria-label'],/客机 2：Guest B/);});
test('same-name guests remain distinguishable by row and accessible labels',()=>{const f=draw({state:{transferPeers:[peer,{peerId:'another-actual-peer',name:peer.name}]}});assert.notEqual(f.buttons[0].props['aria-label'],f.buttons[1].props['aria-label']);assert.equal(f.rows[1].props['data-nnk-transfer-peer'],'another-actual-peer');});
test('historical health event targets cannot replace actual state peers',()=>{const oldEvents=verifiedEvents.map(ev=>({...ev,data:{...ev.data,peerId:'historical-peer'}})),f=draw({events:oldEvents});f.buttons[0].props.onClick();assert.equal(f.commands[0][1].peerId,peer.peerId);});
test('guest retains read-only health controls without a pretend retransmission button',()=>{for(const host of[false,true]){const f=draw({host,role:'guest'});assert.equal(f.manual,undefined);assert.ok(f.all.some(n=>n.tag==='button'&&text(n)==='重新体检'));assert.deepEqual(f.commands,[]);}});
test('unconnected host sees a disabled entry and the real unavailability explanation',()=>{const f=assertBlocked({state:{transferPeers:[],transferAvailable:false,transferUnavailableReason:'请先连接双方新版内核'}});assert.match(f.copy,/请先连接双方新版内核/);});
test('offline state cannot send a request',()=>{assert.match(assertBlocked({online:false}).copy,/内核离线/);});
test('missing current host role cannot use an old host-shaped view',()=>{assertBlocked({role:null});});
for(const state of[{transferRequestPending:true},{transferBusy:true},{batchProposals:[{...binding,status:'pending'}]},{fileBatches:[{...binding,status:'receiving'}]},{fileBatches:[{...binding,status:'committing'}]}])test('pending or active batch state blocks repeated manual requests',()=>{assertBlocked({state});});
for(const phase of['playing','settling','loading','returning','waiting'])test('game phase '+phase+' blocks manual requests',()=>{assert.match(assertBlocked({state:{round:{phase}}}).copy,/返回插件房间/);});
for(const status of['activation_pending','committed','committed_activation_required','unknown','recovery_required'])test(status+' cannot be overwritten through the no-proposal manual entry',()=>{const f=assertBlocked({state:{fileBatches:[{...binding,status}]}});assert.match(f.copy,/提交|恢复/);});
test('durable marker blocks requests even if the status text is malformed',()=>{assertBlocked({state:{fileBatches:[{...binding,status:'failed',fileCommitted:true}]}});});
test('same-scope irreversible outcome for another current peer also blocks the local disk gate',()=>{assertBlocked({state:{fileBatches:[{...binding,peerId:'second-peer',status:'unknown'}]}});});
test('historical irreversible outcome from a retired scope does not suppress current eligible requests',()=>{const f=draw({state:{fileBatches:[{...binding,scope:{...scope,partyEpoch:1},status:'unknown'}]}});assert.equal(f.buttons[0].props.disabled,false);});
test('scope changes are reflected in newly rendered command bindings',()=>{const current={carrierSessionId:'new-carrier',partyEpoch:0},f=draw({state:{transferScope:current}});f.buttons[0].props.onClick();assert.deepEqual(f.commands[0][1],{peerId:peer.peerId,scope:current});});
for(const current of[null,{}, {...scope,partyEpoch:-1},{...scope,extra:true},{...scope,carrierSessionId:'bad\ncarrier'}])test('malformed current scopes remain disabled',()=>{assertBlocked({state:{transferScope:current,manifestScope:current}});});
test('peer list corruption or unsupported capability never creates an arbitrary request target',()=>{for(const transferPeers of[null,'invalid',{},[null,{name:'missing id'},{peerId:'bad\npeer'}]])assertBlocked({state:{transferPeers}});const f=draw({state:{transferPeers:[peer,{...peer},null]}});assert.equal(f.buttons.length,1);});
test('pending health check cannot be replaced by an unrelated manual request',()=>{assertBlocked({events:[verifiedEvents[0]]});});
test('rendering manual controls never grants, reloads, transfers legacy files or invokes AI',()=>{const f=draw({events:verifiedEvents});assert.deepEqual(f.commands,[]);assert.equal(nodes(f.manual).some(n=>n.tag==='input'),false);assert.doesNotMatch(f.copy,/永久授权|自动重启/);});
for(const host of[true,false])test('committed files annotate only the matching peer health snapshot for '+(host?'host':'guest'),()=>{
 const role=host?'host':'guest',events=verifiedEvents.map(ev=>({...ev,data:{...ev.data,role}})),file={...binding,role,status:'committed',fileCommitted:true,batch:{extensions:[{name:'Fixture'}]}};
 const f=draw({host,role,events,state:{transferAvailable:false,fileBatches:[file]}});assert.match(f.copy,/补传前记录/);assert.match(f.copy,/文件已提交/);assert.match(f.copy,/完全退出并重启无名杀/);assert.doesNotMatch(f.copy,/请双方自行安装相同版本|请自行安装或待补传条件就绪|已体检的启用扩展内容一致/);assert.deepEqual(f.commands,[]);
});
for(const change of[{peerId:'another-peer'},{scope:{...scope,partyEpoch:1}},{status:'unknown',fileCommitted:false},{status:'receiving',fileCommitted:false},{role:'guest'}])test('unrelated or uncommitted batches cannot replace missing health guidance '+JSON.stringify(change),()=>{
 const file={...binding,status:'committed',fileCommitted:true,batch:{extensions:[{name:'Fixture'}]},...change},f=draw({events:verifiedEvents,state:{transferAvailable:false,fileBatches:[file]}});assert.match(f.copy,/请自行安装或待补传条件就绪/);assert.doesNotMatch(f.copy,/本条仍为补传前/);
});
test('partially committed names keep unrelated missing extensions visible',()=>{
 const events=verifiedEvents.map(ev=>ev.type==='manifest_diff'?{...ev,data:{...ev.data,exts:{...ev.data.exts,missing:['Fixture','Other']}}}:ev),file={...binding,status:'committed',fileCommitted:true,batch:{extensions:[{name:'Fixture'}]}},f=draw({events,state:{transferAvailable:false,fileBatches:[file]}});assert.match(f.copy,/Fixture/);assert.match(f.copy,/Other/);assert.match(f.copy,/本条仍为补传前/);assert.match(f.copy,/请自行安装或待补传条件就绪/);
});
test('committed same-name file differences remain a previous observation rather than a fresh pass',()=>{
 const events=verifiedEvents.map(ev=>ev.type==='manifest_diff'?{...ev,data:{...ev.data,exts:{...ev.data.exts,missing:[],changed:['Fixture']}}}:ev),file={...binding,status:'committed',fileCommitted:true,batch:{extensions:[{name:'Fixture'}]}},f=draw({events,state:{transferAvailable:false,fileBatches:[file]}});assert.match(f.copy,/补传前记录中的同名扩展内容差异/);assert.match(f.copy,/文件已提交/);assert.doesNotMatch(f.copy,/双方仍可自行安装|已体检的启用扩展内容一致/);
});
test('mixed changed names attribute committed guidance only to the submitted extension',()=>{
 const events=verifiedEvents.map(ev=>ev.type==='manifest_diff'?{...ev,data:{...ev.data,exts:{...ev.data.exts,missing:[],changed:['Fixture','Other']}}}:ev),file={...binding,status:'committed',fileCommitted:true,batch:{extensions:[{name:'Fixture'}]}},f=draw({events,state:{transferAvailable:false,fileBatches:[file]}});assert.match(f.copy,/Fixture：文件已提交/);assert.match(f.copy,/Other：补传当前不可用/);assert.doesNotMatch(f.copy,/Other：文件已提交/);
});
console.log(`\n全部通过: ${count} 项（实际组件函数+合成状态，不替代真实补传验收）`);

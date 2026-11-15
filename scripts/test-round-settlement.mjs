// Protocol unit fixtures only; native gameplay/settlement evidence is separate.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {RoundSettlement} from '../online-kernel/keepalive/round-settlement.js';
import {NATIVE_OVER_SHA256,inspectNativeAvatarRestore,inspectNativeIdentityReveal,sameNativeIdentityReveal,closeNativeSettlementActions} from '../online-kernel/keepalive/native-settlement.js';
globalThis.require=createRequire(import.meta.url);
const clone=x=>JSON.parse(JSON.stringify(x)),H='1'.repeat(64),D='2'.repeat(64);
const scope=(id,generation=3)=>({sessionId:'party',roundId:'round',documentGeneration:generation,bindingId:'binding-'+id,bindingNonce:'nonce-'+id,expectedOrigin:'http://localhost:8089'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
// The two supported official versions share this avatar method. The fixture uses it to verify admission.
class NativeAvatarPlayer {
  setAvatar(name2, name22, video, fakeme) {
    var node;
    if (this.name2 == name2) {
      node = this.node.avatar2;
      this.smoothAvatar(true, video);
    } else if (this.name == name2) {
      node = this.node.avatar;
      this.smoothAvatar(false, video);
    }
    if (node) {
      if (name2 === name22) {
        var skinName = this.name2 != name2 ? this.skin?.name : this.skin?.name2;
        if (!skinName || skinName === name22) {
          node.setBackground(name22, "character");
        } else {
          node.setBackground(skinName, "character");
        }
      } else {
        node.setBackground(name22, "character");
      }
      if (this == game.me && ui.fakeme && fakeme !== false) {
        ui.fakeme.style.backgroundImage = node.style.backgroundImage;
      }
      if (video != false) {
        game.addVideo("setAvatar", this, [name2, name22]);
      }
    }
    game.broadcast(
      function(player, name3, name23) {
        player.setAvatar(name3, name23, false);
      },
      this,
      name2,
      name22
    );
  }
}
const avatarCallback='_noname_func:function (player, name3, name23) {\n        player.setAvatar(name3, name23, false);\n      }';
function avatarFixture(version='1.11.6'){
 const player=Object.assign(new NativeAvatarPlayer(),{playerid:'actual-player',name:'re_zuoci'}),env={game:{online:true,players:[player],dead:[],additionaldead:[]},lib:{version,playerOL:{'actual-player':player},character:{re_zuoci:{}}}};
 const packet=['exec',avatarCallback,'_noname_player:actual-player','re_zuoci','re_zuoci'];return {player,env,packet,raw:()=>JSON.stringify(packet)};
}
// Exact shared official method sources; only isolated fake-DOM execution below.
const identityMethodSources={
 "isAlive": "isAlive() {\n    return this.classList.contains(\"dead\") == false;\n  }",
 "population": "population(identity) {\n    return identity == void 0 ? game.players.length + game.dead.length : game.players.filter((current) => current.identity == identity).length;\n  }",
 "config": "config(item, mode) {\n    mode = mode || lib.config.mode;\n    if (!lib.config.mode_config[mode]) {\n      return;\n    }\n    return lib.config.mode_config[mode][item];\n  }",
 "$fullscreenpop": "$fullscreenpop(str, nature, avatar, broadcast) {\n    if (broadcast !== false) {\n      game.broadcast(\n        function(player, str2, nature2, avatar2) {\n          player.$fullscreenpop(str2, nature2, avatar2);\n        },\n        this,\n        str,\n        nature,\n        avatar\n      );\n    }\n    game.addVideo(\"fullscreenpop\", this, [str, nature, avatar]);\n    var node = ui.create.div(\".damage\");\n    if (avatar && this.node) {\n      if (avatar == \"vice\") {\n        if (lib.character[this.name2]) {\n          avatar = this.node.avatar2;\n        }\n      } else {\n        if (lib.character[this.name]) {\n          avatar = this.node.avatar;\n        }\n      }\n      if (!get.is.div(avatar)) {\n        avatar = false;\n      }\n    } else {\n      avatar = false;\n    }\n    if (avatar) {\n      node.classList.add(\"fullscreenavatar\");\n      ui.create.div(\"\", ui.create.div(node));\n      ui.create.div(\"\", \"<div>\" + str.split(\"\").join(\"</div><br><div>\") + \"</div>\", ui.create.div(\".text\", node));\n      node.firstChild.firstChild.style.backgroundImage = avatar.style.backgroundImage;\n      node.dataset.nature = nature || \"unknown\";\n      var num = 0;\n      var nodes = node.lastChild.firstChild.querySelectorAll(\"div\");\n      var interval = setInterval(function() {\n        if (num < nodes.length) {\n          nodes[num].classList.add(\"flashtext\");\n          num++;\n        } else {\n          clearInterval(interval);\n        }\n      }, 100);\n    } else {\n      avatar = false;\n      node.innerHTML = str;\n      node.dataset.nature = nature || \"soil\";\n    }\n    if (avatar) {\n      var rect1 = ui.window.getBoundingClientRect();\n      var rect2 = this.getBoundingClientRect();\n      var dx = Math.round(2 * rect2.left + rect2.width - rect1.width);\n      var dy = Math.round(2 * rect2.top + rect2.height - rect1.height);\n      node.style.transform = \"scale(0.5) translate(\" + dx + \"px,\" + dy + \"px)\";\n    }\n    ui.window.appendChild(node);\n    ui.refresh(node);\n    if (avatar) {\n      node.style.transform = \"scale(1)\";\n      node.style.opacity = 1;\n    } else {\n      node.classList.add(\"damageadded\");\n    }\n    setTimeout(\n      function() {\n        node.delete();\n        node.style.transform = \"scale(1.5)\";\n      },\n      avatar ? 1600 : 1e3\n    );\n  }",
 "addVideo": "addVideo(type, player, content) {\n    if (_status.video || game.online) {\n      return;\n    }\n    if (!_status.videoInited) {\n      if (type == \"arrangeLib\") {\n        lib.video.push({\n          type,\n          player,\n          content,\n          delay: 0\n        });\n      }\n      return;\n    }\n    if (type == \"storage\" && player && player.updateMarks) {\n      player.updateMarks();\n    }\n    if (game.getVideoName) {\n      var time = get.time();\n      if (!_status.lastVideoLog) {\n        _status.lastVideoLog = time;\n      }\n      if (get.itemtype(player) == \"player\") {\n        player = player.dataset.position;\n      }\n      lib.video.push({\n        type,\n        player,\n        content,\n        delay: time - _status.lastVideoLog\n      });\n      _status.lastVideoLog = time;\n    }\n    if (type === \"init\") {\n      game.addVideo(\"cardtag\", null, _status.cardtag);\n    }\n  }",
 "div": "div() {\n    var str, innerHTML, position, position2, style, divposition, listen;\n    for (var i = 0; i < arguments.length; i++) {\n      if (typeof arguments[i] == \"string\") {\n        if (typeof str == \"string\") {\n          innerHTML = arguments[i];\n        } else {\n          str = arguments[i];\n        }\n      } else if ([\"div\", \"table\", \"tr\", \"td\", \"body\", \"fragment\"].includes(get.objtype(arguments[i]))) {\n        position = arguments[i];\n      } else if (typeof arguments[i] == \"number\") {\n        position2 = arguments[i];\n      } else if (get.itemtype(arguments[i]) == \"divposition\") {\n        divposition = arguments[i];\n      } else if (typeof arguments[i] == \"object\") {\n        style = arguments[i];\n      } else if (typeof arguments[i] == \"function\") {\n        listen = arguments[i];\n      }\n    }\n    if (str == void 0) {\n      str = \"\";\n    }\n    var node = document.createElement(\"div\");\n    for (var i = 0; i < str.length; i++) {\n      if (str[i] == \".\") {\n        if (node.className.length != 0) {\n          node.className += \" \";\n        }\n        while (str[i + 1] != \".\" && str[i + 1] != \"#\" && i + 1 < str.length) {\n          node.className += str[i + 1];\n          i++;\n        }\n      } else if (str[i] == \"#\") {\n        while (str[i + 1] != \".\" && str[i + 1] != \"#\" && i + 1 < str.length) {\n          node.id += str[i + 1];\n          i++;\n        }\n      }\n    }\n    if (position) {\n      if (typeof position2 == \"number\" && position.childNodes.length > position2) {\n        position.insertBefore(node, position.childNodes[position2]);\n      } else {\n        position.appendChild(node);\n      }\n    }\n    if (style) {\n      node.css(style);\n    }\n    if (divposition) {\n      node.setPosition(divposition);\n    }\n    if (innerHTML) {\n      node.innerHTML = innerHTML;\n    }\n    if (listen) {\n      node.listen(listen);\n    }\n    return node;\n  }",
 "refresh": "refresh(node) {\n    void window.getComputedStyle(node, null).getPropertyValue(\"opacity\");\n  }"
};
const identityCallback='_noname_func:function () {\n              if (game.showIdentity) {\n                game.showIdentity();\n              }\n              if (game.zhu && game.zhu.isAlive() && get.population("nei") === 1 && get.config("nei_fullscreenpop")) {\n                game.me.$fullscreenpop(\'<span style="font-family:xinwei"><span data-nature="fire">主公</span><span data-nature="soil"> vs </span><span data-nature="thunder">内奸</span></span>\', null, null, false);\n              }\n            }';
const identityCallback6=identityCallback.replace(/\n  /g,'\n');
const nativeDeleteSource='function(time = 500, callback) {\n  if (this.timeout) {\n    clearTimeout(this.timeout);\n    delete this.timeout;\n  }\n  if (!this._listeningEnd || this._transitionEnded) {\n    if (typeof time != "number") {\n      time = 500;\n    }\n    this.classList.add("removing");\n    this.timeout = setTimeout(() => {\n      this.remove();\n      this.classList.remove("removing");\n      if (typeof callback == "function") {\n        callback();\n      }\n    }, time);\n  } else {\n    this._onEndDelete = true;\n  }\n  return this;\n}';
// The identity callback and engine methods run against in-memory DOM and timer fixtures.
function identityFixture(version='1.11.6',popup=false,hostVersion=version){
 const timers=[],created=[],document={},window={getComputedStyle:()=>({getPropertyValue:()=>''})};
 class Node {
  constructor(){this.ownerDocument=document;this.children=[];this.parentNode=null;this.isConnected=true;this.dataset={};this.style={};this.innerHTML='';const classes=new Set();this.classList={contains:x=>classes.has(x),add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x))};Object.defineProperty(this,'className',{get:()=>[...classes].join(' '),set:value=>{classes.clear();String(value).split(/\s+/).filter(Boolean).forEach(x=>classes.add(x));}});}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
 }
 class Player extends Node {}
 const lib={version,element:{Player},playerOL:{},configOL:{mode:'identity',number:8,identity_mode:'normal'},config:{mode:'connect',mode_config:{connect:{nei_fullscreenpop:popup}}}},status={over:true,connectMode:true},game={online:true,players:[],dead:[],phaseNumber:35,roundNumber:13},get={},ui={window:new Node(),create:{}},env={lib,game,get,ui,_status:status};
 const compile=(source,name)=>Function('game','get','ui','lib','_status','document','window','setTimeout','return ({'+source+'})['+JSON.stringify(name)+']')(game,get,ui,lib,status,document,window,(fn,ms)=>{timers.push({fn,ms});return timers.length;});
 for(const [name,source]of Object.entries(identityMethodSources)){const fn=compile(source,name);if(['isAlive','$fullscreenpop'].includes(name))Player.prototype[name]=fn;else if(['population','config'].includes(name))get[name]=fn;else if(name==='addVideo')game[name]=fn;else if(name==='div')ui.create[name]=fn;else ui[name]=fn;}
 Node.prototype.delete=Function('setTimeout','clearTimeout','return ('+nativeDeleteSource+')')((fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{});
 document.createElement=()=>{const node=new Node();created.push(node);return node;};
 const identities=['zhu','nei','fan','zhong','fan','zhong','fan','fan'],players=identities.map((identity,index)=>Object.assign(new Player(),{playerid:'native-'+index,name:'character_'+index,identity,hp:1,maxHp:4,ai:{shown:index<2?1:0.95},node:{identity:new Node()},phaseNumber:index+1}));
 for(const player of players){player.classList.add('player');lib.playerOL[player.playerid]=player;if(player.identity==='nei'||popup&&player.identity==='zhu')game.players.push(player);else{game.dead.push(player);player.classList.add('dead');}}
 game.zhu=players[0];game.me=players[2];
 const packet=['exec',hostVersion==='1.11.6'?identityCallback6:identityCallback],raw=()=>JSON.stringify(packet),run=()=>Function('game','get','return ('+packet[1].slice('_noname_func:'.length)+')')(game,get)();
 return {env,game,lib,get,ui,status,players,timers,created,packet,raw,run,Node,Player};
}
function fixture(role='host',peers=['a','b'],deadlineMs=12000){
 const round={partySessionId:'party',roundId:'round',operationId:'operation',phase:'playing',failed:false,remotePeerToken:'a',hostDocumentGeneration:3};
 const b={scope:scope('local'),closed:false,status:null},owners=new Map(peers.map(peer=>[peer,{}])),byOwner=new WeakMap([...owners].map(([peer,owner])=>[owner,peer])),out=[],commands=[],events=[];
 let request=0;
 const c={role,round,guestPeer:peers[0],members:new Map(peers.map(peer=>[peer,{peerId:peer,phase:'entered',documentGeneration:3,engineScope:scope(peer)}])),
  live:r=>c.round===r&&!r.failed,engines:{current:b,command:async(type,args)=>{commands.push({type,args});return type==='settlement-proof'?c.proof:{};},wait:async(_b,condition)=>{assert.ok(condition());return true;}},
  sessions:{peerForActualOwner:owner=>byOwner.get(owner)||null,isLive:peer=>owners.has(peer),isEntered:peer=>owners.has(peer),sendControl:(peer,type,data)=>out.push({peer,type,data:clone(data)})},
  envelope:(r,data)=>({...r,requestId:'request-'+(++request),...data}),publishState:()=>{},onEvent:(name,data)=>events.push({name,data}),cancelNextPreparation:reason=>events.push({name:'prepare-cancel',reason})};
 const s=new RoundSettlement(c,{deadlineMs});c.settlement=s;
 const begin=()=>{for(const peer of peers)s.sent(b,peer,10,{rawHash:H,codec:NATIVE_OVER_SHA256});s.engineEvent(b,'native-round-ended',{canonical:true,nativeEnded:true,nativeTailObserved:true,nativeOverUnchanged:true,codec:NATIVE_OVER_SHA256,dom:{present:true,hash:D},roster:peers.map(peer=>({peerId:peer,playerId:'native-'+peer,clientId:'native-'+peer,receivedSeq:7,appliedSeq:7,sequenceGap:false,pendingOfficialHandlers:0})),terminalFrames:peers.map(peer=>({peerId:peer,rawHash:H,codec:NATIVE_OVER_SHA256}))});};
 const ack=peer=>{const f=s.host.fences.get(peer);return {type:'settle-ack',data:{...c.envelope(round,{protocol:'nnk-settle/1'}),barrierId:s.host.barrierId,revision:s.host.revision,fenceRequestId:f.requestId,guestScope:scope(peer),hostGeneration:3,guestSentSeq:f.guestFinalSeq,appliedSeq:f.finalSeq,receivedSeq:f.finalSeq,terminalSeq:f.terminalSeq,terminalHash:f.terminalHash,nativeEnded:true,nativeOverUnchanged:true,sequenceGap:false,pendingOfficialHandlers:0,domHash:D}};};
 return {c,s,b,owners,out,commands,events,begin,ack};
}
let passed=0;async function test(label,fn){try{await fn();passed++;console.log('  ✓ '+label);}catch(error){console.error('  ✗ '+label);throw error;}}
await test('Exact two-version native avatar restore inspects actual live/dead Players without executing the method',async()=>{
 assert.equal(Buffer.byteLength(String(NativeAvatarPlayer.prototype.setAvatar)),1054);assert.equal(createHash('sha256').update(String(NativeAvatarPlayer.prototype.setAvatar)).digest('hex'),'187f9070fb83bd74c825e7fcd048559fd03256d740050969c24ccd6072e22cc4');assert.equal(createHash('sha256').update(avatarCallback).digest('hex'),'770f9771d8eb1e9f3eedd5c0a06cb71093a9839bc737dd2c5d6cabbd6a9f19da');
 for(const version of ['1.11.5.2','1.11.6'])for(const location of ['players','dead','additionaldead']){const f=avatarFixture(version);f.env.game.players=[];f.env.game[location]=[f.player];const proof=inspectNativeAvatarRestore(f.env,f.raw());assert.equal(proof.player,f.player);assert.equal(proof.method,f.player.setAvatar);assert.equal(proof.playerId,f.player.playerid);assert.equal(proof.name,'re_zuoci');assert.equal(f.player.node,undefined);}
 const second=avatarFixture();second.player.name='other';second.player.name2='re_zuoci';assert.equal(inspectNativeAvatarRestore(second.env,second.raw()).player,second.player);
});
await test('Avatar tail rejects modified callbacks instead of treating arbitrary exec as cosmetic',async()=>{
 for(const callback of [avatarCallback+' ',avatarCallback.replace('false','true'),avatarCallback.replace('setAvatar','init'),avatarCallback.replace('player.setAvatar(name3, name23, false);','player.hp=0;'),avatarCallback.replace('_noname_func:',''),null,{},42]){const f=avatarFixture();f.packet[1]=callback;assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);}
});
await test('Avatar tail rejects changed or missing actual Player methods',async()=>{
 for(const method of [function setAvatar(){},null,undefined,'setAvatar']){const f=avatarFixture();f.player.setAvatar=method;assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);}
 const f=avatarFixture();f.player.setAvatar=new Function('return class Changed {'+String(NativeAvatarPlayer.prototype.setAvatar).replace('var node;','var node=null;')+'}')().prototype.setAvatar;assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);
});
await test('Avatar tail requires the unique current native Player mapping and actual collection membership',async()=>{
 const patches=[f=>{delete f.env.lib.playerOL['actual-player'];},f=>{f.env.game.players=[];},f=>{f.env.lib.playerOL['actual-player']=Object.assign(new NativeAvatarPlayer(),{playerid:'actual-player',name:'re_zuoci'});},f=>{f.env.game.dead=[Object.assign(new NativeAvatarPlayer(),{playerid:'actual-player',name:'re_zuoci'})];},f=>{f.player.playerid='another-player';},f=>{f.packet[2]='_noname_player:unknown-player';},f=>{f.packet[2]='actual-player';},f=>{f.packet[2]={playerid:'actual-player'};},f=>{f.env.game.online=false;},f=>{f.env.lib.version='1.11.7';}];
 for(const patch of patches){const f=avatarFixture();patch(f);assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);}
});
await test('Avatar tail rejects avatar changes, illegal names and unknown characters',async()=>{
 const changed=avatarFixture();changed.packet[4]='caocao';changed.env.lib.character.caocao={};assert.equal(inspectNativeAvatarRestore(changed.env,changed.raw()),null);
 for(const name of ['', 'x'.repeat(81),'re-zuoci','../re_zuoci','左慈','unknown_character']){const f=avatarFixture();f.packet[3]=f.packet[4]=name;f.player.name=name;if(name!=='unknown_character')f.env.lib.character[name]={};assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);}
 for(const value of [null,7,{},[]]){const f=avatarFixture();f.packet[3]=f.packet[4]=value;assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);}
 const f=avatarFixture();f.player.name='caocao';assert.equal(inspectNativeAvatarRestore(f.env,f.raw()),null);
});
await test('Avatar tail requires exactly five typed exec items and rejects malformed payloads',async()=>{
 const f=avatarFixture();for(const raw of ['', '{', 'null', '{}', '42',JSON.stringify(f.packet.slice(0,4)),JSON.stringify([...f.packet,false]),JSON.stringify(['update',...f.packet.slice(1)]),JSON.stringify({0:'exec',1:avatarCallback,2:f.packet[2],3:'re_zuoci',4:'re_zuoci'})])assert.equal(inspectNativeAvatarRestore(f.env,raw),null);
});
await test('Both official callback fingerprints retain exact version whitespace and the shared reviewed popup chain',async()=>{
 assert.equal(identityCallback.length,476);assert.equal(Buffer.byteLength(identityCallback),484);assert.equal(createHash('sha256').update(identityCallback).digest('hex'),'2cd2d24173f420bc96c80018f61663c2634e1fc3157a8ab991d0983bd18189e3');
 assert.equal(identityCallback6.length,462);assert.equal(Buffer.byteLength(identityCallback6),470);assert.equal(createHash('sha256').update(identityCallback6).digest('hex'),'8cf14522f3fe787d5defab68aba2e5fc63c5a0dc22bf9fede2caa863fbf9ea1a');
 const expected={isAlive:'2b485433d630e27c52f8ba76b8099aaa263006c819a1b7a403d6460ed34c46d2',population:'bfc3a95415505b3a3ff5bf58be6143352f5fa19d8f99ec20c25ee164bff0cc0e',config:'bff2d5706dcb9f4b795d1effb93ac03225f8734ef37847f034213ee5ed5079f9',$fullscreenpop:'5be57ebafda196fc10de433b51d93cdd351cd061ea060f2803d5cae8935f7566',addVideo:'229dfbb78d60e882f9ef141c4223b44de34fd14f977a544bf1f351e588cfb6e0',div:'1d11523d6ab8aa2a7fd080b3eb43cd11b0937301f2ab9bde7c0862a9a1ade828',refresh:'583361ff9c548907a6727839c86cb754ffc6f6a27c830ec3912c3c80a110b28b'};
 for(const [name,source]of Object.entries(identityMethodSources))assert.equal(createHash('sha256').update(source).digest('hex'),expected[name]);
 assert.equal(createHash('sha256').update(nativeDeleteSource).digest('hex'),'50249d1a56164c886ba3c88716d02be40f5ff880a613f89a9b3f28fee7d2c03d');
});
await test('Actual ordinary Guest absent showIdentity and a dead lord form a verified no-op in either version',async()=>{
 for(const version of ['1.11.5.2','1.11.6'])for(const hostVersion of ['1.11.5.2','1.11.6']){const f=identityFixture(version,false,hostVersion),before=inspectNativeIdentityReveal(f.env,f.raw());assert.ok(before);assert.equal(before.popup,false);assert.equal(f.game.showIdentity,undefined);assert.equal(f.game.me.identityShown,undefined);assert.equal(f.game.me.ai.shown,0.95);assert.equal(f.created.length,0);assert.equal(f.timers.length,0);f.run();const after=inspectNativeIdentityReveal(f.env,f.raw());assert.equal(sameNativeIdentityReveal(before,after),true);assert.equal(f.created.length,0);assert.equal(f.timers.length,0);}
});
await test('Reviewed native popup runs only in the isolated DOM and preserves living/dead player identity for any local role',async()=>{
 for(const version of ['1.11.5.2','1.11.6'])for(const hostVersion of ['1.11.5.2','1.11.6'])for(const local of [0,1,2]){const f=identityFixture(version,true,hostVersion);f.game.me=f.players[local];const before=inspectNativeIdentityReveal(f.env,f.raw());assert.ok(before);assert.equal(before.popup,true);assert.equal(f.created.length,0,'inspection never calls native popup');assert.equal(f.timers.length,0);f.run();const after=inspectNativeIdentityReveal(f.env,f.raw());assert.equal(sameNativeIdentityReveal(before,after),true);assert.equal(f.created.length,1);assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,1000);assert.equal(f.status.over,true);assert.equal(f.game.me,f.players[local]);}
});
await test('Identity display follows the native short circuit rather than assuming a popup for every living lord',async()=>{
 const configFalse=identityFixture('1.11.6',true);configFalse.lib.config.mode_config.connect.nei_fullscreenpop=false;const before=inspectNativeIdentityReveal(configFalse.env,configFalse.raw());assert.equal(before.popup,false);configFalse.run();assert.equal(sameNativeIdentityReveal(before,inspectNativeIdentityReveal(configFalse.env,configFalse.raw())),true);assert.equal(configFalse.created.length,0);
 const noNei=identityFixture('1.11.6',true);noNei.players[1].identity='fan';noNei.get.config=null;const proof=inspectNativeIdentityReveal(noNei.env,noNei.raw());assert.ok(proof);assert.equal(proof.popup,false);noNei.run();assert.equal(sameNativeIdentityReveal(proof,inspectNativeIdentityReveal(noNei.env,noNei.raw())),true);
});
await test('Identity display rejects changed callbacks, added arguments and malformed packets',async()=>{
 const f=identityFixture();for(const raw of ['', '{','null','{}','42',JSON.stringify(['exec',identityCallback,null]),JSON.stringify(['update',identityCallback]),JSON.stringify(['exec',identityCallback+' ']),JSON.stringify(['exec',identityCallback.replace('null, null, false','null, null, true')]),JSON.stringify(['exec',identityCallback.replace('game.showIdentity();','game.reload();')])])assert.equal(inspectNativeIdentityReveal(f.env,raw),null);
});
await test('Identity display requires an ended current supported ordinary connect Guest',async()=>{
 const patches=[f=>{f.lib.version='1.11.7';},f=>{f.game.online=false;},f=>{f.status.over=false;},f=>{f.lib.configOL.mode='single';},f=>{f.game.showIdentity=function showIdentity(){};},f=>{f.game.showIdentity=null;},f=>{f.game.showIdentity=false;},f=>{f.game.zhu=null;}];
 for(const patch of patches){const f=identityFixture();patch(f);assert.equal(inspectNativeIdentityReveal(f.env,f.raw()),null);}
});
await test('Popup rejects any changed dynamic method in the executed native chain',async()=>{
 const patches=[f=>{f.game.zhu.isAlive=()=>true;},f=>{f.get.population=()=>1;},f=>{f.get.config=()=>true;},f=>{f.game.me.$fullscreenpop=()=>{};},f=>{f.game.addVideo=()=>{};},f=>{f.ui.create.div=()=>{};},f=>{f.ui.refresh=()=>{};},f=>{f.ui.window.delete=()=>{};},f=>{f.lib.config.mode_config.connect.nei_fullscreenpop='true';}];
 for(const patch of patches){const f=identityFixture('1.11.6',true);patch(f);assert.equal(inspectNativeIdentityReveal(f.env,f.raw()),null);assert.equal(f.created.length,0);assert.equal(f.timers.length,0);}
});
await test('Identity display requires unique actual Player objects and the complete native mapping',async()=>{
 const patches=[f=>{delete f.lib.playerOL[f.game.me.playerid];},f=>{f.lib.playerOL.stranger=f.game.me;},f=>{f.lib.playerOL[f.game.me.playerid]={...f.game.me};},f=>{f.game.dead.push(f.game.me);},f=>{f.game.dead[0]={...f.game.dead[0]};f.lib.playerOL[f.game.dead[0].playerid]=f.game.dead[0];},f=>{f.game.me=new f.Player();},f=>{f.game.zhu.identity='fan';},f=>{f.players[1].identity='zhu';},f=>{f.game.zhu.classList=null;},f=>{f.game.additionaldead={};}];
 for(const patch of patches){const f=identityFixture();patch(f);assert.equal(inspectNativeIdentityReveal(f.env,f.raw()),null);}
});
await test('Identical method bytes cannot hide changed player, roster, identity, HP or native object references',async()=>{
 const patches=[f=>{f.game.players=[...f.game.players];},f=>{f.game.dead.reverse();},f=>{f.game.me.name='other';},f=>{f.game.me.hp=0;},f=>{f.game.me.identityShown=true;},f=>{f.game.me.ai={...f.game.me.ai};},f=>{f.game.me.node={...f.game.me.node};},f=>{f.lib.playerOL={...f.lib.playerOL};},f=>{f.game.me=f.players[3];},f=>{f.game.zhu.isAlive=Function('return ({'+identityMethodSources.isAlive+'}).isAlive')();}];
 for(const patch of patches){const f=identityFixture(),before=inspectNativeIdentityReveal(f.env,f.raw());assert.ok(before);patch(f);assert.equal(sameNativeIdentityReveal(before,inspectNativeIdentityReveal(f.env,f.raw())),false);}
});
await test('Popup acceptance requires exactly its own original native display node and no other DOM replacement',async()=>{
 const patches=[f=>{f.ui.window.children=[];},f=>{f.ui.window.children[0].innerHTML+='changed';},f=>{f.ui.window.children[0].dataset.nature='fire';},f=>{f.ui.window.children[0].delete=()=>{};},f=>{f.ui.window.appendChild(new f.Node());},f=>{f.ui.window.children[0].parentNode=null;}];
 for(const patch of patches){const f=identityFixture('1.11.6',true),before=inspectNativeIdentityReveal(f.env,f.raw());f.run();patch(f);assert.equal(sameNativeIdentityReveal(before,inspectNativeIdentityReveal(f.env,f.raw())),false);}
 const f=identityFixture('1.11.6',true),existing=new f.Node();f.ui.window.appendChild(existing);const before=inspectNativeIdentityReveal(f.env,f.raw());f.run();f.ui.window.children.shift();assert.equal(sameNativeIdentityReveal(before,inspectNativeIdentityReveal(f.env,f.raw())),false);
});
await test('Host freezes two actual entered peers; one ACK cannot settle the group',async()=>{
 const f=fixture();try{f.begin();assert.equal(f.s.host.peers.length,2);const a=f.ack('a');assert.equal(f.s.validate(f.owners.get('a'),a),true);await f.s.control(f.owners.get('a'),a);assert.equal(f.s.ready(),false);assert.equal(f.c.round.phase,'settling');assert.equal(f.out.filter(x=>x.type==='round-settled').length,0);
  await f.s.control(f.owners.get('b'),f.ack('b'));assert.equal(f.s.ready(),true);assert.equal(f.out.filter(x=>x.type==='round-settled').length,2);
 }finally{f.s.dispose();}
});
await test('Unknown source, future scope, wrong round/request/terminal and incomplete application are rejected',async()=>{
 const f=fixture();try{f.begin();const base=f.ack('a');assert.notEqual(f.s.validate({},base),true);
  for(const patch of [{roundId:'old'},{operationId:'future'},{fenceRequestId:'unknown'},{guestScope:scope('a',4)},{guestScope:{...scope('a'),bindingNonce:'old'}},{appliedSeq:9},{receivedSeq:11},{terminalHash:D},{sequenceGap:true},{pendingOfficialHandlers:1},{nativeEnded:false}])assert.notEqual(f.s.validate(f.owners.get('a'),{...base,data:{...base.data,...patch}}),true);
 }finally{f.s.dispose();}
});
await test('Self-reported identity cannot ACK another actual peer fence',async()=>{
 const f=fixture();try{f.begin();const a=f.ack('a');a.data.peerId='b';assert.notEqual(f.s.validate(f.owners.get('b'),a),true);assert.equal(f.s.validate(f.owners.get('a'),a),true);}finally{f.s.dispose();}
});
await test('Duplicate ACK during preparing preserves phase and does not repeat completion',async()=>{
 const f=fixture();try{f.begin();const a=f.ack('a');await f.s.control(f.owners.get('a'),a);await f.s.control(f.owners.get('b'),f.ack('b'));f.c.round.phase='preparing';const count=f.out.length;await f.s.control(f.owners.get('a'),a);assert.equal(f.c.round.phase,'preparing');assert.equal(f.out.length,count);}finally{f.s.dispose();}
});
await test('New output invalidates prior ACKs and emits a revised actual final sequence',async()=>{
 const f=fixture();try{f.begin();const old=f.ack('a');await f.s.control(f.owners.get('a'),old);await f.s.control(f.owners.get('b'),f.ack('b'));assert.equal(f.s.ready(),true);f.s.sent(f.b,'a',11,null);assert.equal(f.s.ready(),false);assert.equal(f.c.round.phase,'settling');assert.equal(f.s.host.revision,2);assert.equal(f.s.host.fences.get('a').finalSeq,11);assert.notEqual(f.s.validate(f.owners.get('a'),old),true);assert.ok(f.events.some(x=>x.name==='prepare-cancel'));}finally{f.s.dispose();}
});
await test('Output while a native state reply is held prevents stale group completion',async()=>{
 const f=fixture(),hold=deferred();try{f.begin();const original=f.c.engines.command;f.c.engines.command=(type,args)=>type==='settlement-state'&&args.phase==='settled'?hold.promise:original(type,args);await f.s.control(f.owners.get('a'),f.ack('a'));const task=f.s.control(f.owners.get('b'),f.ack('b'));f.s.sent(f.b,'a',11,null);hold.resolve({});await task;assert.equal(f.s.ready(),false);assert.equal(f.out.filter(x=>x.type==='round-settled').length,0);}finally{f.s.dispose();}
});
function guestFixture(){
 const f=fixture('guest',['host']),scopeGuest=f.b.scope;f.s.sent(f.b,'host',7,null);
 const d={...f.c.envelope(f.c.round,{protocol:'nnk-settle/1'}),targetPeerId:'a',hostScope:scope('native-host'),guestGeneration:3,barrierId:'barrier',revision:1,guestFinalSeq:7,finalSeq:10,terminalSeq:9,terminalHash:H,rosterDigest:D};
 f.b.status={over:true,settlement:{guest:{canonical:true}},peerProofs:[{peerId:'host',appliedSeq:10,receivedSeq:10}]};
 f.c.proof={scope:clone(scopeGuest),over:true,queueCount:0,settlement:{nativeOverUnchanged:true,currentDOM:{present:true,hash:D},guest:{canonical:true,terminalSeq:9,rawHash:H}},peers:[{peerId:'host',receivedSeq:10,appliedSeq:10,sequenceGap:false,pendingOfficialHandlers:0}]};
 return {...f,frame:{type:'settle-fence',data:d}};
}
const settledFrame=f=>({type:'round-settled',data:{...f.frame.data,guestGeneration:f.b.scope.documentGeneration}});
const avatarTail=()=>({peerId:'host',terminalSeq:9,rawHash:H,canonical:true,nativeEnded:true,nativeOverUnchanged:true,dom:{present:true,hash:D},tail:{kind:'native-avatar-restore',seq:11,rawHash:D,playerId:'actual-player',name:'re_zuoci'}});
const identityTail=(popup=false)=>({...avatarTail(),tail:{kind:'native-identity-reveal',seq:11,rawHash:D,playerIds:['native-lord','native-guest'],zhuId:'native-lord',popup}});
function nextGuestFence(f){f.frame={type:'settle-fence',data:{...f.frame.data,requestId:'second-fence',revision:2,finalSeq:11}};f.b.status.peerProofs[0].appliedSeq=f.b.status.peerProofs[0].receivedSeq=11;f.c.proof.peers[0].appliedSeq=f.c.proof.peers[0].receivedSeq=11;return f.frame;}
await test('Verified Guest cosmetic tail revokes settled/preparing readiness and requires a new exact fence ACK',async()=>{
 const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);const old=settledFrame(f);assert.equal(f.s.validate(f.owners.get('host'),old),true);await f.s.control(f.owners.get('host'),old);assert.equal(f.s.ready(),true);f.c.round.phase='preparing';f.s.engineEvent(f.b,'native-settlement-tail-applied',avatarTail());assert.equal(f.s.ready(),false);assert.equal(f.s.guest.acked,false);assert.equal(f.c.round.settlementReady,false);assert.equal(f.c.round.phase,'settling');assert.notEqual(f.s.validate(f.owners.get('host'),old),true);assert.ok(f.events.some(e=>e.name==='prepare-cancel'));assert.equal(f.c.engines.current,f.b);
  await f.s.control(f.owners.get('host'),nextGuestFence(f));assert.equal(f.s.guest.acked,true);assert.equal(f.out.filter(e=>e.type==='settle-ack').at(-1).data.revision,2);assert.equal(f.out.filter(e=>e.type==='settle-ack').at(-1).data.appliedSeq,11);assert.equal(f.s.ready(),false);await f.s.control(f.owners.get('host'),settledFrame(f));assert.equal(f.s.ready(),true);
 }finally{f.s.dispose();}
});
await test('Tail arriving while the old Guest settled-state reply is held cannot complete its withdrawn ACK',async()=>{
 const f=guestFixture(),hold=deferred(),asked=deferred();try{await f.s.control(f.owners.get('host'),f.frame);const original=f.c.engines.command;f.c.engines.command=(type,args)=>{if(type==='settlement-state'&&args.phase==='settled'){assert.equal(args.terminalSeq,9);assert.equal(args.finalSeq,10);asked.resolve();return hold.promise;}return original(type,args);};const task=f.s.control(f.owners.get('host'),settledFrame(f));await asked.promise;f.s.engineEvent(f.b,'native-settlement-tail-applied',avatarTail());hold.resolve({});await task;assert.equal(f.s.ready(),false);assert.equal(f.s.guest.acked,false);assert.equal(f.c.round.phase,'settling');assert.equal(f.c.round.settlementReady,false);
 }finally{f.s.dispose();}
});
await test('A newer Guest fence ACK cannot be completed by the older held round-settled reply',async()=>{
 const f=guestFixture(),hold=deferred(),asked=deferred();try{await f.s.control(f.owners.get('host'),f.frame);const original=f.c.engines.command;f.c.engines.command=(type,args)=>{if(type==='settlement-state'&&args.phase==='settled'){asked.resolve();return hold.promise;}return original(type,args);};const task=f.s.control(f.owners.get('host'),settledFrame(f));await asked.promise;f.s.engineEvent(f.b,'native-settlement-tail-applied',avatarTail());await f.s.control(f.owners.get('host'),nextGuestFence(f));assert.equal(f.s.guest.acked,true);assert.equal(f.s.guest.data.revision,2);hold.resolve({});await task;assert.equal(f.s.ready(),false);assert.equal(f.c.round.phase,'settling');assert.equal(f.c.round.settlementReady,false);
 }finally{f.s.dispose();}
});
await test('Native staleSettlementFence response never marks the Guest round settled',async()=>{
 const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);const original=f.c.engines.command;f.c.engines.command=(type,args)=>type==='settlement-state'&&args.phase==='settled'?Promise.resolve({staleSettlementFence:true}):original(type,args);await f.s.control(f.owners.get('host'),settledFrame(f));assert.equal(f.s.ready(),false);assert.equal(f.c.round.phase,'settling');assert.equal(f.c.round.settlementReady,false);
 }finally{f.s.dispose();}
});
await test('Identity no-op and popup tails each withdraw readiness until an exact new final-sequence fence is ACKed',async()=>{
 for(const popup of [false,true]){const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);await f.s.control(f.owners.get('host'),settledFrame(f));assert.equal(f.s.ready(),true);const old=f.frame,acks=f.out.filter(x=>x.type==='settle-ack').length;f.s.engineEvent(f.b,'native-settlement-tail-applied',identityTail(popup));assert.equal(f.s.ready(),false);assert.equal(f.s.guest.acked,false);assert.equal(f.s.tail.seq,11);assert.notEqual(f.s.validate(f.owners.get('host'),old),true);await f.s.control(f.owners.get('host'),old);assert.equal(f.out.filter(x=>x.type==='settle-ack').length,acks);await f.s.control(f.owners.get('host'),nextGuestFence(f));assert.equal(f.s.guest.acked,true);assert.equal(f.out.filter(x=>x.type==='settle-ack').at(-1).data.appliedSeq,11);await f.s.control(f.owners.get('host'),settledFrame(f));assert.equal(f.s.ready(),true);assert.equal(f.c.engines.current,f.b);}finally{f.s.dispose();}}
});
await test('Identity tail during an older native proof query prevents its stale ACK and permits the new fence',async()=>{
 const f=guestFixture(),hold=deferred(),asked=deferred();try{const original=f.c.engines.command;f.c.engines.command=(type,args)=>{if(type==='settlement-proof'){asked.resolve();return hold.promise;}return original(type,args);};const task=f.s.control(f.owners.get('host'),f.frame);await asked.promise;f.s.engineEvent(f.b,'native-settlement-tail-applied',identityTail());hold.resolve(clone(f.c.proof));await task;assert.equal(f.out.filter(x=>x.type==='settle-ack').length,0);assert.equal(f.s.guest.acked,false);assert.equal(f.s.ready(),false);f.c.engines.command=original;await f.s.control(f.owners.get('host'),nextGuestFence(f));assert.equal(f.s.guest.acked,true);assert.equal(f.out.filter(x=>x.type==='settle-ack').at(-1).data.appliedSeq,11);}finally{f.s.dispose();}
});
await test('A held old round-settled reply cannot complete after the identity tail and a revised fence',async()=>{
 const f=guestFixture(),hold=deferred(),asked=deferred();try{await f.s.control(f.owners.get('host'),f.frame);const original=f.c.engines.command;f.c.engines.command=(type,args)=>{if(type==='settlement-state'&&args.phase==='settled'){asked.resolve();return hold.promise;}return original(type,args);};const task=f.s.control(f.owners.get('host'),settledFrame(f));await asked.promise;f.s.engineEvent(f.b,'native-settlement-tail-applied',identityTail(true));await f.s.control(f.owners.get('host'),nextGuestFence(f));assert.equal(f.s.guest.acked,true);hold.resolve({});await task;assert.equal(f.s.ready(),false);assert.equal(f.c.round.phase,'settling');assert.equal(f.c.round.settlementReady,false);}finally{f.s.dispose();}
});
await test('Unknown, malformed, noncanonical or mismatched identity-tail evidence never opens a completion barrier',async()=>{
 const patches=[d=>{d.tail.kind='identity';},d=>{d.tail.popup='true';},d=>{d.tail.playerIds=['same','same'];},d=>{d.tail.playerIds=[];},d=>{d.tail.zhuId='unknown';},d=>{d.tail.seq=9;},d=>{d.tail.rawHash='bad';},d=>{d.rawHash=D;},d=>{d.terminalSeq=8;},d=>{d.peerId='stranger';},d=>{d.canonical=false;},d=>{d.nativeEnded=false;},d=>{d.nativeOverUnchanged=false;},d=>{d.dom.present=false;}];
 for(const patch of patches){const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);const d=identityTail();patch(d);f.s.engineEvent(f.b,'native-settlement-tail-applied',d);assert.equal(f.s.ready(),false);assert.equal(f.s.tail,null);assert.ok(f.c.round.settlementError);}finally{f.s.dispose();}}
});
await test('A second accepted native display tail requires a still newer cutoff and exact same terminal',async()=>{
 const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);f.s.engineEvent(f.b,'native-settlement-tail-applied',identityTail());await f.s.control(f.owners.get('host'),nextGuestFence(f));const prior=f.frame,d=avatarTail();d.tail.seq=12;f.s.engineEvent(f.b,'native-settlement-tail-applied',d);assert.equal(f.s.guest.acked,false);assert.equal(f.s.tail.seq,12);assert.notEqual(f.s.validate(f.owners.get('host'),prior),true);const next={type:'settle-fence',data:{...prior.data,requestId:'third',revision:3,finalSeq:12}};assert.equal(f.s.validate(f.owners.get('host'),next),true);assert.notEqual(f.s.validate(f.owners.get('host'),{type:'settle-fence',data:{...next.data,terminalHash:D}}),true);}finally{f.s.dispose();}
});
await test('A retired binding or different round cannot apply a current-looking identity tail',async()=>{
 for(const retire of [f=>{f.b.closed=true;},f=>{f.c.engines.current={...f.b,scope:scope('replacement')};},f=>{f.c.round={...f.c.round,roundId:'next'};}]){const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);const captured=f.s.guest;retire(f);f.s.engineEvent(f.b,'native-settlement-tail-applied',identityTail());assert.equal(f.s.tail,null);assert.equal(f.s.guest,captured);assert.equal(captured.acked,true);}finally{f.s.dispose();}}
});
await test('Guest ACK requires exact terminal/application/DOM proof after the engine query',async()=>{
 const f=guestFixture();try{assert.equal(f.s.validate(f.owners.get('host'),f.frame),true);await f.s.control(f.owners.get('host'),f.frame);assert.equal(f.out.filter(x=>x.type==='settle-ack').length,1);assert.equal(f.s.ready(),false);assert.equal(f.s.snapshot().resources.pendingCommands,0);}finally{f.s.dispose();}
});
await test('Queued native query from a retired binding cannot ACK a new round',async()=>{
 const f=guestFixture(),hold=deferred(),asked=deferred();try{const original=f.c.engines.command;f.c.engines.command=(type,args)=>{if(type==='settlement-proof'){asked.resolve();return hold.promise;}return original(type,args);};const task=f.s.control(f.owners.get('host'),f.frame);await asked.promise;f.b.closed=true;f.c.round={...f.c.round,roundId:'next'};f.c.engines.current={scope:{...scope('new'),roundId:'next'},closed:false};hold.resolve(f.c.proof);await task;assert.equal(f.out.filter(x=>x.type==='settle-ack').length,0);assert.equal(f.c.round.roundId,'next');assert.equal(f.s.snapshot().resources.pendingCommands,0);}finally{f.s.dispose();}
});
await test('Duplicate Guest fence after preparation only repeats its original ACK',async()=>{
 const f=guestFixture();try{await f.s.control(f.owners.get('host'),f.frame);f.c.round.phase='preparing';const commands=f.commands.length;await f.s.control(f.owners.get('host'),f.frame);assert.equal(f.c.round.phase,'preparing');assert.equal(f.commands.length,commands);assert.equal(f.out.filter(x=>x.type==='settle-ack').length,2);}finally{f.s.dispose();}
});
await test('Missing current DOM or a pending native handler never produces an ACK',async()=>{
 for(const patch of [proof=>{proof.settlement.currentDOM.present=false;},proof=>{proof.peers[0].pendingOfficialHandlers=1;},proof=>{proof.peers[0].sequenceGap=true;},proof=>{proof.scope.bindingNonce='old';}]){
  const f=guestFixture();try{patch(f.c.proof);await f.s.control(f.owners.get('host'),f.frame);assert.equal(f.out.filter(x=>x.type==='settle-ack').length,0);assert.equal(f.s.ready(),false);assert.ok(f.c.round.settlementError);}finally{f.s.dispose();}
 }
});
await test('No native roster cannot turn an empty ACK set into settlement',async()=>{
 const f=fixture();try{f.begin();f.s.retire();f.s.engineEvent(f.b,'native-round-ended',{canonical:true,nativeEnded:true,nativeTailObserved:true,nativeOverUnchanged:true,codec:NATIVE_OVER_SHA256,dom:{present:true},roster:[],terminalFrames:[]});assert.equal(f.s.ready(),false);assert.equal(f.s.host,null);assert.ok(f.c.round.settlementError);}finally{f.s.dispose();}
});
await test('A bounded real timeout retains incomplete settlement and clears its timer',async()=>{
 const f=fixture('host',['a','b'],10);try{f.begin();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(f.s.ready(),false);assert.ok(f.c.round.settlementError.includes('超时'));assert.equal(f.s.snapshot().resources.timers,0);assert.equal(f.c.engines.current,f.b);}finally{f.s.dispose();}
});
await test('Late Guest output revises the reverse-direction applied cutoff and rejects the old ACK',async()=>{
 const f=fixture();try{f.begin();const old=f.ack('a');await f.s.control(f.owners.get('a'),old);await f.s.control(f.owners.get('b'),f.ack('b'));assert.equal(f.s.ready(),true);f.s.status(f.b,{peerProofs:[{peerId:'a',appliedSeq:8}]});assert.equal(f.s.ready(),false);assert.equal(f.s.host.fences.get('a').guestFinalSeq,8);assert.notEqual(f.s.validate(f.owners.get('a'),old),true);}finally{f.s.dispose();}
});
await test('Managed settlement closes native restart/exit/rematch actions and keeps the Return action',async()=>{
 const action=()=>({isConnected:true,closed:0,close(){this.closed++;this.isConnected=false;}}),restart=action(),exit=action(),rematch=action(),retained=action(),other=action();
 const over=()=>{},reload=()=>{},env={_status:{over:true},game:{over,reload},ui:{restart,exit,continue_game:rematch,other}};
 assert.equal(closeNativeSettlementActions(env,retained),3);
 assert.deepEqual([restart.closed,exit.closed,rematch.closed,retained.closed,other.closed],[1,1,1,0,0]);
 assert.equal(env.game.over,over);assert.equal(env.game.reload,reload);assert.equal(env._status.over,true);
 assert.equal(env.ui.exit,exit,'late native callbacks retain their own UI reference');
 assert.equal(env.ui.restart,restart);assert.equal(env.ui.continue_game,rematch);
});
await test('Native settlement action cleanup never changes a live game or an absent environment',async()=>{
 let calls=0;const restart={close(){calls++;}},env={_status:{over:false},ui:{restart}};
 assert.equal(closeNativeSettlementActions(env),0);assert.equal(calls,0);assert.equal(env.ui.restart,restart);
 assert.equal(closeNativeSettlementActions(null),0);assert.equal(closeNativeSettlementActions({_status:{over:true}}),0);
});
await test('Native action cleanup is idempotent for duplicate, disconnected and closing controls',async()=>{
 const action={isConnected:true,closed:0,close(){this.closed++;this.isConnected=false;}},closing={classList:{contains:name=>name==='removing'},close(){throw Error('already closing');}},env={_status:{over:true},ui:{restart:action,exit:action,continue_game:closing}};
 assert.equal(closeNativeSettlementActions(env),1);assert.equal(closeNativeSettlementActions(env),0);assert.equal(action.closed,1);
});
await test('Native action cleanup retains the owned Return control even when aliased by native UI',async()=>{
 const retained={close(){throw Error('Return must remain');}},env={_status:{over:true},ui:{restart:retained,exit:retained}};
 assert.equal(closeNativeSettlementActions(env,retained),0);
});
await test('Native action removal does not invoke game navigation callbacks',async()=>{
 let removed=0;const exit={isConnected:true,remove(){removed++;this.isConnected=false;},callback(){throw Error('must not navigate');}},env={_status:{over:true},ui:{exit,restart:{}}};
 assert.equal(closeNativeSettlementActions(env),1);assert.equal(removed,1);assert.equal(env.ui.exit,exit);
});
console.log('\n全部通过: '+passed+' 项\n失败: 0 项');

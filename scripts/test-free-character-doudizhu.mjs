import assert from 'node:assert/strict';
import {doudizhuAdapter} from '../online-kernel/keepalive/free-character-doudizhu.js';
import {legalCharacterPool,replaceCandidates,characterGroups} from '../online-kernel/keepalive/free-character-choice.js';

let passed=0;
function check(name,action){action();passed++;console.log('  ✓ '+name);}
function fixture(mode){
  const character={},stock={},groups={};
  for(let group=0;group<3;group++){
    groups['g'+group]=[];
    for(let index=0;index<4;index++){
      const id='c'+group+index;character[id]={group:'g'+group};stock[id]=character[id];groups['g'+group].push(id);
    }
  }
  character.disabled=stock.disabled={group:'g0'};groups.g0.push('disabled');
  character.unloaded={group:'g0'};groups.g0.push('unloaded');
  const players=['host','guest1','guest2'].map((playerid,index)=>({playerid,_group:'g'+index}));
  const env={lib:{character,characterPack:{enabled:stock,notEnabled:{unloaded:character.unloaded}},characterReplace:{family:['c00','c01']},
    characterOnline:groups,connectBanned:['c03'],configOL:{mode:'doudizhu',characterPack:['enabled'],banned:['disabled']},
    filter:{characterDisabled:id=>id==='disabled'}},game:{players,zhu:players[0]},get:{config:()=>undefined},_status:{mode}};
  let active=true;const restorers=[],reports=[];
  const ctx={env,mode:'doudizhu',submode:mode,data:{},root:{name:'chooseCharacter'},isActive:()=>active,
    legalPool:(ids,options)=>legalCharacterPool(env,ids,options),replaceCandidates,characterGroups,
    addHandler(child,fn){child.pushHandler(fn);let removed=false;return ()=>{if(removed)return;removed=true;const index=child.getHandler().indexOf(fn);if(index>=0)child.getHandler().splice(index,1);};},
    report:(code,detail)=>reports.push({code,detail}),wrap(owner,key,handler){const old=owner[key];owner[key]=function(...args){return handler(old,this,args);};restorers.push(()=>owner[key]=old);}};
  doudizhuAdapter.begin(ctx);
  return {ctx,players,reports,groups,retire(){active=false;},dispose(){doudizhuAdapter.dispose(ctx);for(const restore of restorers.reverse())restore();}};
}
function event(rows){
  const callbacks=[],callback=()=>{},filter=()=>true;
  return {name:'chooseButtonOL',list:rows,callback,filterButton:filter,pushHandler(fn){callbacks.push(fn);},getHandler(){return callbacks;},finish(result){this.result=result;for(const fn of callbacks)fn(this,{state:'end'});},callbacks};
}
for(const mode of ['normal','kaihei','huanle','binglin','online']){
  const f=fixture(mode),{ctx,players}=f;
  const map=Object.fromEntries(players.map((p,index)=>[p.playerid,ctx.legalPool().slice(index,index+2)]));
  const references=Object.values(map).slice();
  if(mode!=='normal'){
    const args=mode==='kaihei'?[()=>{},map]:mode==='binglin'?[()=>{},map,7,'zhuSkill_fancheng']:[()=>{},map,7];
    const unrelated={host:['c00']};doudizhuAdapter.beforeBroadcast(ctx,[()=>{},unrelated,7]);
    assert.deepEqual(unrelated,{host:['c00']});
    doudizhuAdapter.beforeBroadcast(ctx,args);
    check(mode+': bidding/preview maps expand in place and preserve room bans',()=>{
      assert.equal(ctx.data.doudizhu.previewMap,map);
      for(const [index,p] of players.entries()){
        assert.equal(map[p.playerid],references[index]);assert(map[p.playerid].length>2);
        assert(!map[p.playerid].includes('disabled'));assert(!map[p.playerid].includes('unloaded'));assert(!map[p.playerid].includes('c03'));
        if(mode==='online')assert(map[p.playerid].every(id=>ctx.env.lib.character[id].group===p._group));
      }
    });
  }
  const rows=players.map(p=>{
    const ids=mode==='normal'?['c00']:map[p.playerid];
    if(['kaihei','binglin'].includes(mode))p._characterChoice=ids;
    return [p,{createDialog:['选择角色',[ids,mode==='normal'?'characterx':'character']],selectButton:mode==='online'&&p===ctx.env.game.zhu?2:1,forced:true,filterButton:()=>true}];
  });
  const child=event(rows),callback=child.callback,filters=rows.map(row=>row[1].filterButton),counts=rows.map(row=>row[1].selectButton);
  doudizhuAdapter.beforeChoose(ctx,child);
  check(mode+': full offers retain original selection counts and callback/filter references',()=>{
    assert.equal(child.callback,callback);assert.deepEqual(rows.map(row=>row[1].selectButton),counts);
    assert.deepEqual(rows.map(row=>row[1].filterButton),filters);
    for(const row of rows)assert(characterGroups(row)[0].ids.length>=counts[players.indexOf(row[0])]);
    if(mode==='online')assert.deepEqual(counts,[2,1,1]);
  });
  if(mode!=='online')check(mode+': different players can receive the same legal candidates',()=>{
    const a=characterGroups(rows[0])[0].ids,b=characterGroups(rows[1])[0].ids;assert(a.some(id=>b.includes(id)));
  });
  const result=Object.fromEntries(rows.map(row=>[row[0].playerid,{bool:true,links:characterGroups(row)[0].ids.slice(0,row[1].selectButton)}]));
  const saved=structuredClone(result);child.finish(result);
  check(mode+': normal native results remain byte-for-byte equivalent',()=>assert.deepEqual(result,saved));
  if(['normal','huanle'].includes(mode)){
    child.finish({host:'ai',guest1:{},guest2:{bool:true,links:['c02']}});
    check(mode+': timeout fallbacks use full legal offers before native parent resumes',()=>{
      assert(child.result.host.links.length===1&&ctx.legalPool().includes(child.result.host.links[0]));
      assert(child.result.guest1.links.length===1&&ctx.legalPool().includes(child.result.guest1.links[0]));
      assert.deepEqual(child.result.guest2,{bool:true,links:['c02']});
    });
    f.retire();const retired={host:'ai'};child.finish(retired);
    check('retired character event leaves delayed fallback results untouched',()=>assert.deepEqual(retired,{host:'ai'}));
  }
  f.dispose();check(mode+': adapter-owned result handlers are removed on disposal',()=>assert.equal(child.callbacks.length,0));
}
check('online: original group source and unrelated config reads survive disposal',()=>{
  const f=fixture('online'),source=f.groups;
  assert(f.ctx.env.get.config('character_online')!==source);
  assert.equal(f.ctx.env.get.config('unrelated'),undefined);
  assert(source.g0.includes('disabled')&&source.g0.includes('unloaded'));
  f.dispose();assert.equal(f.ctx.env.get.config('character_online'),undefined);
});
console.log(`\n全部通过: ${passed} 项`);
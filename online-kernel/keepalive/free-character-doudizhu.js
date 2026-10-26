const MODES=new Set(['normal','kaihei','huanle','binglin','online']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function players(ctx){return ctx.env.game.players||[];}
function state(ctx){return ctx.data.doudizhu;}
function currentMode(ctx){return ctx.submode||ctx.env._status.mode||ctx.env.lib.configOL?.doudizhu_mode||'normal';}
function pool(ctx,current,kind='character'){
  if(state(ctx).mode==='online'){
    const groups=ctx.env.get.config?.('character_online')||ctx.env.lib.characterOnline;
    const ids=groups?.[current._group];
    if(!Array.isArray(ids))throw Error('智斗地主当前阵营的选将名单不可用');
    return ctx.legalPool(ids);
  }
  return ctx.legalPool(undefined,{canonical:kind==='characterx'});
}
function candidateMap(ctx,value){
  if(!object(value))return false;
  const roster=players(ctx),ids=roster.map(current=>current.playerid);
  if(!ids.length||new Set(ids).size!==ids.length||Object.keys(value).length!==ids.length)return false;
  return ids.every(id=>Object.hasOwn(value,id)&&Array.isArray(value[id])&&value[id].length>0&&
    value[id].every(name=>typeof name==='string'&&!!ctx.env.lib.character[name]));
}
function prepareMap(ctx,map){
  const prepared=players(ctx).map(current=>({current,ids:map[current.playerid],pool:pool(ctx,current)}));
  if(prepared.some(row=>Object.isFrozen(row.ids)||row.pool.length<(state(ctx).mode==='online'&&row.current===ctx.env.game.zhu?2:1)))
    throw Error('斗地主自由选将的合法候选不足或名单不可修改');
  for(const row of prepared)ctx.replaceCandidates(row.ids,row.pool);
  state(ctx).previewMap=map;
}
function selectCount(row){
  const options=row[1];
  const select=object(options)?options.selectButton:row.find((value,index)=>index>1&&(typeof value==='number'||Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)));
  const count=Array.isArray(select)?select[0]:select;
  return Number.isSafeInteger(count)&&count>0?count:1;
}
function actualName(ctx,id){
  const direct=ctx.legalPool([id]);
  if(direct.length)return direct[0];
  const references=ctx.env.lib.characterReplace?.[id];
  const legal=Array.isArray(references)?ctx.legalPool(references):[];
  return legal.length?legal[Math.floor(Math.random()*legal.length)]:null;
}
function fallbackLinks(ctx,offer){
  const remaining=offer.pool.slice(),links=[];
  while(links.length<offer.count&&remaining.length){
    const index=Math.floor(Math.random()*remaining.length),id=remaining.splice(index,1)[0],actual=actualName(ctx,id);
    if(actual&&!links.includes(actual))links.push(actual);
  }
  if(links.length!==offer.count)throw Error('斗地主自动选将的合法候选不足');
  return links;
}
function installFallback(ctx,child,offers){
  if(typeof ctx.addHandler!=='function')throw Error('当前引擎缺少选将结果处理接口');
  const complete=(event,option)=>{
    if(option?.state!=='end'||event!==child||!ctx.isActive())return;
    const result=event.result;
    if(!object(result))return;
    for(const offer of offers){
      const value=result[offer.current.playerid];
      if(value==='ai'||!value||!Array.isArray(value.links)||value.links.length===0)
        result[offer.current.playerid]={bool:true,links:fallbackLinks(ctx,offer)};
    }
  };
  state(ctx).handlers.push(ctx.addHandler(child,complete));
}

export const doudizhuAdapter={
  id:'doudizhu',
  matchesRoot(root,env){return env.lib.configOL?.mode==='doudizhu'&&['chooseCharacter','chooseCharacterOL'].includes(root.name);},
  begin(ctx){
    const mode=currentMode(ctx);
    if(!MODES.has(mode))throw Error('当前斗地主子玩法没有自由选将适配');
    ctx.data.doudizhu={mode,previewMap:null,offersPrepared:false,handlers:[]};
    if(mode==='online'){
      const source=ctx.env.get.config?.('character_online')||ctx.env.lib.characterOnline;
      if(!object(source))throw Error('智斗地主阵营名单不可用');
      const groups={};
      for(const [group,ids] of Object.entries(source)){
        if(!Array.isArray(ids))throw Error('智斗地主阵营名单格式不受支持');
        const legal=ctx.legalPool(ids);
        if(legal.length>=3)groups[group]=legal;
      }
      if(Object.keys(groups).length<players(ctx).length)throw Error('本局启用的合法武将不足以满足智斗地主的阵营规则');
      ctx.data.doudizhu.groupSource=groups;
      ctx.wrap(ctx.env.get,'config',(original,thisArg,args)=>args[0]==='character_online'?groups:Reflect.apply(original,thisArg,args));
    }
  },
  beforeBroadcast(ctx,args){
    const data=state(ctx);
    if(data.mode==='normal'||data.previewMap||data.offersPrepared)return;
    const expected=data.mode==='kaihei'?args.length===2:data.mode==='binglin'?args.length===4&&Number.isSafeInteger(args[2])&&typeof args[3]==='string':args.length===3&&Number.isSafeInteger(args[2]);
    if(expected&&typeof args[0]==='function'&&candidateMap(ctx,args[1]))prepareMap(ctx,args[1]);
  },
  beforeChoose(ctx,child){
    const data=state(ctx);
    if(child.name!=='chooseButtonOL'||data.offersPrepared)return;
    const rows=child.list;
    if(!Array.isArray(rows)||rows.length!==players(ctx).length||rows.some(row=>!Array.isArray(row)||!players(ctx).includes(row[0])))
      throw Error('斗地主联机选将事件结构不受支持');
    if(data.mode!=='normal'&&!data.previewMap)throw Error('斗地主自由选将尚未同步原生候选预览');
    const offers=rows.map(row=>{
      const groups=ctx.characterGroups(row),group=groups[0],current=row[0];
      if(!group)throw Error('斗地主联机选将缺少原生候选框');
      return {current,row,group,pool:pool(ctx,current,group.kind),count:selectCount(row)};
    });
    if(offers.some(offer=>offer.pool.length<offer.count||Object.isFrozen(offer.group.ids)))throw Error('斗地主自由选将的合法候选不足');
    for(const offer of offers){
      ctx.replaceCandidates(offer.group.ids,offer.pool);
      if(['kaihei','binglin'].includes(data.mode)){
        if(offer.current._characterChoice!==offer.group.ids)throw Error('斗地主原生私有候选与选择框不一致');
        if(data.previewMap[offer.current.playerid]!==offer.group.ids)throw Error('斗地主原生候选预览已变化');
      }
    }
    if(['normal','huanle'].includes(data.mode))installFallback(ctx,child,offers);
    data.offersPrepared=true;
    ctx.report('doudizhu-offers',{submode:data.mode,players:offers.length,counts:offers.map(offer=>offer.count)});
  },
  dispose(ctx){
    const data=state(ctx);
    if(!data)return;
    for(const remove of data.handlers)remove();
    data.handlers.length=0;
  },
};
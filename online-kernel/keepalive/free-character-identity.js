function groupOf(lib,id){return lib.character[id]?.group??lib.character[id]?.[1];}

function sample(ctx,ids,count,kind){
  const pool=ctx.legalPool(ids,{canonical:kind==='characterx'});
  if(pool.length<count||typeof pool.randomGets!=='function')throw Error('Native identity fallback pool is insufficient');
  const selected=pool.randomGets(count);
  if(kind!=='characterx')return selected;
  return selected.map(id=>{
    const variants=ctx.env.lib.characterReplace?.[id];
    if(!Array.isArray(variants)||!variants.length)return id;
    const legal=ctx.legalPool(variants);
    if(!legal.length||typeof legal.randomGet!=='function')throw Error('No legal identity character variant remains');
    return legal.randomGet();
  });
}

function addFallback(ctx,child,offers,count){
  if(typeof child.pushHandler!=='function')throw Error('Native identity selection result hook is unavailable');
  ctx.addHandler(child,(event,option)=>{
    if(option?.state!=='end'||!ctx.isActive()||!event.result||typeof event.result!=='object')return;
    for(const {player,ids,kind} of offers){
      const result=event.result[player.playerid];
      if(result==='ai'||!result||!Array.isArray(result.links)||result.links.length<count){
        event.result[player.playerid]={bool:true,links:sample(ctx,ids,count,kind)};
      }
    }
  });
}

export const identityAdapter={
  id:'identity',
  matchesRoot(root,env){return env.lib.configOL?.mode==='identity'&&root.name==='chooseCharacter';},
  begin(ctx){
    if(!['normal','zhong','purple','stratagem'].includes(ctx.submode))throw Error('Unsupported native identity selection: '+ctx.submode);
    ctx.stage='offer';
    if(ctx.submode==='purple'){
      const {lib,get}=ctx.env;
      if(typeof get?.is?.double!=='function')throw Error('Native purple identity character rules are unavailable');
      ctx.basePool=ctx.legalPool(undefined,{predicate:id=>!id.includes('lingju')&&!get.is.double(id)&&!(lib.selectGroup||[]).includes(groupOf(lib,id))});
    }else ctx.basePool=ctx.legalPool(undefined,{canonical:true});
    if(!ctx.basePool.length)throw Error('No legal identity characters are enabled');
  },
  beforeChoose(ctx,child){
    // Group-selection dialogs and descendants of the OL dispatcher are left to
    // the original event. Only the mode's initial character offers are widened.
    if(child.parent!==ctx.root)return;
    if(child.name==='chooseButton'){
      if(ctx.submode==='purple')return;
      for(const group of ctx.characterGroups(child)){
        ctx.replaceCandidates(group.ids,ctx.legalPool(ctx.basePool,{canonical:group.kind==='characterx'}));
      }
      return;
    }
    if(child.name!=='chooseButtonOL'||!Array.isArray(child.list))return;
    const offers=[];
    for(const row of child.list){
      const player=row?.[0];
      if(!player?.playerid)throw Error('Native identity selection player is unavailable');
      for(const group of ctx.characterGroups(row)){
        let pool;
        if(ctx.submode==='purple'){
          const side=player.identity?.[0],faction=ctx.root[side+'Zhu'];
          if(!['r','b'].includes(side)||typeof faction!=='string'||!Array.isArray(ctx.root.map?.[faction]))throw Error('Native purple identity faction pool is unavailable');
          pool=ctx.legalPool(ctx.basePool).filter(id=>groupOf(ctx.env.lib,id)===faction);
        }else pool=ctx.legalPool(ctx.basePool,{canonical:group.kind==='characterx'});
        ctx.replaceCandidates(group.ids,pool);
        offers.push({player,ids:group.ids,kind:group.kind});
      }
    }
    if(offers.length)addFallback(ctx,child,offers,ctx.submode==='purple'?1:(ctx.env.lib.configOL.double_character?2:1));
  },
};

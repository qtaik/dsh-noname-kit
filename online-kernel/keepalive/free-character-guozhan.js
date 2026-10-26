function poolOptions(ctx){
  const {lib,get}=ctx.env;
  return {packNames:['mode_guozhan'],predicate:id=>!id.startsWith('gz_shibing')&&!get.is.jun(id)&&!lib.config.guozhan_banned?.includes(id)};
}

function fallbackPair(ctx,event,processAI){
  const legal=ctx.legalPool(ctx.basePool,poolOptions(ctx)),order=legal.slice();
  if(typeof order.randomSort==='function')order.randomSort();
  const previous=Object.getOwnPropertyDescriptor(event,'dialog');
  if(previous&&!previous.configurable)throw Error('Native guozhan fallback dialog cannot be scoped safely');
  let result;
  // The retained native processAI reads the current event's button list and
  // decides main/deputy order, including wild and double-faction characters.
  // This supplies its input without opening UI or changing the current event.
  try{
    Object.defineProperty(event,'dialog',{value:{buttons:order.map(link=>({link}))},writable:true,configurable:true});
    result=Reflect.apply(processAI,event,[]);
  }finally{
    if(previous)Object.defineProperty(event,'dialog',previous);
    else delete event.dialog;
  }
  const links=result?.links;
  if(!Array.isArray(links)||links.length!==2||links[0]===links[1]||links.some(id=>!legal.includes(id)))throw Error('Native guozhan AI could not produce a legal fallback pair');
  return result;
}

export const guozhanAdapter={
  id:'guozhan',
  matchesRoot(root,env){return env.lib.configOL?.mode==='guozhan'&&root.name==='chooseCharacter';},
  begin(ctx){
    const {game,get,lib}=ctx.env;
    if(typeof game.getCharacterChoice!=='function'||typeof get?.is?.jun!=='function'||!lib.characterPack?.mode_guozhan)throw Error('Native guozhan selection helper is unavailable');
    ctx.stage='offer';
    ctx.basePool=ctx.legalPool(undefined,poolOptions(ctx));
    if(ctx.basePool.length<2)throw Error('Insufficient legal guozhan characters');
    ctx.data.source=null;
    ctx.wrap(game,'getCharacterChoice',(original,thisArg,args)=>{
      const [source,count]=args;
      if(ctx.stage!=='offer'||!Array.isArray(source)||![5,6,7].includes(count))return Reflect.apply(original,thisArg,args);
      if(ctx.data.source&&ctx.data.source!==source)throw Error('Unexpected guozhan candidate pool during native selection');
      ctx.data.source=source;
      const pool=ctx.legalPool(ctx.basePool,poolOptions(ctx));
      // Preserve the helper's native double-faction preparation on a copy. The
      // original shared pool is not consumed by assigning private random pools.
      Reflect.apply(original,thisArg,[pool.slice(),pool.length]);
      ctx.replaceCandidates(source,pool);
      const offered=pool.slice();
      if(typeof offered.randomSort==='function')offered.randomSort();
      return offered;
    });
  },
  beforeChoose(ctx,child){
    if(child.parent!==ctx.root||child.name!=='chooseButtonOL'||!Array.isArray(child.list))return;
    const offers=[];
    for(const row of child.list){
      for(const group of ctx.characterGroups(row))offers.push({player:row[0],group});
    }
    // The subsequent native faction dialog uses vcard, so it is not an offer.
    if(!offers.length)return;
    if(!ctx.data.source)throw Error('Native guozhan pool preparation was not observed');
    const pool=ctx.legalPool(ctx.basePool,poolOptions(ctx));
    for(const {player,group} of offers){
      if(!player?.playerid)throw Error('Native guozhan selection player is unavailable');
      const available=new Set(pool);
      ctx.replaceCandidates(group.ids,[...group.ids.filter(id=>available.has(id)),...pool.filter(id=>!group.ids.includes(id))]);
    }
    if(typeof child.pushHandler!=='function'||typeof child.processAI!=='function')throw Error('Native guozhan selection result hook or AI is unavailable');
    const processAI=child.processAI;
    ctx.addHandler(child,(event,option)=>{
      if(option?.state!=='end'||!ctx.isActive()||!event.result||typeof event.result!=='object')return;
      for(const {player} of offers){
        const result=event.result[player.playerid];
        if(result!=='ai'&&result&&Array.isArray(result.links)&&result.links.length>=2)continue;
        event.result[player.playerid]=fallbackPair(ctx,event,processAI);
      }
      ctx.stage='selected';
    });
  },
};

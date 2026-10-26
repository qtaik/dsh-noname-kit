const submodes = new Set(['normal', 'changban', 'dianjiang', 'wuxianhuoli']);
const value = (event, key, next) => typeof event.set === 'function' ? event.set(key, next) : (event[key] = next);

function fail(ctx, code) {
  ctx.report(code, 'Unsupported native single character-choice shape');
  throw new Error(code);
}

function makeSyncDraftDialog(env) {
  const { get, ui, game } = env;
  return function syncDraftDialog(id, pool, zhu, fan, seeds) {
    let dialog = get.idDialog(id);
    if (!dialog) {
      dialog = ui.create.dialog('选择武将', [pool, 'character'], '起始武将', [seeds[game.me.identity] || [], 'character']);
      dialog.videoId = id;
    }
    for (const button of dialog.buttons || []) {
      button.classList.toggle('selectedx', fan.includes(button.link));
      button.classList.toggle('glow', zhu.includes(button.link));
    }
  };
}

function makeSyncNativePool(env) {
  const { _status } = env;
  return function syncNativePool(pool) {
    _status.characterlist = pool;
  };
}

function makeOfferFilter(env) {
  const { _status } = env;
  return function filterFreeOffer(button) {
    const event = _status.event;
    return event.nnkFreeCandidates.includes(button.link) &&
      Reflect.apply(event.nnkNativeFilterButton, this, arguments);
  };
}

function draftPool(ctx, player) {
  const choice = ctx.env._status.characterChoice;
  const own = choice?.[player?.identity];
  if (!Array.isArray(own)) return fail(ctx, 'single-draft-roster');
  return ctx.legalPool(ctx.basePool, { nativePool: true }).filter(id => !own.includes(id));
}

function rememberDraft(ctx) {
  const { game, _status } = ctx.env;
  const choice = _status.characterChoice;
  const seeds = ctx.data.seeds;
  if (!seeds) return fail(ctx, 'single-draft-seeds');
  const args = [ctx.root.videoIdx, ctx.basePool.slice(),
    choice.zhu.filter(id => !seeds.zhu.includes(id)),
    choice.fan.filter(id => !seeds.fan.includes(id)), seeds];
  game.broadcastAll(ctx.data.syncDraftDialog, ...args);
  const entry = [ctx.data.syncDraftDialog, ...args];
  (_status.postReconnect ||= {})[ctx.data.reconnectKey] = entry;
  ctx.data.reconnectEntry = entry;
}

export const singleAdapter = {
  id: 'single',
  matchesRoot(root, env) {
    return (env.lib.configOL?.mode || env.lib.config.mode) === 'single' &&
      ['chooseCharacter', 'chooseCharacterOL'].includes(root.name);
  },
  begin(ctx) {
    if (!submodes.has(ctx.submode)) return fail(ctx, 'single-submode');
    const native = ctx.env._status.characterlist;
    ctx.basePool = ctx.submode === 'dianjiang' ? ctx.legalPool() :
      Array.isArray(native) ? ctx.legalPool(native, { nativePool: true }) : fail(ctx, 'single-native-pool');
    if (!ctx.basePool.length) return fail(ctx, 'single-empty-pool');
    ctx.stage = ctx.submode === 'normal' || ctx.submode === 'changban' ? 'draft' : 'offer';
    if (ctx.stage === 'draft' && ctx.basePool.length < 6) return fail(ctx, 'single-draft-pool-too-small');
    if (ctx.submode !== 'dianjiang') ctx.replaceCandidates(native, ctx.basePool);
    ctx.data.reconnectKey = 'nnkFreeSingleChoice';
    ctx.data.syncDraftDialog = makeSyncDraftDialog(ctx.env);
    ctx.data.syncNativePool = makeSyncNativePool(ctx.env);
    ctx.data.offerFilter = makeOfferFilter(ctx.env);
  },
  beforeBroadcast(ctx, args) {
    const { root, env } = ctx;
    if (args[0] === 'closeDialog' && args[1] === root.videoIdx && ctx.data.dialogReady) {
      ctx.stage = 'deploy';
      const entries = env._status.postReconnect;
      if (entries?.[ctx.data.reconnectKey] === ctx.data.reconnectEntry) delete entries[ctx.data.reconnectKey];
      return;
    }
    if (ctx.stage === 'draft' && args[1] === root.videoIdx &&
        args[2] === env._status.characterChoice) {
      const choice = args[2];
      if (![choice.all, choice.zhu, choice.fan].every(Array.isArray)) return fail(ctx, 'single-draft-map');
      ctx.data.seeds ||= { zhu: choice.zhu.slice(), fan: choice.fan.slice() };
      ctx.replaceCandidates(choice.all, ctx.legalPool(ctx.basePool, { nativePool: true }));
      ctx.data.dialogReady = true;
    }
    if (ctx.submode === 'dianjiang' && Array.isArray(args[1]) && args[2] === root.videoId) {
      ctx.replaceCandidates(args[1], ctx.legalPool());
      ctx.basePool = args[1].slice();
      ctx.data.dialogReady = true;
    }
  },
  beforeChoose(ctx, child) {
    if (ctx.submode === 'wuxianhuoli' && child.name === 'chooseButton' && child.parent === ctx.data.offerEvent) {
      const nativeFilter = child.filterButton === ctx.data.offerFilter ? child.nnkNativeFilterButton : child.filterButton;
      if (typeof nativeFilter !== 'function') return fail(ctx, 'single-offer-filter');
      value(child, 'nnkFreeCandidates', ctx.legalPool(ctx.basePool, { nativePool: true }));
      value(child, 'nnkNativeFilterButton', nativeFilter);
      value(child, 'filterButton', ctx.data.offerFilter);
      return;
    }
    if (child.parent !== ctx.root) return;
    const { _status } = ctx.env;
    if (ctx.stage === 'draft') {
      if (child.name === 'chooseButtonOL') {
        // Deployment keeps the already drafted private rosters and native count.
        ctx.stage = 'deploy';
        return;
      }
      if (child.name !== 'chooseButton' || child.dialog !== ctx.root.videoIdx || !Array.isArray(child.canChoose)) return;
      if (!ctx.data.dialogReady) return fail(ctx, 'single-draft-dialog');
      const pool = draftPool(ctx, child.player);
      ctx.replaceCandidates(_status.characterChoice.all, pool);
      value(child, 'canChoose', pool.slice());
      rememberDraft(ctx);
      return;
    }
    if (ctx.submode === 'wuxianhuoli' && ctx.stage === 'offer' && child.name === 'chooseButtonOL') {
      const choice = _status.characterChoice;
      if (!choice || !Array.isArray(choice.zhu) || !Array.isArray(choice.fan) || !Array.isArray(child.list)) return fail(ctx, 'single-offer-map');
      const nativeFilter = ctx.env.lib.filter.filterButton;
      if (typeof nativeFilter !== 'function') return fail(ctx, 'single-offer-filter');
      const pool = ctx.legalPool(ctx.basePool, { nativePool: true });
      for (const identity of ['zhu', 'fan']) ctx.replaceCandidates(choice[identity], pool);
      for (const row of child.list) {
        const groups = ctx.characterGroups(row.slice(1));
        if (groups.length !== 1 || !['zhu', 'fan'].includes(row[0]?.identity) || row.length !== 3 || row[1] !== true || !Array.isArray(row[2])) return fail(ctx, 'single-offer-row');
        ctx.replaceCandidates(groups[0].ids, pool);
        // The OL dispatcher sends these original arguments to remote players.
        // A single params object preserves the native defaults on both ends.
        const params = { forced: true, createDialog: row[2], nnkFreeCandidates: pool.slice(),
          nnkNativeFilterButton: nativeFilter, filterButton: ctx.data.offerFilter };
        row.splice(1, row.length - 1, params);
      }
      ctx.data.offerEvent = child;
      ctx.stage = 'deploy';
    }
    if (ctx.submode === 'dianjiang' && child.name === 'chooseButton' && child.dialog === ctx.root.videoId) {
      // The existing all-character dialog and native double-character count stay intact.
      const pool = ctx.legalPool(ctx.basePool, { nativePool: true });
      ctx.replaceCandidates(_status.characterlist, pool);
      ctx.env.game.broadcastAll(ctx.data.syncNativePool, pool.slice());
    }
  },
  afterStep(ctx) {
    if (ctx.stage === 'draft' && ctx.data.dialogReady) rememberDraft(ctx);
  },
  dispose(ctx) {
    const entries = ctx.env._status.postReconnect;
    if (entries?.[ctx.data.reconnectKey] === ctx.data.reconnectEntry) delete entries[ctx.data.reconnectKey];
  },
};

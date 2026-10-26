const submodes = new Set(['1v1', '2v2', '3v3', '4v4', 'guandu']);
const value = (event, key, next) => typeof event.set === 'function' ? event.set(key, next) : (event[key] = next);

function fail(ctx, code) {
  ctx.report(code, 'Unsupported native versus character-choice shape');
  throw new Error(code);
}

function makeSyncDraftMarks(env) {
  const { get } = env;
  return function syncDraftMarks(id, first, second) {
    const dialog = get.idDialog(id);
    if (!dialog) return;
    for (const button of dialog.buttons || []) {
      button.classList.toggle('selectedx', first.includes(button.link));
      button.classList.toggle('glow', second.includes(button.link));
    }
  };
}

function makeFourFilter(env) {
  const { _status } = env;
  return function fourFilter(button) {
    return _status.event.nnkFreeCandidates.includes(button.link) && !_status.event.selected.includes(button.link);
  };
}

function keepReconnect(ctx, entry) {
  (ctx.env._status.postReconnect ||= {})[ctx.data.reconnectKey] = entry;
  ctx.data.reconnectEntry = entry;
}

function captureGuandu(ctx, args) {
  if (ctx.submode !== 'guandu' || args[1] !== ctx.root.falseList || args[2] !== ctx.root.trueList ||
      !Array.isArray(args[1]) || !Array.isArray(args[2])) return;
  ctx.data.sidePools = {
    false: ctx.legalPool(args[1]),
    true: ctx.legalPool(args[2]),
  };
}

function actualDescriptor(ctx, group) {
  const dialog = group.dialog;
  const descriptors = dialog?.[0] === group.ids ? [dialog] : dialog;
  const matches = Array.isArray(descriptors) ? descriptors.filter(entry =>
    Array.isArray(entry) && entry[0] === group.ids && ['character', 'characterx'].includes(entry[1])) : [];
  if (matches.length !== 1) return fail(ctx, 'versus-guandu-descriptor');
  return matches[0];
}

export const versusAdapter = {
  id: 'versus',
  matchesRoot(root, env) {
    return (env.lib.configOL?.mode || env.lib.config.mode) === 'versus' &&
      ['chooseCharacter', 'chooseCharacterOL'].includes(root.name);
  },
  begin(ctx) {
    if (!submodes.has(ctx.submode)) return fail(ctx, 'versus-submode');
    ctx.basePool = ctx.legalPool(undefined, { canonical: ctx.submode === '2v2' });
    ctx.stage = ctx.submode === '1v1' ? 'draft' : 'offer';
    ctx.data.reconnectKey = 'nnkFreeVersusChoice';
    ctx.data.syncDraftMarks = makeSyncDraftMarks(ctx.env);
    ctx.data.fourFilter = makeFourFilter(ctx.env);
    if (ctx.submode === 'guandu') {
      ctx.wrap(ctx.env.game, 'broadcast', (original, receiver, args) => {
        captureGuandu(ctx, args);
        return Reflect.apply(original, receiver, args);
      });
    }
  },
  beforeBroadcast(ctx, args) {
    const { root, env } = ctx;
    if (ctx.submode === '1v1' && ctx.stage === 'draft' && Array.isArray(args[1]) &&
        args[2] === root.videoId && args[3] === root.choosing) {
      const pool = ctx.legalPool().filter(id => id !== 'huatuo' && id !== 'sunquan');
      ctx.replaceCandidates(args[1], pool);
      ctx.basePool = pool;
      ctx.data.dialogReady = true;
    }
    if (ctx.submode === '2v2' && args[1] === root.videoId && args[2] === env.game._characterChoice) {
      const map = args[2];
      const pool = ctx.legalPool(undefined, { canonical: true });
      for (const player of env.game.players) {
        if (!Array.isArray(map?.[player.playerid])) return fail(ctx, 'versus-private-map');
        ctx.replaceCandidates(map[player.playerid], pool);
      }
      ctx.replaceCandidates(root.list, pool);
      keepReconnect(ctx, args.slice());
      ctx.data.dialogReady = true;
    }
    captureGuandu(ctx, args);
  },
  beforeChoose(ctx, child) {
    if (child.parent !== ctx.root) return;
    const { root, env } = ctx;
    if (ctx.submode === '1v1') {
      if (child.name === 'chooseButtonOL') {
        ctx.stage = 'deploy';
        return;
      }
      if (ctx.stage !== 'draft' || child.name !== 'chooseButton' || child.dialog !== root.videoId || !Array.isArray(child.selected)) return;
      const roster = child.player?.storage?.versuslist;
      if (!ctx.data.dialogReady || !Array.isArray(roster)) return fail(ctx, 'versus-draft-roster');
      value(child, 'selected', roster.slice());
      return;
    }
    if (ctx.submode === '4v4' && child.name === 'chooseButton' && child.dialog === root.videoId && Array.isArray(child.selected)) {
      const pool = ctx.legalPool(env.lib.choiceFour);
      value(child, 'selected', []);
      value(child, 'nnkFreeCandidates', pool);
      value(child, 'filterButton', ctx.data.fourFilter);
      return;
    }
    if (ctx.submode === '3v3' && ctx.stage === 'offer' && child.name === 'chooseButtonOL') {
      if (!Array.isArray(child.list)) return fail(ctx, 'versus-offer-list');
      const pool = ctx.legalPool();
      for (const row of child.list) {
        const groups = ctx.characterGroups(row.slice(1));
        if (groups.length !== 1 || row[2] !== 2) return fail(ctx, 'versus-reserve-row');
        ctx.replaceCandidates(groups[0].ids, pool);
      }
      ctx.replaceCandidates(root.list, pool);
      ctx.stage = 'deploy';
      return;
    }
    if (ctx.submode === 'guandu' && child.name === 'chooseButtonOL' && Array.isArray(child.list)) {
      // Fixed leaders and scenario roles are not random offers.
      if (child.list.every(row => row[0]?.identity === 'zhu')) return;
      if (!ctx.data.sidePools || !root.map) return fail(ctx, 'versus-guandu-pools');
      for (const row of child.list) {
        const player = row[0], groups = ctx.characterGroups(row.slice(1));
        const pool = ctx.data.sidePools[String(player?.side)];
        if (player?.identity !== 'zhong' || groups.length !== 1 || !pool?.length || !Array.isArray(root.map[player.playerid])) return fail(ctx, 'versus-guandu-row');
        ctx.replaceCandidates(root.map[player.playerid], pool);
        ctx.replaceCandidates(groups[0].ids, pool);
        // Guandu initializes AI results directly and does not prune family variants.
        actualDescriptor(ctx, groups[0])[1] = 'character';
      }
      ctx.stage = 'deploy';
    }
  },
  afterStep(ctx) {
    if (ctx.submode !== '1v1' || ctx.stage !== 'draft' || !ctx.data.dialogReady) return;
    const first = ctx.env._status.firstChoose;
    const one = first?.storage?.versuslist, two = first?.next?.storage?.versuslist;
    if (!Array.isArray(one) || !Array.isArray(two)) return;
    const args = [ctx.root.videoId, one.slice(), two.slice()];
    ctx.env.game.broadcastAll(ctx.data.syncDraftMarks, ...args);
    keepReconnect(ctx, [ctx.data.syncDraftMarks, ...args]);
  },
  dispose(ctx) {
    const entries = ctx.env._status.postReconnect;
    if (entries?.[ctx.data.reconnectKey] === ctx.data.reconnectEntry) delete entries[ctx.data.reconnectKey];
  },
};

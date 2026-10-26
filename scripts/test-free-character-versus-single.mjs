import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installFreeCharacterChoice } from '../online-kernel/keepalive/free-character-choice.js';
import { versusAdapter } from '../online-kernel/keepalive/free-character-versus.js';
import { singleAdapter } from '../online-kernel/keepalive/free-character-single.js';

for (const name of ['get', 'ui', 'game', '_status']) assert.equal(name in globalThis, false, 'host fixture must not expose dev global ' + name);

let checks = 0;
function test(name, run) {
  run();
  checks++;
  console.log('PASS ' + name);
}

// Native public event/dialog shapes, without starting a game or a model.
function fixture(mode, submode, enabled = true) {
  const handlers = new Map(), broadcasts = [], dialogs = new Map();
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'blocked', 'disabled'];
  const characters = Object.fromEntries([...ids, 'native_only'].map(id => [id, { group: 'wei' }]));
  const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((playerid, index) => ({
    playerid, identity: index % 2 ? 'fan' : 'zhu', side: Boolean(index % 2), storage: { versuslist: [] },
  }));
  for (let index = 0; index < players.length; index++) players[index].next = players[(index + 1) % players.length];
  function makeDialog(pool = []) {
    const dialog = { buttons: pool.map(link => ({ link, classList: { values: new Set(), toggle(name, on) { on ? this.values.add(name) : this.values.delete(name); } } })) };
    Object.defineProperty(dialog, 'videoId', { set(id) { dialogs.set(id, dialog); }, get() { return [...dialogs].find(([, item]) => item === dialog)?.[0]; } });
    return dialog;
  }
  const env = {
    lib: {
      config: { mode }, configOL: { mode, [mode + '_mode']: submode, nnk_free_choose: enabled, characterPack: ['standard'], banned: ['blocked'] },
      mode: Object.fromEntries(['identity', 'guozhan', 'versus', 'doudizhu', 'single'].map(name => [name, { connect: {} }])),
      character: characters, characterPack: { standard: Object.fromEntries(ids.map(id => [id, characters[id]])) },
      characterReplace: {}, connectBanned: [], choiceFour: ['a', 'b', 'c', 'blocked', 'disabled'],
      filter: { characterDisabled: id => id === 'disabled', filterButton: function (button) { return button.link !== 'c'; } },
      announce: { subscribe() {}, unsubscribe() {} },
    },
    _status: { mode: submode, connectMode: true, characterlist: mode === 'single' && ['normal', 'changban'].includes(submode) ? [...ids, 'native_only'] : ids.slice(), postReconnect: {} },
    get: { idDialog: id => dialogs.get(id) },
    ui: { create: { dialog: (...args) => { const dialog = makeDialog(args[1][0]); dialog.args = args; return dialog; } } },
    game: {
      players, me: players[0], online: false,
      globalEventHandlers: {
        pushHandler(name, callback) { const list = handlers.get(name) || []; list.push(callback); handlers.set(name, list); },
        removeHandler(name, _type, callback) { handlers.set(name, (handlers.get(name) || []).filter(item => item !== callback)); },
      },
      broadcastAll(...args) {
        broadcasts.push(args);
        const [func, ...values] = args;
        if (typeof func === 'function') func(...values);
      },
      broadcast(...args) { broadcasts.push(args); },
    },
  };
  const root = { name: 'chooseCharacter', finished: false };
  const lease = { info: { role: 'engine', engineRole: 'host' }, isCurrent: () => true };
  const api = installFreeCharacterChoice({ env }, lease, [versusAdapter, singleAdapter]);
  function fire(event, state = 'begin') {
    env._status.event = event;
    for (const callback of handlers.get(event.name) || []) callback(event, { state });
  }
  function choice(fields) {
    return { name: 'chooseButton', parent: root, player: players[0], _set: [], set(key, next) { this[key] = next; this._set.push([key, next]); return this; }, ...fields };
  }
  function broadcast(...args) { env._status.event = root; env.game.broadcastAll(...args); }
  function replay(entry) { return vm.runInNewContext('(' + entry[0].toString() + ')(...__args)', { ...env, __args: entry.slice(1) }); }
  fire(root);
  return { env, root, players, api, broadcasts, dialogs, fire, choice, broadcast, replay, close: () => api.dispose() };
}

// Preserve the relevant native player.chooseButton params/positional branches.
function nativeOfferChoice(f, row, parent) {
  const args = row.slice(1), params = args[0];
  const next = f.choice({ parent, player: row[0] });
  if (args.length === 1 && params && !Array.isArray(params) && typeof params === 'object') {
    Object.assign(next, params);
    if (typeof next.selectButton === 'number') next.selectButton = [next.selectButton, next.selectButton];
    if (params.dialog != null) next.closeDialog = true;
  } else {
    for (const arg of args) {
      if (typeof arg === 'boolean') { if (!next.forced) next.forced = arg; else next.complexSelect = arg; }
      else if (Array.isArray(arg)) next.createDialog = arg;
    }
  }
  if (typeof next.forced !== 'boolean') next.forced = false;
  if (next.filterButton === undefined) next.filterButton = f.env.lib.filter.filterButton;
  if (next.selectButton === undefined) next.selectButton = [1, 1];
  if (next.ai === undefined) next.ai = function () { return 1; };
  if (next.complexSelect !== false) next.complexSelect = !(next.complexSelect === undefined && next.allowChooseAll === true);
  next._args = args;
  return next;
}

test('switch off leaves native single draft untouched', () => {
  const f = fixture('single', 'normal', false);
  const map = { zhu: ['a'], fan: ['b'], all: ['c'] };
  f.env._status.characterChoice = map;
  f.root.videoIdx = 10;
  f.broadcast(function () {}, 10, map);
  assert.deepEqual(map.all, ['c']);
  assert.equal(f.api.diagnostics.length, 0);
  f.close();
});

for (const submode of ['normal', 'changban']) test('single ' + submode + ' keeps draft rounds, private rosters and deployment', () => {
  const f = fixture('single', submode);
  const map = { zhu: ['a', 'b', 'c'], fan: ['d', 'e', 'f'], all: ['g', 'h'] };
  f.env._status.characterChoice = map;
  f.root.videoIdx = 11;
  const all = map.all, zhu = map.zhu, fan = map.fan;
  f.broadcast(function () {}, 11, map);
  assert.equal(map.all, all);
  assert(map.all.includes('native_only'));
  assert(!map.all.includes('blocked') && !map.all.includes('disabled'));
  const actor = f.players[1];
  const child = f.choice({ player: actor, dialog: 11, canChoose: all, selectButton: 2 });
  const nativeFilter = function (button) { return this.canChoose.includes(button.link); };
  child.filterButton = nativeFilter;
  f.fire(child);
  assert.equal(child.selectButton, 2);
  assert.equal(child.filterButton, nativeFilter);
  assert(child.canChoose.includes('a'), 'other actor starting roster remains selectable');
  assert(!child.canChoose.includes('d'), 'own roster cannot be drafted twice');
  map.fan.push('g');
  map.all.splice(map.all.indexOf('g'), 1);
  const other = f.choice({ player: f.players[0], dialog: 11, canChoose: all, selectButton: 2 });
  f.fire(other);
  assert(!other.canChoose.includes('a'), 'own initial character remains excluded');
  assert(other.canChoose.includes('d'), 'other actor roster does not globally ban a character');
  assert(other.canChoose.includes('g'), 'other actor previous draft pick remains selectable');
  const repeated = f.choice({ player: actor, dialog: 11, canChoose: all, selectButton: 2 });
  f.fire(repeated);
  assert(!repeated.canChoose.includes('g'), 'own previous draft pick cannot be drafted twice');
  assert.equal(map.zhu, zhu); assert.equal(map.fan, fan);
  assert.deepEqual(zhu, ['a', 'b', 'c']); assert.deepEqual(fan, ['d', 'e', 'f', 'g']);
  const count = submode === 'changban' ? 2 : 1;
  const row = [actor, count, true, ['出场', [fan, 'character']]];
  const callback = function () {};
  const deployment = f.choice({ name: 'chooseButtonOL', list: [row], callback });
  f.fire(deployment);
  assert.equal(row[3][1][0], fan); assert.equal(row[1], count); assert.equal(deployment.callback, callback);
  const reserve = f.choice({ parent: { name: 'replacePlayerSingle' }, createDialog: ['替补', [['e'], 'character']] });
  f.fire(reserve);
  assert.deepEqual(reserve.createDialog[1][0], ['e']);
  const entry = f.env._status.postReconnect.nnkFreeSingleChoice;
  f.replay(entry);
  assert(f.dialogs.get(11).buttons.some(button => button.link === 'native_only'));
  const marks = id => f.dialogs.get(11).buttons.find(button => button.link === id).classList.values;
  assert(!marks('a').has('glow'), 'private zhu starting roster is not a public draft mark');
  assert(!marks('d').has('selectedx'), 'private fan starting roster is not a public draft mark');
  assert(marks('g').has('selectedx'), 'the public fan draft pick remains marked');
  assert.deepEqual(f.dialogs.get(11).args[3][0], ['a', 'b', 'c'], 'reconnect shows only the local starting roster section');
  f.broadcast('closeDialog', 11);
  f.fire(f.root, 'end');
  assert.equal(f.env._status.postReconnect.nnkFreeSingleChoice, undefined);
  f.close();
  assert.equal(f.env._status.postReconnect.nnkFreeSingleChoice, undefined);
});

test('single wuxianhuoli expands only character offers and retains callback/buff text', () => {
  const f = fixture('single', 'wuxianhuoli');
  f.env._status.characterChoice = { zhu: ['a'], fan: ['b'] };
  const callback = function () {};
  const row1 = [f.players[0], true, ['Buff', '<p>buff</p>', [f.env._status.characterChoice.zhu, 'character']]];
  const row2 = [f.players[1], true, ['Buff', '<p>buff</p>', [f.env._status.characterChoice.fan, 'character']]];
  const child = f.choice({ name: 'chooseButtonOL', list: [row1, row2], callback });
  f.fire(child);
  const dialog1 = row1[2] || row1[1].createDialog, dialog2 = row2[2] || row2[1].createDialog;
  assert(dialog1[2][0].includes('h') && dialog2[2][0].includes('h'));
  assert.equal(dialog1[1], '<p>buff</p>'); assert.equal(child.callback, callback);
  const later = f.choice({ name: 'chooseButtonOL', list: [[f.players[0], ['技能', [['a'], 'character']]]] });
  f.fire(later);
  assert.deepEqual(later.list[0][1][1][0], ['a']);
  f.close();
});

test('single dianjiang retains native double count and enabled-pack scope', () => {
  const f = fixture('single', 'dianjiang');
  f.root.videoId = 12;
  const list = ['a'];
  f.broadcast(function () {}, list, 12);
  assert(list.includes('h') && !list.includes('native_only') && !list.includes('blocked'));
  f.env._status.characterlist = ['b'];
  const child = f.choice({ dialog: 12, selectButton: [1, 2] });
  f.fire(child);
  assert.deepEqual(child.selectButton, [1, 2]);
  assert(f.env._status.characterlist.includes('a'));
  f.replay(f.broadcasts.at(-1));
  assert(f.env._status.characterlist.includes('a'));
  f.close();
});

test('versus 1v1 retains alternating draft counts and per-actor rosters', () => {
  const f = fixture('versus', '1v1');
  const [first, second] = f.players;
  first.next = second; second.next = first;
  f.root.videoId = 20; f.root.choosing = first; f.root.num = 6;
  f.env._status.firstChoose = first;
  const list = ['a'];
  f.broadcast(function () {}, list, 20, first);
  assert(list.includes('h') && !list.includes('native_only') && !list.includes('blocked'));
  first.storage.versuslist.push('a');
  second.storage.versuslist.push('a', 'b');
  const selected = ['a', 'a', 'b'];
  const filter = function () {};
  const child = f.choice({ dialog: 20, selected, selectButton: 1, filterButton: filter });
  f.fire(child);
  assert.deepEqual(child.selected, ['a']); assert.equal(child.filterButton, filter);
  assert.equal(child.selectButton, 1); assert.equal(f.root.num, 6);
  assert.deepEqual(selected, ['a', 'a', 'b']);
  f.fire(f.root, 'end');
  f.replay([function (id, pool) { const dialog = ui.create.dialog('选将', [pool, 'character']); dialog.videoId = id; }, 20, list]);
  f.replay(f.env._status.postReconnect.nnkFreeVersusChoice);
  const mark = f.dialogs.get(20).buttons.find(button => button.link === 'a').classList.values;
  assert(mark.has('selectedx') && mark.has('glow'));
  const deployment = f.choice({ name: 'chooseButtonOL', list: [[first, ['出场', [['a'], 'character']]]] });
  f.fire(deployment);
  assert.deepEqual(deployment.list[0][1][1][0], ['a']);
  f.close();
});

test('versus 2v2 expands player-ID private maps without altering teammate callbacks', () => {
  const f = fixture('versus', '2v2');
  f.root.videoId = 21; f.root.list = ['g'];
  const map = Object.fromEntries(f.players.map(player => [player.playerid, ['a']]));
  f.env.game._characterChoice = map;
  const arrays = Object.values(map);
  const { game } = f.env;
  const original = function (id, choice) { game._characterChoice = choice; game._characterDialogID = id; };
  f.broadcast(original, 21, map);
  for (const [index, pool] of Object.values(map).entries()) {
    assert.equal(pool, arrays[index]); assert(pool.includes('h')); assert(!pool.includes('blocked'));
  }
  assert.equal(f.broadcasts[0][0], original);
  f.replay(f.env._status.postReconnect.nnkFreeVersusChoice);
  assert.equal(f.env.game._characterChoice, map);
  f.close();
});

test('versus 3v3 preserves native choose-two and each reserve result', () => {
  const f = fixture('versus', '3v3');
  f.root.list = ['g'];
  const callback = function () {};
  const rows = f.players.map(player => [player, ['选择出场和备用武将', [['a'], 'character']], 2, true]);
  const child = f.choice({ name: 'chooseButtonOL', list: rows, callback });
  f.fire(child);
  assert.equal(child.callback, callback);
  for (const row of rows) { assert.equal(row[2], 2); assert(row[1][1][0].includes('h')); }
  assert.notEqual(rows[0][1][1][0], rows[1][1][1][0]);
  const reserve = f.choice({ name: 'chooseButtonOL', list: [[f.players[0], ['替补', [['b'], 'character']]]] });
  f.fire(reserve);
  assert.deepEqual(reserve.list[0][1][1][0], ['b']);
  f.close();
});

test('versus 4v4 preserves native curated pool and role/count but removes cross-player exclusion', () => {
  const f = fixture('versus', '4v4');
  f.root.videoId = 22;
  const selected = ['a'];
  const child = f.choice({ dialog: 22, selected, selectButton: 1 });
  f.fire(child);
  assert.deepEqual(child.selected, []); assert.deepEqual(selected, ['a']);
  assert.deepEqual(child.nnkFreeCandidates, ['a', 'b', 'c']);
  f.env._status.event = child;
  assert.equal(child.filterButton({ link: 'a' }), true, 'host runs its original callback without dev globals');
  assert.equal(child.filterButton({ link: 'h' }), false);
  assert.equal(vm.runInNewContext('(' + child.filterButton.toString() + ')({link:"a"})', f.env), true);
  assert.equal(vm.runInNewContext('(' + child.filterButton.toString() + ')({link:"h"})', f.env), false);
  assert.equal(child.selectButton, 1); assert.equal(child.player.identity, 'zhu');
  f.close();
});

test('versus guandu retains fixed leaders and restricts each side to its native list', () => {
  const f = fixture('versus', 'guandu');
  f.root.falseList = ['a', 'b', 'blocked']; f.root.trueList = ['c', 'd', 'disabled'];
  f.env._status.event = f.root;
  f.env.game.broadcast(function () {}, f.root.falseList, f.root.trueList);
  const leaders = f.choice({ name: 'chooseButtonOL', list: [[f.players[0], ['主公', [['a'], 'characterx']], true]] });
  f.players[0].identity = 'zhu'; f.fire(leaders);
  assert.deepEqual(leaders.list[0][1][1][0], ['a']);
  assert.equal(leaders.list[0][1][1][1], 'characterx', 'fixed scenario leader selection is unchanged');
  f.players[0].identity = 'zhong'; f.players[1].identity = 'zhong';
  f.root.map = { p1: ['a'], p2: ['c'] };
  const rows = [f.players[0], f.players[1]].map(player => [player, ['请选择武将', [f.root.map[player.playerid], 'characterx']], true]);
  const child = f.choice({ name: 'chooseButtonOL', list: rows });
  f.fire(child);
  assert.deepEqual(f.root.map.p1, ['a', 'b']); assert.deepEqual(f.root.map.p2, ['c', 'd']);
  assert.equal(rows[0][1][1][0], f.root.map.p1); assert.equal(rows[1][1][1][0], f.root.map.p2);
  f.close();
});

test('single wuxianhuoli legacy all-character dialog preserves native filters and room legality on host and guest', () => {
  const f = fixture('single', 'wuxianhuoli');
  f.env._status.characterChoice = { zhu: ['a'], fan: ['b'] };
  const rows = [f.players[0], f.players[1]].map(player => [player, true, ['Buff', '<p>buff</p>', [f.env._status.characterChoice[player.identity], 'character']]]);
  const callback = function () {};
  const ol = f.choice({ name: 'chooseButtonOL', list: rows, callback });
  const originalHostChoice = nativeOfferChoice(f, rows[0], ol);
  f.fire(ol);
  const host = nativeOfferChoice(f, rows[0], ol);
  host.callback = callback;
  f.fire(host);
  // The legacy cheat changes the dialog, so its buttons no longer come from the row offer.
  host.dialog = { buttons: ['a', 'blocked', 'disabled', 'native_only'].map(link => ({ link })) };
  assert.equal(host.filterButton({ link: 'blocked' }), false, 'OL-banned character cannot bypass through legacy cheat2');
  assert.equal(host.filterButton({ link: 'native_only' }), false, 'disabled pack character cannot bypass through legacy cheat2');
  assert.equal(host.filterButton({ link: 'disabled' }), false);
  assert.equal(host.filterButton({ link: 'c' }), false, 'original native filter still applies');
  assert.equal(host.filterButton({ link: 'a' }), true);
  assert.deepEqual(host.selectButton, originalHostChoice.selectButton);
  assert.equal(host.forced, originalHostChoice.forced);
  assert.equal(host.complexSelect, originalHostChoice.complexSelect);
  assert.equal(host.ai(), originalHostChoice.ai()); assert.equal(host.callback, callback); assert.equal(ol.callback, callback);
  for (const key of ['nnkFreeCandidates', 'nnkNativeFilterButton', 'filterButton']) assert(host._set.some(entry => entry[0] === key));
  const guestStatus = { ...f.env._status, event: null };
  const context = vm.createContext({ ...f.env, _status: guestStatus });
  function wire(value) {
    if (typeof value === 'function') return vm.runInContext('(' + value.toString() + ')', context);
    if (Array.isArray(value)) return value.map(wire);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]));
    return value;
  }
  const guestRow = [f.players[1], ...wire(rows[1].slice(1))];
  const guest = nativeOfferChoice(f, guestRow, ol);
  guestStatus.event = guest;
  guest.dialog = host.dialog;
  assert.equal(guest.filterButton({ link: 'blocked' }), false);
  assert.equal(guest.filterButton({ link: 'native_only' }), false);
  assert.equal(guest.filterButton({ link: 'c' }), false);
  assert.equal(guest.filterButton({ link: 'a' }), true);
  assert.deepEqual(guest.nnkFreeCandidates, host.nnkFreeCandidates);
  f.close();
});

test('versus guandu offers legal actual family variants and feeds the actual ID to native AI', () => {
  const f = fixture('versus', 'guandu');
  const { lib } = f.env;
  lib.character.re_a = { group: 'wei' }; lib.character.off_a = { group: 'wei' };
  lib.characterPack.standard.re_a = lib.character.re_a;
  lib.characterPack.refresh = { off_a: lib.character.off_a };
  lib.characterReplace.a = ['a', 're_a', 'off_a'];
  const variants = lib.characterReplace.a, before = variants.slice();
  lib.configOL.banned.push('a');
  f.root.falseList = ['a']; f.root.trueList = ['c'];
  f.env._status.event = f.root;
  f.env.game.broadcast(function () {}, f.root.falseList, f.root.trueList);
  f.players[0].identity = 'zhong'; f.players[1].identity = 'zhong';
  f.root.map = { p1: ['a'], p2: ['c'] };
  const rows = [f.players[0], f.players[1]].map(player => [player, ['请选择武将', [f.root.map[player.playerid], 'characterx']], true]);
  f.fire(f.choice({ name: 'chooseButtonOL', list: rows }));
  assert.deepEqual(f.root.map.p1, ['re_a']);
  assert.equal(rows[0][1][1][1], 'character'); assert.equal(rows[1][1][1][1], 'character');
  const aiPool = f.root.map.p1;
  Object.defineProperty(aiPool, 'randomRemove', { value(count) { return this.splice(0, count); } });
  const aiResult = aiPool.randomRemove(1)[0];
  assert.equal(aiResult, 're_a', 'native AI initializes this exact ID without alias resolution');
  assert(!lib.configOL.banned.includes(aiResult)); assert(lib.characterPack.standard[aiResult]);
  assert.equal(lib.characterReplace.a, variants); assert.deepEqual(variants, before);
  f.close();
});

test('versus guandu does not expose unenabled family variants through characterx replacement UI', () => {
  const f = fixture('versus', 'guandu');
  const { lib } = f.env;
  lib.character.re_a = { group: 'wei' }; lib.characterPack.refresh = { re_a: lib.character.re_a };
  lib.characterReplace.a = ['a', 're_a'];
  f.root.falseList = ['a']; f.root.trueList = ['c'];
  f.env._status.event = f.root;
  f.env.game.broadcast(function () {}, f.root.falseList, f.root.trueList);
  f.players[0].identity = 'zhong'; f.players[1].identity = 'zhong';
  f.root.map = { p1: ['a'], p2: ['c'] };
  const rows = [f.players[0], f.players[1]].map(player => [player, ['请选择武将', [f.root.map[player.playerid], 'characterx']], true]);
  f.fire(f.choice({ name: 'chooseButtonOL', list: rows }));
  assert.deepEqual(f.root.map.p1, ['a']);
  assert.equal(rows[0][1][1][1], 'character', 'actual descriptor cannot surface unenabled replacement variants');
  assert.deepEqual(lib.characterReplace.a, ['a', 're_a']);
  f.close();
});

test('unsupported versus shape reports and throws without replacing native callbacks', () => {
  const f = fixture('versus', 'guandu');
  f.players[0].identity = 'zhong';
  const callback = function () {};
  const child = f.choice({ name: 'chooseButtonOL', list: [[f.players[0], ['选将', [['a'], 'characterx']]]], callback });
  assert.throws(() => f.fire(child), /versus-guandu-pools/);
  assert.equal(child.callback, callback);
  assert(f.api.diagnostics.some(item => item.code === 'versus-guandu-pools'));
  f.close();
});

console.log('PASS ' + checks + ' focused versus/single cases');

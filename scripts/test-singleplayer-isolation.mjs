// Run with node --experimental-vm-modules. This is an isolated startup contract
// test, not a native-window, third-party-shell or full gameplay integration test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import testPaths from './fixtures/test-paths.cjs';

if (typeof vm.SourceTextModule !== 'function') throw Error('Run this test with --experimental-vm-modules');
const sourceRoot = testPaths.sourceRoot(), officialRoot = testPaths.officialRoot('Latest');
const officialVersion = JSON.parse(fs.readFileSync(path.join(officialRoot, 'package.json'), 'utf8')).version;
if (officialVersion !== '1.11.6') throw Error('This startup contract requires the official 1.11.6 source fixture');
const nativeFiles = {
  game: fs.readFileSync(path.join(officialRoot, 'noname/game/index.js'), 'utf8'),
  util: fs.readFileSync(path.join(officialRoot, 'noname/util/index.js'), 'utf8'),
  loading: fs.readFileSync(path.join(officialRoot, 'noname/init/loading.js'), 'utf8')
};
// Execute the actual native methods, including their class, filter and enable
// checks. Only select complete declarations; do not reproduce their behavior.
function declaration(source, startPattern, closingLine) {
  const lines = source.split(/\r?\n/), start = lines.findIndex(line => startPattern.test(line));
  if (start < 0) throw Error('Required official declaration is unavailable');
  const end = lines.findIndex((line, index) => index > start && line === closingLine);
  if (end < 0) throw Error('Official declaration boundary is unavailable');
  return lines.slice(start, end + 1).join('\n');
}
const nativeImport = declaration(nativeFiles.game, /^  import\(type, content, url\) \{$/, '  }');
const nativeLoad = declaration(nativeFiles.game, /^  async loadExtension\(object\) \{$/, '  }');
const nativeIsClass = declaration(nativeFiles.util, /^function isClass\(func\) \{$/, '}');
const nativeContent = declaration(nativeFiles.loading, /^async function loadExtension\(extension\) \{$/, '}');
const extensionSource = fs.readFileSync(path.join(sourceRoot, 'online-kernel/extension.js'), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
async function flush() { for (let n = 0; n < 5; n++) { await Promise.resolve(); await nextTurn(); } }

async function fixture(role, {identity = false, nativeFailure = null, mode = 'identity', connectMode = false} = {}) {
  const intervals = new Map(), timeouts = new Map(), listeners = new Map(), modules = new Map();
  let timerId = 0;
  const records = {imports: [], scripts: 0, endpoint: 0, nativeActions: [], assignments: [], configWrites: [],
    logs: [], alerts: [], fetches: [], content: [], finishes: 0, hooks: 0, menus: 0,
    bootstrapRequires: 0, captures: 0};
  const virtualShell = path.resolve('nnk-memory-game'), virtualRoot = path.join(virtualShell, 'resources', 'app');
  const config = {
    mode, show_splash: 'always', directstartmode: 'single', debug: false,
    extensions: ['联机助手', 'ExistingContent', 'ExistingUI', 'NativeClass', 'FilteredFactory', 'DisabledFactory'],
    extension_联机助手_enable: true, extension_ExistingContent_enable: true, extension_ExistingUI_enable: true,
    extension_NativeClass_enable: true, extension_FilteredFactory_enable: true, extension_DisabledFactory_enable: false,
    all: {stockextension: [], plays: [], characters: ['standard'], cards: ['standard']},
    characters: ['standard'], cards: ['standard'], connect_characters: [], connect_cards: [],
    connect_nickname: 'GameName', connect_avatar: 'native_hero',
    nnk_onlineName: identity ? 'WorkshopName' : '', nnk_onlineAvatar: identity ? 'fixture_hero' : '',
    nnk_identityStamped: identity ? 'PreviousName' : '', nnk_avatarStamped: identity ? 'previous_hero' : ''
  };
  const database = new Map(Object.entries(config)), initialConfig = plain(config);
  const storage = new Map(), session = new Map([['isJITReloaded', 'true'], ['canUseTs', 'true']]);
  const fsBoundary = {existsSync(file) {
    return path.resolve(file) === path.join(virtualRoot, 'extension', '联机助手', 'extension.js');
  }};
  const lease = {info: {role, root: virtualRoot, origin: 'http://localhost:8089', engineRole: 'host',
    bootCapability: 'fixture-ordinary-capability', scope: role === 'engine' ? {sessionId: 'p', roundId: 'r',
      documentGeneration: 1, bindingId: 'b', bindingNonce: 'n', expectedOrigin: 'http://localhost:8089'} : null},
    isCurrent: () => ['ordinary', 'engine'].includes(role), isDocumentAlive: () => true,
    native: {async request(action, args) {
      records.nativeActions.push(action);
      if (action === 'beginCarrier') {
        records.transitionProfile = plain(args[1]);
        return {carrierURL: 'http://localhost:8089/extension/carrier-fixture.html', transitionTicket: 'fixture-ticket'};
      }
      throw Error('Unexpected native startup operation: ' + action);
    }, async report() { records.nativeActions.push('report'); }}};
  const boundaryRequire = name => {
    if (['node:path', 'path'].includes(name)) return path;
    if (['node:fs', 'fs'].includes(name)) return fsBoundary;
    if (name.endsWith('keepalive-bootstrap.cjs')) {
      records.bootstrapRequires++;
      if (nativeFailure === 'require') throw Error('fixture native require failure');
      return {capture() {
        records.captures++;
        if (nativeFailure === 'capture') throw Error('fixture native capture failure');
        return lease;
      }};
    }
    if (name.endsWith('batch-runtime.cjs')) return {createRuntime: () => ({capability: 0, paused: true,
      snapshot: () => [], resourceSnapshot: () => ({live: 0}), canEnter: () => true})};
    throw Error('Unexpected isolated startup dependency: ' + name);
  };
  const context = vm.createContext({records, config, database, pathBoundary: path, require: boundaryRequire, crypto: webcrypto,
    AbortController, TextEncoder, TextDecoder, URL, queueMicrotask,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => records.logs.push({level,
      message: args.map(item => typeof item === 'string' ? item : String(item)).join(' ')})])),
    alert: message => records.alerts.push(String(message)),
    process: {execPath: path.join(virtualShell, 'noname.exe'), cwd: () => virtualRoot, platform: 'win32'},
    setInterval(fn) { intervals.set(++timerId, fn); return timerId; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { timeouts.set(++timerId, fn); return timerId; }, clearTimeout(id) { timeouts.delete(id); },
    fetch: async (url, options = {}) => { records.fetches.push({url, method: options.method || 'GET'});
      if (options.method === 'POST') throw Error('A bridge destination was not provided to this fixture');
      return {ok: false}; },
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    sessionStorage: {getItem: key => session.get(key) ?? null},
    location: {origin: 'http://localhost:8089', assign: value => records.assignments.push(value)},
    document: {readyState: 'complete', createElement: tag => ({tag}),
      head: {appendChild(script) { records.scripts++; queueMicrotask(() => script.onload()); }}}
  });
  vm.runInContext(`
    globalThis.window = globalThis;
    window.__dirname = ${JSON.stringify(virtualRoot)};
    window.require = require;
    window.addEventListener = function(name, fn) { registerListener(name, fn); };
    window.onerror = function nativeOnerror() { return 'native-error'; };
    Array.prototype.add = function(item) { if (!this.includes(item)) this.push(item); return this; };
    class Player { chooseToUse() { return this.nextEvent; } }
    globalThis.lib = {version: '1.11.6', config, configprefix: 'fixture_', node: {path: pathBoundary},
      help: {}, extensionMenu: {}, extensionPack: {}, extensions: [
        ['ExistingContent', function(){}, {}, false, {nopack: true, character: {character: {fixture_hero: {}}}}, false],
        ['ExistingUI', function(){}, {}, false, {nopack: true}, true]
      ], imported: {}, arenaReady: [], onprepare: [], element: {Player}, hooks: {},
      character: {fixture_hero: {}, native_hero: {}}, characterPack: {standard: {}}, cardPack: {standard: {}},
      connectCharacterPack: [], connectCardPack: [], translate: {},
      message: {server: {nativeMessage() {}}, client: {nativeMessage() {}}}};
    globalThis._status = {connectMode: ${JSON.stringify(connectMode)}};
    globalThis.ui = {window: {isConnected: true}, click: {connectMenu: function nativeConnectMenu() { records.menus++; }}};
    globalThis.get = {connectNickname: () => lib.config.connect_nickname || '无名玩家'};
    globalThis.ai = {};
    globalThis.game = {
      online: false, players: [], phaseNumber: 0,
      saveConfig(key, value, mode, done) {
        records.configWrites.push({key, value, mode: mode || null});
        const storedKey = mode ? key + '_mode_config_' + mode : key;
        if (value === undefined) database.delete(storedKey); else database.set(storedKey, value);
        if (!mode) { if (value === undefined) delete config[key]; else config[key] = value; }
        if (done) queueMicrotask(done);
      },
      getDB: async (_store, key) => database.get(key),
      callHook: function nativeCallHook(name, args) { records.hooks++; return 'native-hook'; },
      switchMode: function nativeSwitchMode() { return 'native-mode'; },
      over: function nativeOver() { return 'native-over'; }
    };
    ${nativeIsClass}
    Object.assign(game, {${nativeImport}, ${nativeLoad}});
    globalThis.nativeContentLoader = (${nativeContent});
  `, context);
  context.registerListener = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  };
  const refs = {import: context.game.import, chooseToUse: context.lib.element.Player.prototype.chooseToUse,
    callHook: context.game.callHook, onerror: context.onerror, connectMenu: context.ui.click.connectMenu,
    switchMode: context.game.switchMode, over: context.game.over, extensionPush: context.lib.extensions.push,
    nativeServer: context.lib.message.server.nativeMessage, nativeClient: context.lib.message.client.nativeMessage};
  async function loadModule(specifier, parent = 'http://localhost:8089/') {
    const url = new URL(specifier, parent), relative = decodeURIComponent(url.pathname).replace(/^\/extension\/联机助手\//, '');
    if (modules.has(url.href)) return modules.get(url.href);
    const promise = (async () => {
      let source;
      if (relative === 'keepalive/engine-endpoint.js') source = 'export async function attachEngine(){ records.endpoint++; }';
      else {
        if (!/^(?:src\/[a-z-]+|keepalive\/entry)\.js$/.test(relative)) throw Error('Unexpected startup module: ' + relative);
        source = fs.readFileSync(path.join(sourceRoot, 'online-kernel', relative), 'utf8');
      }
      records.imports.push(relative);
      const module = new vm.SourceTextModule(source, {context, identifier: url.href,
        importModuleDynamically: (child, owner) => loadModule(child, owner.identifier)});
      await module.link((child, owner) => loadModule(child, owner.identifier));
      await module.evaluate();
      return module;
    })();
    modules.set(url.href, promise);
    return promise;
  }
  const script = new vm.Script(extensionSource, {filename: 'online-kernel/extension.js',
    importModuleDynamically: specifier => loadModule(specifier)});
  script.runInContext(context);
  const registered = await Promise.allSettled(context._status.extensionLoading || []);
  for (const result of registered) if (result.status === 'rejected') throw result.reason;
  if (!nativeFailure && ['ordinary', 'engine'].includes(role)) assert.equal(context.__nnk__.state.bootStage, 'ready', records.logs.map(value => value.message).join('\n'));
  delete context._status.extensionLoading;
  await flush();
  async function tick() { for (const fn of [...intervals.values()]) fn(); await flush(); }
  const result = {context, refs, records, initialConfig, initialConnectMode: connectMode, intervals, tick,
    async run(code) { return vm.runInContext(code, context); },
    async content(name) { const row = context.lib.extensions.find(value => value[0] === name);
      assert.ok(row, 'Expected a native extension content record'); return context.nativeContentLoader(row); },
    async close() { for (const fn of listeners.get('pagehide') || []) fn(); await flush(); intervals.clear(); timeouts.clear(); }};
  return result;
}

function assertNoGameplayPatches(f) {
  const {context: c, refs} = f;
  assert.equal(c.game.import, refs.import, 'Ordinary game.import must keep the native loader');
  assert.equal(c.lib.element.Player.prototype.chooseToUse, refs.chooseToUse, 'Ordinary chooseToUse must remain native');
  assert.equal(c.game.callHook, refs.callHook, 'Ordinary callHook must remain native');
  assert.equal(c.onerror, refs.onerror, 'Ordinary onerror must remain native');
  assert.equal(c.ui.click.connectMenu, refs.connectMenu, 'Ordinary connectMenu must remain native');
  assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(c.ui.click, 'connectMenu'), 'value'), 'Ordinary menu must not become an accessor');
  assert.equal(c.game.switchMode, refs.switchMode);
  assert.equal(c.game.over, refs.over);
  assert.equal(c.lib.extensions.push, refs.extensionPush);
  assert.equal(c.lib.arenaReady.length, 0);
  assert.equal(c._status.connectMode, f.initialConnectMode);
  assert.equal(c.game.online, false);
  assert.equal(c.lib.extensions[0][5], false, 'Existing extension connect flag must stay unchanged');
  assert.equal(c.lib.extensions[1][5], true);
}
const tests = [];
async function test(name, run) {
  try { await run(); tests.push({name, ok: true}); console.log('ok', name); }
  catch (error) { tests.push({name, ok: false, error: String(error), stack: error.stack}); console.error('FAIL', name, error); }
}
async function withFixture(role, options, run) {
  const f = await fixture(role, options);
  try { await run(f); } finally { await f.close(); }
}

await test('Ordinary production boot preserves native gameplay methods, modes and extension switches', async () => {
  // Online-looking game flags do not grant this Document native engine ownership.
  for (const options of [{mode: 'connect', connectMode: true}, {}]) {
    await withFixture('ordinary', options, async f => {
      assertNoGameplayPatches(f);
      assert.deepEqual(plain(f.context.lib.config), f.initialConfig);
      assert.deepEqual(f.records.configWrites, []);
      assert.equal(f.records.endpoint, 0);
      assert.deepEqual(f.records.nativeActions, []);
    });
  }
});
await test('Ordinary production boot retains metadata handlers and starts its actual bridge once', async () => {
  await withFixture('ordinary', {}, async f => {
    const c = f.context;
    assert.equal(c.__nnk__.keepaliveEntry.role, 'ordinary');
    assert.equal(typeof c.__nnk__.modules.compat.applyIdentity, 'function');
    assert.equal(typeof c.lib.message.server.nnk_manifest, 'function');
    assert.equal(typeof c.lib.message.client.nnk_manifest_diff, 'function');
    assert.equal(typeof c.lib.message.client.nnk_tx_begin, 'function');
    assert.equal(typeof c.lib.message.server.nnk_tx_ack, 'function');
    assert.equal(c.lib.message.server.nativeMessage, f.refs.nativeServer);
    assert.equal(c.lib.message.client.nativeMessage, f.refs.nativeClient);
    delete c.ui.window;
    await f.tick(); await f.tick();
    assert.equal(c.__nnk__.modules.bridge.snapshot().timer, true);
    assert.equal(f.records.endpoint, 0);
    assert.ok(f.records.fetches.length > 0, 'The production bridge should read its binding');
    assert.equal(f.intervals.size, 1, 'Only the production bridge polling timer should remain');
    assert.deepEqual(f.records.nativeActions, []);
  });
});
await test('Ordinary native class extensions still construct, register and run their content', async () => {
  await withFixture('ordinary', {}, async f => {
    await f.run(`game.import('extension', class NativeClass {
      constructor() { this.name='NativeClass'; this.package={nopack:true}; this.content=function(){records.content.push('class');}; }
    })`);
    assert.ok(f.context.lib.extensionPack.NativeClass);
    await f.content('NativeClass');
    assert.deepEqual(f.records.content, ['class']);
  });
});
await test('Ordinary native factory.filter=false prevents registration and content', async () => {
  await withFixture('ordinary', {}, async f => {
    await f.run(`(async function(){
      function filtered() { return {name:'FilteredFactory',package:{nopack:true,character:{character:{fixture_hero:{}}}},content:function(){records.content.push('filtered');}}; }
      filtered.filter=function(){return false;};
      await game.import('extension', filtered);
    })()`);
    assert.equal(Object.hasOwn(f.context.lib.extensionPack, 'FilteredFactory'), false);
    assert.equal(f.context.lib.extensions.some(row => row[0] === 'FilteredFactory'), false);
    assert.deepEqual(f.records.content, []);
    assert.equal(f.context.lib.config.extension_FilteredFactory_enable, true);
  });
});
await test('Ordinary disabled content extensions stay disabled and do not register or execute', async () => {
  await withFixture('ordinary', {}, async f => {
    await f.run(`game.import('extension', function(){return {name:'DisabledFactory',package:{nopack:true,character:{character:{fixture_hero:{}}}},content:function(){records.content.push('disabled');}};})`);
    assert.equal(f.context.lib.config.extension_DisabledFactory_enable, false);
    assert.equal(Object.hasOwn(f.context.lib.extensionPack, 'DisabledFactory'), false);
    assert.equal(f.context.lib.extensions.some(row => row[0] === 'DisabledFactory'), false);
    assert.deepEqual(f.records.content, []);
  });
});
await test('Ordinary identity sync preserves native gameplay and the accepted carrier profile', async () => {
  await withFixture('ordinary', {identity: true}, async f => {
    assertNoGameplayPatches(f);
    const c = f.context;
    assert.equal(c.lib.config.connect_nickname, 'WorkshopName');
    assert.equal(c.lib.config.connect_avatar, 'fixture_hero');
    assert.equal(c.lib.config.nnk_identityStamped, 'WorkshopName');
    assert.equal(c.lib.config.nnk_avatarStamped, 'fixture_hero');
    const identityKeys = new Set(['connect_nickname', 'connect_avatar', 'nnk_identityStamped', 'nnk_avatarStamped']);
    const before = {...f.initialConfig}, after = plain(c.lib.config);
    for (const key of identityKeys) { delete before[key]; delete after[key]; }
    assert.deepEqual(after, before);
    assert.ok(f.records.configWrites.every(row => identityKeys.has(row.key)));
    await f.tick();
    await c.__nnk__.keepaliveEntry.beginCarrier({action: 'create_room', args: {mode: 'identity'}});
    assert.deepEqual(f.records.nativeActions, ['beginCarrier']);
    assert.deepEqual(f.records.transitionProfile.identity, {connectNickname: 'WorkshopName', connectAvatar: 'fixture_hero'});
    assert.equal(f.records.transitionProfile.config.onlineName, 'WorkshopName');
    assert.equal(f.records.transitionProfile.inventory.identity.name, 'WorkshopName');
    assert.equal(f.records.assignments.length, 1);
    assert.equal(c.__nnk__.modules.bridge.snapshot().stopped, true);
    assert.equal(f.records.endpoint, 0);
  });
});
await test('Fresh engine production boot retains its existing compatibility installation and endpoint path', async () => {
  await withFixture('engine', {identity: true}, async f => {
    const c = f.context;
    assert.notEqual(c.game.import, f.refs.import);
    assert.equal(c.lib.element.Player.prototype.chooseToUse.__nnkInfoMapShim, true);
    assert.equal(c.game.callHook.__nnkGuarded, true);
    assert.equal(c.__nnkOnerrorGuarded, true);
    assert.equal(c.ui.click.__nnkMenuPatched, true);
    assert.equal(c.game.switchMode.__nnkPackUnlock, true);
    assert.equal(c.lib.extensions.__nnkUnlocked, true);
    assert.equal(c.lib.extensions[0][5], true);
    assert.equal(c.lib.extensions[1][5], false);
    assert.equal(c.lib.config.mode, 'connect');
    assert.equal(c.lib.config.show_splash, 'off');
    assert.equal(c.lib.config.connect_nickname, 'WorkshopName');
    assert.equal(c.lib.config.connect_avatar, 'fixture_hero');
    assert.equal(c.lib.arenaReady.length, 1);
    await f.run(`globalThis.eventParent={}; globalThis.useEvent={parent:eventParent,info_map:{skill:'fixture'},finish:function(){records.finishes++;return 'finished';}};
      globalThis.player=new lib.element.Player();player.nextEvent=useEvent;player.chooseToUse();`);
    assert.equal(c.eventParent._info_map, c.useEvent.info_map);
    assert.equal(c.useEvent.finish(), 'finished');
    assert.equal(Object.hasOwn(c.eventParent, '_info_map'), false);
    assert.equal(f.records.finishes, 1);
    await f.tick(); await f.tick();
    assert.equal(f.records.endpoint, 1);
    assert.equal(c.__nnk__.modules.bridge.snapshot().timer, false);
    assert.equal(f.records.nativeActions.length, 0);
    assert.equal(f.records.fetches.length, 0);
  });
});
await test('Preliminary and retired native documents stop before module loading or compatibility installation', async () => {
  for (const role of ['preliminary', 'retired']) await withFixture(role, {identity: true}, async f => {
    assertNoGameplayPatches(f);
    assert.deepEqual(plain(f.context.lib.config), f.initialConfig);
    assert.equal(f.context.__nnk__.state.bootStage, 'env-ready');
    assert.deepEqual(Object.keys(f.context.__nnk__.modules), []);
    assert.deepEqual(f.records.imports, []);
    assert.deepEqual(f.records.configWrites, []);
    assert.deepEqual(f.records.nativeActions, []);
    assert.equal(f.records.scripts, 0);
    assert.equal(f.intervals.size, 0);
  });
});
for (const nativeFailure of ['require', 'capture']) {
  await test('Native ' + nativeFailure + ' failure returns normally through actual extension precontent', async () => {
    await withFixture('ordinary', {identity: true, nativeFailure}, async f => {
      const c = f.context;
      assert.equal(f.records.alerts.length, 0, 'Unavailable native helpers must not reach the original extension-error popup');
      assert.equal(Object.hasOwn(c._status, 'extension'), false, 'Native loadExtension must clear its extension marker after precontent returns');
      assert.ok(c._status.extensionLoaded.includes('联机助手'), 'The original native extension import must finish normally');
      assert.equal(c.__nnk__.state.bootStage, 'native-unavailable');
      assert.match(String(c.__nnk__.state.bootError), new RegExp('fixture native ' + nativeFailure + ' failure'));
      assertNoGameplayPatches(f);
      assert.deepEqual(plain(c.lib.config), f.initialConfig);
      assert.deepEqual(f.records.configWrites, []);
      assert.equal(f.records.bootstrapRequires, 1);
      assert.equal(f.records.captures, nativeFailure === 'capture' ? 1 : 0);
      assert.deepEqual(Object.keys(c.__nnk__.modules), []);
      assert.equal(c.__nnk__.keepaliveEntry, undefined);
      assert.equal(c.__nnk__.keepaliveRuntime, undefined);
      assert.deepEqual(f.records.imports, []);
      assert.deepEqual(f.records.nativeActions, []);
      assert.deepEqual(f.records.fetches, []);
      assert.equal(f.records.scripts, 0);
      assert.equal(f.records.endpoint, 0);
      assert.equal(f.intervals.size, 0);
    });
  });
}

console.log(JSON.stringify({scope: 'Production extension.boot, entry, compat and src modules with actual official 1.11.6 import/loadExtension/content methods; in-memory native/filesystem/endpoint boundaries; no native-window or full-gameplay claim',
  officialVersion, nativeMethodSHA256: sha([nativeImport, nativeLoad, nativeIsClass, nativeContent].join('\n')),
  extensionSHA256: sha(extensionSource), passed: tests.filter(value => value.ok).length, total: tests.length, tests}, null, 2));
if (tests.some(value => !value.ok)) process.exitCode = 1;

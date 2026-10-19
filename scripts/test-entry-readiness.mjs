import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setImmediate as nextTurn} from 'node:timers/promises';
import testPaths from './fixtures/test-paths.cjs';

const out = fs.mkdtempSync(testPaths.tempPrefix('entry-readiness-'));
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}\n');
fs.copyFileSync(path.join(testPaths.sourceRoot(), 'online-kernel/keepalive/entry.js'), path.join(out, 'entry.js'));
fs.writeFileSync(path.join(out, 'engine-endpoint.js'), 'export async function attachEngine(nnk, options) { return nnk.recordEndpoint(options); }\n');
const oldRequire = Object.getOwnPropertyDescriptor(globalThis, 'require');
globalThis.require = createRequire(import.meta.url);
const {install} = await import(pathToFileURL(path.join(out, 'entry.js')));
if (oldRequire) Object.defineProperty(globalThis, 'require', oldRequire); else delete globalThis.require;
await import(pathToFileURL(path.join(out, 'engine-endpoint.js')));

const tests = [];
async function flush() { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTurn(); } }
async function test(name, fn) {
  try { await fn(); tests.push({name, ok: true}); console.log('ok', name); }
  catch (error) { tests.push({name, ok: false, error: String(error), stack: error.stack}); console.error('FAIL', name, error); }
}
async function fixture(role, run) {
  const intervals = new Map(), listeners = new Map(), calls = {bridge: 0, endpoint: 0, reports: []};
  let nextId = 0, current = true;
  const nnk = {state: {bootStage: 'ready'}, env: {lib: {}, _status: {}, ui: {}}, modules: {
    bridge: {async init() { calls.bridge++; }}
  }, recordEndpoint(options) { calls.endpoint++; calls.options = options; }};
  const storage = new Map([['isJITReloaded', 'true'], ['canUseTs', 'true']]);
  const document = {readyState: 'complete'};
  const lease = {info: {role, engineRole: 'host', root: 'fixture-root'}, isCurrent: () => current,
    native: {async report(scope, value) { calls.reports.push({scope, value}); }}};
  const replacements = {
    document,
    window: {addEventListener(name, fn) { listeners.set(name, fn); }},
    sessionStorage: {getItem: key => storage.get(key) ?? null},
    setInterval(fn) { intervals.set(++nextId, fn); return nextId; },
    clearInterval(id) { intervals.delete(id); }
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const f = {nnk, storage, document, lease, calls, intervals,
    retire() { current = false; },
    pagehide() { listeners.get('pagehide')?.(); },
    async tick() { for (const fn of [...intervals.values()]) fn(); await flush(); }};
  try { await install(nnk, lease); await run(f); }
  finally {
    f.pagehide(); await flush();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}

await test('Ordinary splash starts its bridge once without an arena and keeps the saved mode', async () => {
  await fixture('ordinary', async f => {
    f.nnk.env.lib.config = {mode: 'identity', show_splash: 'always'};
    await f.tick(); await f.tick();
    assert.equal(f.calls.bridge, 1); assert.equal(f.calls.endpoint, 0); assert.equal(f.intervals.size, 0);
    assert.deepEqual(f.nnk.env.lib.config, {mode: 'identity', show_splash: 'always'});
  });
});
await test('Ordinary bridge waits for kernel boot, extensions, onload, document and JIT initialization', async () => {
  const blocks = [
    f => { f.nnk.state.bootStage = 'modules-loaded'; return () => { f.nnk.state.bootStage = 'ready'; }; },
    f => { f.nnk.env._status.extensionLoading = []; return () => { delete f.nnk.env._status.extensionLoading; }; },
    f => { f.nnk.env.lib.onload = []; return () => { delete f.nnk.env.lib.onload; }; },
    f => { f.document.readyState = 'loading'; return () => { f.document.readyState = 'complete'; }; },
    f => { f.storage.delete('isJITReloaded'); return () => { f.storage.set('isJITReloaded', 'true'); }; },
    f => { f.storage.delete('canUseTs'); return () => { f.storage.set('canUseTs', 'false'); }; }
  ];
  for (const block of blocks) await fixture('ordinary', async f => {
    const unblock = block(f); await f.tick(); assert.equal(f.calls.bridge, 0); assert.equal(f.intervals.size, 1);
    unblock(); await f.tick(); assert.equal(f.calls.bridge, 1); assert.equal(f.intervals.size, 0);
  });
});
await test('Pagehide and a retired lease cannot start an ordinary bridge or engine endpoint', async () => {
  for (const role of ['ordinary', 'engine']) for (const stop of ['pagehide', 'retire']) await fixture(role, async f => {
    f.nnk.env.ui.window = {isConnected: true}; f[stop](); await f.tick();
    assert.equal(f.calls.bridge, 0); assert.equal(f.calls.endpoint, 0); assert.equal(f.intervals.size, 0);
  });
});
await test('Engine keeps waiting for an actual connected arena and both JIT markers', async () => {
  for (const missing of ['arena', 'connected', 'isJITReloaded', 'canUseTs']) await fixture('engine', async f => {
    f.nnk.env.ui.window = {isConnected: true};
    if (missing === 'arena') delete f.nnk.env.ui.window;
    else if (missing === 'connected') f.nnk.env.ui.window.isConnected = false;
    else f.storage.delete(missing);
    await f.tick(); assert.equal(f.calls.endpoint, 0); assert.equal(f.calls.bridge, 0); assert.equal(f.intervals.size, 1);
    f.nnk.env.ui.window = {isConnected: true}; f.storage.set('isJITReloaded', 'true'); f.storage.set('canUseTs', 'true');
    await f.tick(); assert.equal(f.calls.endpoint, 1); assert.equal(f.calls.bridge, 0); assert.equal(f.intervals.size, 0);
    assert.equal(f.calls.options.info.role, 'host'); assert.equal(f.calls.options.info.engineRoot, 'fixture-root');
  });
});
await test('Other document roles cannot schedule either startup path', async () => {
  for (const role of ['preliminary', 'retired', 'carrier']) await fixture(role, async f => {
    await f.tick(); assert.equal(f.calls.bridge, 0); assert.equal(f.calls.endpoint, 0); assert.equal(f.intervals.size, 0);
  });
});

const result = {scope: 'Actual production entry.install with isolated DOM, timers and engine-endpoint dependency; no game or native claim',
  out, passed: tests.filter(value => value.ok).length, total: tests.length, tests};
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({out, passed: result.passed, total: result.total}));
if (result.passed !== result.total) process.exitCode = 1;

// Execute the production manager, endpoint and carrier receiver together. Native
// documents, IPC transport and gameplay are boundaries supplied by this fixture.
import assert from 'node:assert/strict';
import {createEngineEndpoint} from '../online-kernel/keepalive/engine-endpoint.js';
import {EngineBindingManager} from '../online-kernel/keepalive/engine-binding.js';
import {installFreeCharacterChoice} from '../online-kernel/keepalive/free-character-choice.js';
import {FREE_CHOICE_MODES} from '../online-kernel/keepalive/free-character-options.js';

const tests = [], expectedErrors = [];
function captureExpectedError(run) {
  const original = console.error;
  console.error = (...args) => expectedErrors.push(args.map(value => value?.message || String(value)).join(' '));
  try { return run(); } finally { console.error = original; }
}
async function test(name, run) {
  try { await run(); tests.push({name, ok: true}); console.log('ok ' + name); }
  catch (error) { tests.push({name, ok: false, error: String(error), stack: error.stack}); console.error('FAIL ' + name, error); }
}

function fixture({on = true, role = 'host', attach = true, failureAt = 'begin', noFeature = false, duringCleanup = false} = {}) {
  let live = true, pauses = 0, endpoint, savedFailure, starts = 0, closes = 0;
  const handlers = new Map(), announcements = new Map(), invalidations = new Set(), ipcListeners = new Map();
  const order = [], frames = [], carrierFailures = [], carrierEvents = [];
  const scope = {sessionId: 'fixture-session', roundId: 'fixture-round', documentGeneration: 1,
    bindingId: 'fixture-binding', bindingNonce: 'fixture-nonce', expectedOrigin: 'http://fixture.invalid'};
  const native = {onInvalidated(fn) { invalidations.add(fn); return () => invalidations.delete(fn); }};
  const lib = {version: '1.11.6', config: {},
    mode: Object.fromEntries(FREE_CHOICE_MODES.map(mode => [mode, {connect: {connect_number: {init: '8', connect: true}}}])),
    configOL: {mode: 'identity', nnk_free_choose: on}, node: {clients: []},
    announce: {subscribe(name, fn) { announcements.set(fn, name); return fn; },
      unsubscribe(name, fn) { if (announcements.get(fn) === name) announcements.delete(fn); }}};
  const status = {connectMode: true};
  const game = {online: false, players: [], connectPlayers: [],
    pause() { pauses++; status.paused = true; },
    broadcastAll(fn, ...args) { return fn(...args); },
    globalEventHandlers: {
      pushHandler(name, type, ...rest) {
        const list = handlers.get(name) || [];
        list.push(...(typeof type === 'string' ? rest : [type, ...rest])); handlers.set(name, list);
      },
      removeHandler(name, type, fn) {
        const list = handlers.get(name) || [], index = list.indexOf(fn);
        if (index >= 0) list.splice(index, 1);
      }
    }};
  const env = {lib, game, _status: status, get: {}, ui: {dialogs: []}};
  const nnk = {env, modules: {}, state: {bootStage: 'ready'}};
  const lease = {info: {role: 'engine', engineRole: role, scope}, isCurrent: () => live, native};
  const adapter = {id: 'fixture-failure', matchesRoot: () => true,
    begin() { if (failureAt === 'begin') throw Error('fixture selection failed'); },
    beforeChoose() { if (failureAt === 'beforeChoose') throw Error('fixture child failed'); }};
  const feature = noFeature ? null : installFreeCharacterChoice(nnk, lease, [adapter]);
  if (feature) {
    // Delegate to the real API. Observation records only registration/cleanup
    // ordering; it neither implements nor substitutes failure/disposal logic.
    nnk.modules.freeCharacterChoice = {installed: feature.installed,
      resourceSnapshot: feature.resourceSnapshot,
      setFailureHandler(fn) {
        order.push('register'); savedFailure = fn;
        const off = feature.setFailureHandler(fn);
        return () => {
          order.push('unsubscribe');
          if (duringCleanup) captureExpectedError(() => savedFailure(Error('late unsubscribe callback')));
          return off();
        };
      },
      dispose() {
        order.push('dispose');
        assert.equal(feature.resourceSnapshot().failureHandlerListeners, 0, 'Endpoint must unsubscribe before feature disposal');
        if (duringCleanup) captureExpectedError(() => savedFailure(Error('late dispose callback')));
        return feature.dispose();
      }};
  }
  const carrier = new EngineBindingManager({native,
    ipc: {on(name, fn) { ipcListeners.set(name, fn); }, removeListener(name, fn) { if (ipcListeners.get(name) === fn) ipcListeners.delete(name); }},
    onEvent: (name, value) => carrierEvents.push({name, value}),
    onFailure: (binding, error) => carrierFailures.push({binding, error})});
  // Native creation/port admission are covered elsewhere. Supply the admitted
  // scope, then deliver each real endpoint frame through the real receiver.
  const binding = {scope, closed: false, error: null, pending: new Map()};
  carrier.current = binding;
  const port = {onmessage: null, start() { starts++; }, close() { closes++; },
    postMessage(value) {
      assert.equal(closes, 0, 'No frame may be sent through the closed fixture port');
      const frame = JSON.parse(JSON.stringify(value)); frames.push(frame); carrier.receive(binding, frame);
    }};
  function attachEndpoint() {
    assert.equal(endpoint, undefined);
    endpoint = captureExpectedError(() => createEngineEndpoint(nnk, {native: {}, info: {role, scope}, port,
      isCurrent: () => live, documentToken: 'fixture-document', onRetire: () => order.push('retire')}));
    return endpoint;
  }
  function event(name, parent = null) {
    const copied = [...(handlers.get(name) || [])];
    return {name, parent, finished: false,
      fire(state = 'begin') { status.event = this; for (const handler of copied.slice()) handler(this, {state}); }};
  }
  const root = event('chooseCharacter', event('game'));
  if (attach) attachEndpoint();
  return {env, nnk, feature, root, event, scope, frames, order, carrier, binding, carrierFailures, carrierEvents,
    handlers, announcements, invalidations, ipcListeners, port, attachEndpoint,
    get endpoint() { return endpoint; }, counts: () => ({pauses, starts, closes}),
    lateFailure() { captureExpectedError(() => savedFailure?.(Error('retired callback'))); },
    retire() { live = false; }, failures: () => frames.filter(frame => frame.type === 'failure'),
    async close() {
      try { if (endpoint) await endpoint.detach('fixture cleanup'); else feature?.dispose(); }
      finally {
        for (const request of binding.pending.values()) clearTimeout(request.timer);
        binding.pending.clear(); carrier.dispose();
      }
    }};
}
async function withFixture(options, run) {
  const f = fixture(options);
  try { await run(f); } finally { await f.close(); }
  assert.equal(f.endpoint?.resourceSnapshot().endpoint.timers ?? 0, 0);
  assert.equal(f.invalidations.size, 0);
  assert.equal(f.ipcListeners.size, 0);
}
function triggerFailure(f, target = f.root) {
  captureExpectedError(() => assert.throws(() => target.fire(), /fixture (selection|child) failed/));
}

await test('Real feature failure is scoped through endpoint to the existing carrier failure receiver exactly once', async () => {
  await withFixture({}, async f => {
    assert.equal(f.feature.installed, true);
    assert.equal(f.feature.resourceSnapshot().failureHandlerListeners, 1);
    assert.deepEqual(f.order, ['register']);
    const rejected = [];
    f.binding.pending.set('pending', {timer: setTimeout(() => {}, 60000), reject: error => rejected.push(error)});
    triggerFailure(f);
    assert.deepEqual(f.counts(), {pauses: 1, starts: 1, closes: 0});
    const [frame] = f.failures();
    assert.equal(f.failures().length, 1);
    assert.equal(frame.stage, 'free-character-choice');
    assert.deepEqual(frame.scope, f.scope);
    assert.equal(frame.error.message, 'fixture selection failed');
    assert.equal(f.carrierFailures.length, 1);
    assert.equal(f.carrierFailures[0].binding, f.binding);
    assert.equal(f.binding.error.message, frame.error.message);
    assert.equal(rejected.length, 1);
    assert.equal(f.binding.pending.size, 0);
    assert.equal(f.carrierEvents.filter(row => row.name === 'engine-operation-failed').length, 1);
    f.root.fire(); f.root.fire('end');
    f.event('chooseCharacter', f.event('game')).fire();
    assert.equal(f.failures().length, 1);
    assert.equal(f.counts().pauses, 1);
  });
});
await test('Pausing the selection event does not prevent endpoint command replies and cleanup', async () => {
  await withFixture({}, async f => {
    triggerFailure(f);
    assert.equal(f.env._status.paused, true);
    await f.endpoint.handleMessage({type: 'command', scope: f.scope, requestId: 'after-pause', command: 'status'});
    const result = f.frames.find(frame => frame.type === 'result' && frame.requestId === 'after-pause');
    assert.equal(result?.ok, true);
    assert.equal(result.value.resourceSnapshot.freeCharacterChoice.failed, true);
    assert.equal(f.failures().length, 1);
  });
});
await test('Failure before endpoint registration is delivered once when the real endpoint subscribes', async () => {
  await withFixture({attach: false}, async f => {
    triggerFailure(f);
    assert.equal(f.frames.length, 0);
    assert.equal(f.counts().pauses, 1);
    f.attachEndpoint();
    assert.equal(f.failures().length, 1);
    assert.equal(f.carrierFailures.length, 1);
    f.root.fire();
    assert.equal(f.failures().length, 1);
  });
});
await test('Child adapter failures use the same channel and release an active root context', async () => {
  await withFixture({failureAt: 'beforeChoose'}, async f => {
    f.root.fire();
    assert.equal(f.feature.resourceSnapshot().contexts, 1);
    const child = f.event('chooseButton', f.root);
    triggerFailure(f, child);
    child.fire();
    assert.equal(f.failures().length, 1);
    assert.equal(f.failures()[0].error.message, 'fixture child failed');
    await f.endpoint.detach();
    child.fire();
    assert.equal(f.feature.resourceSnapshot().contexts, 0);
    assert.equal(f.feature.resourceSnapshot().bindings, 0);
    assert.equal(f.failures().length, 1);
  });
});
await test('Detach unsubscribes before disposal and suppresses reentrant and retained failure callbacks', async () => {
  await withFixture({duringCleanup: true}, async f => {
    const pending = f.endpoint.detach('round replaced');
    assert.deepEqual(f.order, ['register', 'unsubscribe', 'dispose', 'retire']);
    f.lateFailure(); f.root.fire();
    const result = await pending;
    assert.deepEqual(result.cleanupErrors, []);
    assert.equal(result.ownedCleanup.endpoint.timers, 0);
    assert.equal(result.ownedCleanup.endpoint.ports, 0);
    assert.equal(result.ownedCleanup.freeCharacterChoice.failureHandlerListeners, 0);
    assert.equal(result.ownedCleanup.freeCharacterChoice.registeredEventHandlers, 0);
    assert.equal(result.ownedCleanup.freeCharacterChoice.nativeHandlerCopiesObservable, false);
    assert.equal(f.announcements.size, 0);
    assert.ok([...f.handlers.values()].every(list => list.length === 0));
    assert.equal(f.port.onmessage, null);
    assert.equal(f.binding.detachEvidence.reason, 'round replaced');
    assert.equal(f.frames.filter(frame => frame.type === 'detached').length, 1);
    assert.equal(await f.endpoint.detach('again'), result);
    f.lateFailure();
    assert.equal(f.failures().length, 0);
    assert.deepEqual(f.counts(), {pauses: 0, starts: 1, closes: 1});
  });
});
await test('Failure followed by retirement cannot pause or notify the carrier again', async () => {
  await withFixture({}, async f => {
    triggerFailure(f);
    await f.endpoint.detach();
    f.lateFailure(); f.root.fire();
    assert.equal(f.failures().length, 1);
    assert.equal(f.carrierFailures.length, 1);
    assert.equal(f.counts().pauses, 1);
  });
});
await test('Retired leases and replaced environments reject retained callbacks before detach', async () => {
  for (const replacement of ['lease', 'env']) await withFixture({}, async f => {
    if (replacement === 'lease') f.retire(); else f.nnk.env = {...f.env};
    f.lateFailure(); f.root.fire();
    await f.endpoint.handleMessage({type: 'command', scope: f.scope, requestId: 'retired', command: 'status'});
    assert.equal(f.frames.length, 0);
    assert.equal(f.carrierFailures.length, 0);
    assert.equal(f.counts().pauses, 0);
  });
});
await test('Disabled setting, normal selection, guest and absent feature never emit selection failures', async () => {
  for (const options of [{on: false}, {failureAt: null}, {role: 'guest'}, {noFeature: true}]) {
    await withFixture(options, async f => {
      f.root.fire();
      assert.equal(f.failures().length, 0);
      assert.equal(f.carrierFailures.length, 0);
      assert.equal(f.counts().pauses, 0);
      if (options.role === 'guest') assert.equal(f.feature.installed, false);
      if (options.noFeature) assert.deepEqual(f.order, []);
    });
  }
});
await test('Carrier ignores a retained old-scope failure after the current binding changes', async () => {
  await withFixture({}, async f => {
    triggerFailure(f);
    const oldFrame = f.failures()[0], originalCount = f.carrierFailures.length;
    f.carrier.current = {scope: {...f.scope, documentGeneration: 2}, closed: false, pending: new Map()};
    f.carrier.receive(f.binding, oldFrame);
    assert.equal(f.carrierFailures.length, originalCount);
    assert.equal(f.carrierEvents.at(-1).name, 'retired-engine-message');
  });
});

console.log(JSON.stringify({scope: 'Real free-character manager, engine endpoint, operation/settlement dependencies and carrier receiver; isolated event/IPC/native-document fixtures, no actual gameplay or native-window claim',
  passed: tests.filter(row => row.ok).length, total: tests.length, expectedErrors, tests}, null, 2));
if (tests.some(row => !row.ok)) process.exitCode = 1;

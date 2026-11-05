import assert from 'node:assert/strict'
import { createSessionState, stateSchema } from '../presets/noname-dev/session-state.mjs'
import { createEpochPromotion } from '../presets/noname-dev/compaction-epoch.mjs'
import { apply as applyAnchor } from '../presets/noname-dev/anchor-turn.mjs'
import { apply as applyHint } from '../presets/noname-dev/instruction-hint.mjs'
import { apply as applyBootstrap } from '../presets/noname-dev/zero-tool-bootstrap.mjs'

let passed = 0
async function test(label, run) {
  await run()
  passed++
  console.log('  ✓ ' + label)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const definition = {
  key: 'private-test:state', stateVersion: 1,
  stateSchema: stateSchema((state) => Number.isInteger(state.count), 'test'),
  init: () => ({ count: 0 }),
  apply: (state) => ({ count: state.count + 1 }),
}
function ctxWith(registry) {
  const hooks = new Map()
  return {
    hooks,
    get(name) { return name === 'sessionProjections' ? registry : undefined },
    on(name, action) { hooks.set(name, action) },
    logger: { warn() { throw new Error('unexpected fallback') } },
  }
}
await test('current host registration remains unreadable until its handle is ready', async () => {
  const pending = deferred()
  const state = createSessionState(ctxWith({ register() { return pending.promise } }), definition)
  assert.throws(() => state.state({ events: [] }), /registration is not ready/)
  pending.resolve({ stateOf() { return { count: 8 } } })
  await state.ready
  assert.deepEqual(state.state({ events: [] }), { count: 8 })
})
await test('current host reads the held handle without deprecated registry lookups', async () => {
  let deprecated = 0
  const ctx = ctxWith({
    async register() { return { stateOf() { return { count: 12 } } } },
    stateOf() { deprecated++; throw new Error('deprecated reader used') },
  })
  const state = createSessionState(ctx, definition)
  await state.ready
  assert.deepEqual(state.state({}), { count: 12 })
  assert.equal(deprecated, 0)
})
await test('registration failure propagates instead of pretending history is fresh', async () => {
  const state = createSessionState(ctxWith({ async register() { throw new Error('checkpoint unavailable') } }), definition)
  await assert.rejects(state.ready, /checkpoint unavailable/)
  assert.throws(() => state.state({ events: [] }), /registration is not ready/)
})
await test('older synchronous registrations retain the service reader', async () => {
  let key
  const state = createSessionState(ctxWith({
    register() { return () => {} },
    stateOf(_session, name) { key = name; return { count: 3 } },
  }), definition)
  await state.ready
  assert.deepEqual(state.state({}), { count: 3 })
  assert.equal(key, definition.key)
})
await test('a malformed projection service does not silently downgrade to event replay', async () => {
  const state = createSessionState(ctxWith({ async register() { return {} } }), definition)
  await assert.rejects(state.ready, /has no reader/)
})
await test('legacy event-array hosts replay durable events once', async () => {
  const session = { header: {}, events: [{ seq: 0 }, { seq: 1 }] }
  const state = createSessionState(ctxWith(undefined), definition)
  await state.ready
  assert.deepEqual(state.state(session), { count: 2 })
  assert.deepEqual(state.state(session), { count: 2 })
  session.events.push({ seq: 2 })
  assert.deepEqual(state.state(session), { count: 3 })
})
await test('legacy event observation and later array publication do not double-count', async () => {
  const session = { events: [] }
  const state = createSessionState(ctxWith(undefined), definition)
  await state.ready
  state.state(session)
  const event = { seq: 0 }
  state.observe(session, event)
  session.events.push(event)
  assert.deepEqual(state.state(session), { count: 1 })
})
await test('unavailable durable history remains an explicit error', async () => {
  const state = createSessionState(ctxWith(undefined), definition)
  await state.ready
  assert.throws(() => state.state({}), /neither session projections nor a readable durable event array/)
})
await test('epoch readiness follows projection registration', async () => {
  const pending = deferred()
  const epoch = createEpochPromotion(['assistant/message'], { ctx: ctxWith({ register() { return pending.promise } }) })
  const agent = { session: { header: {} } }
  assert.throws(() => epoch.status(agent), /registration is not ready/)
  pending.resolve({ stateOf() { return { boundary: 7, promoted: false } } })
  await epoch.ready
  assert.deepEqual(epoch.status(agent), { boundary: 7, promoted: false })
})
for (const [label, apply, config, consumers] of [
  ['anchor', applyAnchor, {}, ['agent/inbox/inserted']],
  ['instruction hint', applyHint, {}, ['agent/pre-step']],
  ['bootstrap', applyBootstrap, {}, ['system-prompt/assemble', 'agent/pre-step']],
]) {
  await test(label + ' publishes consumers only after registration succeeds', async () => {
    const pending = deferred()
    const ctx = ctxWith({ register() { return pending.promise } })
    const ready = apply(ctx, config)
    assert.ok(consumers.every((name) => !ctx.hooks.has(name)))
    pending.resolve({ stateOf() { return { boundary: -1, promoted: false, names: [] } } })
    await ready
    assert.ok(consumers.every((name) => ctx.hooks.has(name)))
  })
  await test(label + ' refuses failed projection registration', async () => {
    const ctx = ctxWith({ async register() { throw new Error('registration canceled') } })
    await assert.rejects(apply(ctx, config), /registration canceled/)
    assert.ok(consumers.every((name) => !ctx.hooks.has(name)))
  })
}
console.log('全部通过:' + passed + ' 项')


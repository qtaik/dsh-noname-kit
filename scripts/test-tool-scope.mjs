import assert from 'node:assert/strict'
import { createPresetToolRegistrar } from '../src/tool-scope.js'
import { apply as mountTools } from '../presets/noname-dev/tools.mjs'

const parents = new WeakMap()
const api = {
  scopeOf: ctx => ctx.scope,
  scopeChainOf(scope) {
    const chain = []
    for (let key = scope; key; key = parents.get(key)) chain.push(key)
    return chain
  },
}
let passed = 0, calls = 0
const check = (name, test) => Promise.resolve().then(test).then(() => { passed++; console.log('PASS ' + name) })
function context(scope) {
  const definitions = new Map()
  const effects = []
  return {
    scope, definitions,
    effect(run) { const undo = run(); effects.push(undo); return undo },
    dispose() { for (const undo of effects.reverse()) undo() },
    tools: {
      register(definition) {
        if (definitions.has(definition.name)) throw new Error('duplicate')
        definitions.set(definition.name, definition)
        return () => { if (definitions.get(definition.name) === definition) definitions.delete(definition.name) }
      },
    },
  }
}
let directory = 'game-a'
const register = createPresetToolRegistrar(ctx => ctx.tools.register({
  name: 'noname_read_extension',
  async execute(args) { calls++; return { directory, args } },
}), api)
const preset = {}, ordinary = {}, agent = {}, otherAgent = {}, child = {}
parents.set(agent, preset); parents.set(otherAgent, ordinary); parents.set(child, agent)
const ctx = context(preset)
ctx.nonameKitTools = register
await check('unscoped mounting fails without any registration', () => {
  const global = context()
  assert.throws(() => register(global), /预设作用域/)
  assert.equal(global.definitions.size, 0)
})
await check('missing host scope capability fails closed', () => {
  assert.throws(() => createPresetToolRegistrar(() => assert.fail(), null)(ctx), /预设作用域/)
})
await check('missing workshop service fails closed', () => assert.throws(() => mountTools(context(preset)), /工具服务不可用/))
await check('preset mounts only its own tool definitions', () => { mountTools(ctx); assert.equal(ctx.definitions.size, 1) })
const tool = ctx.definitions.get('noname_read_extension')
await check('own agent and child can execute', async () => {
  assert.equal((await tool.execute({}, { agent })).directory, 'game-a')
  assert.equal((await tool.execute({}, { agent: child })).directory, 'game-a')
})
await check('ordinary and missing caller identities cannot execute', async () => {
  const before = calls
  for (const caller of [{ agent: otherAgent }, { agent: {} }, {}, undefined]) {
    await assert.rejects(tool.execute({}, caller), { code: 'NONAME_PRESET_REQUIRED' })
  }
  assert.equal(calls, before)
})
await check('dynamic configuration remains shared with the workshop', async () => {
  directory = 'game-b'
  assert.equal((await tool.execute({}, { agent })).directory, 'game-b')
})
await check('cached definition is revoked immediately when switching away', async () => {
  parents.set(agent, ordinary)
  const before = calls
  await assert.rejects(tool.execute({}, { agent }), { code: 'NONAME_PRESET_REQUIRED' })
  await assert.rejects(tool.execute({}, { agent: child }), { code: 'NONAME_PRESET_REQUIRED' })
  assert.equal(calls, before)
})
await check('returning to the preset restores its tools', async () => {
  parents.set(agent, preset)
  assert.equal((await tool.execute({}, { agent })).directory, 'game-b')
})
await check('concurrent callers retain independent authorization', async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => tool.execute({}, { agent: i % 2 ? otherAgent : agent })))
  results.forEach((result, i) => assert.equal(result.status, i % 2 ? 'rejected' : 'fulfilled'))
})
await check('another Noname preset instance uses its own registration', async () => {
  const secondPreset = {}, secondAgent = {}
  parents.set(secondAgent, secondPreset)
  const second = context(secondPreset)
  register(second)
  await assert.rejects(tool.execute({}, { agent: secondAgent }), { code: 'NONAME_PRESET_REQUIRED' })
  assert.equal((await second.definitions.get(tool.name).execute({}, { agent: secondAgent })).directory, 'game-b')
  second.dispose()
})
await check('dispose revokes cached definitions and unregisters tools', async () => {
  ctx.dispose()
  assert.equal(ctx.definitions.size, 0)
  await assert.rejects(tool.execute({}, { agent }), { code: 'NONAME_PRESET_REQUIRED' })
  ctx.dispose()
})
await check('partial registration failure rolls back only owned definitions', () => {
  const broken = context(preset)
  const existing = { name: 'existing' }
  broken.tools.register(existing)
  const brokenRegister = createPresetToolRegistrar(target => {
    target.tools.register({ name: 'temporary', execute() {} })
    target.tools.register(existing)
  }, api)
  assert.throws(() => brokenRegister(broken), /duplicate/)
  assert.deepEqual([...broken.definitions.keys()], ['existing'])
})
console.log('全部通过:' + passed + ' 项')

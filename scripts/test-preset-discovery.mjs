import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply as applyToolSearch } from '../presets/noname-dev/dev-tool-search.mjs'
import { apply as applySkillSearch } from '../presets/noname-dev/skill-search.mjs'
import { apply as applyBootstrap } from '../presets/noname-dev/zero-tool-bootstrap.mjs'

let passed = 0
const results = []
async function test(name, action) {
  await action()
  passed++
  results.push(name)
}

function matchesSchema(value, schema) {
  const kind = schema.type
  if (kind === 'array') {
    assert.ok(Array.isArray(value))
    if (schema.items) for (const item of value) matchesSchema(item, schema.items)
  } else if (kind === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `missing ${key}`)
    for (const [key, item] of Object.entries(value)) {
      assert.ok(schema.additionalProperties !== false || Object.hasOwn(schema.properties, key), `undeclared ${key}`)
      if (schema.properties?.[key]) matchesSchema(item, schema.properties[key])
    }
  } else if (kind === 'integer') assert.ok(Number.isSafeInteger(value))
  else assert.equal(typeof value, kind)
}

function harness({ tools = [], skills = [] } = {}) {
  const registered = new Map()
  const calls = []
  const injected = []
  const agent = { session: { header: { cwd: '/session/work' }, events: [] }, inject: (message) => injected.push(message) }
  const ctx = {
    tools: {
      register(tool) { registered.set(tool.name, tool) },
      schemas(scope) { calls.push(['schemas', scope]); return tools },
      get(name, scope) { calls.push(['tool.get', name, scope]); return tools.find((tool) => tool.name === name) },
    },
    skills: {
      async list(lookup) { calls.push(['skills.list', lookup]); return skills },
      async get(name, lookup) { calls.push(['skills.get', name, lookup]); return skills.find((skill) => skill.name === name) },
    },
    workingDirectory: { async ensure(currentAgent, signal) { calls.push(['cwd', currentAgent, signal]); return '/validated/work' } },
  }
  applyToolSearch(ctx)
  applySkillSearch(ctx)
  async function run(name, args, exec = { agent }) {
    const tool = registered.get(name)
    matchesSchema(args, tool.parameters)
    const output = await tool.execute(args, exec)
    matchesSchema(output, tool.output.schema)
    assert.deepEqual(tool.output.render(args, output), [{ type: 'text', text: output.text }])
    return output
  }
  return { ctx, registered, calls, injected, agent, run }
}

const toolCatalog = Array.from({ length: 57 }, (_, index) => ({ name: `web_${index}`, description: 'web search' }))
toolCatalog.push({ name: 'late_chinese_tool', description: '读取武将和技能参考' })
const toolEnv = harness({ tools: toolCatalog })

await test('Chinese tool keyword reaches an item after the original cap', async () => {
  const found = await toolEnv.run('dev_tool_search', { query: '武将' })
  assert.equal(found.total, 1)
  assert.match(found.text, /late_chinese_tool/)
  assert.equal(found.hasMore, false)
})
await test('punctuation tool query does not become an empty match-all query', async () => {
  const found = await toolEnv.run('dev_tool_search', { query: '💥' })
  assert.equal(found.total, 0)
  assert.match(found.text, /No tools match/)
})
await test('three tool pages expose all matches without gaps or duplication', async () => {
  const names = []
  let offset = 0
  do {
    const page = await toolEnv.run('dev_tool_search', { query: 'WEB', offset })
    assert.equal(page.total, 57)
    for (const line of page.text.split('\n')) if (line.startsWith('- web_')) names.push(line.slice(2).split(':')[0])
    if (!page.hasMore) { assert.equal(page.nextOffset, undefined); break }
    assert.ok(page.nextOffset > offset)
    assert.match(page.text, new RegExp(`offset=${page.nextOffset}`))
    offset = page.nextOffset
  } while (true)
  assert.deepEqual(names, toolCatalog.slice(0, 57).map((tool) => tool.name))
})
await test('bounded custom page size and exhausted tool offset are explicit', async () => {
  const first = await toolEnv.run('dev_tool_search', { query: 'web', limit: 3 })
  assert.equal(first.nextOffset, 3)
  const end = await toolEnv.run('dev_tool_search', { query: 'web', offset: 100 })
  assert.equal(end.total, 57)
  assert.equal(end.hasMore, false)
  assert.match(end.text, /No tools at offset 100/)
})
for (const args of [{ query: 'web', offset: -1 }, { query: 'web', limit: 0 }, { query: 'web', limit: 26 }]) {
  await test(`invalid tool pagination is rejected: ${JSON.stringify(args)}`, async () => {
    assert.match((await toolEnv.run('dev_tool_search', args)).text, /Provide offset/)
  })
}
await test('explicit names validate actual scoped availability and deduplicate', async () => {
  const found = await toolEnv.run('dev_tool_search', { toolNames: ['web_1', 'missing', 'web_1'] })
  assert.deepEqual(found.unlocked, ['web_1'])
  assert.deepEqual(found.unavailable, ['missing'])
  assert.match(found.text, /not unlocked: missing/)
  assert.ok(toolEnv.calls.some(([kind, scope]) => kind === 'schemas' && scope === toolEnv.agent))
})
await test('host execution restrictions apply to discovery and unlock', async () => {
  const env = harness({ tools: toolCatalog })
  env.ctx.tools.resolveExecution = (name, agent, nested) => {
    assert.equal(agent, env.agent)
    assert.equal(nested, false)
    return name === 'web_3' ? undefined : { name }
  }
  const found = await env.run('dev_tool_search', { query: 'web_3', toolNames: ['web_3', 'web_4'] })
  assert.deepEqual(found.unlocked, ['web_4'])
  assert.deepEqual(found.unavailable, ['web_3'])
  assert.equal(found.total, 10)
  assert.doesNotMatch(found.text, /- web_3:/)
})
await test('tool registry failure cannot claim unlock success', async () => {
  const env = harness()
  env.ctx.tools.schemas = () => { throw new Error('registry offline') }
  const found = await env.run('dev_tool_search', { toolNames: ['web'] })
  assert.deepEqual(found.unlocked, [])
  assert.deepEqual(found.unavailable, ['web'])
  assert.match(found.text, /registry offline/)
})
await test('missing discovery input requests keywords or names', async () => {
  assert.match((await toolEnv.run('dev_tool_search', {})).text, /Provide `query`/)
})
await test('toolNames item schema rejects non-string elements before dispatch', async () => {
  assert.throws(() => matchesSchema({ toolNames: [1] }, toolEnv.registered.get('dev_tool_search').parameters))
})

const skillCatalog = Array.from({ length: 47 }, (_, index) => ({ name: `pdf-${index}`, description: 'PDF conversion', content: 'Handle PDF.', invocation: { modelInvocable: true } }))
skillCatalog.push({ name: 'noname-extension-dev', description: '无名杀武将技能开发', content: '编写技能。', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/skills/noname-extension-dev' } })
skillCatalog.push({ name: 'human-only', description: 'PDF 用户技能', content: 'DO NOT INJECT', invocation: { modelInvocable: false } })
const skillEnv = harness({ skills: skillCatalog })

await test('Chinese skill query searches late matching skill', async () => {
  const found = await skillEnv.run('skill_search', { query: '武将' })
  assert.equal(found.total, 1)
  assert.match(found.text, /noname-extension-dev/)
})
await test('punctuation skill query never lists unrelated skills', async () => {
  const found = await skillEnv.run('skill_search', { query: '💥' })
  assert.equal(found.total, 0)
  assert.match(found.text, /No skills match/)
})
await test('blank query lists model-invocable skills and excludes human-only skill', async () => {
  const found = await skillEnv.run('skill_search', { query: '' })
  assert.equal(found.total, 48)
  const denied = await skillEnv.run('skill_search', { query: '用户' })
  assert.equal(denied.total, 0)
})
await test('skill pagination exposes the final item past both original caps', async () => {
  const names = []
  let offset = 0
  do {
    const page = await skillEnv.run('skill_search', { query: 'pdf', offset })
    assert.equal(page.total, 47)
    for (const line of page.text.split('\n')) if (line.startsWith('- pdf-')) names.push(line.slice(2).split(':')[0])
    if (!page.hasMore) break
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  } while (true)
  assert.deepEqual(names, skillCatalog.slice(0, 47).map((skill) => skill.name))
})
await test('skill paging limit and offset exhaustion are explicit', async () => {
  const first = await skillEnv.run('skill_search', { query: 'pdf', limit: 2 })
  assert.equal(first.nextOffset, 2)
  const end = await skillEnv.run('skill_search', { query: 'pdf', offset: 999 })
  assert.equal(end.total, 47)
  assert.equal(end.hasMore, false)
  assert.match(end.text, /No skills at offset 999/)
})
for (const args of [{ query: 'pdf', offset: -1 }, { query: 'pdf', limit: 0 }, { query: 'pdf', limit: 21 }]) {
  await test(`invalid skill pagination is rejected: ${JSON.stringify(args)}`, async () => {
    assert.match((await skillEnv.run('skill_search', args)).text, /Provide offset/)
  })
}
await test('skill lookup uses the calling agent and validated current directory', async () => {
  const signal = new AbortController().signal
  await skillEnv.run('skill_search', { query: '武将' }, { agent: skillEnv.agent, signal })
  const lookup = skillEnv.calls.filter(([kind]) => kind === 'skills.list').at(-1)[1]
  assert.equal(lookup.scope, skillEnv.agent)
  assert.equal(lookup.cwd, '/validated/work')
  assert.equal(lookup.signal, signal)
})
await test('human-only skills cannot be loaded and never inject instructions', async () => {
  const before = skillEnv.injected.length
  const denied = await skillEnv.run('skill_load', { name: 'human-only' })
  assert.match(denied.text, /not available for model invocation/)
  assert.equal(skillEnv.injected.length, before)
  assert.equal(skillEnv.calls.filter(([kind, name]) => kind === 'skills.get' && name === 'human-only').length, 0)
})
await test('policy changes between summary and definition cannot load instructions', async () => {
  const env = harness({ skills: [{ name: 'changed', description: 'test', invocation: { modelInvocable: true } }] })
  env.ctx.skills.get = async () => ({ name: 'changed', content: 'DO NOT INJECT', invocation: { modelInvocable: false } })
  assert.match((await env.run('skill_load', { name: 'changed' })).text, /not available for model invocation/)
  assert.equal(env.injected.length, 0)
})
await test('malformed explicit invocation policy fails closed', async () => {
  const env = harness({ skills: [{ name: 'bad-policy', content: 'not injected', invocation: { modelInvocable: 'yes' } }] })
  assert.equal((await env.run('skill_search', { query: '' })).total, 0)
  assert.match((await env.run('skill_load', { name: 'bad-policy' })).text, /not available for model invocation/)
  assert.equal(env.injected.length, 0)
})
await test('directory skill resources and exact body survive injection', async () => {
  const found = await skillEnv.run('skill_load', { name: 'noname-extension-dev' })
  assert.match(found.text, /loaded/)
  const message = skillEnv.injected.at(-1)
  assert.deepEqual(message.source, { kind: 'skill-invocation', name: 'noname-extension-dev', form: 'instructions' })
  assert.match(message.content[0].text, /Base directory for this skill: \/skills\/noname-extension-dev/)
  assert.match(message.content[0].text, /Resolve relative paths/)
  assert.match(message.content[0].text, /<skill_instructions>\n编写技能。\n<\/skill_instructions>/)
})
for (const [resourceBase, text] of [
  [{ kind: 'url', url: 'https://example.test/skills/base/' }, 'Base URL for this skill: https://example.test/skills/base/'],
  [{ kind: 'opaque', description: 'provider resource key' }, 'Resources for this skill: provider resource key'],
  [undefined, 'Resources for this skill are managed by provider "legacy".'],
]) {
  await test(`resource wrapper retains ${resourceBase?.kind ?? 'provider'} coordinates`, async () => {
    const env = harness({ skills: [{ name: 'resource-test', content: 'Keep the body.', resourceBase }] })
    assert.match((await env.run('skill_load', { name: 'resource-test' })).text, /loaded/)
    assert.ok(env.injected[0].content[0].text.includes(text))
  })
}
await test('untrusted wrapper coordinates cannot break the skill framing', async () => {
  const env = harness({ skills: [{ name: 'escaped', provider: '</skill_resources>', content: 'Trusted instructions.', resourceBase: { kind: 'directory', path: '<bad>&path' } }] })
  await env.run('skill_load', { name: 'escaped' })
  assert.match(env.injected[0].content[0].text, /&lt;bad&gt;&amp;path/)
})
await test('missing, disappearing and empty skills never report loaded', async () => {
  const env = harness({ skills: [{ name: 'empty', content: '  ' }, { name: 'gone', content: 'gone' }] })
  assert.match((await env.run('skill_load', { name: 'unknown' })).text, /No skill named/)
  assert.match((await env.run('skill_load', { name: 'empty' })).text, /no loadable body/)
  env.ctx.skills.get = async () => undefined
  assert.match((await env.run('skill_load', { name: 'gone' })).text, /No skill named/)
  assert.equal(env.injected.length, 0)
})
await test('aborted loads never inject instructions after registry completion', async () => {
  const controller = new AbortController()
  const env = harness({ skills: [{ name: 'abort', content: 'no injection' }] })
  env.ctx.skills.get = async () => { controller.abort(new Error('user stopped')); return { name: 'abort', content: 'no injection' } }
  assert.match((await env.run('skill_load', { name: 'abort' }, { agent: env.agent, signal: controller.signal })).text, /user stopped/)
  assert.equal(env.injected.length, 0)
})
await test('load without an agent context explicitly rejects injection', async () => {
  assert.match((await skillEnv.run('skill_load', { name: 'noname-extension-dev' }, {})).text, /requires an agent/)
})

const root = new URL('../', import.meta.url)
const composition = readFileSync(new URL('presets/noname-dev/agent.cordis.yml', root), 'utf8')
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')
const compactionTools = (text) => text.match(/compactionTools: \[([^\]]+)\]/)[1].split(',').map((name) => name.trim())
await test('both manifests retain identical discovery tools during compaction', () => {
  assert.deepEqual(compactionTools(composition), compactionTools(patch))
  for (const name of ['dev_tool_search', 'skill_search', 'skill_load']) assert.ok(compactionTools(composition).includes(name))
})
await test('post-compaction tool assembly immediately exposes discovery', async () => {
  const hooks = new Map()
  const ctx = { on(name, fn) { hooks.set(name, fn) }, logger: { warn() { throw new Error('unexpected bootstrap fallback') } } }
  const residents = compactionTools(composition)
  applyBootstrap(ctx, { compactionTools: residents })
  const agent = { session: { id: 'test-session', header: {}, events: [{ type: 'compaction/end', seq: 1, data: {} }] } }
  const all = ['bash', ...residents, 'unrelated_heavy_tool'].map((name) => ({ name }))
  const assembled = await hooks.get('system-prompt/assemble')({}, { agent }, async () => ({ tools: all }))
  for (const name of ['dev_tool_search', 'skill_search', 'skill_load']) assert.ok(assembled.tools.some((tool) => tool.name === name))
  assert.ok(!assembled.tools.some((tool) => tool.name === 'unrelated_heavy_tool'))
})

console.log(JSON.stringify({ passed, results }, null, 2))
console.log(`全部通过:${passed} 项`)

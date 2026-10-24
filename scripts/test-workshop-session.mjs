#!/usr/bin/env node
/** 工坊提交使用真实组件的回调；会话服务仅记录绑定与排队内容，不调用模型。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : new URL('../client.js', import.meta.url)
const source = readFileSync(sourcePath, 'utf8')
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, 'function exists: ' + name)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error('Unclosed function: ' + name)
}

function mount(service, panel = false, extra = {}) {
  const slots = [], effects = []
  let cursor = 0, dirty = false, tree
  const React = {
    createElement(type, props, ...children) {
      return { $$typeof: Symbol.for('react.element'), type, props: { ...props, children } }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true }
      }]
    },
    useRef(initial) { return this.useState(() => ({ current: initial }))[0] },
    useId() { return this.useState('workshop-session-test')[0] },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = slots[index]
      if (!previous || !dependencies || dependencies.length !== previous.length || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = dependencies && dependencies.slice()
        effects.push(effect)
      }
    },
  }
  const parts = ['h', 'e', 'readCurrentSessionId', 'WorkshopView', 'WorkshopPanelWindow'].map(extractFunction).join('\n')
  const components = new Function('React', 'fetch', 'console', `
    var healthBus = { refresh: function () { return Promise.resolve({ preset: { state: 'ok' } }) } };
    var workshopBus = { open: true, sub: function () { return function () {} }, set: function () {} };
    var localStorage = { getItem: function () { return null } };
    function usePanelViewport() {}
    function clampPanelPos(pos) { return pos }
    function AppearanceSwitch() {}
    function WorkshopTabs() {}
    function WorkshopPage() {}
    function NewTaskForm() {}
    function TaskListContent() {}
    function HistoryPanel() {}
    function OnlinePanel() {}
    function SettingsPanel() {}
    ${parts}
    return { WorkshopView, WorkshopPanelWindow, NewTaskForm };
  `)(React, async url => {
    assert.equal(url, '/noname-kit-api/status')
    return { json: async () => ({ active: true }) }
  }, console)
  const Component = panel ? components.WorkshopPanelWindow : components.WorkshopView
  const props = { sessionId: 'A', sessions: service.sessions, uiSession: service.uiSession, ...extra }
  function render() {
    cursor = 0; dirty = false
    tree = Component(props)
    effects.splice(0).forEach(effect => effect())
  }
  render()
  return {
    components,
    async settle() {
      for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render() }
      assert.equal(dirty, false, 'component settles')
      return tree
    },
    tree: () => tree,
  }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
}
function service(initial = 'A') {
  let currentId = initial
  const bindings = [], prompts = []
  const value = {
    bindings, prompts, open: new Set(['A', 'B']), error: null,
    current(id) { currentId = id },
    uiSession: { adapter: { current: { getSnapshot: () => currentId ? { key: currentId } : null } } },
    sessions: {
      list: { getSnapshot: () => ({ byId: {} }) },
      binding(id) {
        bindings.push(id)
        if (!value.open.has(id)) return undefined
        return { session: { prompt(content, mode) {
          prompts.push({ id, content, mode })
          return value.error ? Promise.reject(value.error) : Promise.resolve('queued')
        } } }
      },
    },
  }
  return value
}
async function sender(value, extra = {}) {
  const view = mount(value, false, extra)
  const tree = await view.settle()
  const forms = nodes(tree).filter(node => node.type === view.components.NewTaskForm)
  assert.equal(forms.length, 1, 'real WorkshopView renders one NewTaskForm')
  assert.equal(typeof forms[0].props.send, 'function')
  return forms[0].props.send
}

let passed = 0
async function test(name, body) {
  try { await body() }
  catch (error) { console.error('  ✗ ' + name); throw error }
  passed++; console.log('  ✓ ' + name)
}

await test('浮窗保持打开且不重渲染，A 切换到 B 后旧回调将完整任务排队到 B', async () => {
  const value = service(), send = await sender(value, { followCurrentSession: true })
  value.current('B')
  const text = '任务ID: workshop-session-01\n技能: 火攻\n说明: 保留 Unicode 与多行正文。'
  assert.equal(await send(text), 'queued')
  assert.deepEqual(value.bindings, ['B'])
  assert.deepEqual(value.prompts, [{ id: 'B', content: [{ type: 'text', text }], mode: 'queue' }])
})

await test('真实浮窗渲染将跟随当前会话的标记传入 WorkshopView', async () => {
  const value = service(), panel = mount(value, true)
  const tree = await panel.settle()
  const views = nodes(tree).filter(node => node.type === panel.components.WorkshopView)
  assert.equal(views.length, 1, 'open panel renders one WorkshopView')
  assert.equal(views[0].props.followCurrentSession, true)
  assert.equal(views[0].props.sessionId, 'A')
  assert.equal(views[0].props.sessions, value.sessions)
  assert.equal(views[0].props.uiSession, value.uiSession)
  const send = await sender(value, views[0].props)
  value.current('B')
  await send('浮窗实际传参后的任务')
  assert.deepEqual(value.bindings, ['B'])
})

await test('普通会话页继续绑定自己的 A，会话当前值 B 不改变发送目标', async () => {
  const value = service(), send = await sender(value)
  value.current('B')
  await send('属于 A 的任务')
  assert.deepEqual(value.bindings, ['A'])
  assert.deepEqual(value.prompts, [{ id: 'A', content: [{ type: 'text', text: '属于 A 的任务' }], mode: 'queue' }])
})

await test('浮窗当前会话消失时拒绝提交，不回退至渲染时的 A', async () => {
  const value = service(), send = await sender(value, { followCurrentSession: true })
  value.current(null)
  await assert.rejects(send('不可发送的任务'), /当前没有打开的会话/)
  assert.deepEqual(value.bindings, [])
  assert.deepEqual(value.prompts, [])
})

await test('当前 B 已关闭时明确拒绝，不发送给仍然打开的 A', async () => {
  const value = service(), send = await sender(value, { followCurrentSession: true })
  value.current('B'); value.open.delete('B')
  await assert.rejects(send('不可发送的任务'), /目标会话未打开或已关闭/)
  assert.deepEqual(value.bindings, ['B'])
  assert.deepEqual(value.prompts, [])
})

await test('绑定缺少 session 时返回关闭提示，避免出现 TypeError', async () => {
  const value = service(), send = await sender(value, { followCurrentSession: true })
  value.current('B')
  value.sessions.binding = id => { value.bindings.push(id); return {} }
  await assert.rejects(send('不可发送的任务'), /目标会话未打开或已关闭/)
  assert.deepEqual(value.bindings, ['B'])
  assert.deepEqual(value.prompts, [])
})

await test('prompt 拒绝原样传回表单，仍只尝试向当前 B 排队一次', async () => {
  const value = service(), send = await sender(value, { followCurrentSession: true })
  const failure = new Error('controlled prompt rejection'), text = '失败时保留完整任务\n技能: 观星'
  value.current('B'); value.error = failure
  await assert.rejects(send(text), error => error === failure)
  assert.deepEqual(value.bindings, ['B'])
  assert.deepEqual(value.prompts, [{ id: 'B', content: [{ type: 'text', text }], mode: 'queue' }])
})

await test('普通会话页的 A 已关闭时拒绝，即使当前 B 仍然可用', async () => {
  const value = service(), send = await sender(value)
  value.current('B'); value.open.delete('A')
  await assert.rejects(send('属于 A 的任务'), /目标会话未打开或已关闭/)
  assert.deepEqual(value.bindings, ['A'])
  assert.deepEqual(value.prompts, [])
})

await test('uiSession 不可读时使用旧版 current 或新版 mainView 快照', async () => {
  for (const snapshot of [{ current: 'B' }, { byId: { B: { id: 'B', retainedBy: { mainView: 1 } } } }]) {
    const value = service(), send = await sender(value, { followCurrentSession: true })
    value.uiSession.adapter.current.getSnapshot = () => { throw new Error('current unavailable') }
    value.sessions.list.getSnapshot = () => snapshot
    await send('兼容快照的任务')
    assert.deepEqual(value.bindings, ['B'])
    assert.equal(value.prompts[0].mode, 'queue')
  }
})

console.log('全部通过: ' + passed + ' 项')

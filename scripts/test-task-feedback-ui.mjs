#!/usr/bin/env node
/** 工具注册、结果卡片与任务反馈的行为回归；任务登记仅写系统临时目录。 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createTask, getTask, listTasks, markSkillsWritten, setSkillStatus, skillFeedback } from '../src/tasks.js'

let passed = 0
function check(value, label) { assert.ok(value, label); passed++; console.log('  ✓ ' + label) }
const plain = value => JSON.parse(JSON.stringify(value))
const outputText = content => content.map(item => item.text || '').join('\n')
const home = await mkdtemp(join(tmpdir(), 'noname-kit-feedback-ui-'))
const registryPath = join(home, 'noname-kit.tasks.json')

// 按已声明的 schema 校验实际返回值，防止新增字段被严格输出通道丢弃。
function validateSchema(value, schema, path = 'output') {
  const kind = schema.type
  if (kind === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), path)
    for (const key of Object.keys(value)) {
      const child = schema.properties[key]
      assert.ok(child || schema.additionalProperties !== false, path + '.' + key + ' is declared')
      if (child) validateSchema(value[key], child, path + '.' + key)
    }
    for (const [key, child] of Object.entries(schema.properties)) if (child.required) assert.ok(Object.hasOwn(value, key), path + '.' + key + ' is required')
  } else if (kind === 'array') {
    assert.ok(Array.isArray(value), path)
    value.forEach((item, i) => validateSchema(item, schema.items, path + '[' + i + ']'))
  } else if (kind === 'integer') assert.ok(Number.isInteger(value), path)
  else assert.equal(typeof value, kind, path)
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, 'function exists: ' + name)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error('Unclosed function: ' + name)
}

let current = null
const effects = []
const React = {
  createElement(type, props, ...children) { return { $$typeof: Symbol.for('react.element'), type, props: { ...props, children } } },
  useState(init) {
    const instance = current, index = instance.cursor++
    if (instance.hooks.length <= index) instance.hooks[index] = { value: typeof init === 'function' ? init() : init }
    const slot = instance.hooks[index]
    return [slot.value, value => {
      const next = typeof value === 'function' ? value(slot.value) : value
      if (!Object.is(next, slot.value)) { slot.value = next; instance.scheduled = true }
    }]
  },
  useEffect(effect, deps) {
    const instance = current, index = instance.cursor++
    const previous = instance.hooks[index]
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      instance.hooks[index] = { deps: deps && deps.slice() }
      effects.push(effect)
    }
  },
}

function textOf(node) {
  if (node == null || node === false) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return String(node)
  return textOf(node.props && node.props.children)
}
function nodes(node, predicate = () => true, result = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, result))
  else if (node && typeof node === 'object') {
    if (node.type && predicate(node)) result.push(node)
    nodes(node.props && node.props.children, predicate, result)
  }
  return result
}
const classHas = (node, name) => String(node.props.className || '').split(' ').includes(name)
function button(tree, label) {
  const found = nodes(tree, node => node.type === 'button' && textOf(node) === label)
  assert.equal(found.length, 1, 'one button: ' + label)
  return found[0]
}

try {
  const source = (await readFile(new URL('../index.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
  const nameAt = source.indexOf("name: 'noname_skills_written'")
  const from = source.lastIndexOf('ctx.tools.register(defineTool({', nameAt)
  const to = source.indexOf('  // ── 3) 守卫', nameAt)
  assert.ok(from >= 0 && to > from, 'bounded final tool registration')
  let tool
  runInNewContext(source.slice(from, to), {
    defineTool: value => value, active: true, dshHomeDir: home, markSkillsWritten,
    ctx: { tools: { register(value) { assert.equal(tool, undefined); tool = value } } },
  })
  check(tool.name === 'noname_skills_written', '真实最后一个工具注册可独立执行且不运行目录守卫')
  check(tool.parameters.retestSkills.type === 'array' && tool.parameters.retestSkills.items.type === 'string' && !tool.parameters.retestSkills.required,
    '工具接受可选的精确重测技能数组')

  const taskId = '反馈工具-06'
  assert.ok((await createTask(home, { id: taskId, folder: '回归包', title: '状态回归', image: 'test.png', skills: [{ name: 'A' }, { name: 'B' }] })).ok)
  await setSkillStatus(home, { taskId, skill: 'A', status: 'confirmed' })
  const execute = async args => {
    const result = await tool.execute(args)
    validateSchema(result, tool.output.schema)
    validateSchema(plain(result), tool.output.schema)
    return result
  }
  const mixed = await execute({ taskId, skills: ['A', 'B'] })
  check(mixed.ok && mixed.marked === 1 && mixed.confirmed === 1 && mixed.total === 2 && JSON.stringify(mixed.preservedConfirmed) === '["A"]',
    '全量回传 A已确认+B待实现只标记 B，结果保留 A且满足输出 schema')
  check((await getTask(home, taskId)).skills.map(skill => skill.status).join() === 'confirmed,written', '工具真实落盘保留已确认技能')
  const mixedText = outputText(tool.output.render({}, mixed))
  check(mixedText.includes('已标记 1 个技能待测试') && mixedText.includes('保留 1 个技能的确认状态') && mixedText.includes('可以进游戏测试'), '非零待测工具文本报告数量及下一步')

  await setSkillStatus(home, { taskId, skill: 'B', status: 'confirmed' })
  const noOp = await execute({ taskId, skills: ['A', 'B'] })
  check(noOp.ok && noOp.marked === 0 && noOp.confirmed === 2 && !noOp.reopened && (await getTask(home, taskId)).status === 'done',
    '全确认清单再次回传保持完成且无新增待测')
  check(JSON.stringify(noOp.preservedConfirmed) === '["A","B"]', '全确认结果逐名报告保留的确认状态')
  const noOpText = outputText(tool.output.render({}, noOp))
  check(noOpText.includes('无需重复确认') && !noOpText.includes('可以进游戏测试'), '零新增待测工具文本无需重复确认')

  const retest = await execute({ taskId, skills: ['A', 'B'], retestSkills: ['B'] })
  check(retest.ok && retest.marked === 1 && retest.reopened && JSON.stringify(retest.preservedConfirmed) === '["A"]'
    && (await getTask(home, taskId)).skills.map(skill => skill.status).join() === 'confirmed,written', '显式精确重测只重新打开 B')
  for (const invalid of [['A', '不存在'], 'A', [42]]) {
    const before = await readFile(registryPath, 'utf8')
    const rejected = await execute({ taskId, skills: ['B'], retestSkills: invalid, notes: ['不得落盘'] })
    check(!rejected.ok && typeof rejected.error === 'string' && (await readFile(registryPath, 'utf8')) === before,
      '非法 retestSkills 被工具拒绝且登记处逐字不变: ' + JSON.stringify(invalid))
  }

  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const parts = ['h', 'e', 'parseBlock', 'CompleteCard', 'readCurrentSessionId', 'TaskListContent'].map(name => extractFunction(client, name)).join('\n')
  const requests = [], prompts = [], boundIds = []
  let pendingRequests = 0
  const uiId = '反馈界面-06'
  await createTask(home, { id: uiId, folder: '当前包', image: 'test.png', skills: [{ name: '其他已确认' }, { name: '问题技能' }, { name: '另一个已确认' }] })
  for (const skill of ['其他已确认', '另一个已确认']) await setSkillStatus(home, { taskId: uiId, skill, status: 'confirmed' })
  await markSkillsWritten(home, { taskId: uiId, skills: ['问题技能'] })
  async function fetchStub(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null
    requests.push({ url: String(url), body })
    pendingRequests++
    try {
      let value
      if (url === '/noname-kit-api/tasks') value = { tasks: (await listTasks(home)).filter(task => task.id === uiId) }
      else if (url === '/noname-kit-api/tasks/feedback') value = await skillFeedback(home, body)
      else throw new Error('Unexpected request: ' + url)
      return { json: async () => plain(value) }
    } finally { pendingRequests-- }
  }
  const components = new Function('React', 'fetch', 'console', parts + '\nreturn { CompleteCard, TaskListContent };')(React, fetchStub, console)
  const settledBlock = text => ({ call: { argsRaw: '{}' }, content: [{ type: 'text', text }] })
  const card = (text, extra = {}) => components.CompleteCard({ block: { ...settledBlock(text), ...extra } })
  const noOpCard = card(noOpText)
  const noOpHeading = textOf(nodes(noOpCard, node => node.type === 'b')[0])
  check(noOpHeading === '✅ 技能状态已核对' && nodes(noOpCard, node => classHas(node, 'nnk-ok')).length === 1
    && nodes(noOpCard, node => classHas(node, 'nnk-err')).length === 0, '真实 CompleteCard 将零新增待测呈现为核对成功')
  check(!noOpHeading.includes('待游戏测试') && textOf(noOpCard).includes('无需重复确认'), '零新增卡片标题不误示待测且保留无需重复确认的正文')
  const successCard = card(mixedText)
  check(textOf(nodes(successCard, node => node.type === 'b')[0]) === '🏁 技能已写入,待游戏测试'
    && nodes(successCard, node => classHas(node, 'nnk-ok')).length === 1, '非零待测成功卡片仍显示游戏测试入口说明')
  const failedResult = await execute({ taskId: '不存在', skills: ['A'] })
  const failedCard = card(outputText(tool.output.render({}, failedResult)))
  check(nodes(failedCard, node => classHas(node, 'nnk-err')).length === 1 && textOf(failedCard).includes('收口未完成')
    && textOf(failedCard).includes('找不到任务'), '工具失败卡片保留错误原因与重试提示')
  check(textOf(components.CompleteCard({ block: {} })).includes('正在标记技能'), '运行中的工具卡片保持等待状态')
  check(nodes(card('', { isError: true }), node => classHas(node, 'nnk-err')).length === 1, '工具传输异常卡片仍呈现错误状态')

  const sessions = {
    list: { getSnapshot: () => ({ current: '旧会话' }) },
    binding(id) {
      boundIds.push(id)
      return { session: { prompt(content, mode) { prompts.push({ content, mode }); return Promise.resolve() } } }
    },
  }
  const uiSession = { adapter: { current: { getSnapshot: () => ({ key: '当前会话' }) } } }
  const instance = { hooks: [], cursor: 0, scheduled: false }
  let tree
  function render() {
    current = instance; instance.cursor = 0; instance.scheduled = false
    tree = components.TaskListContent({ sessions, uiSession })
    current = null
    effects.splice(0).forEach(effect => effect())
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  async function flush() {
    const deadline = Date.now() + 5000
    for (let i = 0; Date.now() < deadline; i++) {
      await tick()
      if (instance.scheduled) render()
      else if (pendingRequests === 0 && i > 4) return
    }
    throw new Error('TaskListContent did not settle')
  }
  render(); await flush()
  button(tree, '展开技能树').props.onClick(); await flush()
  function skillRow(name) {
    const found = nodes(tree, node => classHas(node, 'nnk-task-skill') && nodes(node, child => child.type === 'b' && textOf(child).endsWith('. ' + name)).length)
    assert.equal(found.length, 1, 'one skill row: ' + name)
    return found[0]
  }
  function confirmed(name) {
    const row = skillRow(name)
    return nodes(row, node => classHas(node, 'nnk-status-done') && textOf(node) === '✅已确认').length === 1
      && nodes(row, node => node.type === 'button' && textOf(node) === '✅ 确认无误').length === 0
  }
  check(confirmed('其他已确认') && confirmed('另一个已确认'), '任务列表为其他确认技能展示确认徽标且不重复要求确认')
  button(skillRow('问题技能'), '🔁 反馈').props.onClick(); await flush()
  const textarea = nodes(tree, node => node.type === 'textarea')[0]
  assert.ok(textarea)
  const issue = '触发后伤害计算错误；game.log: feedback-probe-06'
  textarea.props.onChange({ target: { value: '  ' + issue + '  ' } }); await flush()
  button(tree, '提交反馈').props.onClick(); await flush()
  const feedbackRequest = requests.find(request => request.url.endsWith('/tasks/feedback'))
  check(feedbackRequest && JSON.stringify(feedbackRequest.body) === JSON.stringify({ taskId: uiId, skill: '问题技能', issue }), '真实点击提交反馈保留任务ID、技能名与完整问题正文')
  check(prompts.length === 1 && boundIds.join() === '当前会话' && prompts[0].mode === 'queue', '反馈只向当前打开会话排队发送一次')
  const prompt = prompts[0].content.map(item => item.text || '').join('\n')
  check(prompt.includes('任务ID: ' + uiId) && prompt.includes('目标扩展文件夹: 当前包') && prompt.includes('问题技能: 问题技能') && prompt.includes(issue), '当前会话实际收到的 prompt 保留反馈上下文')
  check(prompt.includes('skills 只填本轮实际修复的任务技能名称') && prompt.includes('不要照抄整个任务清单')
    && prompt.includes('同时列入 skills 和 retestSkills') && prompt.includes('未修改的已确认技能不得列入 retestSkills'), '反馈 prompt 明确仅回传本轮修复及精确重测规则')
  const saved = await getTask(home, uiId)
  check(saved.skills.map(skill => skill.status).join() === 'confirmed,open,confirmed' && saved.feedbacks[0].issue === issue,
    '反馈真实落盘仅打开问题技能，其余确认状态保留')
  check(confirmed('其他已确认') && confirmed('另一个已确认') && nodes(skillRow('问题技能'), node => classHas(node, 'nnk-status-open')).length === 1,
    '反馈后重新加载的 UI 仍保留其他技能确认徽标，并显示问题技能待实现')
  console.log('全部通过:' + passed + ' 项')
} finally {
  await rm(home, { recursive: true, force: true })
}

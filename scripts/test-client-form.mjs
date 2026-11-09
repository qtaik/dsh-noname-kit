#!/usr/bin/env node
/**
 * noname-kit 行为单测:client.js 的任务表单 NewTaskForm。
 * 运行:node scripts/test-client-form.mjs
 *
 * 异步条目与元信息请求可能乱序返回。响应必须比对当前包和条目状态，
 * 避免迟到的旧请求覆盖当前列表、读取提示或历史注意点。
 * 组件体内的局部递增序号会在重渲染时重置，不能充当跨渲染竞态守卫。
 * 同时验证编辑模式的新玩法分支不渲染目标选项，且提交消息与当前模式一致。
 *
 * 从真实源码提取表单及展示组件，以迷你 React 和可控时序 fetch 桩
 * 驱动业务状态机。展示组件使用经典外观依赖；DOM、焦点与动效不在此模拟。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'client.js'), 'utf8')

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

// ── 从源码切出函数体(花括号配对) ──────────────────────────
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('找不到 function ' + name)
  let i = source.indexOf('{', start), depth = 0
  for (; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error('括号不配平: ' + name)
}
const parts = ['h', 'e', 'fieldLabelParts', 'FormField', 'textField', 'renderRadioGroup', 'formGroup', 'NewTaskForm'].map((n) => extractFunction(src, n)).join('\n')
const presentationDependencies = [
  "var appearanceBus = { value: 'classic', focusTarget: null, sub: function () { return function () {} } };",
  'var skillMotion = new Map(); var skillScopeSerial = 0;',
  'var document = { getElementById: function () { return null } };',
  "function useAppearance() { return 'classic' }",
].join('\n')
const makeFactory = new Function('return function (React, fetch, console) {\n' + presentationDependencies + '\n' + parts + '\n return NewTaskForm;\n}')
const quiet = { error() {}, warn() {}, log() {} }

// ── 迷你 React:业务状态与展示组件的基础 hooks ─────────────
let cur = null, pendingEffects = []
function useStateImpl(init) {
  const inst = cur, i = inst.cursor++
  if (inst.hooks.length <= i) inst.hooks[i] = { value: typeof init === 'function' ? init() : init }
  const s = inst.hooks[i]
  return [s.value, function (v) { const n = typeof v === 'function' ? v(s.value) : v; if (n !== s.value) { s.value = n; inst.scheduled = true } }]
}
function useEffectImpl(fn, deps) {
  const inst = cur, i = inst.cursor++
  if (inst.hooks.length <= i) inst.hooks[i] = { deps: undefined, cleanup: undefined }
  const s = inst.hooks[i]
  const ch = s.deps === undefined || !deps || deps.length !== s.deps.length || deps.some((d, k) => !Object.is(d, s.deps[k]))
  if (ch) { pendingEffects.push({ slot: s, fn }); s.deps = deps ? deps.slice() : undefined }
}
let presentationId = 0
const React = {
  createElement(t, p, ...c) {
    const children = c.flat()
    if (typeof t === 'function') {
      const parent = cur
      cur = { hooks: [], cursor: 0, scheduled: false }
      try { return t(Object.assign({}, p, { children: children.length === 1 ? children[0] : children })) }
      finally { cur = parent }
    }
    return { type: t, props: Object.assign({}, p, { children }) }
  },
  cloneElement(node, props) { return { type: node.type, props: Object.assign({}, node.props, props) } },
  useRef(value) { return useStateImpl(() => ({ current: value }))[0] },
  useId() { return useStateImpl(() => 'test-ui-' + (++presentationId))[0] },
  useState: useStateImpl, useEffect: useEffectImpl,
}

// ── fetch 桩:请求悬置,由用例手动放行(模拟任意到达顺序) ────
const requests = []
function fetchStub(url, opts) {
  return new Promise((resolve) => {
    requests.push({
      url: String(url), opts, answered: false,
      reply(body) { this.answered = true; resolve({ json: () => Promise.resolve(body) }) },
    })
  })
}
const tick = () => new Promise((r) => setTimeout(r, 0))
async function settle() { for (let i = 0; i < 8; i++) await tick() }
const req = (pred) => requests.filter((r) => !r.answered && pred(r))[0]

// ── 渲染循环 ────────────────────────────────────────────────
let inst = null, tree = null, sent = []
const NewTaskForm = makeFactory()(React, fetchStub, quiet)
function render() {
  cur = inst; inst.cursor = 0; inst.scheduled = false
  tree = NewTaskForm({ send: (text) => { sent.push(text); return Promise.resolve() } })
  pendingEffects.splice(0).forEach((e) => e.fn())
  return tree
}
function mount() { requests.length = 0; sent = []; inst = { hooks: [], cursor: 0, scheduled: false }; render() }
function form() { return inst.hooks[0].value }
async function flush() { await settle(); for (let i = 0; i < 20 && inst.scheduled; i++) { render(); await settle() } await settle() }
function walk(node, out) {
  if (node == null || node === false) return out
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out }
  if (typeof node !== 'object') return out
  if (node.type) out.push(node)
  walk(node.props && node.props.children, out)
  return out
}
function findAll(pred) {
  const nodes = walk(tree, [])
  const names = new Map()
  // 测试按「组标题 + 选项值」查找；原生 name 现为组件作用域内共享的组名。
  // 只投影查找结果，不修改真实树或回调；正查找和“不存在”断言共用同一映射。
  for (const label of nodes.filter(n => n.type === 'label' && n.props.key != null)) {
    const input = deepKids(label).find(n => n && n.type === 'input' && n.props.type === 'radio')
    if (!input || !String(input.props.name).includes(':')) continue
    const group = String(input.props.name).slice(String(input.props.name).lastIndexOf(':') + 1)
    names.set(input, group + String(label.props.key))
  }
  return nodes.map(n => names.has(n) ? { ...n, props: { ...n.props, name: names.get(n) } } : n).filter(pred)
}
function clickRadio(name) {
  const el = findAll((n) => n.type === 'input' && n.props.type === 'radio' && n.props.name === name)[0]
  if (!el) throw new Error('找不到 radio ' + name)
  el.props.onChange()
}
/** 按 label 文本前缀找输入控件:label 的下一个兄弟节点里的 textarea/input。
 *  两种结构都吃:textField 的 div>{label,textarea},以及模式规则那种 label 与
 *  textarea 平级的裸数组。 */
const textOf = (n) => {
  if (n == null || n === false) return ''
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (typeof n !== 'object') return String(n)
  return textOf(n.props && n.props.children)
}
/** 深度展平子节点(真 React 会递归展平数组,迷你 shim 只展一层——
 *  表单里 mode 规则框那种「label 与 textarea 放同一个数组字面量」的写法要靠它)。 */
function deepKids(node) {
  const out = []
  const push = (v) => {
    if (v == null || v === false) return
    if (Array.isArray(v)) { v.forEach(push); return }
    out.push(v)
  }
  push(node.props && node.props.children)
  return out
}
function fieldByLabel(prefix) {
  const linkedLabel = findAll(n => n.type === 'label' && n.props.htmlFor && textOf(n).startsWith(prefix))[0]
  if (linkedLabel) {
    const control = findAll(n => ['textarea', 'input', 'select'].includes(n.type) && n.props.id === linkedLabel.props.htmlFor)[0]
    if (control) return control
  }
  let found = null
  const rec = (node) => {
    if (found || node == null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(rec); return }
    const kids = deepKids(node)
    if (kids.length) {
      for (let i = 0; i < kids.length && !found; i++) {
        const k = kids[i]
        if (k && k.type === 'label' && textOf(k).startsWith(prefix)) {
          for (let j = i + 1; j < kids.length; j++) {
            const cand = kids[j]
            if (cand && (cand.type === 'textarea' || cand.type === 'input')) { found = cand; break }
          }
        }
      }
    }
    if (kids) rec(kids)
  }
  rec(tree)
  if (!found) {
    const labels = walk(tree, []).filter((n) => n.type === 'label').map((n) => textOf(n).slice(0, 24))
    const errs = walk(tree, []).filter((n) => typeof (n.props && n.props.className) === 'string' && n.props.className.indexOf('nnk-err') >= 0).map((n) => textOf(n))
    throw new Error('找不到字段 ' + prefix + ';现有 label=' + JSON.stringify(labels) + (errs.length ? ';页面错误=' + JSON.stringify(errs) : ''))
  }
  return found
}
const folderSelect = () => findAll((n) => n.type === 'select' && walk(n, []).some((c) => c.type === 'option' && c.props.value === ''))[0]
const entrySelect = () => findAll((n) => n.type === 'select' && walk(n, []).some((c) => c.type === 'option' && String(c.props.value).startsWith('e-')))[0]
const submitBtn = () => findAll((n) => n.type === 'button' && n.props.className === 'nnk-submit')[0]

try {
  // ═══ 进入「编辑已有扩展包 + 目标=编辑已有」,选包 A(慢)再立刻切包 B(快) ═══
  console.log('场景 0:搭台(编辑模式 → 目标=编辑已有 → 连切两包)')
  mount()
  clickRadio('模式edit')
  await flush()
  const folders = req((r) => r.url.endsWith('/settings?allExtensions=1'))
  assert.ok(folders, '切到编辑模式会直接读取扩展目录列表')
  assert.equal(req((r) => r.url.endsWith('/history')), undefined, '目录列表不依赖历史整表')
  folders.reply({ nonameDir: "D:\\Games\\noname", extensions: ['A', 'B'] })
  await flush()
  clickRadio('目标edit')
  await flush()
  folderSelect().props.onChange({ target: { value: 'A' } })
  await flush()
  const entriesA = req((r) => r.url.includes('/entries') && r.url.includes('folder=A'))
  folderSelect().props.onChange({ target: { value: 'B' } })
  await flush()
  const entriesB = req((r) => r.url.includes('/entries') && r.url.includes('folder=B'))
  ok(entriesA && entriesB, '两个 /entries 请求都发出(切包各自触发)')

  // ── 1) entries 竞态:B 先回,A 迟到 → 列表必须保持 B 的 ──
  console.log('场景 1:entries 先发后至')
  entriesB.reply({ ok: true, entries: [{ id: 'e-b1', name: 'B 条目一' }, { id: 'e-b2', name: 'B 条目二' }] })
  await flush()
  entriesA.reply({ ok: true, entries: [{ id: 'e-a1', name: 'A 条目' }] })
  await flush()
  ok(form().entryList.length === 2 && form().entryList[0].id === 'e-b1',
    '切包 B 后旧包 A 的迟到响应被丢弃(列表仍是 B 的两条)')
  ok(form().entryLoading === false, '加载态被正确收尾(不是卡在「加载中…」)')

  // ── 2) 文件夹元信息竞态:currentInfo / notes 不被旧包覆盖 ──
  console.log('场景 2:扩展包元信息先发后至')
  for (const t of requests.filter((r) => !r.answered && r.url.endsWith('/tasks'))) t.reply({ tasks: [] })
  await flush()
  const extA = req((r) => r.url.includes('/extension?folder=A'))
  const histA = req((r) => r.url.includes('/history?folder=A'))
  const extB = req((r) => r.url.includes('/extension?folder=B'))
  const histB = req((r) => r.url.includes('/history?folder=B'))
  ok(extA && histA && extB && histB, '两个包的 extension/history 请求都发出(经 /tasks 链)')
  extB.reply({ code: 'game.import("extension",function(){})' })   // B:老式游戏.import
  histB.reply({ folder: 'B', history: { tasks: [], notes: [] }, backups: [] })
  await flush()
  const infoB = form().currentInfo
  ok(String(infoB).indexOf('B') >= 0 && String(infoB).indexOf('classic') >= 0, 'B 的读取结果先落地:' + infoB)
  extA.reply({ code: 'a\nb\nc\nd\ne\n' })                          // A:6 行、module 写法,迟到
  histA.reply({ folder: 'A', history: { tasks: [], notes: ['A 的注意点'] }, backups: [] })
  await flush()
  ok(form().currentInfo === infoB, '旧包 A 的迟到读取结果不覆盖新包 B 的提示')
  ok((form().notes || []).length === 0, '旧包 A 的注意点不混进当前包(任务消息里报的是条数)')

  // ── 3) 条目技能竞态:选了 b1(慢)再选 b2(快) ──
  console.log('场景 3:条目技能先发后至')
  entrySelect().props.onChange({ target: { value: 'e-b1' } })
  await flush()
  const sk1 = req((r) => r.url.includes('/entry-skills') && r.url.includes('id=e-b1'))
  entrySelect().props.onChange({ target: { value: 'e-b2' } })
  await flush()
  const sk2 = req((r) => r.url.includes('/entry-skills') && r.url.includes('id=e-b2'))
  ok(sk1 && sk2, '两次 /entry-skills 都发出')
  sk2.reply({ ok: true, skills: [{ id: 'sk-b2', name: 'B2 技能' }] })
  await flush()
  sk1.reply({ ok: true, skills: [{ id: 'sk-b1', name: 'B1 技能' }] })
  await flush()
  ok(form().entrySkills.length === 1 && form().entrySkills[0].id === 'sk-b2',
    '切条目后旧条目的迟到技能列表被丢弃')
  ok(form().entrySkillsLoading === false, '技能加载态收尾')

  // ── 4) 正常顺序(不迟到)仍要照常工作:防「守卫修过头」 ──
  console.log('场景 4:正常顺序回归')
  entrySelect().props.onChange({ target: { value: 'e-b1' } })
  await flush()
  const sk1b = req((r) => r.url.includes('/entry-skills') && r.url.includes('id=e-b1'))
  sk1b.reply({ ok: true, skills: [{ id: 'sk-b1', name: 'B1 技能' }] })
  await flush()
  ok(form().entrySkills.length === 1 && form().entrySkills[0].id === 'sk-b1', '顺序正常时技能列表照常更新')
  entrySelect().props.onChange({ target: { value: '' } })   // 清空选择
  await flush()
  ok(form().entrySkills.length === 0 && form().entrySkillsLoading === false, '清空条目选择后加载态不残留')

  // ── 5) 🎲 模式 + 编辑模式:没有「目标」radio,提交消息不自相矛盾 ──
  console.log('场景 5:模式类型在编辑模式的消息口径')
  clickRadio('类型mode')
  await flush()
  ok(!findAll((n) => n.type === 'input' && n.props.name === '目标create')[0]
    && !findAll((n) => n.type === 'input' && n.props.name === '目标edit')[0],
    '模式类型下不渲染「目标」radio(亲手点不出 goal=create)')
  ok(form().goal === 'edit', '模式类型在编辑模式下目标恒为「编辑已有」')
  fieldByLabel('任务ID').props.onChange({ target: { value: 'probe-mode-01' } })
  await flush()
  fieldByLabel('新增或调整的规则').props.onChange({ target: { value: '雪天全场武力 -1' } })
  await flush()
  submitBtn().props.onClick()
  await flush()
  const settingsReq = req((r) => r.url.endsWith('/settings'))
  if (settingsReq) settingsReq.reply({ nonameDir: 'D:\\Games\\noname' })
  await flush()
  const postTasks = req((r) => r.url.endsWith('/tasks') && r.opts && r.opts.method === 'POST')
  ok(postTasks, '提交会注册任务(POST /tasks)')
  postTasks.reply({ ok: true })
  await flush()
  ok(sent.length === 1, '任务消息发给了会话')
  const msg = sent[0] || ''
  ok(msg.indexOf('编辑已有扩展包') >= 0, '消息口径 = 编辑已有扩展包')
  ok(msg.indexOf('当前不存在') < 0, '消息不再自称「目标文件夹当前不存在」')
  ok(msg.indexOf('雪天全场武力 -1') >= 0, '用户填的规则进了消息')

  // ── 6) 回归:🆕 创建新扩展包 + 🎲 新玩法 的消息口径不变 ──
  console.log('场景 6:创建新包的模式分支没被改坏')
  clickRadio('模式new')
  await flush()
  fieldByLabel('任务ID').props.onChange({ target: { value: 'probe-mode-02' } })
  await flush()
  fieldByLabel('新扩展包名称').props.onChange({ target: { value: '测试包' } })
  await flush()
  fieldByLabel('一句话核心玩法').props.onChange({ target: { value: '混战大逃杀' } })
  await flush()
  fieldByLabel('玩法细节描述').props.onChange({ target: { value: '每人独立求生' } })
  await flush()
  submitBtn().props.onClick()
  await flush()
  const settingsReq2 = req((r) => r.url.endsWith('/settings'))
  if (settingsReq2) settingsReq2.reply({ nonameDir: 'D:\\Games\\noname' })
  await flush()
  const postTasks2 = req((r) => r.url.endsWith('/tasks') && r.opts && r.opts.method === 'POST')
  ok(postTasks2, '第二次提交也注册任务')
  postTasks2.reply({ ok: true })
  await flush()
  const msg2 = sent[sent.length - 1] || ''
  ok(msg2.indexOf('创建全新扩展包') >= 0 && msg2.indexOf('混战大逃杀') >= 0, '新包模式分支口径不变(创建全新扩展包)')

  // ── 7) 结构锁:坏守卫模式不得复活 ──
  console.log('场景 7:结构锁')
  const bad = []
  const lines = src.split('\n')
  lines.forEach((ln, i) => {
    if (/^\s{6}var \w*Seq\w* *= 0/.test(ln)) bad.push(i + 1 + ': ' + ln.trim())
  })
  ok(bad.length === 0, '组件体内不再有 ++seq 序号守卫(重渲染即失效的写法):' + (bad.join(' / ') || '无'))
  ok(/prev\.entryId !== entryId/.test(src), '条目技能守卫按「当前状态 vs 请求参数」判定')
  ok(/prev\.folder !== folder/.test(src), '包级响应守卫按当前包判定')

  console.log('场景 8:部分索引结果明确显示冲突，不冒称全量成功')
  mount()
  clickRadio('模式edit')
  await flush()
  req(r => r.url.endsWith('/settings?allExtensions=1')).reply({ extensions: ['PartialPack'] })
  await flush()
  folderSelect().props.onChange({ target: { value: 'PartialPack' } })
  await flush()
  req(r => r.url.includes('/extension?folder=PartialPack')).reply({ code: 'game.import("extension",function(){})' })
  await flush()
  const indexButton = () => findAll(n => n.type === 'button' && textOf(n).includes('建立区块索引'))[0]
  indexButton().props.onClick()
  await flush()
  req(r => r.url.endsWith('/blocks/migrate')).reply({ ok: true, partial: true, totalFiles: 1, totalBlocks: 702, totalInserted: 1404, filesSkipped: 0, skippedEntries: [{ file: 'extension.js', key: 'translate:fixture_shared', reason: 'duplicate-key' }, { file: 'extension.js', key: 'translate:fixture_shared', reason: 'duplicate-key' }], failed: [] })
  await flush()
  ok(form().currentInfo.startsWith('⚠️') && form().currentInfo.includes('702 个区块'), '部分索引显示警示和真实成功区块数')
  ok(form().currentInfo.includes('2 处') && form().currentInfo.includes('translate:fixture_shared'), '显示未索引定义数量和冲突键')
  ok(form().currentInfo.includes('原内容保留') && form().currentInfo.includes('唯一原文精确修改'), '提示原内容保留及可用修改方式')
  indexButton().props.onClick()
  await flush()
  req(r => r.url.endsWith('/blocks/migrate')).reply({ ok: true, totalFiles: 1, totalBlocks: 4, totalInserted: 8, filesSkipped: 0, failed: [] })
  await flush()
  ok(form().currentInfo.startsWith('✅') && !form().currentInfo.includes('未索引'), '完整迁移仍显示原成功提示')
  indexButton().props.onClick()
  await flush()
  req(r => r.url.endsWith('/blocks/migrate')).reply({ ok: false, error: '无可安全索引条目' })
  await flush()
  ok(form().currentInfo.startsWith('❌') && form().currentInfo.includes('无可安全索引条目'), '全部不可索引时仍明确失败')

  console.log('场景 9:创建武将的势力和视频选项')
  const checkbox = (label) => {
    const owner = findAll(n => n.type === 'label' && textOf(n) === label)[0]
    return owner && walk(owner, []).find(n => n.type === 'input' && n.props.type === 'checkbox')
  }
  const change = async (label, value) => {
    fieldByLabel(label).props.onChange({ target: { value } })
    await flush()
  }
  const toggle = async (label, checked) => {
    assert.ok(checkbox(label), '存在勾选项：' + label)
    checkbox(label).props.onChange({ target: { checked } })
    await flush()
  }
  const submitTask = async (id) => {
    await change('任务ID', id)
    const sentBefore = sent.length
    submitBtn().props.onClick()
    await flush()
    const settings = req(r => r.url.endsWith('/settings'))
    assert.ok(settings, '有效表单应读取设置；页面错误：' + form().err)
    settings.reply({ nonameDir: 'D:\\Games\\noname' })
    await flush()
    const post = req(r => r.url.endsWith('/tasks') && r.opts && r.opts.method === 'POST')
    assert.ok(post, '有效表单应登记任务')
    const body = JSON.parse(post.opts.body)
    post.reply({ ok: true })
    await flush()
    assert.equal(sent.length, sentBefore + 1, '任务消息只发送一次')
    return { body, message: sent[sent.length - 1] }
  }
  const expectBlocked = async (expected) => {
    const requestCount = requests.length, sentCount = sent.length
    submitBtn().props.onClick()
    await flush()
    ok(form().err.includes(expected) && !form().busy, '未填完整时给出提示：' + expected)
    ok(requests.length === requestCount && sent.length === sentCount, '未填完整时不登记任务或发送消息')
  }
  const noCharacterOptions = (result) => result.body.newFaction === null && result.body.portraitVideo === ''
    && !result.message.includes('星海势力') && !result.message.includes('星海 图.png') && !result.message.includes('动态 立绘.MP4')
    && !result.message.includes('── 新势力 ──') && !result.message.includes('── 视频动态立绘 ──')
    && !result.message.includes('references/custom-faction.md') && !result.message.includes('references/video-portrait.md')

  mount()
  ok(checkbox('创建新势力') && checkbox('使用视频作为动态立绘'), '创建武将显示两个选项')
  ok(!checkbox('创建新势力').props.checked && !checkbox('使用视频作为动态立绘').props.checked, '两个选项默认关闭')
  ok(!findAll(n => ['factionName', 'factionImage', 'portraitVideo'].includes(n.props['data-nnk-field'])).length, '未勾选时不渲染附属输入框')
  const skillName = findAll(n => n.type === 'input' && String(n.props.placeholder).startsWith('技能名'))[0]
  skillName.props.onChange({ target: { value: '远航' } })
  await flush()
  await toggle('创建新势力', true)
  ok(findAll(n => ['factionName', 'factionImage'].includes(n.props['data-nnk-field'])).length === 2 && fieldByLabel('新势力名称') && fieldByLabel('势力图片路径'), '勾选势力后显示名称和图片字段')
  ok(checkbox('创建新势力').props['aria-expanded'] === true, '势力展开状态提供给辅助技术')
  await expectBlocked('新势力名称')
  await change('新势力名称', '  星海势力  ')
  await expectBlocked('势力图片路径')
  await change('势力图片路径', '  "D:\\素材 文件\\星海 图.png"  ')
  await toggle('使用视频作为动态立绘', true)
  ok(findAll(n => n.props['data-nnk-field'] === 'portraitVideo').length === 1 && fieldByLabel('动态立绘视频路径'), '勾选视频后显示视频输入框')
  await expectBlocked('动态立绘视频路径')
  await change('动态立绘视频路径', 'D:\\素材 文件\\静态.png')
  await expectBlocked('支持 MP4')
  await change('动态立绘视频路径', '  "D:\\素材 文件\\动态 立绘.MP4"  ')
  await change('图片路径', 'D:\\素材 文件\\静态立绘.png')
  const createdOptions = await submitTask('options-new')
  assert.deepEqual(createdOptions.body.newFaction, { name: '星海势力', image: 'D:\\素材 文件\\星海 图.png' })
  ok(createdOptions.body.portraitVideo === 'D:\\素材 文件\\动态 立绘.MP4', '任务登记保留带空格的路径并去除复制路径的外层引号')
  ok(createdOptions.body.image === 'D:\\素材 文件\\静态立绘.png', '势力图与视频不覆盖静态立绘字段')
  ok(createdOptions.message.includes('星海势力') && createdOptions.message.includes('星海 图.png') && createdOptions.message.includes('动态 立绘.MP4'), 'AI 消息同时包含势力名称、势力图与视频路径')
  ok(createdOptions.message.includes('noname_copy_videos') && createdOptions.message.includes('video/'), '视频需求说明专用复制工具与包内视频目录')
  ok(['game.addGroup(', '配置对象中的 image', 'lib.selectGroup', 'references/custom-faction.md'].every(part => createdOptions.message.includes(part)), '新势力任务下发注册、图片与选择语义参考')
  ok(createdOptions.message.includes('势力图单独用 noname_copy_images') && createdOptions.message.includes('不带 taskId'), '势力图独立复制且不会登记为武将立绘')
  ok(createdOptions.message.includes('静态立绘独立处理') && createdOptions.message.includes('复制成功不等于已验证播放'), '视频消息保留静态回退和播放验证要求')

  ok(['player.node.avatar', 'avatar2', 'lib.assetURL', 'pointer-events:none', 'references/video-portrait.md'].every(part => createdOptions.message.includes(part)), '新建视频任务直接提供头像叠加方法与可定位参考')

  console.log('场景 10:取消勾选不提交隐藏值，重新勾选保留输入')
  await toggle('创建新势力', false)
  await toggle('使用视频作为动态立绘', false)
  ok(!findAll(n => ['factionName', 'factionImage', 'portraitVideo'].includes(n.props['data-nnk-field'])).length, '取消勾选后附属输入框隐藏')
  ok(form().factionName.includes('星海势力') && form().portraitVideo.includes('动态 立绘.MP4'), '取消勾选保留草稿输入')
  ok(noCharacterOptions(await submitTask('options-disabled')), '隐藏草稿不进入登记请求或 AI 消息')
  await toggle('创建新势力', true)
  await toggle('使用视频作为动态立绘', true)
  ok(fieldByLabel('新势力名称').props.value.includes('星海势力') && fieldByLabel('动态立绘视频路径').props.value.includes('动态 立绘.MP4'), '重新勾选恢复原输入')

  console.log('场景 11:卡牌和模式不携带武将选项')
  clickRadio('类型card')
  await flush()
  ok(!checkbox('创建新势力') && !checkbox('使用视频作为动态立绘'), '切到卡牌后隐藏武将专用选项')
  ok(noCharacterOptions(await submitTask('options-card')), '卡牌提交不携带已勾选的武将选项')
  clickRadio('类型mode')
  await flush()
  await change('一句话核心玩法', '各自为战')
  await change('玩法细节描述', '最后存活者获胜')
  ok(!checkbox('创建新势力') && !checkbox('使用视频作为动态立绘'), '切到模式后隐藏武将专用选项')
  ok(noCharacterOptions(await submitTask('options-mode')), '模式提交不携带已勾选的武将选项')

  console.log('场景 12:已有包新增武将及手动源码模式')
  clickRadio('类型character')
  await flush()
  clickRadio('模式edit')
  await flush()
  req(r => r.url.endsWith('/settings?allExtensions=1')).reply({ nonameDir: 'D:\\Games\\noname', extensions: ['已有包'] })
  await flush()
  folderSelect().props.onChange({ target: { value: '已有包' } })
  await flush()
  ok(form().goal === 'create' && checkbox('创建新势力') && checkbox('使用视频作为动态立绘'), '已有包的新增武将仍显示两个选项')
  clickRadio('写入方式manual')
  await flush()
  const existingCreate = await submitTask('options-existing-new')
  ok(existingCreate.body.newFaction.name === '星海势力' && existingCreate.body.portraitVideo.endsWith('.MP4'), '已有包新增武将同样登记势力和视频')
  ok(existingCreate.message.includes('编辑已有扩展包') && existingCreate.message.includes('── 新势力 ──') && existingCreate.message.includes('── 视频动态立绘 ──'), '已有包新增武将的消息包含两项新需求')
  ok(['game.addGroup(', '武将的 group', '保留已有有效兼容方案', '可以使用必要的全局注册、全局技能或界面钩子', 'references/custom-faction.md'].every(part => existingCreate.message.includes(part)), '已有包新增武将也包含自建势力方法及兼容边界')
  ok(existingCreate.body.writeMode === 'manual' && existingCreate.message.includes('手动复制(只生成代码,不要写文件)') && existingCreate.message.includes('素材复制遵守用户已授权范围'), '手动模式保留源码手动与素材授权语义')

  console.log('场景 13:编辑已有武将显示视频选项，不显示新势力')
  clickRadio('目标edit')
  await flush()
  req(r => r.url.includes('/entries') && r.url.includes('kind=character')).reply({ ok: true, entries: [{ id: 'e-existing', name: '已有武将' }] })
  await flush()
  entrySelect().props.onChange({ target: { value: 'e-existing' } })
  await flush()
  await change('武将改动描述', '体力调整为 4')
  ok(!checkbox('创建新势力') && checkbox('使用视频作为动态立绘'), '编辑已有武将只显示视频选项')
  await toggle('使用视频作为动态立绘', true)
  const existingEdit = await submitTask('options-existing-edit')
  ok(existingEdit.body.target.id === 'e-existing' && existingEdit.body.newFaction === null && existingEdit.body.portraitVideo.endsWith('.MP4'), '编辑已有武将登记目标和视频，不携带新势力草稿')
  ok(existingEdit.body.skills.length === 2 && existingEdit.body.skills[0].name === '修改 e-existing' && existingEdit.body.skills[1].name === '视频动态立绘', '条目修改与视频要求各有任务节点')
  ok(!existingEdit.message.includes('星海势力') && !existingEdit.message.includes('星海 图.png') && existingEdit.message.includes('目标武将内部 ID: e-existing'), '编辑消息指向已有武将，不要求创建新势力')
  ok(existingEdit.message.includes('沿用现有静态立绘作为回退') && existingEdit.message.includes('不创建新武将'), '编辑视频保留既有立绘和目标范围')

  console.log('场景 14:动态立绘可单独编辑，取消勾选不是删除请求')
  await change('武将改动描述', '')
  await change('图片路径', '')
  const videoOnly = await submitTask('options-video-only')
  ok(videoOnly.body.target.id === 'e-existing' && videoOnly.body.skills.length === 1 && videoOnly.body.skills[0].name === '视频动态立绘', '仅勾选视频即可提交单节点编辑任务')
  ok(videoOnly.body.skills[0].desc.includes('e-existing') && videoOnly.body.skills[0].desc.includes('动态 立绘.MP4'), '视频节点记录现有目标和源路径')
  ok(videoOnly.message.includes('noname_copy_videos') && videoOnly.message.includes('动态立绘项:') && videoOnly.message.includes('必要挂载'), '视频单独编辑的确认说明和实现范围完整')
  ok(videoOnly.body.image === '' && videoOnly.message.includes('沿用现有静态立绘'), '未提供新静态图时保留已有回退')
  ok(['参考做法', '头像槽位', '换将、禁用或离场', '全屏技能视频', 'references/video-portrait.md'].every(part => videoOnly.message.includes(part)), '仅编辑视频也下发绑定、清理与非全屏参考')
  ok(videoOnly.message.includes('本次未填图片路径不代表缺图'), '编辑视频不因表单图片留空误报已有武将缺图')
  ok(videoOnly.message.includes('目标条目和播放挂载可能位于不同文件') && videoOnly.message.includes('每次写入传对应的 file 参数'), '编辑视频提示多文件挂载按所属文件读写')
  await toggle('使用视频作为动态立绘', false)
  ok(!findAll(n => n.props['data-nnk-field'] === 'portraitVideo').length && form().portraitVideo.includes('动态 立绘.MP4'), '关闭编辑视频选项时隐藏字段并保留草稿')
  await expectBlocked('至少填一项')
  await change('武将改动描述', '体力调整为 5')
  const editWithoutVideo = await submitTask('options-edit-no-video')
  ok(noCharacterOptions(editWithoutVideo) && editWithoutVideo.body.skills.length === 1 && editWithoutVideo.body.skills[0].name === '修改 e-existing', '取消视频仅去掉附加要求，仍可单独提交原有修改')
  ok(!editWithoutVideo.message.includes('删除视频') && !editWithoutVideo.message.includes('删除动态立绘'), '取消勾选不会生成删除已有视频的要求')
  await toggle('使用视频作为动态立绘', true)
  await change('动态立绘视频路径', ' ')
  await expectBlocked('动态立绘视频路径')
  await change('动态立绘视频路径', 'D:\\素材 文件\\图片.png')
  await expectBlocked('支持 MP4')
  await change('动态立绘视频路径', 'D:\\素材 文件\\动态 立绘.MP4')
  entrySelect().props.onChange({ target: { value: '' } })
  await flush()
  await expectBlocked('选择要修改的武将')
  entrySelect().props.onChange({ target: { value: 'e-existing' } })
  await flush()

  console.log('场景 15:视频节点不覆盖同名技能，卡牌编辑不携带视频')
  const pendingSkills = requests.filter(r => !r.answered && r.url.includes('/entry-skills') && r.url.includes('id=e-existing'))
  for (const request of pendingSkills) request.reply({ ok: true, skills: [{ id: 'skill-video-name', name: '视频动态立绘' }] })
  await flush()
  const sameNameSkill = checkbox('skill-video-name(视频动态立绘)')
  assert.ok(sameNameSkill, '已有同名技能显示在候选列表中')
  sameNameSkill.props.onChange()
  await flush()
  const note = findAll(n => n.type === 'input' && String(n.props.placeholder).startsWith('要改成什么'))[0]
  assert.ok(note, '已选技能可填写修改内容')
  note.props.onChange({ target: { value: '此技能每轮限一次' } })
  await flush()
  const collision = await submitTask('options-video-name-collision')
  ok(collision.body.skills.some(s => s.name === '视频动态立绘' && s.desc === '此技能每轮限一次') && collision.body.skills.some(s => s.name === '视频动态立绘 2' && s.desc.includes('e-existing')), '视频需求节点避开已有同名技能')
  ok(new Set(collision.body.skills.map(s => s.name)).size === collision.body.skills.length && collision.message.includes('- 视频动态立绘 2'), '节点名称唯一且随消息下发给 AI')
  clickRadio('类型card')
  await flush()
  req(r => r.url.includes('/entries') && r.url.includes('kind=card')).reply({ ok: true, entries: [{ id: 'e-card', name: '已有卡牌' }] })
  await flush()
  entrySelect().props.onChange({ target: { value: 'e-card' } })
  await flush()
  await change('卡牌改动描述', '调整牌面说明')
  ok(!checkbox('创建新势力') && !checkbox('使用视频作为动态立绘'), '卡牌编辑不显示武将视频与势力选项')
  const cardEdit = await submitTask('options-card-edit')
  ok(cardEdit.body.target.kind === 'card' && noCharacterOptions(cardEdit) && !cardEdit.body.skills.some(s => s.name.startsWith('视频动态立绘')), '卡牌编辑不提交视频路径或附加节点')

  console.log('\n全部通过:' + passed + ' 项')
} catch (err) {
  console.error('\n❌ 失败:', err && err.message || err)
  process.exit(1)
}

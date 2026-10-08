#!/usr/bin/env node
/**
 * noname-kit 行为单测:client.js 的「任务表单」NewTaskForm(真代码渲染,迷你 React)。
 * 运行:node scripts/test-client-form.mjs
 *
 * 背景(第 1 轮循环审计实测):表单里的竞态守卫原写成组件体内的 `var entrySeq = 0`,
 * 每次重渲染都会重建 → 守卫形同虚设。行为探针真跑出两个用户可见后果:
 *   ①快速切包 A→B 后,A 的迟到响应把条目列表整个换成 A 的;
 *   ②旧包的读取结果(约 N 行/写法提示、历史注意点条数)覆盖新包。
 * 修法=把判定挪进函数式更新里比对「当前状态 vs 请求参数」;本文件把它钉死。
 * 另锁:🎲 模式类型在编辑模式下不再渲染「目标」radio(手点「创建新」会产出
 * 「创建全新扩展包,目标文件夹当前不存在」却又是从已有列表选包的自相矛盾消息)。
 *
 * 渲染手法与 %TEMP%\nnk-ui-harness\probe.cjs 同源:从源码精确切出组件函数,
 * 喂迷你 React + 可控时序的 fetch 桩,跑状态机直到稳定。
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
const parts = ['h', 'e', 'textField', 'radioGroup', 'formGroup', 'NewTaskForm'].map((n) => extractFunction(src, n)).join('\n')
const makeFactory = new Function('return function (React, fetch, console) {\n' + parts + '\n return NewTaskForm;\n}')
const quiet = { error() {}, warn() {}, log() {} }

// ── 迷你 React(useState/useEffect,与 UI 测试台同款) ────────
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
const React = {
  createElement(t, p, ...c) { return { type: t, props: Object.assign({}, p, { children: c.flat() }) } },
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
const findAll = (pred) => walk(tree, []).filter(pred)
function clickRadio(name) {
  const el = findAll((n) => n.type === 'input' && n.props.type === 'radio' && n.props.name === name)[0]
  if (!el) throw new Error('找不到 radio ' + name)
  el.props.onChange()
}
/** 按 label 文本前缀找输入控件:label 的下一个兄弟节点里的 textarea/input。
 *  两种结构都吃:textField 的 div>{label,textarea},以及模式规则那种 label 与
 *  textarea 平级的裸数组。 */
const textOf = (n) => {
  const c = n.props && n.props.children
  return Array.isArray(c) ? c.join('') : String(c == null ? '' : c)
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
  const hist = req((r) => r.url.endsWith('/history'))
  assert.ok(hist, '切到编辑模式会拉扩展包列表')
  hist.reply({ extensions: [{ folder: 'A' }, { folder: 'B' }] })
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
  if (settingsReq) settingsReq.reply({ nonameDir: 'D:\\wms' })
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
  if (settingsReq2) settingsReq2.reply({ nonameDir: 'D:\\wms' })
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

  console.log('\n全部通过:' + passed + ' 项')
} catch (err) {
  console.error('\n❌ 失败:', err && err.message || err)
  process.exit(1)
}

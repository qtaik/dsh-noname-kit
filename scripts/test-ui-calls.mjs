#!/usr/bin/env node
/*
 * test-ui-calls.mjs —— 静态扫描 client.js 的 e()/h() 调用形态(零依赖,七套件同款风格)。
 *
 * 背景(实测白屏事故):内联样式写成 e('div','cls',{style:…},文本) 时,e 只吃
 * (tag, className, ...子节点),那个对象会被当子节点渲染 → React #31 → 整个浮窗
 * 被槽位吞成空白且无红字。同族变体:e(tag, {props}, kids) 会把 props 当 className
 * 字符串丢掉(样式/事件静默失效)。本测试把这两类形态钉死在源码层。
 *
 * 运行: node scripts/test-ui-calls.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, '..', 'client.js')
const src = readFileSync(CLIENT, 'utf8')

const DIV_LIKE = new Set(')]}'.split(''))
const REGEX_PREV = new Set('(,=:[!&|?{};+*-%<>~^'.split(''))

/**
 * 从 s[i] 起按 JS 词法切分,返回下一个"有效 token"结束后的下标。
 * 能跳过:行/块注释、单双引号字符串、模板字符串、正则字面量、括号嵌套。
 * 用于把 e()/h() 的实参列表安全地切开(字符串/正则里的逗号不参与切分)。
 */
function skipToken(s, i) {
  const ch = s[i]
  if (ch === '/' && s[i + 1] === '/') {
    const j = s.indexOf('\n', i)
    return j < 0 ? s.length : j
  }
  if (ch === '/' && s[i + 1] === '*') {
    const j = s.indexOf('*/', i + 2)
    return j < 0 ? s.length : j + 2
  }
  if (ch === '"' || ch === "'") {
    let j = i + 1
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue }
      if (s[j] === ch) break
      j++
    }
    return j + 1
  }
  if (ch === '`') {
    let j = i + 1
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue }
      if (s[j] === '`') break
      j++
    }
    return j + 1
  }
  return i + 1
}

/** 判断 s[i] 处的 '/' 是正则字面量起点(前一个有效字符是运算符/开括号等,或没有)。 */
function isRegexStart(s, i) {
  let k = i - 1
  while (k >= 0 && /\s/.test(s[k])) k--
  if (k < 0) return true
  return REGEX_PREV.has(s[k])
}

/** 跳过正则字面量(含字符类与转义)。 */
function skipRegex(s, i) {
  let j = i + 1
  let cls = false
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '[') cls = true
    else if (c === ']') cls = false
    else if (c === '/' && !cls) return j + 1
    else if (c === '\n') return j
    j++
  }
  return s.length
}

/** 从 '(' 后开始,按顶层逗号切分实参;字符串/正则/嵌套括号里的逗号不算。 */
function splitArgs(s, start) {
  let depth = 0
  let cur = ''
  const args = []
  let i = start
  while (i < s.length) {
    const ch = s[i]
    if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; i++ }
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === -1) { if (cur.trim()) args.push(cur.trim()); return args }
      cur += ch
      i++
    } else if (ch === ',' && depth === 0) {
      args.push(cur.trim()); cur = ''; i++
    } else if (ch === '/' && isRegexStart(s, i)) {
      const j = skipRegex(s, i)
      cur += s.slice(i, j)
      i = j
    } else {
      const j = skipToken(s, i)
      cur += s.slice(i, j)
      i = j
    }
  }
  return null
}

const PROPS_KEYS = ['style', 'onClick', 'onChange', 'onMouseDown', 'className', 'title', 'key', 'disabled', 'checked', 'value', 'href', 'placeholder', 'readOnly']
function topLevelKeys(objText) {
  const body = objText.trim()
  if (!body.startsWith('{') || !body.endsWith('}')) return []
  const inner = body.slice(1, -1)
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  const keys = []
  for (const p of parts) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(p)
    if (m) keys.push(m[1])
  }
  return keys
}

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) { console.log('  ✓ ' + name); pass++ } else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++ }
}

/** 扫描给定源码,返回问题列表 [{line, msg}] 与调用计数。 */
function scan(source) {
  const problems = []
  let eCount = 0
  let hCount = 0
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    // 跳过注释与字符串,避免把示例文本当代码
    if (ch === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) { i = skipToken(source, i); continue }
    if (ch === '"' || ch === "'" || ch === '`') { i = skipToken(source, i); continue }
    if ((ch === 'e' || ch === 'h') && source[i + 1] === '(') {
      const prev = source[i - 1] || ' '
      const isCall = !/[A-Za-z0-9_$.]/.test(prev)
      const isDef = /function\s+$/.test(source.slice(Math.max(0, i - 10), i))
      if (isCall && !isDef) {
        if (ch === 'e') eCount++; else hCount++
        const args = splitArgs(source, i + 2)
        const line = source.slice(0, i).split('\n').length
        if (args === null) { problems.push({ line, msg: '括号没配平' }); i += 2; continue }
        if (ch === 'e') {
          if (args.length >= 2) {
            const a2 = args[1].trim()
            if (a2.startsWith('{') && a2 !== '{}') {
              const keys = topLevelKeys(a2)
              if (keys.some((k) => PROPS_KEYS.includes(k))) problems.push({ line, msg: 'e() 第2参是 props 对象(键:' + keys.join(',') + '),该用 h()' })
            }
          }
          if (args.length >= 3) {
            const a3 = args[2].trim()
            if (a3.startsWith('{') && a3 !== '{}') problems.push({ line, msg: 'e() 第3参是对象(键:' + topLevelKeys(a3).join(',') + '),会被当子节点渲染 → React 崩' })
          }
        } else {
          if (args.length && args[0].trim().startsWith('{')) problems.push({ line, msg: 'h() 第1参是对象字面量,应为标签名或组件' })
        }
        i += 2
        continue
      }
    }
    i++
  }
  return { problems, eCount, hCount }
}

console.log('e()/h() 调用形态扫描')
const { problems, eCount, hCount } = scan(src)

check('client.js:e() 没有「第2参是 props 对象」的形态', !problems.some((p) => p.msg.includes('第2参')),
  problems.filter((p) => p.msg.includes('第2参')).map((p) => 'L' + p.line).join(','))
check('client.js:e() 没有「第3参是对象」的形态', !problems.some((p) => p.msg.includes('第3参')),
  problems.filter((p) => p.msg.includes('第3参')).map((p) => 'L' + p.line).join(','))
check('client.js:h() 第1参都是标签名或组件', !problems.some((p) => p.msg.includes('h() 第1参')),
  problems.filter((p) => p.msg.includes('h() 第1参')).map((p) => 'L' + p.line).join(','))
check('client.js:全库零命中', problems.length === 0, problems.map((p) => 'L' + p.line + ':' + p.msg).join(' | '))
check('扫描量合理(e>100, h>100)', eCount > 100 && hCount > 100, 'e=' + eCount + ' h=' + hCount)

/* 自证:构造手滑样本,扫描器必须抓到(防扫描器本身失效) */
{
  const sample = [
    "var a = e('div', 'nnk-hint', { style: { color: 'red' } }, 'x');",
    "var b = e('div', { className: 'a' }, 'y');",
    "var c = h({ style: {} }, null);",
    "var d = e('div', 'nnk-hint', '正常调用');",              // 合法:不应命中
    "var re = /[,，;；\\n]/; var s2 = e('div', 'cls', re.test(x) ? 'a,b' : 'c');",  // 正则里有逗号:不应误伤
    "var t = e('div', 'cls', '文本里 e(\\'x\\', {y:1}) 不算调用');",  // 字符串里的示例:不应命中
  ].join('\n')
  const r = scan(sample)
  const hitLines = r.problems.map((p) => p.line).sort((a, b) => a - b)
  check('自证:3 处手滑样本全被抓到且只抓这 3 处', r.problems.length === 3 && String(hitLines) === '1,2,3',
    '命中 ' + r.problems.length + ' 处(行 ' + hitLines.join(',') + ')')
}

console.log('\n' + (fail === 0 ? '全部通过:' + pass + ' 项' : '失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项'))
if (fail > 0) process.exit(1)

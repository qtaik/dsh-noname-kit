/**
 * noname-kit 锚点区块:区块化读写的文本核心(纯函数,无 IO)。
 *
 * 锚点格式(纯注释行,引擎忽略):
 *   //#noname-kit-begin skill:cs_tianfa
 *   cs_tianfa: { ... },        ← 区块内文(含结尾逗号)
 *   //#noname-kit-end skill:cs_tianfa
 *
 * 无锚存量文件支持「虚拟区块」:用字符串感知花括号配对现场划分
 * skill/translate 区段,只读使用(目录/按块读/保真校验);
 * 区块化写入仍需真实锚点(由骨架模板在首写时产生,或走迁移)。
 */

// 行尾允许 \r:CRLF 文件里锚点行可能带回车(编辑器/git autocrlf 会把整个文件转 CRLF),
// 行尾锚漏了 \r 就会认不出锚点、以为文件没锚过
const BEGIN_RE = /^[ \t]*\/\/#noname-kit-begin\s+([\w]+):([\w-]+)[ \t\r]*$/
const END_RE = /^[ \t]*\/\/#noname-kit-end\s+([\w]+):([\w-]+)[ \t\r]*$/
const ANCHOR_LINE_RE = /^[ \t]*\/\/#noname-kit-(begin|end)\s+/

function anchorBegin(kind, id) { return `//#noname-kit-begin ${kind}:${id}` }
function anchorEnd(kind, id) { return `//#noname-kit-end ${kind}:${id}` }

/**
 * 字符串感知的花括号配对:跳过单引号/双引号/模板字符串(含 ${} 插值,
 * 递归按代码层处理)与 //、/* 注释,返回与 text[openIndex] 配对的 '}' 下标。
 * 找不到返回 -1。正则字面量里的引号/花括号是已知盲区(实践中罕见,
 * 失败表现为提取失败并回退全文模式,不会写坏文件)。
 */
export function matchBrace(text, openIndex) {
  if (text[openIndex] !== '{') return -1
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
    else if (c === "'" || c === '"' || c === '`') i = skipString(text, i)
    else if (c === '/' && text[i + 1] === '/') i = skipLineComment(text, i)
    else if (c === '/' && text[i + 1] === '*') i = skipBlockComment(text, i)
  }
  return -1
}

function skipString(text, i) {
  const q = text[i]
  i++
  for (; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { i++; continue }
    if (q === '`' && c === '$' && text[i + 1] === '{') {
      const close = matchBrace(text, i + 1)
      i = close >= 0 ? close : text.length
      continue
    }
    if (c === q) return i
  }
  return i
}

function skipLineComment(text, i) {
  while (i < text.length && text[i] !== '\n') i++
  return i
}

function skipBlockComment(text, i) {
  const end = text.indexOf('*/', i + 2)
  return end >= 0 ? end + 1 : text.length
}

/** 定位顶层区段(如 skill/translate)的 { 与配对 };多个候选取跨度最大者(避开 package 描述里的同名嵌套)。 */
export function findSection(code, name) {
  const re = new RegExp('(?:^|[\\n{,;])\\s*' + name + '\\s*:\\s*\\{', 'g')
  let m
  let best = null
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index + m[0].length - 1)
    const close = matchBrace(code, open)
    if (close < 0) continue
    if (!best || close - open > best.close - best.open) best = { open, close }
    re.lastIndex = close
  }
  return best
}

/**
 * 找出所有同名区段(含嵌套,如 package.skill 与 package.skill.skill)。
 * 虚拟划分用:无名杀扩展的布局不止一种,技能/翻译可能藏在任意层级。
 * 导出给 validate.js 的 ID 收集共用(字符串感知,兼容裸键/引号键/任意嵌套)。
 */
export function findAllSections(code, name) {
  const re = new RegExp('(?:^|[\\n{,;])\\s*' + name + '\\s*:\\s*\\{', 'g')
  const out = []
  let m
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index + m[0].length - 1)
    const close = matchBrace(code, open)
    if (close < 0) continue
    out.push({ open, close })
    re.lastIndex = open + 1
  }
  return out
}

/** 结构键黑名单:这些名字是布局骨架,不是内容 ID,绝不当作区块。
 * 导出给 validate.js 的 ID 收集共用(容器套容器如 package.card.card 会让
 * card/character/skill 被误收为内容 ID,污染前缀检查与防丢护栏)。 */
export const STRUCTURAL_NAMES = new Set([
  'skill', 'translate', 'character', 'card', 'package', 'help', 'config',
  'content', 'precontent', 'arenaReady', 'name', 'author', 'version',
  'editable', 'connect', 'type', 'list',
])

/** 枚举区段内 depth-1 的属性:[{name, start(名字起点), end(配对}下标)}]。
 * 导出给 validate.js 的 ID 收集共用。 */
export function sectionProperties(code, open, close) {
  const props = []
  let i = open + 1
  let depth = 0
  while (i < close) {
    const c = code[i]
    if (depth > 0) {
      // 区块内部:字符串/注释不构成新属性,括号计深度
      if (c === "'" || c === '"' || c === '`') { i = skipString(code, i); continue }
      if (c === '/' && code[i + 1] === '/') { i = skipLineComment(code, i); continue }
      if (c === '/' && code[i + 1] === '*') { i = skipBlockComment(code, i); continue }
      if (c === '{' || c === '[' || c === '(') { depth++; i++; continue }
      if (c === '}' || c === ']' || c === ')') { depth--; i++; continue }
      i++
      continue
    }
    // depth 0:注释跳过;属性起点(裸名或带引号名)+ 冒号
    if (c === '/' && code[i + 1] === '/') { i = skipLineComment(code, i); continue }
    if (c === '/' && code[i + 1] === '*') { i = skipBlockComment(code, i); continue }
    if (/[A-Za-z_$"']/.test(c)) {
      const nm = /^(["'])([\w-]+)\1\s*:|^([A-Za-z_$][\w$]*)\s*:/.exec(code.slice(i, close + 1))
      if (!nm) { i++; continue }
      const nameStart = i
      const name = nm[2] || nm[3]
      let j = i + nm[0].length
      while (j < close && /\s/.test(code[j])) j++
      let end
      if (code[j] === '{') end = matchBrace(code, j)
      else if (code[j] === '[') end = matchBracket(code, j)
      else {
        // 字面量值:扫到 depth-1 的逗号或区段收口为止,再回退尾随空白/逗号
        // (修复:最后一个条目没有逗号时,值扫描曾越过区段收口导致块尾定位越界)
        let d = 0
        let k = j
        for (; k < close; k++) {
          const ch = code[k]
          if (ch === "'" || ch === '"' || ch === '`') { k = skipString(code, k); continue }
          if (d === 0 && ch === ',') break
          if (ch === '{' || ch === '[' || ch === '(') d++
          else if (ch === '}' || ch === ']' || ch === ')') {
            if (d === 0) break
            d--
          }
        }
        let e2 = k - 1
        while (e2 > j && /[\s,]/.test(code[e2])) e2--
        end = e2
      }
      if (end < 0 || end > close) { i++; continue }
      props.push({ name, start: nameStart, end })
      i = end + 1
      continue
    }
    i++
  }
  return props
}

function matchBracket(text, openIndex) {
  if (text[openIndex] !== '[') return -1
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) return i }
    else if (c === "'" || c === '"' || c === '`') i = skipString(text, i)
  }
  return -1
}

/** 扫描锚点区块(按文本顺序):[{key, kind, id, start, end, innerStart, innerEnd, text}]。 */
export function scanAnchored(code) {
  const lines = code.split('\n')
  const out = []
  let cur = null
  let offset = 0
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (cur === null) {
      const m = BEGIN_RE.exec(line)
      if (m) {
        cur = { key: m[1] + ':' + m[2], kind: m[1], id: m[2], start: offset, innerStart: offset + line.length + 1 }
      }
    } else {
      const m = END_RE.exec(line)
      if (m && m[1] + ':' + m[2] === cur.key) {
        const innerEnd = offset
        const end = offset + line.length + 1
        out.push({ ...cur, innerEnd, end })
        cur = null
      }
    }
    offset += line.length + 1
  }
  for (const b of out) b.text = code.slice(b.innerStart, b.innerEnd)
  return out
}

export function hasAnchors(code) { return scanAnchored(code).length > 0 }

/** 区块目录:锚点优先;无锚时虚拟划分(skill 区段属性 + translate 条目分组)。 */
export function scanBlocks(code) {
  const anchored = scanAnchored(code)
  if (anchored.length) {
    return {
      anchored: true,
      blocks: anchored.map((b) => ({ key: b.key, kind: b.kind, id: b.id, lines: b.text.split('\n').length, virtual: false })),
    }
  }
  const blocks = []
  for (const b of virtualSkillBlocks(code)) blocks.push({ key: b.key, kind: 'skill', id: b.id, lines: b.text.split('\n').length, virtual: true })
  for (const b of virtualTranslateBlocks(code)) blocks.push({ key: b.key, kind: 'translate', id: b.id, lines: b.text.split('\n').length, virtual: true })
  return { anchored: false, blocks }
}

/** 按块取内文:key 形如 'skill:cs_tianfa'。锚点优先,退回虚拟。 */
export function extractBlock(code, kind, id) {
  const key = kind + ':' + id
  const hit = scanAnchored(code).find((b) => b.key === key)
  if (hit) return hit.text
  if (kind === 'skill') {
    const b = virtualSkillBlocks(code).find((x) => x.id === id)
    return b ? b.text : null
  }
  if (kind === 'translate') {
    const b = virtualTranslateBlocks(code).find((x) => x.id === id)
    return b ? b.text : null
  }
  return null
}

/** 无锚文件:所有 skill 区段(含嵌套如 package.skill.skill)的 depth-1 属性逐个成块。 */
export function virtualSkillBlocks(code) {
  const out = []
  const seen = new Set()
  for (const sec of findAllSections(code, 'skill')) {
    for (const p of sectionProperties(code, sec.open, sec.close)) {
      if (code[p.end] !== '}') continue
      if (STRUCTURAL_NAMES.has(p.name)) continue
      if (seen.has(p.name)) continue
      seen.add(p.name)
      out.push({ key: 'skill:' + p.name, kind: 'skill', id: p.name, start: p.start, end: p.end, text: code.slice(p.start, p.end + 1) })
    }
  }
  return out
}

/** 无锚文件:所有 translate 区段的条目按基础 ID 分组(x 与 x_info 同块),按区段去重。 */
export function virtualTranslateBlocks(code) {
  const out = []
  const seen = new Set()
  for (const sec of findAllSections(code, 'translate')) {
    const groups = new Map()
    for (const p of sectionProperties(code, sec.open, sec.close)) {
      if (code[p.end] === '}') continue
      const base = p.name.replace(/_info$/, '')
      const g = groups.get(base)
      if (g) { g.end = p.end; g.text = code.slice(g.start, p.end + 1) }
      else groups.set(base, { key: 'translate:' + base, kind: 'translate', id: base, start: p.start, end: p.end, text: code.slice(p.start, p.end + 1) })
    }
    for (const b of groups.values()) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      out.push(b)
    }
  }
  return out
}

function normalizeBlockCode(kind, raw) {
  let code = String(raw || '').replace(/\s+$/, '')
  if (kind === 'skill' || kind === 'translate') {
    if (!code.endsWith(',')) code += ','
  }
  return code
}

function anchorWrap(key, body) {
  const [kind, id] = key.split(':')
  return anchorBegin(kind, id) + '\n' + body + '\n' + anchorEnd(kind, id)
}

function insertPoint(code, kind) {
  const all = scanAnchored(code).filter((b) => b.kind === kind)
  if (all.length) return all[all.length - 1].end
  const sec = findSection(code, kind)
  if (!sec) return null
  const nl = code.indexOf('\n', sec.open)
  return nl >= 0 ? nl + 1 : null
}

/**
 * 区块组装:把提交的块替换/插入进旧文件,其余文本逐字节保留。
 * 纯文本操作;任何错误整单拒绝并返回原码。
 * @returns {{code:string, applied:string[], deleted:string[], errors:string[]}}
 */
export function assembleBlocks(oldCode, blocks = [], edits = [], deletes = []) {
  const errors = []
  const applied = []
  const deleted = []
  let code = oldCode

  // 1) 删除声明必须存在
  const presentKeys = new Set(scanAnchored(code).map((b) => b.key))
  for (const key of deletes) {
    if (!presentKeys.has(key)) errors.push(`要删除的区块「${key}」不存在(现存区块可用 listBlocks 查看)`)
  }
  // 2) 提交块查重
  const seen = new Set()
  for (const item of blocks) {
    const key = item.kind + ':' + item.id
    if (seen.has(key)) errors.push(`区块「${key}」重复提交,一次只提交一份`)
    seen.add(key)
  }
  if (errors.length) return { code: oldCode, applied, deleted, errors }

  // 3) 删除区块(从后往前,偏移不失效)
  const delRegions = scanAnchored(code).filter((b) => deletes.includes(b.key)).sort((a, b) => b.start - a.start)
  for (const r of delRegions) {
    code = code.slice(0, r.start) + code.slice(r.end)
    deleted.push(r.key)
  }

  // 4) 替换已有块(从后往前)
  const cur = new Map(scanAnchored(code).map((b) => [b.key, b]))
  const replacing = []
  const inserting = []
  for (const item of blocks) {
    const key = item.kind + ':' + item.id
    const wrapped = anchorWrap(key, normalizeBlockCode(item.kind, item.code))
    const hit = cur.get(key)
    if (hit) replacing.push({ key, wrapped, region: hit })
    else inserting.push({ key, kind: item.kind, wrapped })
  }
  for (const r of replacing.sort((a, b) => b.region.start - a.region.start)) {
    // 区间 [start,end) 含末尾换行;wrapped 自身不带,补一个防前后锚点粘连
    code = code.slice(0, r.region.start) + r.wrapped + '\n' + code.slice(r.region.end)
    applied.push(r.key)
  }

  // 5) 插入新块:插到同类最后一个块之后(区段缺失则报错)
  for (const kind of ['skill', 'translate']) {
    const list = inserting.filter((x) => x.kind === kind)
    if (!list.length) continue
    const at = insertPoint(code, kind)
    if (at == null) { errors.push(`文件中找不到 ${kind}: { 区段,无法插入新块——请用全文模式补充骨架后重试`); continue }
    code = code.slice(0, at) + list.map((x) => x.wrapped).join('\n') + '\n' + code.slice(at)
    for (const x of list) applied.push(x.key)
  }

  // 6) 精确小补丁:find 必须恰好命中一次
  for (const e of edits) {
    let count = 0
    let idx = -1
    let pos = 0
    while ((pos = code.indexOf(e.find, pos)) >= 0) { count++; idx = pos; pos += e.find.length }
    if (count === 0) errors.push(`edits:未找到目标文本(必须从当前代码原样复制):「${e.find.slice(0, 60)}」`)
    else if (count > 1) errors.push(`edits:目标文本出现 ${count} 次,无法唯一定位:「${e.find.slice(0, 60)}」`)
  }
  if (errors.length) return { code: oldCode, applied, deleted, errors }
  for (const e of edits) {
    const at = code.indexOf(e.find)
    code = code.slice(0, at) + e.replace + code.slice(at + e.find.length)
  }
  return { code, applied, deleted, errors }
}

/**
 * 保真校验(全文模式写存量包用):scope 外的 skill 区块必须逐字节一致
 * (按行尾空白/回车归一后比较,避免无害差异误报)。
 */
export function checkFidelity(oldCode, newCode, scopeIds = []) {
  const scope = new Set(scopeIds)
  const newBlocks = new Map(virtualSkillBlocks(newCode).map((b) => [b.id, b]))
  const changed = []
  for (const b of virtualSkillBlocks(oldCode)) {
    if (scope.has(b.id)) continue
    const nb = newBlocks.get(b.id)
    if (!nb || normalizeForCompare(b.text) !== normalizeForCompare(nb.text)) changed.push(b.id)
  }
  return { ok: changed.length === 0, changed }
}

function normalizeForCompare(code) {
  return code.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\r/g, '')
}

/**
 * 锚点化迁移:对无锚老文件插入锚点注释行,一个代码字符不动。
 * 自检:剥掉锚点行后必须与原文逐行一致,否则放弃。
 */
export function migrateCode(oldCode) {
  // 幂等:已锚点文件先剥旧锚再重扫(锚点规范升级后直接重新建立索引即可)
  const base = scanAnchored(oldCode).length ? stripAnchors(oldCode) : oldCode
  const skills = virtualSkillBlocks(base)
  const translates = virtualTranslateBlocks(base)
  if (!skills.length && !translates.length) {
    return { error: '未能识别出可锚定的区块(skill/translate 区段)——该文件可能是非常规格式,请走全文模式处理。' }
  }
  // 按位置聚合插入(同一边界:前块 end 锚先于后块 begin 锚),再从后往前落位
  const byAt = new Map()
  const addAt = function (at, text) {
    const parts = byAt.get(at) || []
    if (parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
    parts.push(text)
    byAt.set(at, parts)
  }
  let inserted = 0
  let commas = 0
  for (const b of [...skills, ...translates]) {
    const ls = base.lastIndexOf('\n', b.start) + 1
    let le = b.end
    while (le < base.length && base[le] !== '\n') le++
    if (le < base.length) le++
    addAt(ls, anchorBegin(b.kind, b.id) + '\n')
    addAt(le, anchorEnd(b.kind, b.id) + '\n')
    inserted += 2
    // 区块收尾补逗号:end 锚前最后一个内容行若不以 , 结尾则补上,
    // 保证后续往该位置之后插入新区块不会产生语法错误。
    // 跳过空白时必须带上 \r —— CRLF 文件行尾是 ",\r",漏了 \r 就会把回车当成
    // "最后一个字符",于是给每一行都误补一个逗号(实测:真实 CRLF 扩展 523 个区块
    // 全被误补,逗号落到下一行行首 → Unexpected token ',')
    let last = le - 1
    while (last > ls && /[ \t\r\n]/.test(base[last])) last--
    if (base[last] !== ',') { addAt(last + 1, ','); commas++ }
  }
  let code = base
  for (const at of [...byAt.keys()].sort((a, b) => b - a)) {
    code = code.slice(0, at) + byAt.get(at).join('') + code.slice(at)
  }
  // 自检:剥锚点 + 行尾逗号归一后,必须与原文件一致
  // (锚点行与收尾逗号是迁移仅有的两类合法差异;代码被移动/改写都会在此暴露)
  if (normalizeForCompare(stripEolCommas(stripAnchors(code))) !== normalizeForCompare(stripEolCommas(base))) {
    return { error: '锚点插入自检失败(除锚点行与收尾逗号外内容发生变化),已放弃写入。' }
  }
  return { code, inserted, commas, blocks: skills.length + translates.length }
}

/** 迁移自检用:剥掉行尾逗号(迁移合法差异=新增锚点行与收尾逗号;CRLF 行尾的 \r 一并剥)。 */
function stripEolCommas(code) {
  return code.split('\n').map((l) => l.replace(/[ \t\r]*$/, '').replace(/,$/, '')).join('\n')
}

/** 剥掉全部锚点注释行(迁移自检用)。 */
export function stripAnchors(code) {
  return code.split('\n').filter((l) => !ANCHOR_LINE_RE.test(l)).join('\n')
}

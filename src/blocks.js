/**
 * noname-kit 锚点区块:区块化读写的文本核心(纯函数,无 IO)。
 *
 * 锚点格式(纯注释行,引擎忽略):
 *   //#noname-kit-begin skill:cs_tianfa
 *   cs_tianfa: { ... },        ← 区块内文(含结尾逗号)
 *   //#noname-kit-end skill:cs_tianfa
 *
 * 无锚存量文件支持「虚拟区块」:静态解析内容表的真实属性位置,
 * 用于目录、按块读取与保真校验;
 * 区块化写入仍需真实锚点(由骨架模板在首写时产生,或走迁移)。
 */

// 行尾允许 \r:CRLF 文件里锚点行可能带回车(编辑器/git autocrlf 会把整个文件转 CRLF),
// 行尾锚漏了 \r 就会认不出锚点、以为文件没锚过
import { sourceSections, sourceProperties, sourceStructure, commentTrivia } from './module-parser.js'
import { ENTRY_ID_SOURCE, isEntryId } from './entry-id.js'

const BEGIN_RE = new RegExp('^[ \\t]*//#noname-kit-begin\\s+([\\w]+):(' + ENTRY_ID_SOURCE + ')[ \\t\\r]*$', 'u')
const END_RE = new RegExp('^[ \\t]*//#noname-kit-end\\s+([\\w]+):(' + ENTRY_ID_SOURCE + ')[ \\t\\r]*$', 'u')
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

/** Enumerate static descriptor sections and top-level singular/plural tables. */
export function findAllSections(code, name, options = {}) { return sourceSections(code, name, options) }

/** 结构键黑名单:这些名字是布局骨架,不是内容 ID,绝不当作区块。
 * 导出给 validate.js 的 ID 收集共用(容器套容器如 package.card.card 会让
 * card/character/skill 被误收为内容 ID,污染前缀检查与防丢护栏)。 */
export const STRUCTURAL_NAMES = new Set([
  'skill', 'translate', 'character', 'card', 'package', 'help', 'config',
  'content', 'precontent', 'arenaReady', 'name', 'author', 'version',
  'editable', 'connect', 'type', 'list',
])

/** Direct, static properties with exact source offsets. */
export function sectionProperties(code, open, close, options = {}) { return sourceProperties(code, open, close, options) }

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
      if (m && isEntryId(m[2])) {
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

/** Only unique real entries bounded by genuine comment markers are writable. */
export function scanEffectiveAnchored(code, options = {}) {
  const raw = scanAnchored(code)
  const comments = new Set(sourceStructure(code, options).comments.filter(c => c.type === 'Line').map(c => c.start))
  const commentAt = at => comments.has(at + (code.slice(at).match(/^[ \t]*/)?.[0].length || 0))
  const entries = [...CONTENT_KINDS, 'translate'].flatMap(kind => virtualCandidates(code, kind, options))
  return raw.filter(b => {
    const hits = entries.filter(x => x.key === b.key)
    if (hits.length !== 1 || raw.filter(x => x.key === b.key).length !== 1) return false
    const entry = hits[0]
    if (entry.readOnly || entry.contiguous === false || entry.start < b.innerStart || entry.end >= b.innerEnd) return false
    if (!commentAt(b.start) || !commentAt(b.innerEnd) || b.text.split('\n').some(l => ANCHOR_LINE_RE.test(l))) return false
    return commentTrivia(code, b.innerStart, entry.start, false, options)
      && commentTrivia(code, entry.end + 1, b.innerEnd, true, options)
  })
}

/** Merge validated anchors and remaining real entries, including partially indexed files. */
export function scanBlocks(code, options = {}) {
  const anchored = new Map(scanEffectiveAnchored(code, options).map(b => [b.key, b]))
  const blocks = []
  for (const kind of [...CONTENT_KINDS, 'translate']) {
    const candidates = virtualCandidates(code, kind, options), counts = new Map()
    for (const b of candidates) counts.set(b.key, (counts.get(b.key) || 0) + 1)
    for (const b of candidates) {
      const ambiguous = !!b.ambiguous || counts.get(b.key) > 1
      const hit = !ambiguous && anchored.get(b.key)
      blocks.push({ key: b.key, kind: b.kind, id: b.id, lines: (hit?.text || b.text).split('\n').length, virtual: !hit, ...(ambiguous ? { ambiguous: true, start: b.start, end: b.end } : {}) })
    }
  }
  const model = sourceStructure(code, options)
  return { anchored: anchored.size > 0, blocks, ...(model.parseError ? { error: model.parseError } : {}) }
}

/** Read true entries; invalid legacy marker keys cannot expose nested configuration. */
export function extractBlock(code, kind, id, options = {}) {
  const key = kind + ':' + id
  const choices = virtualCandidates(code, kind, options).filter(x => x.id === id)
  if (choices.length !== 1 || choices[0].ambiguous) return null
  const hit = scanEffectiveAnchored(code, options).find(b => b.key === key)
  return hit ? hit.text : choices[0].text
}

/** 内容块种类:skill / card / character 三种条目形状相同(区段: { 名字: {...} }),
 *  translate 有 name+desc 合并逻辑、单独处理。 */
export const CONTENT_KINDS = ['skill', 'card', 'character']

function virtualCandidates(code, kind, options = {}) {
  const out = []
  for (const sec of findAllSections(code, kind, options)) {
    const props = sectionProperties(code, sec.open, sec.close, options)
    if (kind !== 'translate') {
      for (const p of props) {
        const types = kind === 'skill' ? ['ObjectExpression'] : ['ObjectExpression', 'ArrayExpression', 'NewExpression']
        if (!isEntryId(p.name) || STRUCTURAL_NAMES.has(p.name) || !types.includes(p.valueType)) continue
        if (p.valueType === 'NewExpression' && !(kind === 'character' && p.readOnly && p.characterConstructor)) continue
        out.push({ key: kind + ':' + p.name, kind, id: p.name, start: p.start, end: p.end, readOnly: !!(p.readOnly || p.indirect), skillIds: p.skillIds, skillsDynamic: p.skillsDynamic, text: code.slice(p.start, p.end + 1) })
      }
      continue
    }
    const groups = new Map()
    for (const [index, p] of props.entries()) {
      if (!isEntryId(p.name) || p.valueType === 'ObjectExpression') continue
      const id = p.name.replace(/_info$/, '')
      if (!isEntryId(id)) continue
      if (!groups.has(id)) groups.set(id, [])
      groups.get(id).push({ ...p, index })
    }
    for (const [id, parts] of groups) {
      const start = parts[0].start, end = parts[parts.length - 1].end
      const contiguous = parts.every((p, i) => i === 0 || p.index === parts[i - 1].index + 1)
      const ambiguous = new Set(parts.map(p => p.name)).size !== parts.length
      out.push({ key: 'translate:' + id, kind, id, start, end, contiguous, ambiguous, readOnly: ambiguous || parts.some(p => p.readOnly || p.indirect),
        text: contiguous ? code.slice(start, end + 1) : parts.map(p => code.slice(p.start, p.end + 1)).join(',\n') })
    }
  }
  return out
}

function uniqueVirtual(code, kind, options = {}) {
  const seen = new Set()
  return virtualCandidates(code, kind, options).filter(b => !seen.has(b.key) && seen.add(b.key))
}
export function virtualSkillBlocks(code, options = {}) { return uniqueVirtual(code, 'skill', options) }
export function virtualCardBlocks(code, options = {}) { return uniqueVirtual(code, 'card', options) }
export function virtualCharacterBlocks(code, options = {}) { return uniqueVirtual(code, 'character', options) }
export function virtualTranslateBlocks(code, options = {}) { return uniqueVirtual(code, 'translate', options) }
export function virtualBlocks(code, kind, options = {}) { return uniqueVirtual(code, kind, options) }

function normalizeBlockCode(kind, raw) {
  let code = String(raw || '').replace(/\s+$/, '')
  if (CONTENT_KINDS.includes(kind) || kind === 'translate') {
    if (!code.endsWith(',')) code += ','
  }
  return code
}

function anchorWrap(key, body) {
  const [kind, id] = key.split(':')
  return anchorBegin(kind, id) + '\n' + body + '\n' + anchorEnd(kind, id)
}

function insertPoint(code, kind, options = {}) {
  const all = scanEffectiveAnchored(code, options).filter((b) => b.kind === kind)
  if (all.length) {
    // 按区段归属统计同 kind 的锚点，将新块插到锚点最多的主体区段末尾；无法定位区段时使用该 kind 的最后一个锚点。
    const secs = findAllSections(code, kind, options)
    const bySec = new Map()
    for (const b of all) {
      const sec = secs.filter((s) => b.start > s.open && b.start < s.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))[0]
      if (!sec) continue
      if (!bySec.has(sec)) bySec.set(sec, [])
      bySec.get(sec).push(b)
    }
    if (bySec.size) {
      let bestBlocks = null
      let bestCount = -1
      for (const blocks of bySec.values()) {
        if (blocks.length > bestCount) { bestBlocks = blocks; bestCount = blocks.length }
        else if (blocks.length === bestCount) bestBlocks = null
      }
      return bestBlocks ? bestBlocks[bestBlocks.length - 1].end : null
    }
    return all[all.length - 1].end
  }
  // 无锚时:挑"真正装着条目"的那个同名区段插入。嵌套布局(老式扩展常见的
  // card:{ card:{…} })里外层容器只有一个同名骨架键、条目全在内层,插到外层
  // 会让新条目挂到错误的对象层级上。
  let best = null
  let bestCount = -1
  const secs = findAllSections(code, kind, options)
  for (const sec of secs) {
    if (secs.some(inner => inner.open > sec.open && inner.close < sec.close)) continue
    const count = sectionProperties(code, sec.open, sec.close, options).filter((p) => !STRUCTURAL_NAMES.has(p.name)).length
    if (count > bestCount) { best = sec; bestCount = count }
    else if (count === bestCount) best = null
  }
  if (!best) return null
  const nl = code.indexOf('\n', best.open)
  return nl >= 0 && nl < best.close && commentTrivia(code, best.open + 1, nl, false, options) ? nl + 1 : null
}

/**
 * 区块组装:把提交的块替换/插入进旧文件,其余文本逐字节保留。
 * 纯文本操作;任何错误整单拒绝并返回原码。
 * @returns {{code:string, applied:string[], deleted:string[], errors:string[]}}
 */
export function assembleBlocks(oldCode, blocks = [], edits = [], deletes = [], options = {}) {
  const errors = []
  const applied = []
  const deleted = []
  let code = oldCode

  const raw = scanAnchored(oldCode)
  const effective = scanEffectiveAnchored(oldCode, options)
  const real = [...CONTENT_KINDS, 'translate'].flatMap(kind => virtualCandidates(oldCode, kind, options))
  const invalid = raw.filter(b => !effective.some(x => x.start === b.start && x.end === b.end))
  for (const item of blocks) {
    if (!item || ![...CONTENT_KINDS, 'translate'].includes(item.kind) || !isEntryId(item.id)) errors.push('区块种类或 ID 格式无效')
  }
  for (const key of deletes) {
    const parts = typeof key === 'string' ? key.split(':') : []
    if (parts.length !== 2 || ![...CONTENT_KINDS, 'translate'].includes(parts[0]) || !isEntryId(parts[1])) errors.push('删除区块键格式无效')
  }
  if (errors.length) return { code: oldCode, applied, deleted, errors }
  const targets = [...deletes, ...blocks.map(item => item.kind + ':' + item.id)]
  for (const key of targets) {
    const hit = effective.find(b => b.key === key)
    const entries = real.filter(b => b.key === key)
    if (invalid.some(b => b.key === key || entries.some(e => b.start <= e.end && b.end > e.start))) {
      errors.push('区块「' + key + '」涉及无效旧索引,请先重新建立区块索引')
    } else if (!hit && entries.length) {
      errors.push('区块「' + key + '」已存在但没有唯一有效索引,请先重新建立区块索引')
    }
  }

  // 1) 删除声明必须存在
  const presentKeys = new Set(scanEffectiveAnchored(code, options).map((b) => b.key))
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
  const delRegions = scanEffectiveAnchored(code, options).filter((b) => deletes.includes(b.key)).sort((a, b) => b.start - a.start)
  for (const r of delRegions) {
    code = code.slice(0, r.start) + code.slice(r.end)
    deleted.push(r.key)
  }

  // 4) 替换已有块(从后往前)
  const cur = new Map(scanEffectiveAnchored(code, options).map((b) => [b.key, b]))
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
  for (const kind of [...CONTENT_KINDS, 'translate']) {
    const list = inserting.filter((x) => x.kind === kind)
    if (!list.length) continue
    const at = insertPoint(code, kind, options)
    if (at == null) { errors.push(`文件中找不到唯一安全的 ${kind} 插入位置,请核对目标文件和区块索引,或使用唯一原文 edits`); continue }
    code = code.slice(0, at) + list.map((x) => x.wrapped).join('\n') + '\n' + code.slice(at)
    for (const x of list) applied.push(x.key)
  }

  // 6) 按提交顺序校验并应用精确补丁;任一失败整单返回原文。
  for (const e of edits) {
    if (typeof e?.find !== 'string' || !e.find || typeof e.replace !== 'string') {
      errors.push('edits:find 必须是非空原文,replace 必须是字符串')
      continue
    }
    let count = 0
    let idx = -1
    let pos = 0
    while ((pos = code.indexOf(e.find, pos)) >= 0) { count++; idx = pos; pos += e.find.length }
    if (count === 0) errors.push(`edits:未找到目标文本(必须从当前代码原样复制):「${e.find.slice(0, 60)}」`)
    else if (count > 1) errors.push(`edits:目标文本出现 ${count} 次,无法唯一定位:「${e.find.slice(0, 60)}」`)
    else code = code.slice(0, idx) + e.replace + code.slice(idx + e.find.length)
  }
  if (blocks.length) {
    const indexed = new Set(scanEffectiveAnchored(code, options).map(b => b.key))
    for (const item of blocks) {
      const key = item.kind + ':' + item.id
      if (!indexed.has(key)) errors.push('区块「' + key + '」未形成唯一有效索引,已放弃写入')
    }
  }
  if (errors.length) return { code: oldCode, applied: [], deleted: [], errors }
  return { code, applied, deleted, errors }
}

/**
 * 全文覆盖只允许已存在、唯一的内容条目改变。其余全文(含 imports、precontent、
 * 骨架、注释及行尾)原样比较。不把非连续翻译条目之间的文本纳入授权范围。
 * bare ID 兼容旧调用;kind:id 可缩小到单种条目。添加/删除/歧义使用区块或精确 edits。
 */
export function checkFidelity(oldCode, newCode, scopeIds = [], options = {}) {
  if (!Array.isArray(scopeIds) || scopeIds.some((id) => {
    if (typeof id !== 'string') return true
    const parts = id.split(':')
    return parts.length === 1 ? !isEntryId(id)
      : parts.length !== 2 || ![...CONTENT_KINDS, 'translate'].includes(parts[0]) || !isEntryId(parts[1])
  })) {
    return { ok: false, changed: ['editScope 格式无效'] }
  }
  // 全文覆盖保留既有保守边界:含正则/除法或模板插值时不授予覆盖区间,
  // 仍允许原文不变,否则要求精确 edits(直接在旧文本组装,无需推断授权范围)。
  const uncertain = (text) => {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === "'" || c === '"' || c === '`') {
        const end = skipString(text, i)
        if (c === '`' && text.slice(i, end).includes('${')) return true
        i = end
      } else if (c === '/' && text[i + 1] === '/') i = skipLineComment(text, i)
      else if (c === '/' && text[i + 1] === '*') i = skipBlockComment(text, i)
      else if (c === '/') return true
    }
    return false
  }
  if (oldCode !== newCode && (uncertain(oldCode) || uncertain(newCode))) {
    return { ok: false, changed: ['无法可靠划分全文授权区间,请使用精确 edits'] }
  }
  const scope = new Set(scopeIds)
  const collect = (code) => {
    const items = []
    for (const kind of [...CONTENT_KINDS, 'translate']) {
      for (const sec of findAllSections(code, kind, options)) {
        for (const p of sectionProperties(code, sec.open, sec.close, options)) {
          if (!isEntryId(p.name) || p.readOnly || p.indirect) continue
          if (kind === 'translate' ? code[p.end] === '}' : STRUCTURAL_NAMES.has(p.name) || !(kind === 'skill' ? '}' : '}]').includes(code[p.end])) continue
          const id = kind === 'translate' ? p.name.replace(/_info$/, '') : p.name
          items.push({ ...p, id, kind, key: kind + ':' + p.name, text: code.slice(p.start, p.end + 1) })
        }
      }
    }
    return items.sort((a, b) => a.start - b.start)
  }
  const oldBlocks = collect(oldCode), newBlocks = collect(newCode)
  const allowed = (b) => scope.has(b.id) || scope.has(b.kind + ':' + b.id)
  const changed = []
  for (const id of scope) {
    if (!oldBlocks.some((b) => id === b.id || id === b.kind + ':' + b.id)) changed.push('editScope 未识别条目:' + id)
  }
  for (const items of [oldBlocks, newBlocks]) {
    for (const b of items.filter(allowed)) {
      if (items.filter((other) => other.key === b.key).length !== 1
        || items.some((other) => other !== b && other.start <= b.end && other.end >= b.start)) {
        changed.push('editScope 区间不唯一:' + b.key)
      }
    }
  }
  // 分段数组而非拼接哨兵字符串:原文不能伪造哨兵来吞掉未授权文本。
  const outside = (code, items) => {
    const parts = []
    let at = 0
    for (const b of items.filter(allowed)) {
      parts.push(code.slice(at, b.start), b.key)
      at = b.end + 1
    }
    parts.push(code.slice(at))
    return JSON.stringify(parts)
  }
  if (outside(oldCode, oldBlocks) !== outside(newCode, newBlocks)) {
    for (const b of oldBlocks.filter((b) => !allowed(b))) {
      if (!newBlocks.some((nb) => nb.key === b.key && nb.text === b.text)) changed.push(b.id)
    }
    changed.push('文件骨架/imports/precontent/范围外文本(含行尾)')
  }
  return { ok: changed.length === 0, changed: [...new Set(changed)] }
}

function normalizeForCompare(code) {
  return code.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\r/g, '')
}

/**
 * 锚点化迁移:对无锚老文件插入锚点注释行,一个代码字符不动。
 * 自检:剥掉锚点行后必须与原文逐行一致,否则放弃。
 */
export function migrateCode(oldCode, options = {}) {
  // 幂等:已锚点文件先剥旧锚再重扫(锚点规范升级后直接重新建立索引即可)
  const base = scanAnchored(oldCode).length ? stripAnchors(oldCode, options) : oldCode
  const items = []
  for (const kind of [...CONTENT_KINDS, 'translate']) items.push(...virtualCandidates(base, kind, options))
  /* 按源码位置排序区块，使共享插入偏移处的 begin/end 锚保持原文顺序，避免不同 kind 的相邻区块交叉。 */
  items.sort((a, b) => (a.start - b.start) || (a.end - b.end))
  if (!items.length) {
    // 新式 ES Module 多文件包(如懒人包预装的英雄杀):extension.js 只是入口壳,
    // 条目在子目录模块(const character = {...} + export)。锚点化与全文写入的
    // 目标都是 extension.js,对壳文件动手毫无意义——必须给专属文案,不能引导"走全文模式"。
    if (/(^|\n)\s*import\s+[\w{*\s"']/.test(base) || /(^|\n)\s*export\s+(default|let|const|var|\{)/.test(base)) {
      return { error: '该文件未发现可锚定的内容条目;ES Module 多文件结构请指定实际定义武将、技能或翻译的模块文件,也可在工坊建立全包索引。' }
    }
    return { error: '未能识别出可锚定的区块(skill/card/character/translate 区段)——该文件可能是非常规格式,请走全文模式处理。' }
  }
  if (items.some(b => b.readOnly)) return { error: '该文件包含只读或间接内容定义,不能安全建立可写索引;请使用唯一原文 edits 精确修改。' }
  if (items.some(b => b.contiguous === false || items.filter(x => x.key === b.key).length !== 1)) {
    return { error: '条目重复或翻译条目不连续,无法安全建立区块索引;请使用唯一原文 edits 精确修改。' }
  }
  for (const b of items) {
    const ls = base.lastIndexOf('\n', b.start) + 1
    let le = base.indexOf('\n', b.end + 1)
    if (le < 0) le = base.length
    if (!commentTrivia(base, ls, b.start, false, options) || !commentTrivia(base, b.end + 1, le, true, options)) {
      return { error: '条目与容器或其他条目位于同一行,无法安全插入索引注释;请使用唯一原文 edits 精确修改。' }
    }
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
  for (const b of items) {
    const ls = base.lastIndexOf('\n', b.start) + 1
    let le = b.end
    while (le < base.length && base[le] !== '\n') le++
    if (le < base.length) le++
    addAt(ls, anchorBegin(b.kind, b.id) + '\n')
    addAt(le, anchorEnd(b.kind, b.id) + '\n')
    inserted += 2
    // 在 end 锚前补齐缺少的条目逗号，便于后续插入。跳过尾部空白时包含 CRLF 中的回车，确保逗号位于内容行末。
    let last = le - 1
    while (last > ls && /[ \t\r\n]/.test(base[last])) last--
    /* 仅当区块结束位置也是该行最后一个有效字符时补逗号，避免修改外层对象或语句的结束符。 */
    if (base[last] !== ',' && last === b.end) { addAt(last + 1, ','); commas++ }
  }
  let code = base
  for (const at of [...byAt.keys()].sort((a, b) => b - a)) {
    code = code.slice(0, at) + byAt.get(at).join('') + code.slice(at)
  }
  // 自检:剥锚点 + 行尾逗号归一后,必须与原文件一致
  // (锚点行与收尾逗号是迁移仅有的两类合法差异;代码被移动/改写都会在此暴露)
  if (normalizeForCompare(stripEolCommas(stripAnchors(code, options))) !== normalizeForCompare(stripEolCommas(base))) {
    return { error: '锚点插入自检失败(除锚点行与收尾逗号外内容发生变化),已放弃写入。' }
  }
  const verified = scanEffectiveAnchored(code, options)
  if (verified.length !== items.length || items.some(b => !verified.some(x => x.key === b.key))) {
    return { error: '锚点有效性自检失败,已放弃写入。' }
  }
  return { code, inserted, commas, blocks: items.length }
}

/** 迁移自检用:剥掉行尾逗号(迁移合法差异=新增锚点行与收尾逗号;CRLF 行尾的 \r 一并剥)。 */
function stripEolCommas(code) {
  return code.split('\n').map((l) => l.replace(/[ \t\r]*$/, '').replace(/,$/, '')).join('\n')
}

/** 剥掉全部锚点注释行(迁移自检用)。 */
export function stripAnchors(code, options = {}) {
  const comments = new Set(sourceStructure(code, options).comments.filter(c => c.type === 'Line').map(c => c.start))
  let offset = 0
  return code.split('\n').filter(line => {
    const slash = offset + (line.match(/^[ \t]*/)?.[0].length || 0)
    offset += line.length + 1
    return !(ANCHOR_LINE_RE.test(line) && comments.has(slash))
  }).join('\n')
}

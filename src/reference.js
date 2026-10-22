/**
 * noname-kit 官方参考搜索 v2。
 *
 * 移植「全能搜索」扩展的搜索思想到文件级:
 * 1. 一次性建目录索引:扫描源码里的 `lib.translate.<id> = '中文名'` 与 `<id>_info = '描述'`,
 *    以及 translate/character 对象内的中文键值对,得到 ID → 中文名/描述 的映射
 *    (官方包与 extension/ 下用户扩展都在索引里)
 * 2. 中文归一化匹配(全角→半角、小写、去空格),多关键词 AND;ID 精确匹配权重最高
 * 3. 命中 ID 后,在源码里做花括号配对提取,返回完整的技能/武将/卡牌定义对象
 * 4. 普通文件按关键词评分兜底；大文件使用固定内存分块搜索，并返回明确覆盖范围和续搜位置
 */
import { readdir, lstat, open } from 'node:fs/promises'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import { REFERENCE_MAX_FILE_BYTES, REFERENCE_STREAM_BUDGET_BYTES, searchStreamReferences } from './reference-stream.js'

const MAX_INDEX_FILE_BYTES = 8 * 1024 ** 2
const MAX_INDEX_BYTES = 64 * 1024 ** 2
const INDEX_TTL_MS = 15_000
const CURSOR_KEY = randomBytes(32)
const MAX_DEPTH = 5
const MAX_FILES = 1200
const CONTEXT_LINES = 10
const MAX_DEF_LINES = 220

/** 按类型给出搜索根(相对 nonameDir)。 */
function rootsFor(type) {
  if (type === 'card') return ['card', 'noname/library']
  if (type === 'character') return ['character', 'noname/library']
  if (type === 'skill') return ['noname/library', 'character', 'gnc']
  return ['noname/library', 'character', 'card', 'gnc', 'extension']
}

async function collectFiles(root, depth, out, scan) {
  if (depth > MAX_DEPTH) { scan.depthLimited = true; return }
  if (out.length >= MAX_FILES) { scan.fileLimited = true; return }
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch (error) {
    if (error.code !== 'ENOENT') scan.skipped.push({ file: relative(scan.root, root).split('\\').join('/'), bytes: 0, reason: '目录不可读取' })
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) { scan.fileLimited = true; break }
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'assets', 'audio', 'font', 'image', 'themes', '_virtual', 'dist', 'backup'].includes(entry.name)) continue
      if (/voice/i.test(entry.name)) continue
      await collectFiles(full, depth + 1, out, scan)
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.min.js') && !/voice/i.test(entry.name)) {
      out.push(full)
    }
  }
}

/** 中文归一化:全角→半角、小写、去空白。 */
function normalize(str) {
  return String(str || '').toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
    .replace(/\s+/g, '')
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

function putEntry(catalog, id, value, relFile, line, offset = 0) {
  if (id.endsWith('_info')) {
    const base = id.slice(0, -5)
    const e = catalog.get(base) || { name: '', info: '', file: relFile, line, offset }
    if (!e.info) e.info = value
    catalog.set(base, e)
  } else {
    const entry = catalog.get(id) || { name: '', info: '', file: relFile, line, offset }
    if (!entry.name && /[\u4e00-\u9fff]/.test(value)) entry.name = value
    if (!entry.file) { entry.file = relFile; entry.line = line }
    catalog.set(id, entry)
  }
}

/** 扫描 translate 记录,填充目录索引。 */
function extractTranslateEntries(text, relFile, catalog) {
  const patterns = [
    /lib\.translate\.([A-Za-z_$][\w$]{0,255})\s*=\s*(['"])([^'"]{1,500})\2/g,
    /(?<![\w$])(['"]?)([A-Za-z_$][\w$]{0,255})\1\s*:\s*(['"])([^'"]{1,500})\3/g,
  ]
  for (let pass = 0; pass < patterns.length; pass++) {
    let last = 0, line = 1, match
    while ((match = patterns[pass].exec(text)) !== null) {
      for (; last < match.index; last++) if (text[last] === '\n') line++
      const key = pass === 0 ? match[1] : match[2]
      const value = pass === 0 ? match[3] : match[4]
      if (pass === 0 || /[\u4e00-\u9fff]/.test(value) || key.endsWith('_info')) putEntry(catalog, key, value, relFile, line, match.index)
    }
  }
}

/** Keep source excerpts bounded even when an entire file is one minified line. */
function numberedExcerpt(text, firstLine, maxChars = 12000) {
  const clipped = text.slice(0, maxChars)
  const lines = clipped.split('\n')
  const selected = lines.slice(0, MAX_DEF_LINES)
  let output = selected.map((line, i) => String(firstLine + i).padStart(5) + ' | ' + line).join('\n')
  const truncated = clipped.length < text.length || selected.length < lines.length || output.length > maxChars
  output = output.slice(0, maxChars)
  if (/[\uD800-\uDBFF]$/.test(output)) output = output.slice(0, -1)
  return output + (truncated ? '\n…(片段已截断，可按文件或区块继续读取)' : '')
}

function excerptAround(text, offset) {
  let start = offset
  for (let i = 0; i < 5; i++) {
    const previous = text.lastIndexOf('\n', start - 1)
    if (previous < 0) { start = 0; break }
    start = previous
  }
  start = Math.max(start, offset - 1500, 0)
  if (text[start] === '\n') start++
  if (/[\uDC00-\uDFFF]/.test(text[start] || '')) start++
  let end = offset
  for (let i = 0; i < CONTEXT_LINES; i++) {
    const following = text.indexOf('\n', end + 1)
    if (following < 0) { end = text.length; break }
    end = following
  }
  end = Math.min(end, offset + 10000)
  return numberedExcerpt(text.slice(start, end), lineOf(text, start))
}

/**
 * 在源文件里提取某个 ID 的完整定义块(花括号配对;字符串内括号按普通字符计数的
 * 误差在实践中罕见,失败时调用方退回行窗口)。
 */
function extractDefinition(text, relFile, id) {
  const patterns = [
    new RegExp(`${id}\\s*:\\s*\\{`),
    new RegExp(`${id}\\s*=\\s*\\{`),
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const braceStart = text.indexOf('{', m.index + m[0].length - 1)
    if (braceStart < 0) continue
    let depth = 0
    let i = braceStart
    const limit = Math.min(text.length, braceStart + 40_000)
    for (; i < limit; i++) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) break }
    }
    if (depth !== 0) continue
    const startLine = lineOf(text, braceStart)
    const block = text.slice(braceStart, i + 1)
    return { file: relFile, line: startLine, snippet: numberedExcerpt(block, startLine) }
  }
  return null
}

const PUNCT_RE = /[\p{P}\p{S}\s]/gu
const STOP_CHARS = new Set('的一是了在和与就也都但被把将为对以从到于其这那之以及等后时可将会再且若则即又很更最非常应要需要能可以')

/** 相似度用清理:去标点/符号/空白,再去功能字。 */
function cleanForSimilarity(str) {
  return normalize(String(str || '').replace(PUNCT_RE, ''))
    .split('').filter((c) => !STOP_CHARS.has(c)).join('')
}

/** 字符二元组集合。 */
function bigramsOf(str) {
  const out = new Set()
  for (let i = 0; i < str.length - 1; i++) out.add(str.slice(i, i + 2))
  return out
}

/** 查询二元组在目标中的包含率(0~1)。 */
function containmentRatio(queryGrams, targetGrams) {
  if (queryGrams.size === 0) return 0
  let hit = 0
  for (const g of queryGrams) if (targetGrams.has(g)) hit++
  return hit / queryGrams.size
}

/** 普通源码缓存有固定字节预算；超出预算的文件仅保留流式检索元数据。 */
let cachedIndex = null

async function readIndexFile(file, info) {
  const handle = await open(file, 'r')
  try {
    const current = await handle.stat()
    if (current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ino !== info.ino) throw new Error('文件已变更')
    const buffer = Buffer.alloc(info.size)
    let position = 0
    while (position < buffer.length) {
      const { bytesRead } = await handle.read(buffer, position, buffer.length - position, position)
      if (!bytesRead) throw new Error('文件读取不完整')
      position += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('文件读取期间发生变更')
    return buffer.toString('utf8')
  } finally { await handle.close() }
}

async function buildSearchIndex(nonameDir) {
  const files = []
  const scan = { root: nonameDir, fileLimited: false, depthLimited: false, skipped: [] }
  for (const root of rootsFor('any')) await collectFiles(join(nonameDir, root), 0, files, scan)
  const byId = new Map(), loaded = [], streamFiles = [], metadata = []
  let indexedBytes = 0
  for (const file of files) {
    const rel = relative(nonameDir, file).split('\\').join('/')
    let info
    try { info = await lstat(file) }
    catch { scan.skipped.push({ file: rel, bytes: 0, reason: '文件不可读取' }); continue }
    if (!info.isFile() || info.isSymbolicLink()) { scan.skipped.push({ file: rel, bytes: info.size, reason: '不是普通源码文件' }); continue }
    metadata.push([rel, info.size, info.mtimeMs])
    if (info.size > REFERENCE_MAX_FILE_BYTES) {
      scan.skipped.push({ file: rel, bytes: info.size, reason: '超过单文件 5 GiB 搜索上限' })
      continue
    }
    if (info.size > MAX_INDEX_FILE_BYTES || indexedBytes + info.size > MAX_INDEX_BYTES) {
      streamFiles.push({ path: file, rel, size: info.size, mtimeMs: info.mtimeMs })
      continue
    }
    let text
    try { text = await readIndexFile(file, info) }
    catch { scan.skipped.push({ file: rel, bytes: info.size, reason: '文件不可读取或读取期间已变更' }); continue }
    indexedBytes += info.size
    loaded.push({ path: file, rel, text })
    extractTranslateEntries(text, rel, byId)
  }
  return { nonameDir, byId, loaded, streamFiles, indexedBytes, scan,
    snapshot: createHash('sha256').update(JSON.stringify(metadata)).digest('hex') }
}

async function getIndex(nonameDir) {
  if (cachedIndex && cachedIndex.nonameDir === nonameDir && (cachedIndex.pending || Date.now() - cachedIndex.at < INDEX_TTL_MS)) return cachedIndex.promise
  const record = { nonameDir, at: Date.now(), pending: true, promise: null }
  record.promise = buildSearchIndex(nonameDir).then(index => { record.at = Date.now(); record.pending = false; return index }).catch(error => {
    if (cachedIndex === record) cachedIndex = null
    throw error
  })
  cachedIndex = record
  return record.promise
}

function cursorScope(index, raw, type) {
  return createHash('sha256').update(JSON.stringify([resolve(index.nonameDir), raw, type, index.snapshot])).digest('hex')
}

function encodeCursor(index, raw, type, start, unreadableFiles, matchedStops) {
  const body = Buffer.from(JSON.stringify({ v: 1, scope: cursorScope(index, raw, type), start, unreadableFiles, matchedStops })).toString('base64url')
  const signature = createHmac('sha256', CURSOR_KEY).update(body).digest('base64url')
  return body + '.' + signature
}

async function decodeCursor(cursor, index, raw, type) {
  if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error('无效的续搜位置，请不带 cursor 重新搜索。')
  const parts = cursor.split('.')
  if (parts.length !== 2) throw new Error('无效的续搜位置，请不带 cursor 重新搜索。')
  const expected = createHmac('sha256', CURSOR_KEY).update(parts[0]).digest()
  const signature = Buffer.from(parts[1], 'base64url')
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error('续搜位置已失效，请不带 cursor 重新搜索。')
  let payload
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) }
  catch { throw new Error('无效的续搜位置，请重新搜索。') }
  if (payload.v !== 1 || payload.scope !== cursorScope(index, raw, type)) throw new Error('查询或源码快照已变更，请不带 cursor 重新搜索。')
  if (!Number.isSafeInteger(payload.unreadableFiles) || payload.unreadableFiles < 0 || payload.unreadableFiles > MAX_FILES ||
      !Number.isSafeInteger(payload.matchedStops) || payload.matchedStops < 0 || payload.matchedStops > MAX_FILES) throw new Error('无效的续搜统计，请重新搜索。')
  const start = payload.start
  if (!start || !Number.isSafeInteger(start.index) || start.index < 0 || start.index >= index.streamFiles.length ||
      !Number.isSafeInteger(start.offset) || start.offset < 0 || start.offset > index.streamFiles[start.index].size ||
      !Number.isSafeInteger(start.line) || start.line < 1 || start.line > start.offset + 1) throw new Error('无效的续搜位置，请重新搜索。')
  for (const file of index.streamFiles) {
    let info
    try { info = await lstat(file.path) }
    catch { throw new Error('源码文件已变更或不可读，请不带 cursor 重新搜索。') }
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size || info.mtimeMs !== file.mtimeMs) throw new Error('源码文件已变更，请不带 cursor 重新搜索。')
  }
  return { start, unreadableFiles: payload.unreadableFiles, matchedStops: payload.matchedStops }
}

function coverageOf(index, stream, priorUnreadable, priorMatchedStops) {
  const skipped = [...index.scan.skipped, ...(stream.unreadable || []).map(x => ({ file: x.file, bytes: 0, reason: x.reason }))]
  const pending = stream.next ? index.streamFiles.length - stream.next.index : 0
  const matchStops = priorMatchedStops + stream.filesStoppedAfterMatch
  const partial = !!(pending || skipped.length || priorUnreadable || matchStops || index.scan.fileLimited || index.scan.depthLimited)
  return {
    partial, indexedFiles: index.loaded.length, indexedBytes: index.indexedBytes,
    largeFiles: index.streamFiles.length, largeFilesPending: pending,
    streamBytesRead: stream.bytesRead, streamFilesExhausted: stream.filesExhausted,
    skippedFiles: skipped.length + priorUnreadable, skipped: skipped.slice(0, 10),
    streamFilesStoppedAfterMatch: matchStops, largeFileMatchWindowBytes: 16 * 1024,
    fileLimitReached: index.scan.fileLimited, depthLimitReached: index.scan.depthLimited,
    maxFileBytes: REFERENCE_MAX_FILE_BYTES, scanBudgetBytes: REFERENCE_STREAM_BUDGET_BYTES,
    stopReason: stream.stopReason,
  }
}

function searchIndexed(index, raw, maxMatches) {
  const keywords = raw.split(/\s+/).map(normalize).filter(Boolean)

  const matches = []
  let simHitsTruncated = 0
  let fallbackLimited = false

  // 按目录索引匹配中文名、描述与 ID，并提取完整定义块。
  const candidates = []
  for (const [id, entry] of index.byId) {
    if (!entry.name && !entry.info) continue
    const hay = normalize(id + ' ' + entry.name + ' ' + entry.info)
    const hitAll = keywords.length > 0 && keywords.every((k) => hay.includes(k))
    const idExact = keywords.length === 1 && id.toLowerCase() === keywords[0]
    if (!hitAll && !idExact) continue
    let score = idExact ? 100 : 0
    for (const k of keywords) {
      if (normalize(entry.name).includes(k)) score += 10
      if (normalize(entry.info).includes(k)) score += 2
    }
    candidates.push({ id, entry, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  const seen = new Set()
  for (const cand of candidates) {
    if (matches.length >= maxMatches) break
    if (seen.has(cand.id)) continue
    let def = null
    const fileEntry = index.loaded.find((f) => f.rel === cand.entry.file)
    if (fileEntry) def = extractDefinition(fileEntry.text, cand.entry.file, cand.id)
    if (!def) {
      for (const f of index.loaded) {
        def = extractDefinition(f.text, f.rel, cand.id)
        if (def) break
      }
    }
    if (!def) {
      // 定义提取失败:退回 translate 记录处的行窗口(至少给出 ID 与中文名的位置)
      const fe = index.loaded.find((f) => f.rel === cand.entry.file)
      if (!fe) continue
      def = { file: cand.entry.file, line: cand.entry.line,
        snippet: excerptAround(fe.text, cand.entry.offset || 0) + '\n…(定义块提取失败，仅显示翻译附近片段)' }
    }
    seen.add(cand.id)
    matches.push({
      id: cand.id,
      name: cand.entry.name,
      info: (cand.entry.info || '').slice(0, 200),
      file: def.file,
      line: def.line,
      snippet: def.snippet,
    })
  }

  // 目录未命中时，使用全文关键词评分查找参考内容。
  if (matches.length === 0) {
    for (const file of index.loaded) {
      const lower = file.text.toLowerCase()
      let score = 0
      let allHit = true
      for (const token of keywords) {
        const t = token.toLowerCase()
        let count = 0, position = 0
        while (count < 30) {
          const found = lower.indexOf(t, position)
          if (found < 0) break
          count++
          position = found + t.length
        }
        if (count === 0) allHit = false
        score += Math.min(count, 30)
      }
      if (score === 0 || (keywords.length > 1 && !allHit && score < keywords.length * 5)) continue
      let bestIndex = -1
      for (const token of keywords) {
        const idx = lower.indexOf(token.toLowerCase())
        if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx
      }
      if (bestIndex < 0) continue
      const line = lineOf(file.text, bestIndex)
      const snippet = excerptAround(file.text, bestIndex)
      matches.push({ id: '', name: '', info: '', file: file.rel, line, snippet })
      if (matches.length >= maxMatches) {
        fallbackLimited = file !== index.loaded[index.loaded.length - 1]
        break
      }
    }
  }

  // 按描述相似度匹配，保留至少 50% 的结果，降序排列并与已有结果去重。
  const qClean = cleanForSimilarity(raw)
  const qGrams = bigramsOf(qClean)
  if (qGrams.size >= 3) {
    const existIds = new Set(matches.map((m) => m.id).filter(Boolean))
    /* 结果列表使用 let，允许后续按 limit 截断时重新赋值。 */
    let simHits = []
    for (const [id, entry] of index.byId) {
      if (!entry.name && !entry.info) continue
      if (existIds.has(id)) continue
      if (!entry._grams) entry._grams = bigramsOf(cleanForSimilarity(entry.name + ' ' + entry.info))
      const ratio = containmentRatio(qGrams, entry._grams)
      if (ratio >= 0.5) simHits.push({ id, entry, ratio })
    }
    simHits.sort((a, b) => b.ratio - a.ratio)
    /* 精确命中优先占用 limit，剩余额度用于相似度结果；发生截断时说明结果不完整，便于收窄查询。 */
    const room = Math.max(0, maxMatches - matches.length)
    if (room > 0) {
      simHitsTruncated = Math.max(0, simHits.length - room)
      simHits = simHits.slice(0, room)
    } else {
      simHitsTruncated = simHits.length
      simHits = []
    }
    for (const hit of simHits) {
      const score = Math.round(hit.ratio * 100) / 100
      const info = (hit.entry.info || '(索引中无描述)').replace(/<[^>]+>/g, '')
      matches.push({
        id: hit.id, name: hit.entry.name,
        info: info.slice(0, 400),
        score,
        file: hit.entry.file, line: hit.entry.line,
        snippet: `相似度 ${Math.round(score * 100)}% · ID: ${hit.id} · 名称: ${hit.entry.name || '-'} · ${hit.entry.file}:${hit.entry.line}
  描述: ${info.slice(0, 160)}
  (对该 ID 再搜一次可获取完整定义)`,
      })
    }
  }

  return { matches, truncated: simHitsTruncated > 0 || candidates.length > seen.size || fallbackLimited }
}

/** 搜索源码参考；大文件按固定内存分段读取，nextCursor 只能用于同一查询及源码快照。 */
export async function searchReference(nonameDir, { query, type = 'any', limit = 5, cursor } = {}) {
  if (!nonameDir) return { ok: false, error: '未配置 nonameDir(游戏本体目录)，请在工坊设置页配置游戏本体目录。' }
  const raw = String(query || '').trim()
  if (!raw) return { ok: false, error: 'query 不能为空：支持中文名、ID、空格分隔关键词或效果描述。' }
  if (raw.length > 1024) return { ok: false, error: 'query 超过 1024 字符，请缩短关键词。' }
  const maxMatches = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 10)) : 5
  const index = await getIndex(nonameDir)
  let start = { index: 0, offset: 0, line: 1 }, priorUnreadable = 0, priorMatchedStops = 0
  if (cursor !== undefined) {
    try {
      const decoded = await decodeCursor(cursor, index, raw, type)
      start = decoded.start; priorUnreadable = decoded.unreadableFiles; priorMatchedStops = decoded.matchedStops
    }
    catch (error) { return { ok: false, matches: [], query: raw, error: error.message } }
  }
  const indexed = cursor === undefined ? searchIndexed(index, raw, maxMatches) : { matches: [], truncated: false }
  const matches = indexed.matches
  let stream = { matches: [], next: null, bytesRead: 0, filesVisited: 0, filesExhausted: 0, filesStoppedAfterMatch: 0, unreadable: [], stopReason: 'complete' }
  if (index.streamFiles.length) {
    const remaining = maxMatches - matches.length
    if (remaining > 0) stream = await searchStreamReferences(index.streamFiles, { query: raw, limit: remaining, start })
    else stream = { ...stream, next: start, stopReason: 'limit' }
    matches.push(...stream.matches)
  }
  const coverage = coverageOf(index, stream, priorUnreadable, priorMatchedStops)
  const result = { ok: matches.length > 0, matches, scanned: index.loaded.length + stream.filesVisited, query: raw, coverage }
  if (indexed.truncated) result.truncated = '结果达到 limit=' + maxMatches + '，仍有匹配未展示；可收窄关键词或提高 limit（上限 10）。'
  if (stream.next) result.nextCursor = encodeCursor(index, raw, type, stream.next, priorUnreadable + stream.unreadable.length, priorMatchedStops + stream.filesStoppedAfterMatch)
  if (coverage.partial) {
    result.warning = '本轮搜索范围不完整。' + (stream.next ? '保持 query/type 不变并传 nextCursor 作为 cursor 可继续大文件搜索。' : '') +
      (coverage.skippedFiles ? '有文件不可检索或被跳过，原因见当前及此前结果的 coverage.skipped。' : '') +
      (coverage.streamFilesStoppedAfterMatch ? '大文件仅返回每文件首个命中片段，命中后的内容未继续扫描；可使用更精确的 ID 或关键词。' : '') +
      (coverage.fileLimitReached || coverage.depthLimitReached ? '目录枚举达到数量或深度上限。' : '')
  }
  if (!matches.length) result.error = coverage.partial ? '本轮已扫描部分未命中；尚未检索的内容不能视为不存在。' : '未命中：可尝试中文技能名、技能/卡牌 ID、效果关键词或完整效果描述。'
  return result
}

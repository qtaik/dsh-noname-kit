/**
 * noname-kit 官方参考搜索 v2。
 *
 * 移植「全能搜索」扩展的搜索思想到文件级:
 * 1. 一次性建目录索引:扫描源码里的 `lib.translate.<id> = '中文名'` 与 `<id>_info = '描述'`,
 *    以及 translate/character 对象内的中文键值对,得到 ID → 中文名/描述 的映射
 *    (官方包与 extension/ 下用户扩展都在索引里)
 * 2. 中文归一化匹配(全角→半角、小写、去空格),多关键词 AND;ID 精确匹配权重最高
 * 3. 命中 ID 后,在源码里做花括号配对提取,返回完整的技能/武将/卡牌定义对象
 * 4. 兜底:目录没命中时退回关键词全文评分(老行为)
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const MAX_FILE_BYTES = 900_000
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

async function collectFiles(root, depth, out) {
  if (depth > MAX_DEPTH || out.length > MAX_FILES) return
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'assets', 'audio', 'font', 'image', 'themes', '_virtual', 'dist', 'backup'].includes(entry.name)) continue
      if (/voice/i.test(entry.name)) continue
      await collectFiles(full, depth + 1, out)
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.min.js') && !/voice/i.test(entry.name)) {
      out.push(full)
      if (out.length > MAX_FILES) return
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

function putEntry(catalog, id, value, relFile, line) {
  if (id.endsWith('_info')) {
    const base = id.slice(0, -5)
    const e = catalog.get(base) || { name: '', info: '', file: relFile, line }
    if (!e.info) e.info = value
    catalog.set(base, e)
  } else {
    const entry = catalog.get(id) || { name: '', info: '', file: relFile, line: 0 }
    if (!entry.name && /[\u4e00-\u9fff]/.test(value)) entry.name = value
    if (!entry.file) { entry.file = relFile; entry.line = line }
    catalog.set(id, entry)
  }
}

/** 扫描 translate 记录,填充目录索引。 */
function extractTranslateEntries(text, relFile, catalog) {
  // 形式一:lib.translate.xxx = '中文名' / xxx_info = '描述'
  const re1 = /lib\.translate\.([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]{1,500})\2/g
  let m
  while ((m = re1.exec(text)) !== null) putEntry(catalog, m[1], m[3], relFile, lineOf(text, m.index))
  // 形式二:对象内键值对 "xxx": '中文' / xxx_info: '描述'(translate/character 包常这样写)
  const re2 = /(['"]?)([A-Za-z][\w]*)\1\s*:\s*(['"])([^'"]{1,500})\3/g
  while ((m = re2.exec(text)) !== null) {
    const key = m[2]
    const val = m[4]
    if (/[\u4e00-\u9fff]/.test(val) || key.endsWith('_info')) putEntry(catalog, key, val, relFile, lineOf(text, m.index))
  }
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
    if (block.length > 30_000) {
      return { file: relFile, line: startLine, snippet: block.slice(0, 30_000) + '\n…(过长截断)' }
    }
    const numbered = block.split('\n').map((l, idx) => `${String(startLine + idx).padStart(5)} | ${l}`).join('\n')
    return { file: relFile, line: startLine, snippet: numbered }
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

/** 进程级缓存:同一 DSH 进程内多次调用不重复扫描(首调约 5 秒)。 */
let cachedIndex = null

async function buildSearchIndex(nonameDir) {
  const files = []
  for (const root of rootsFor('any')) await collectFiles(join(nonameDir, root), 0, files)
  // 用户扩展的 extension.js 也是好参考(用户扩展也是语料)
  try {
    const extFiles = []
    await collectFiles(join(nonameDir, 'extension'), 2, extFiles)
    files.push(...extFiles.filter((f) => f.endsWith('extension.js')))
  } catch { /* extension 目录可能不存在 */ }

  const byId = new Map()
  const loaded = []
  for (const path of files) {
    let text
    try {
      const info = await stat(path)
      if (info.size > MAX_FILE_BYTES) continue
      text = await readFile(path, 'utf8')
    } catch { continue }
    const rel = relative(nonameDir, path).split('\\').join('/')
    loaded.push({ path, rel, text })
    extractTranslateEntries(text, rel, byId)
  }
  return { nonameDir, byId, loaded }
}

async function getIndex(nonameDir) {
  if (cachedIndex && cachedIndex.nonameDir === nonameDir) return cachedIndex
  cachedIndex = await buildSearchIndex(nonameDir)
  return cachedIndex
}

/**
 * 搜索官方/扩展实现:v2(目录索引 + 中文匹配 + 完整定义提取)。
 * @param {string} nonameDir - 游戏本体目录。
 * @param {object} input
 * @param {string} input.query - 中文名(天罚)、ID(juedou / cs_tianfa)、
 *   或空格分隔多关键词("摸牌 damage draw")。
 * @param {'any'|'skill'|'character'|'card'} [input.type]
 * @param {number} [input.limit]
 */
export async function searchReference(nonameDir, { query, type = 'any', limit = 5 }) {
  if (!nonameDir) {
    // 报错必须给 AI 指明出路,否则它会退回 bash 自己找 —— 实测会从系统根目录开始
    // 全盘检索,用户等几分钟都没结果(issue #1)
    return { ok: false, error: '未配置 nonameDir(游戏本体目录),noname_search_reference 无法搜索。请让用户在工坊「⚙ 设置」页配置游戏本体目录;配置之前不要用 bash 在磁盘/系统目录里检索源码——那会全盘扫描,耗时极长。' }
  }
  const raw = String(query || '').trim()
  if (!raw) {
    return { ok: false, error: 'query 不能为空:支持中文名(天罚)、ID(juedou)、或空格分隔的多关键词(摸牌 damage)。' }
  }
  const index = await getIndex(nonameDir)
  const keywords = raw.split(/\s+/).map(normalize).filter(Boolean)

  const maxMatches = Math.max(1, Math.min(limit, 10))
  const matches = []

  // ── 阶段 1:目录索引命中(中文名/描述/ID)→ 提取完整定义块 ──
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
      const lines = fe.text.split('\n')
      const s = Math.max(0, cand.entry.line - 3)
      def = {
        file: cand.entry.file,
        line: cand.entry.line,
        snippet: lines.slice(s, Math.min(lines.length, cand.entry.line + 8))
          .map((l, i) => `${String(s + i + 1).padStart(5)} | ${l}`).join('\n') + '\n…(定义块提取失败,仅显示 translate 位置)',
      }
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

  // ── 阶段 2:目录未命中时,退回全文关键词评分(老行为) ──
  if (matches.length === 0) {
    for (const file of index.loaded) {
      const lower = file.text.toLowerCase()
      let score = 0
      let allHit = true
      for (const token of keywords) {
        const t = token.toLowerCase()
        const count = lower.split(t).length - 1
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
      const line = file.text.slice(0, bestIndex).split('\n').length
      const lines = file.text.split('\n')
      const snippet = lines.slice(Math.max(0, line - 5), Math.min(lines.length, line + CONTEXT_LINES))
        .map((l, i) => `${String(Math.max(0, line - 5) + i + 1).padStart(5)} | ${l}`).join('\n')
      matches.push({ id: '', name: '', info: '', file: file.rel, line, snippet })
      if (matches.length >= maxMatches) break
    }
  }

  // ── 阶段 3:描述相似度匹配(≥50% 全部列出,按相似度降序,与已有结果去重) ──
  const qClean = cleanForSimilarity(raw)
  const qGrams = bigramsOf(qClean)
  if (qGrams.size >= 3) {
    const existIds = new Set(matches.map((m) => m.id).filter(Boolean))
    const simHits = []
    for (const [id, entry] of index.byId) {
      if (!entry.name && !entry.info) continue
      if (existIds.has(id)) continue
      if (!entry._grams) entry._grams = bigramsOf(cleanForSimilarity(entry.name + ' ' + entry.info))
      const ratio = containmentRatio(qGrams, entry._grams)
      if (ratio >= 0.5) simHits.push({ id, entry, ratio })
    }
    simHits.sort((a, b) => b.ratio - a.ratio)
    // 全部以紧凑行列出(ID/名称/相似度/位置),不提取完整定义——
    // AI 看中哪个,用该 ID 再精确搜索一次即可获取完整代码(防止几百段代码撑爆上下文)。
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

  // 无损 JSON 要求:不得携带显式 undefined 字段(序列化会丢键,被判为有损)
  const result = { ok: matches.length > 0, matches, scanned: index.loaded.length, query: raw }
  if (matches.length === 0) {
    result.error = '未命中:可尝试——①中文技能名;②技能/卡牌 ID;③空格分隔的效果关键词;④整句效果描述(相似度≥50% 才列出,条数可能很多)。'
  }
  return result
}

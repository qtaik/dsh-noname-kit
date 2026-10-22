import { lstat, readdir, realpath, open } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, basename } from 'node:path'
import { sourceModel } from './module-parser.js'
import { createHash } from 'node:crypto'
import { pageRead } from './package-read.js'

const KINDS = ['character', 'card', 'mode']
const SOURCES = ['builtin', 'extension']
const SKIP_DIRS = new Set(['node_modules', '.git', 'backup', 'image', 'audio', 'font'])
const AUXILIARY_CHARACTER_FILES = new Set(['rank.js', 'replace.js', 'perfectPairs.js'])
const LIMITS = Object.freeze({ depth: 12, files: 512, bytes: 64 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, packs: 256, records: 100000 })
const slash = value => value.replace(/\\/g, '/')
const within = (base, target) => { const rel = relative(base, target); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) }

function simpleName(value, label) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/:\0]/.test(value) || value.startsWith('.')) throw new Error(`${label} 不是有效名称。`)
  return value
}

function relativeJs(value) {
  if (typeof value !== 'string' || !value || /[\0:]/.test(value) || isAbsolute(value)) throw new Error('file 必须是目录中列出的相对 .js 路径。')
  const normalized = slash(value)
  if (normalized.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || !normalized.endsWith('.js')) throw new Error('file 必须是目录中列出的相对 .js 路径。')
  return normalized
}

async function safeReal(root, target, directory = false) {
  const lexical = resolve(target)
  if (!within(root, lexical)) throw new Error('目录读取路径越界。')
  const info = await lstat(lexical)
  if (info.isSymbolicLink()) throw new Error('目录读取拒绝符号链接。')
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error(directory ? '不是可读取的目录。' : '不是可读取的文件。')
  const actual = await realpath(lexical)
  if (!within(root, actual)) throw new Error('目录读取真实路径越界。')
  return { actual, info }
}

async function readJs(root, target, remaining = LIMITS.bytes) {
  const checked = await safeReal(root, target)
  if (checked.info.size > remaining) throw new Error('本次读取总量超过只读目录上限。')
  if (checked.info.size > LIMITS.fileBytes) throw new Error('文件超过只读目录的大小上限。')
  const handle = await open(checked.actual, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > Math.min(LIMITS.fileBytes, remaining) || info.dev !== checked.info.dev || info.ino !== checked.info.ino) throw new Error('读取期间文件已更换或超过本次读取预算。')
    const buffer = Buffer.alloc(Math.min(info.size + 1, LIMITS.fileBytes + 1))
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    const bytes = buffer.subarray(0, length)
    if (bytes.length > LIMITS.fileBytes) throw new Error('读取期间文件超过只读目录的大小上限。')
    if (bytes.length !== info.size) throw new Error('读取期间文件已更换。')
    const again = await safeReal(root, target)
    if (again.actual !== checked.actual || again.info.dev !== info.dev || again.info.ino !== info.ino || again.info.size !== bytes.length || again.info.mtimeMs !== info.mtimeMs) throw new Error('读取期间文件已更换。')
    const code = bytes.toString('utf8')
    if (!Buffer.from(code, 'utf8').equals(bytes)) throw new Error('文件不是可无损读取的 UTF-8。')
    return { code, bytes: bytes.length }
  } finally { await handle.close() }
}

function issue(coverage, code, file, message) {
  coverage.gaps.push({ code, file: slash(file || ''), message: String(message).slice(0, 400) })
}

async function walkFiles(root, directory, coverage, budget) {
  const out = []
  let fileLimitReached = false, filesSeen = 0
  async function visit(dir, depth) {
    if (depth > LIMITS.depth) { issue(coverage, 'depth-limit', relative(root, dir), '递归深度超过只读目录上限。'); return }
    let entries
    try { await safeReal(root, dir, true); entries = await readdir(dir, { withFileTypes: true }) }
    catch (error) { issue(coverage, 'unreadable-directory', relative(root, dir), error.message); return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (budget.stopped || fileLimitReached) return
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const target = join(dir, entry.name), file = slash(relative(root, target))
      if (entry.isSymbolicLink()) { issue(coverage, 'symlink-skipped', file, '未跟随符号链接。'); continue }
      if (entry.isDirectory()) { await visit(target, depth + 1); continue }
      if (!entry.isFile() || !entry.name.endsWith('.js') || /\.\d{8}-\d{6}(?:-\d+)?\.js$/.test(entry.name)) continue
      if (++filesSeen > LIMITS.files) { fileLimitReached = true; issue(coverage, 'file-limit', file, '包内文件数超过只读目录上限。'); return }
      try {
        const loaded = await readJs(root, target, LIMITS.bytes - budget.bytes)
        if (budget.bytes + loaded.bytes > LIMITS.bytes) { budget.stopped = true; issue(coverage, 'byte-limit', file, '本次读取总量超过只读目录上限。'); return }
        budget.bytes += loaded.bytes; out.push({ file, code: loaded.code })
      } catch (error) { issue(coverage, 'unreadable-file', file, error.message) }
    }
  }
  await visit(directory, 0)
  return out
}

async function rootsOf(nonameDir) {
  if (typeof nonameDir !== 'string' || !nonameDir.trim()) throw new Error('未配置游戏目录，无法读取内容目录。')
  const root = await realpath(resolve(nonameDir))
  if (!(await lstat(root)).isDirectory()) throw new Error('游戏目录不存在。')
  return root
}

function normalizeOptions(options, reading = false) {
  const source = options.source || (reading ? '' : 'all'), kind = options.kind || (reading ? '' : 'all')
  if (!(reading ? SOURCES : ['all', ...SOURCES]).includes(source)) throw new Error('source 应为 builtin 或 extension，列目录时还可用 all。')
  if (!(reading ? KINDS : ['all', ...KINDS]).includes(kind)) throw new Error('kind 应为 character、card 或 mode，列目录时还可用 all。')
  if (options.pack != null) simpleName(options.pack, 'pack')
  if (reading && !options.pack) throw new Error('读取内容必须指定 pack。')
  return { source, kind, pack: options.pack || '', includeEntries: options.includeEntries === true || (options.includeEntries == null && !!options.pack) }
}

async function collectPackages(root, options, coverage, budget) {
  const candidates = []
  async function category(source, kind, categoryDir) {
    let entries
    try { await safeReal(root, categoryDir, true); entries = await readdir(categoryDir, { withFileTypes: true }) }
    catch (error) { issue(coverage, error.code === 'ENOENT' ? 'missing-root' : 'unreadable-root', relative(root, categoryDir), error.message); return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (budget.stopped) return
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      if (entry.isSymbolicLink()) { issue(coverage, 'symlink-skipped', relative(root, join(categoryDir, entry.name)), '未跟随包的符号链接。'); continue }
      const directory = entry.isDirectory(), js = entry.isFile() && entry.name.endsWith('.js')
      if ((!directory && !js) || (source === 'extension' && !directory)) continue
      if (source === 'builtin' && kind === 'character' && AUXILIARY_CHARACTER_FILES.has(entry.name)) { coverage.auxiliaryFiles.push(slash(relative(root, join(categoryDir, entry.name)))); continue }
      const pack = directory ? entry.name : basename(entry.name, '.js')
      if (options.pack && pack !== options.pack) continue
      if (candidates.length >= LIMITS.packs) { issue(coverage, 'pack-limit', relative(root, categoryDir), '包数超过只读目录上限。'); return }
      let files
      if (directory) files = await walkFiles(root, join(categoryDir, entry.name), coverage, budget)
      else {
        const file = slash(relative(root, join(categoryDir, entry.name)))
        try { const loaded = await readJs(root, join(categoryDir, entry.name), LIMITS.bytes - budget.bytes); if (budget.bytes + loaded.bytes > LIMITS.bytes) { budget.stopped = true; issue(coverage, 'byte-limit', file, '本次读取总量超过只读目录上限。'); return } budget.bytes += loaded.bytes; files = [{ file, code: loaded.code }] }
        catch (error) { issue(coverage, 'unreadable-file', file, error.message); files = [] }
      }
      const expected = directory ? slash(relative(root, join(categoryDir, entry.name, source === 'extension' ? 'extension.js' : 'index.js'))) : files[0]?.file
      const entryFile = files.find(f => f.file === expected)?.file || files[0]?.file || null
      candidates.push({ source, kind, pack, entryFile, files })
    }
  }
  if (options.source !== 'extension') for (const kind of KINDS.filter(k => options.kind === 'all' || options.kind === k)) await category('builtin', kind, join(root, kind))
  if (options.source !== 'builtin') await category('extension', null, join(root, 'extension'))
  return candidates
}

function modelPackage(candidate, coverage) {
  const modules = new Map(candidate.files.map(f => [f.file, f.code]))
  const tables = [], registrations = [], tableKeys = new Set(), registrationKeys = new Set()
  const f = candidate.files.find(file => file.file === candidate.entryFile) || candidate.files[0]
  if (f) {
    const model = sourceModel(f.code, { file: f.file, modules, allModules: candidate.source === 'extension' })
    coverage.filesRead += candidate.files.length
    if (!model.parsed && !(model.errors || []).length) issue(coverage, 'parse-failed', f.file, '无法静态解析。')
    for (const error of model.errors || []) issue(coverage, 'parse-failed', error?.file || f.file, typeof error === 'string' ? error : error.message || '无法静态解析。')
    for (const unresolved of model.unresolved || []) issue(coverage, 'static-unresolved', unresolved.file || f.file, unresolved.reason || '动态内容无法静态确认。')
    for (const table of model.tables || []) {
      const key = `${table.file}:${table.start}:${table.end}:${table.kind}:${table.id}`
      if (tableKeys.has(key)) continue
      const code = modules.get(table.file)
      if (typeof code !== 'string' || !Number.isInteger(table.start) || !Number.isInteger(table.end) || table.start < 0 || table.end < table.start || table.end >= code.length) { issue(coverage, 'invalid-static-range', table.file || f.file, '静态条目的文件或位置无效。'); continue }
      tableKeys.add(key); tables.push({ ...table, readOnly: true })
      if (tables.length >= LIMITS.records) { issue(coverage, 'record-limit', f.file, '条目数超过只读目录上限。'); break }
    }
    for (const registration of model.registrations || []) {
      let item = registration
      if (item.descriptor) {
        const { file, open, close } = item.descriptor, code = modules.get(file)
        if (typeof code !== 'string' || !Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close < open || close >= code.length) {
          issue(coverage, 'invalid-static-range', file || f.file, '注册描述符的文件或位置无效。')
          item = { ...item, descriptor: null, dynamic: true }
        }
      }
      const key = item.descriptor
        ? `${item.kind}:${item.id}:${item.descriptor.file}:${item.descriptor.open}:${item.descriptor.close}`
        : `${item.kind}:${item.id}:${item.file || f.file}:${item.start}`
      if (registrationKeys.has(key)) continue
      registrationKeys.add(key); registrations.push(item)
      if (item.dynamic || !item.id) issue(coverage, 'dynamic-registration', f.file, '注册 ID 或描述符无法完全静态确定。')
      if (registrations.length >= LIMITS.records) { issue(coverage, 'record-limit', f.file, '注册数超过只读目录上限。'); break }
    }
  }
  const names = new Map()
  for (const table of tables) if (table.kind === 'translate' && typeof table.literalValue === 'string' && !table.id.endsWith('_info') && !names.has(table.id)) names.set(table.id, table.literalValue)
  for (const table of tables) if (table.kind !== 'translate' && names.has(table.id)) table.name = names.get(table.id)
  return { ...candidate, modules, tables, registrations, names }
}

function publicEntry(entry) {
  const result = { kind: entry.kind, id: entry.id, file: entry.file, start: entry.start, end: entry.end, readOnly: true, indirect: !!entry.indirect }
  if (typeof entry.name === 'string') result.name = entry.name
  if (['character','card'].includes(entry.kind) && Array.isArray(entry.skillIds)) { result.skillIds = entry.skillIds; result.skillsDynamic = !!entry.skillsDynamic }
  return result
}

function summaries(candidate, options) {
  const categories = candidate.source === 'builtin' ? [candidate.kind] : KINDS.filter(kind => kind === 'mode' ? candidate.registrations.some(r => r.kind === 'mode' && r.id) : candidate.tables.some(t => t.kind === kind))
  return categories.filter(kind => options.kind === 'all' || options.kind === kind).map(kind => {
    const entries = candidate.tables.map(publicEntry)
    const modes = candidate.registrations.filter(r => r.kind === 'mode' && r.id).map(r => ({ kind: 'mode', id: r.id, name: candidate.names.get(r.id) || '', file: r.descriptor?.file || r.file || candidate.entryFile, ...(r.descriptor ? { start: r.descriptor.open, end: r.descriptor.close } : {}), ...(Number.isInteger(r.start) ? { registrationStart: r.start } : {}), ...(Number.isInteger(r.end) ? { registrationEnd: r.end } : {}), readOnly: true, dynamic: !!r.dynamic }))
    const types = ['character','card','skill','translate']
    const counts = Object.fromEntries(types.map(type => [type, new Set(entries.filter(e => e.kind === type).map(e => e.id)).size]))
    const definitionCounts = Object.fromEntries(types.map(type => [type, entries.filter(e => e.kind === type).length]))
    counts.mode = new Set(modes.map(mode => mode.id)).size; definitionCounts.mode = modes.length
    const groups = new Map()
    for (const entry of [...entries, ...modes]) { const key = `${entry.kind}:${entry.id}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry) }
    const ambiguities = [...groups.values()].filter(group => group.length > 1).map(group => ({ kind: group[0].kind, id: group[0].id, sources: group.map(({ file, start, end, registrationStart, registrationEnd }) => ({ ...(typeof file === 'string' ? { file } : {}), ...(Number.isInteger(start) ? { start } : {}), ...(Number.isInteger(end) ? { end } : {}), ...(Number.isInteger(registrationStart) ? { registrationStart } : {}), ...(Number.isInteger(registrationEnd) ? { registrationEnd } : {}) })) }))
    const result = { source: candidate.source, kind, pack: candidate.pack, readOnly: true, inventoryScope: candidate.source === 'builtin' ? 'registered-entry' : 'available-static-source', entryFile: candidate.entryFile, files: candidate.files.map(f => f.file), counts, definitionCounts, ambiguousIds: ambiguities.length, modes }
    if (options.includeEntries) { result.entries = entries; result.ambiguities = ambiguities }
    return result
  })
}

async function catalogState(nonameDir, options) {
  const root = await rootsOf(nonameDir), coverage = { staticOnly: true, runtimeEvaluated: false, complete: false, filesRead: 0, bytesRead: 0, auxiliaryFiles: [], gaps: [] }, budget = { bytes: 0 }
  const candidates = await collectPackages(root, options, coverage, budget)
  const packages = candidates.map(candidate => modelPackage(candidate, coverage))
  const seen = new Set()
  coverage.gaps = coverage.gaps.filter(g => { const key = `${g.code}:${g.file}:${g.message}`; if (seen.has(key)) return false; seen.add(key); return true })
  coverage.bytesRead = budget.bytes; coverage.complete = coverage.gaps.length === 0
  coverage.limits = LIMITS
  const snapshot = createHash('sha256')
  for (const candidate of candidates) for (const file of candidate.files) snapshot.update(file.file).update('\0').update(file.code).update('\0')
  snapshot.update(JSON.stringify(coverage.gaps))
  coverage.snapshot = snapshot.digest('hex')
  return { root, packages, coverage }
}

/** Static content inventory only. Official files never enter the extension write channel. */
export async function listCatalog(nonameDir, options = {}) {
  let coverage
  try {
    const normalized = normalizeOptions(options), state = await catalogState(nonameDir, normalized)
    coverage = state.coverage
    if (options.snapshot && options.snapshot !== coverage.snapshot) throw new Error('源码快照已变化，请从 offset:0 重新读取目录。')
    const all = state.packages.flatMap(candidate => summaries(candidate, normalized)), query = String(options.query || '').trim().toLocaleLowerCase()
    let packs, pagination
    if (normalized.pack && normalized.includeEntries) {
      const pool = new Map()
      for (const pack of all) for (const entry of [...pack.entries, ...pack.modes]) {
        const key = `${entry.kind}:${entry.id}:${entry.file}:${entry.start}:${entry.end}:${entry.registrationStart}`
        if ((!query || `${entry.kind}:${entry.id} ${entry.name || ''} ${entry.file}`.toLocaleLowerCase().includes(query)) && !pool.has(key)) pool.set(key, entry)
      }
      const page = pageRead([...pool.values()], options, 'entries'), selected = new Set(page.value.map(e => `${e.kind}:${e.id}`))
      pagination = page.pagination
      packs = all.map(pack => ({ ...pack, entries: page.value.filter(e => e.kind !== 'mode'), modes: page.value.filter(e => e.kind === 'mode'), ambiguities: pack.ambiguities.filter(a => selected.has(`${a.kind}:${a.id}`)) }))
    } else {
      const filtered = all.filter(pack => !query || `${pack.pack} ${pack.kind} ${pack.source}`.toLocaleLowerCase().includes(query)), page = pageRead(filtered, options, 'packs')
      packs = page.value; pagination = page.pagination
    }
    return { ok: !normalized.pack || all.length > 0, readOnly: true, source: normalized.source, kind: normalized.kind, packs, pagination, coverage, ...(!all.length && normalized.pack ? { error: coverage.complete ? '未找到指定内容包。' : '扫描不完整，不能判定指定内容包不存在；请查看 coverage。' } : {}) }
  } catch (error) { return { ok: false, readOnly: true, packs: [], ...(coverage ? { coverage } : {}), error: error.message } }
}

export async function readCatalog(nonameDir, options = {}) {
  let coverage
  try {
    const normalized = normalizeOptions(options, true), file = options.file == null ? null : relativeJs(options.file)
    const state = await catalogState(nonameDir, normalized)
    coverage = state.coverage
    if (options.snapshot && options.snapshot !== coverage.snapshot) throw new Error('源码快照已变化，请从 offset:0 重新读取。')
    const candidates = state.packages.filter(candidate => summaries(candidate, normalized).length)
    if (candidates.length !== 1) throw new Error(candidates.length ? '内容包归属不唯一。' : coverage.complete ? '未找到指定内容包。' : '扫描不完整，不能判定指定内容包不存在；请查看 coverage。')
    const candidate = candidates[0]
    const result = { ok: true, readOnly: true, source: normalized.source, kind: normalized.kind, pack: normalized.pack, coverage: state.coverage }
    if (options.entry != null) {
      const match = /^(character|card|skill|translate|mode):(.+)$/u.exec(String(options.entry))
      if (!match) throw new Error('entry 应为 kind:id，例如 character:caocao 或 mode:identity。')
      const [, kind, id] = match
      const entries = kind === 'mode'
        ? candidate.registrations.filter(r => r.kind === 'mode' && r.id === id && r.descriptor).map(r => ({ kind, id, file: r.descriptor.file, start: r.descriptor.open, end: r.descriptor.close, readOnly: true }))
        : candidate.tables.filter(t => t.kind === kind && t.id === id)
      const seen = new Set(), choices = entries.filter(entry => (!file || entry.file === file) && !seen.has(`${entry.file}:${entry.start}:${entry.end}`) && seen.add(`${entry.file}:${entry.start}:${entry.end}`))
      if (choices.length !== 1) return { ...result, ok: false, error: choices.length ? '同名条目有多个来源，请用 file 明确选择；同文件重复条目不可猜选。' : kind === 'mode' && candidate.registrations.some(r => r.kind === kind && r.id === id && !r.descriptor) ? '已识别该模式注册，但描述符为动态内容，无法静态读取；请按文件读取原文。' : coverage.complete ? '未找到指定条目。' : '扫描不完整，不能判定指定条目不存在；请查看 coverage。', candidates: choices.map(publicEntry) }
      const entry = choices[0], code = candidate.modules.get(entry.file)
      if (typeof code !== 'string' || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 || entry.end >= code.length || entry.end < entry.start) throw new Error('静态条目的文件或位置无效。')
      const page = pageRead(code.slice(entry.start, entry.end + 1), options)
      return { ...result, file: entry.file, entry: publicEntry(entry), code: page.value, pagination: page.pagination }
    }
    const target = file || candidate.entryFile
    if (!target || !candidate.modules.has(target)) throw new Error('file 不属于所选内容包。')
    const page = pageRead(candidate.modules.get(target), options)
    return { ...result, file: target, code: page.value, pagination: page.pagination }
  } catch (error) { return { ok: false, readOnly: true, ...(coverage ? { coverage } : {}), error: error.message } }
}

import { lstat, realpath, open, readdir } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { sourceModel } from './module-parser.js'
import { scanEffectiveAnchored } from './blocks.js'

export const PACKAGE_READ_LIMITS = Object.freeze({ fileBytes: 12 * 1024 * 1024, bytes: 64 * 1024 * 1024, files: 512, depth: 12, metadataBytes: 256 * 1024 })
const SKIP = new Set(['backup', 'image', 'audio', 'node_modules', '.git', 'font'])
const slash = value => value.replaceAll('\\', '/')
const within = (root, target) => { const rel = relative(root, target); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep) }
export function readGap(coverage, code, file, message) {
  coverage.gaps.push({ code, file: slash(file || ''), message: String(message).slice(0, 400) })
  coverage.complete = false
}
export function readCoverage() { return { staticOnly: true, runtimeEvaluated: false, complete: true, filesRead: 0, bytesRead: 0, limits: PACKAGE_READ_LIMITS, gaps: [] } }

async function checkedPath(root, target, directory = false) {
  root = resolve(root); target = resolve(target)
  if (!within(root, target)) throw new Error('只读路径越界。')
  let at = root
  for (const part of ['', ...relative(root, target).split(sep).filter(Boolean)]) {
    if (part) at = join(at, part)
    if ((await lstat(at)).isSymbolicLink()) throw new Error('只读路径含符号链接或目录链接。')
  }
  const info = await lstat(target), actual = await realpath(target)
  if (!within(root, actual) || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('目标不是包内可读取的' + (directory ? '目录。' : '文件。'))
  return { info, actual }
}

/** Preflight and reserve the byte budget before allocating or reading source text. */
export async function readBoundedUtf8(root, target, maximum = PACKAGE_READ_LIMITS.fileBytes) {
  const checked = await checkedPath(root, target)
  if (checked.info.size > maximum) throw Object.assign(new Error(`文件为 ${checked.info.size} 字节，超过本次只读上限 ${maximum} 字节；5 GiB 上限仅用于分块搜索，不用于 AST 解析。请用搜索定位并缩小读取范围。`), { code: 'resource-limit' })
  const handle = await open(checked.actual, 'r')
  try {
    const before = await handle.stat()
    if (before.size > maximum || !before.isFile() || before.dev !== checked.info.dev || before.ino !== checked.info.ino) throw new Error('读取期间文件已更换。')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const next = await handle.read(bytes, length, bytes.length - length, length)
      if (!next.bytesRead) break
      length += next.bytesRead
    }
    const after = await handle.stat(), checkedAgain = await checkedPath(root, target)
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || checkedAgain.actual !== checked.actual || checkedAgain.info.dev !== before.dev || checkedAgain.info.ino !== before.ino || checkedAgain.info.size !== before.size || checkedAgain.info.mtimeMs !== before.mtimeMs) throw new Error('读取期间文件已更换。')
    const raw = bytes.subarray(0, length), code = raw.toString('utf8')
    if (!Buffer.from(code, 'utf8').equals(raw)) throw new Error('文件不是可无损读取的 UTF-8。')
    return { code, bytes: length, hash: createHash('sha256').update(raw).digest('hex') }
  } finally { await handle.close() }
}

export async function loadPackageSources(root) {
  const coverage = readCoverage(), modules = new Map(), inventory = []
  let count = 0, stopped = false
  async function walk(dir, depth) {
    if (stopped) return
    if (depth > PACKAGE_READ_LIMITS.depth) { readGap(coverage, 'depth-limit', relative(root, dir), '递归深度超过只读上限。'); return }
    let entries
    try { await checkedPath(root, dir, true); entries = await readdir(dir, { withFileTypes: true }) }
    catch (error) { readGap(coverage, 'unreadable-directory', relative(root, dir), error.message); return }
    entries.sort((a, b) => a.name === 'extension.js' ? -1 : b.name === 'extension.js' ? 1 : a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (stopped) return
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const target = join(dir, entry.name), file = slash(relative(root, target))
      if (entry.isSymbolicLink()) { readGap(coverage, 'symlink-skipped', file, '未跟随符号链接或目录链接。'); continue }
      if (entry.isDirectory()) { await walk(target, depth + 1); continue }
      if (!entry.isFile() || !/\.js$/i.test(entry.name) || /^[\w.-]+\.(?:pre-rollback\.)?\d{8}-\d{6}(?:-\d{6})?\.js$/i.test(entry.name)) continue
      if (++count > PACKAGE_READ_LIMITS.files) { stopped = true; readGap(coverage, 'file-limit', file, '包内文件数超过只读上限；请按文件读取或搜索。'); return }
      const maximum = Math.min(PACKAGE_READ_LIMITS.fileBytes, PACKAGE_READ_LIMITS.bytes - coverage.bytesRead)
      try {
        const loaded = await readBoundedUtf8(root, target, maximum)
        coverage.bytesRead += loaded.bytes; coverage.filesRead++
        modules.set(file, loaded.code); inventory.push({ file, bytes: loaded.bytes, hash: loaded.hash })
      } catch (error) { inventory.push({ file, error: error.code || 'unreadable-file' }); readGap(coverage, error.code || 'unreadable-file', file, error.message) }
    }
  }
  await walk(root, 0)
  coverage.snapshot = createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
  return { modules, coverage }
}

/** A single shared module graph supplies every block's physical file and offsets. */
export function packageBlocks(state) {
  const { modules, coverage } = state, file = modules.has('extension.js') ? 'extension.js' : modules.keys().next().value
  if (!file) return { ...state, blocks: [], tables: [] }
  const model = sourceModel(modules.get(file), { file, modules, allModules: true })
  for (const error of model.errors || []) readGap(coverage, 'parse-failed', error.file || file, error.message || '无法静态解析。')
  for (const item of model.unresolved || []) readGap(coverage, 'static-unresolved', item.file || file, item.reason || '动态内容无法静态确认。')
  const unique = new Map()
  for (const table of model.tables || []) {
    const code = modules.get(table.file)
    if (typeof code !== 'string' || !Number.isInteger(table.start) || !Number.isInteger(table.end) || table.start < 0 || table.end < table.start || table.end >= code.length) { readGap(coverage, 'invalid-static-range', table.file, '静态来源位置无效。'); continue }
    unique.set(`${table.kind}:${table.file}:${table.start}:${table.end}`, table)
  }
  const tables = [...unique.values()], blocks = [], translations = new Map(), anchors = new Map()
  for (const [name, code] of modules) anchors.set(name, scanEffectiveAnchored(code, { file: name }))
  for (const table of tables) {
    if (table.kind === 'translate') {
      const id = table.id.replace(/_info$/, ''), key = `${table.file}:${table.sectionStart}:${id}`
      if (!translations.has(key)) translations.set(key, [])
      translations.get(key).push(table)
    } else blocks.push({ ...table, key: `${table.kind}:${table.id}`, text: modules.get(table.file).slice(table.start, table.end + 1) })
  }
  for (const parts of translations.values()) {
    parts.sort((a, b) => a.start - b.start)
    const first = parts[0], id = first.id.replace(/_info$/, ''), start = first.start, end = parts.at(-1).end, code = modules.get(first.file)
    const contiguous = parts.every((part, i) => i === 0 || /^(?:\s|,|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(code.slice(parts[i - 1].end + 1, part.start)))
    const ambiguous = new Set(parts.map(p => p.id)).size !== parts.length
    blocks.push({ key: 'translate:' + id, kind: 'translate', id, file: first.file, start, end, readOnly: ambiguous || parts.some(p => p.readOnly), contiguous, ambiguous,
      ...(ambiguous ? { sources: parts.map(p => ({ file: p.file, start: p.start, end: p.end, id: p.id })) } : {}),
      text: contiguous ? code.slice(start, end + 1) : parts.map(p => code.slice(p.start, p.end + 1)).join(',\n') })
  }
  const counts = new Map()
  for (const block of blocks) counts.set(block.key, (counts.get(block.key) || 0) + 1)
  for (const block of blocks) {
    block.ambiguous = !!block.ambiguous || counts.get(block.key) > 1
    const hit = !block.ambiguous && anchors.get(block.file).find(a => a.key === block.key && block.start >= a.innerStart && block.end < a.innerEnd)
    if (hit) block.text = hit.text
    block.virtual = !hit; block.lines = block.text.split('\n').length
  }
  return { ...state, blocks, tables }
}

export function pageRead(items, options = {}, unit = 'characters') {
  const maximum = unit === 'entries' || unit === 'packs' ? 200 : 16000, fallback = unit === 'entries' || unit === 'packs' ? 50 : 8000
  const offset = options.offset == null ? 0 : Number(options.offset), limit = options.limit == null ? fallback : Number(options.limit)
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new Error(`offset 必须为非负整数，limit 必须在 1–${maximum} 之间。`)
  const total = items.length
  let end = Math.min(total, offset + limit)
  const text = typeof items === 'string'
  const splitsPair = at => at > 0 && at < total && /[\uD800-\uDBFF]/.test(items[at - 1]) && /[\uDC00-\uDFFF]/.test(items[at])
  if (text) {
    if (splitsPair(offset)) throw new Error('offset 位于 UTF-16 字符对中间；请使用 pagination.nextOffset 或从完整字符边界重新读取。')
    if (splitsPair(end)) end--
    // A one-unit budget still advances past a complete supplementary character.
    if (end === offset && offset < total) end = Math.min(total, offset + 2)
  }
  return { value: items.slice(offset, end), pagination: { offset, limit, total, nextOffset: end < total ? end : null, complete: end >= total, unit,
    ...(text ? { actualLength: Math.max(0, end - offset), codePointSafe: true, ...(end - offset > limit ? { limitAdjustedForCodePoint: true } : {}) } : {}) } }
}

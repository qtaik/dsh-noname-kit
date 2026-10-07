/**
 * noname-kit 扩展文件读写:所有对 <nonameDir>/extension/** 的落盘都经过这里。
 * 路径安全:文件夹名只允许安全字符,解析后必须仍在 extension 目录内
 * (防路径逃逸)。覆盖前自动备份到 <文件夹>/backup/。
 */
import { copyFile, mkdir, readFile, readdir, writeFile, unlink, stat } from 'node:fs/promises'
import { join, resolve, basename, relative, sep, dirname } from 'node:path'
import { validateExtensionCode, syntaxCheck, collectDefinedIds } from './validate.js'
import { scanAnchored, scanBlocks, extractBlock, assembleBlocks, checkFidelity, migrateCode, stripAnchors, findAllSections, sectionProperties, virtualCharacterBlocks, virtualCardBlocks, virtualBlocks, virtualTranslateBlocks, CONTENT_KINDS } from './blocks.js'

const FOLDER_RE = /^[\w\u4e00-\u9fff-]{1,64}$/

/** 多文件包扫描时跳过的目录(素材/备份/依赖,绝不会有条目)。 */
const SKIP_DIRS = new Set(['backup', 'image', 'audio', 'node_modules', '.git'])

export function extRootOf(nonameDir) {
  return join(resolve(nonameDir), 'extension')
}

/** 校验文件夹名并解析出安全绝对路径;逃逸直接抛错。 */
export function safeFolderPath(nonameDir, folder) {
  if (typeof folder !== 'string' || !FOLDER_RE.test(folder)) {
    throw new Error(`非法的扩展文件夹名「${folder}」:只允许中文/字母/数字/下划线/连字符,长度 1-64。`)
  }
  const root = extRootOf(nonameDir)
  const full = resolve(root, folder)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('路径越界:目标不在 extension 目录内。')
  }
  return { root, full }
}

/**
 * 解析「条目文件」参数(ES Module 多文件包的条目在子目录模块里,如
 * character/character.js)。file 缺省 = extension.js(单文件包,完全向后兼容);
 * 只允许包内相对 .js 路径,禁 ..,resolve 后必须仍在包目录内。
 * @returns {{rel:string, full:string}} rel 为 POSIX 斜杠相对路径
 */
export function safeEntryFilePath(nonameDir, folder, file) {
  const { full: folderFull } = safeFolderPath(nonameDir, folder)
  const rel = file == null || file === '' ? 'extension.js' : String(file).split('\\').join('/')
  if (!/\.js$/i.test(rel) || rel.includes('..') || rel.startsWith('/')) {
    throw new Error(`非法的条目文件路径「${file}」:必须是扩展包内的相对 .js 路径。`)
  }
  const full = resolve(folderFull, rel)
  if (!full.startsWith(folderFull + sep)) {
    throw new Error('路径越界:目标文件不在扩展包目录内。')
  }
  return { rel, full }
}

/** 递归枚举扩展包内全部 .js(POSIX 相对路径;跳过 backup/image/audio 等目录)。 */
export async function listPackageJsFiles(nonameDir, folder) {
  const { full: folderFull } = safeFolderPath(nonameDir, folder)
  const out = []
  async function walk(dir, rel) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        await walk(join(dir, e.name), childRel)
      } else if (e.isFile() && /\.js$/i.test(e.name)) {
        // 历史备份文件(1.5.0 曾误写到包根):extension.<时间戳>.js 命名,不是源码,排除
        if (/^[\w.-]+\.(?:pre-rollback\.)?\d{8}-\d{6}(?:-\d{6})?\.js$/i.test(e.name)) continue
        out.push(childRel)
      }
    }
  }
  await walk(folderFull, '')
  return out.sort((a, b) => (a === 'extension.js' ? -1 : b === 'extension.js' ? 1 : a.localeCompare(b)))
}

let lastStampSeq = 0
/* 备份名时间戳:精确到毫秒 + 进程内递增。此前只到秒——同一秒内连写两次
 * (AI 一轮里"写入→改一处→再写"很常见)备份名完全相同,后一次把前一次的
 * 备份直接覆盖掉,BACKUP_KEEP=3 名不副实、可回滚的历史只剩最后一次。 */
function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  lastStampSeq = (lastStampSeq + 1) % 1000
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms}${String(lastStampSeq).padStart(3, '0')}`
}

/** 每个备份目录保留的最新备份数(超出按文件修改时间从旧到新删除)。 */
const BACKUP_KEEP = 3

/**
 * 备份滚动清理:backupDir 里只保留最新 BACKUP_KEEP 个 .js 备份,其余删除。
 * 返回被删文件的相对路径(相对 nonameDir,POSIX)——供调用方同步清理
 * history.backups 登记,避免登记指向已不存在的文件。
 */
async function pruneBackups(backupDir, relBase) {
  let names
  try { names = await readdir(backupDir) } catch { return [] }
  const stats = []
  for (const n of names) {
    if (!/\.js$/i.test(n)) continue
    try { stats.push({ n, m: (await stat(join(backupDir, n))).mtimeMs }) } catch { /* 刚被并发删掉 */ }
  }
  stats.sort((a, b) => b.m - a.m)
  const removed = []
  for (const s of stats.slice(BACKUP_KEEP)) {
    try { await unlink(join(backupDir, s.n)); removed.push((relBase + '/' + s.n).replace(/\\/g, '/')) } catch { /* 已不存在 */ }
  }
  return removed
}

/** 备份文件清理后,同步清掉 history 里指向它们的登记(含「回滚自 x」类文案条目)。 */
async function pruneHistoryBackups(nonameDir, folder, removedFiles) {
  if (!removedFiles.length) return
  try {
    const h = await import('./history.js') // 动态加载避免 write↔history 循环依赖
    await h.pruneBackupRecords(nonameDir, folder, removedFiles)
  } catch { /* 登记清理失败不影响写入主流程 */ }
}

/**
 * 校验并写入扩展。两种模式:
 * - 全文模式(默认):提交 code 全文;存量包可带 editScope 做保真校验
 *   (范围外区块必须与旧文件逐字节一致,否则拒写)。
 * - 区块模式(提交 blocks/edits/deletes 之一即触发):AI 只提交改动的区块,
 *   其余文本由工具从旧文件逐字节保留——未提交区域物理上不可能被改。
 * @returns 校验失败 → {ok:false, wrote:false, errors, warnings};成功 → {ok:true, wrote:true, path, backup, infoWritten};
 *          manual 模式 → {ok:true, wrote:false, code};file 指向模块文件时语义门禁降级为纯语法检查
 */
/** collect all backup/ dirs inside the package (subdir modules each keep their own). */
async function collectBackupDirs(folderFull) {
  const dirs = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const child = join(dir, e.name)
      if (e.name === 'backup') { dirs.push(child); continue } // backup 内不再嵌套,不递归
      if (SKIP_DIRS.has(e.name)) continue
      await walk(child)
    }
  }
  await walk(folderFull)
  return dirs
}

/** 主动清理整个扩展包的全部 backup/(工坊历史面板按钮):
 *  每目录保留最新 3 个,并同步清除 history 里指向被删文件的登记。 */
export async function prunePackageBackups(nonameDir, folder) {
  const { full } = safeFolderPath(nonameDir, folder)
  try { await readdir(full) } catch { return { ok: false, error: '扩展包不存在。' } }
  const dirs = await collectBackupDirs(full)
  const allRemoved = []
  let touchedDirs = 0
  for (const d of dirs) {
    const removed = await pruneBackups(d, relative(nonameDir, d))
    if (removed.length) { touchedDirs++; allRemoved.push(...removed) }
  }
  await pruneHistoryBackups(nonameDir, folder, allRemoved)
  return { ok: true, removedCount: allRemoved.length, dirs: touchedDirs }
}

export async function writeExtension(nonameDir, { folder, file, code, blocks, edits, deletes, editScope, style, kind, infoJson, idPrefix, writeMode }) {
  const blockMode = Array.isArray(blocks) || Array.isArray(edits) || Array.isArray(deletes)
  const full = safeFolderPath(nonameDir, folder).full
  await mkdir(full, { recursive: true })
  const entryPath = safeEntryFilePath(nonameDir, folder, file)
  const target = entryPath.full

  // 旧文件:两种模式都先读(区块模式组装、全文模式保真/防丢都依赖它)
  let oldCode = null
  try { oldCode = await readFile(target, 'utf8') } catch { /* 首次写入,无旧文件 */ }
  await mkdir(dirname(target), { recursive: true })

  let finalCode = code
  const preErrors = []
  if (blockMode) {
    if (!oldCode) preErrors.push('区块模式用于已有扩展:新包首写请用全文模式(提交 code 参数,骨架模板自带锚点)。')
    else if (!scanAnchored(oldCode).length) preErrors.push('该文件尚未建立区块索引:请在工坊点「建立区块索引」,或用全文模式写入一次后重试。')
    else {
      const r = assembleBlocks(oldCode, blocks || [], edits || [], deletes || [])
      if (r.errors.length) preErrors.push(...r.errors)
      else finalCode = r.code
    }
    if (preErrors.length) return { ok: false, wrote: false, errors: preErrors.map((m) => ({ message: m })), warnings: [] }
  } else if (oldCode && Array.isArray(editScope)) {
    // 全文模式保真校验:范围外区块逐字节一致(虚拟区块,只读不写)
    const f = checkFidelity(oldCode, code, editScope)
    if (!f.ok) {
      return {
        ok: false, wrote: false,
        errors: f.changed.map((id) => ({ message: `区块「${id}」不在本次申报范围(editScope)内却被修改——未申报的改动一律拒写;如确要修改,请把它加入 editScope 后重试。` })),
        warnings: [],
      }
    }
  }

  // 模块文件(多文件包的子目录 .js,如 character/character.js)不是完整扩展,
  // 没有 name/translate,扩展语义规则对它不适用——只做纯语法检查(且强制按
  // module 剥离 import/export,子目录模块按定义就是 ESM,不信任调用方 style)。
  // 判定用归一化后的 rel:AI 显式传 'extension.js' 时仍是入口文件,门禁不降级。
  const isModuleFile = entryPath.rel !== 'extension.js'
  const verdict = isModuleFile
    ? syntaxCheck(finalCode, 'module')
    : validateExtensionCode({ code: finalCode, style, kind, folder, idPrefix })
  if (!verdict.ok) {
    if (isModuleFile) return { ok: false, wrote: false, errors: [{ message: verdict.message || '语法错误' }], warnings: [] }
    return { ...verdict, wrote: false }
  }

  // 防丢技能护栏:旧代码里定义、新代码里消失的内部 ID → 拒写。
  // 比对前剥掉锚点注释行(锚点是纯注释,ID 语义不变,但会隔断 collectDefinedIds 的匹配)。
  // 区块模式下 deletes[] 声明的删除豁免;多技能逐个实现时这是安全网。
  if (oldCode) {
    const oldIds = collectDefinedIds(stripAnchors(oldCode))
    const newIds = new Set(collectDefinedIds(stripAnchors(finalCode)))
    const declared = new Set((deletes || []).map((k) => String(k).split(':')[1] || k))
    const lost = [...oldIds].filter((id) => !newIds.has(id) && !declared.has(id))
    if (lost.length > 0) {
      return {
        ok: false, wrote: false,
        errors: [{ message: `检测到 ${lost.length} 个内部 ID 在新代码中消失: ${lost.join(', ')}——直接覆盖会丢失它们。若确要删除,请在需求中明确说明后再试;否则请把它们的定义补回新代码。` }],
        warnings: [],
      }
    }
  }

  // 手动复制模式:所有门禁过了之后,返回组装/校验后的代码,不落盘
  if (writeMode === 'manual') return { ...verdict, wrote: false, code: finalCode }

  // 覆盖前备份(路径记成相对 nonameDir 的全相对路径——render 直接展示给 AI/用户,
  // 只给 "backup/x.js" 的话对方不知道该在哪个目录下找,实测要试错一次)
  let backup = ''
  if (oldCode) {
    const backupDir = join(dirname(target), 'backup')
    await mkdir(backupDir, { recursive: true })
    backup = join(relative(nonameDir, backupDir), `${basename(target, '.js')}.${timestamp()}.js`).split(sep).join('/')
    await copyFile(target, join(backupDir, basename(backup)))
    await pruneHistoryBackups(nonameDir, folder, await pruneBackups(backupDir, relative(nonameDir, backupDir)))
  }
  await writeFile(target, finalCode, 'utf8')

  // 初值必须是 boolean 而非 null/null 省略:info.json 已存在且本次未提交时,
  // infoWritten 会一直保持初值——null 过不了 output schema
  let infoWritten = false
  if (infoJson && String(infoJson).trim()) {
    const infoPath = join(full, 'info.json')
    try {
      const parsed = JSON.parse(infoJson)
      await writeFile(infoPath, JSON.stringify(parsed, null, 2), 'utf8')
      infoWritten = true
    } catch (error) {
      return { ...verdict, wrote: true, path: relative(nonameDir, target).split(sep).join('/'), backup, infoError: `info.json 不是合法 JSON,未写入: ${error.message}` }
    }
  } else {
    // 没提供 info.json 时,若也不存在则写一份最小可用的
    try { await readFile(join(full, 'info.json'), 'utf8') } catch {
      await writeFile(join(full, 'info.json'), JSON.stringify({ name: folder, author: '', diskURL: '', forumURL: '', version: '1.0' }, null, 2), 'utf8')
      infoWritten = true
    }
  }

  return { ...verdict, wrote: true, path: relative(nonameDir, target).split('\\').join('/'), backup, infoWritten }
}

/**
 * 读取扩展内容。file 缺省 = extension.js。
 * - 默认:该文件全文整读(兼容)
 * - opts.listBlocks=true:未指定 file 时**聚合全包**(每块带 file 归属、顶层 files
 *   清单);指定 file 时只返回该文件的目录
 * - opts.block='kind:id':file 给定 → 只在该文件找;未给定 → 先 extension.js,
 *   找不到再按序扫全包,首个命中即返回(块带 file)
 */
export async function readExtension(nonameDir, folder, opts = {}) {
  const { full } = safeFolderPath(nonameDir, folder)
  const fileRel = opts.file == null || opts.file === '' ? 'extension.js' : String(opts.file).split('\\').join('/')
  const target = safeEntryFilePath(nonameDir, folder, fileRel).full
  const names = await readdir(full)
  const result = { folder, file: fileRel, files: names.filter((n) => !n.startsWith('.')) }
  let code
  try { code = await readFile(target, 'utf8') } catch { /* 文件可能不存在(多文件包的壳可能极短或没有) */ }
  if (opts.listBlocks) {
    if (opts.file == null || opts.file === '') {
      // 聚合全包:每个含条目的文件一段目录,块带 file 归属
      const files = await listPackageJsFiles(nonameDir, folder)
      const blocks = []
      const fileSummaries = []
      for (const f of files) {
        let c
        try { c = await readFile(join(full, f), 'utf8') } catch { continue }
        const sb = scanBlocks(c)
        if (!sb.blocks.length) continue
        fileSummaries.push({ file: f, anchored: sb.anchored, blocks: sb.blocks.length })
        for (const b of sb.blocks) blocks.push({ ...b, file: f })
      }
      result.blocks = { anchored: fileSummaries.some((f) => f.anchored), blocks, files: fileSummaries }
    } else {
      result.blocks = code !== undefined
        ? scanBlocks(code)
        : { anchored: false, blocks: [] }
    }
  } else if (opts.block) {
    const m = /^(\w+):([\w-]+)$/.exec(String(opts.block))
    if (!m) result.error = 'block 参数格式应为 kind:id,例如 skill:cs_tianfa。'
    else {
      let fileMissing = false
      // 查找范围:指定 file → 只查该文件;未指定 → 先 extension.js,再扫全包
      // (多文件包的壳 extension.js 里没有条目,不能因为它存在就停止查找)
      let tryFiles
      if (opts.file != null && opts.file !== '') tryFiles = [fileRel]
      else tryFiles = ['extension.js', ...(await listPackageJsFiles(nonameDir, folder)).filter((f) => f !== 'extension.js')]
      for (const f of tryFiles) {
        let c
        try { c = await readFile(join(full, f), 'utf8') } catch { if (f === fileRel) fileMissing = true; continue }
        const text = extractBlock(c, m[1], m[2])
        if (text != null) { result.code = text; result.block = { kind: m[1], id: m[2], file: f }; break }
      }
      if (result.code === undefined) result.error = fileMissing ? `文件 ${fileRel} 不存在。` : `未找到区块「${opts.block}」(可用 listBlocks 查看目录)。`
    }
  } else if (code !== undefined) {
    result.code = code
  }
  if (names.includes('info.json')) {
    try {
      const parsedInfo = JSON.parse(await readFile(join(full, 'info.json'), 'utf8'))
      // 顶层必须是对象(写入通道不拦数组/字符串等非常规 JSON,但返回给工具前要
      // 过 schema——info 声明为 object,非对象会让整个读取结果被拒收)
      result.info = parsedInfo && typeof parsedInfo === 'object' && !Array.isArray(parsedInfo) ? parsedInfo : {}
    } catch { result.info = {} }
  }
  return result
}

/**
 * 锚点化迁移(用户在工坊手动触发,AI 侧没有任何工具能调它):对无锚老文件插入
 * 锚点注释行,一个代码字符不动;写前跑语法校验(不过不落盘),通过后自动备份再写。
 * file 缺省 = extension.js;多文件包对子目录模块文件逐个迁移。
 */
export async function migrateAnchors(nonameDir, folder, file) {
  const target = safeEntryFilePath(nonameDir, folder, file).full
  let oldCode
  try { oldCode = await readFile(target, 'utf8') } catch { return { ok: false, error: '该文件不存在。' } }
  const r = migrateCode(oldCode)
  if (r.error) return { ok: false, error: r.error }
  const style = /game\.import\(/.test(r.code) ? 'classic' : 'module'
  // 迁移只加注释行,自检用纯语法检查即可;模块文件没有 name 字段,
  // validateExtensionCode 的语义规则(name 必有等)对它不适用
  const verdict = syntaxCheck(r.code, style)
  if (!verdict.ok) return { ok: false, error: '迁移后语法校验失败(不应发生,已放弃写入): ' + (verdict.message || '未知') }
  const backupDir = join(dirname(target), 'backup')
  await mkdir(backupDir, { recursive: true })
  const backup = join(relative(nonameDir, backupDir), `${basename(target, '.js')}.${timestamp()}.js`).split(sep).join('/')
  await copyFile(target, join(backupDir, basename(backup)))
  await pruneHistoryBackups(nonameDir, folder, await pruneBackups(backupDir, relative(nonameDir, backupDir)))
  await writeFile(target, r.code, 'utf8')
  return { ok: true, inserted: r.inserted, commas: r.commas, blocks: r.blocks, backup }
}

/**
 * 多文件迁移:遍历包内全部 .js,对「含可锚定条目」的文件逐个锚点化(幂等:
 * 已锚文件剥旧锚重打;无条目的壳文件如 extension.js / index.js 自动跳过)。
 * 返回逐文件明细;全部失败才 ok:false。
 */
export async function migrateExtension(nonameDir, folder) {
  const files = await listPackageJsFiles(nonameDir, folder)
  if (!files.length) return { ok: false, error: '扩展包里没有任何 .js 文件。' }
  const results = []
  for (const file of files) {
    let code
    try { code = await readFile(safeEntryFilePath(nonameDir, folder, file).full, 'utf8') } catch { continue }
    const virtual = virtualEntryCount(code)
    if (!virtual) continue // 壳文件/无条目文件:跳过
    const r = await migrateAnchors(nonameDir, folder, file)
    results.push({ file, ...r, entries: virtual })
  }
  const done = results.filter((r) => r.ok)
  if (!done.length) {
    const firstErr = results.find((r) => r.error)
    return { ok: false, error: firstErr ? `迁移失败: ${firstErr.file} —— ${firstErr.error}` : '包内没有可锚定的条目(所有文件均为空或无法识别)。' }
  }
  return {
    ok: true,
    files: done.map((r) => ({ file: r.file, inserted: r.inserted, commas: r.commas, blocks: r.blocks, entries: r.entries, backup: r.backup })),
    filesSkipped: files.length - results.filter((r) => r.ok || r.error).length,
    failed: results.filter((r) => r.error).map((r) => ({ file: r.file, error: r.error })),
    totalFiles: done.length,
    totalInserted: done.reduce((n, r) => n + r.inserted, 0),
    totalCommas: done.reduce((n, r) => n + r.commas, 0),
    totalBlocks: done.reduce((n, r) => n + r.blocks, 0),
  }
}

/** 某文件内全部可锚定条目数(四种 kind 合计,translate 走独立分组)。 */
function virtualEntryCount(code) {
  return CONTENT_KINDS.reduce((n, kind) => n + virtualBlocks(code, kind).length, 0)
    + virtualTranslateBlocks(code).length
}

/** 列出某扩展的备份文件(新→旧)。 */
export async function listBackups(nonameDir, folder) {
  const { full } = safeFolderPath(nonameDir, folder)
  const out = []
  /* 递归:多文件包的模块文件各自备份在自己的 backup/(character/backup/…),
   * 只读包根的 backup/ 会让子目录备份"看不见、也回滚不了"(实测)。 */
  const walk = async (dir, prefix) => {
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'backup') {
          try {
            for (const n of (await readdir(abs)).filter((x) => x.endsWith('.js')).sort().reverse()) {
              /* 必须带 backup/ 段:回滚接口按「…/backup/文件名」定位,漏了这段
               * 它就会说"非法的备份路径"——列表与回滚互相不认(实测) */
              out.push((prefix ? prefix + '/' : '') + 'backup/' + n)
            }
          } catch { /* 忽略 */ }
        } else if (e.name !== 'image' && e.name !== 'audio' && e.name !== 'node_modules' && !e.name.startsWith('.')) {
          await walk(abs, prefix ? prefix + '/' + e.name : e.name)
        }
      }
    }
  }
  await walk(full, '')
  return out.sort().reverse()
}

/** 回滚:把指定备份覆盖回 extension.js。返回旧内容备份名。 */
export async function rollbackExtension(nonameDir, folder, backupName) {
  /* 接受两种形态:
   *   "extension.20261007-...js"                —— 包根 backup/ 里的(旧客户端)
   *   "character/backup/character.2026...js"    —— 子目录模块的备份(多文件包)
   * 子目录形态写回集 / 必须有 /backup/ 段,其余按包内相对路径定位。 */
  const rel = String(backupName || '').split('\\').join('/')
  if (rel.includes('..') || rel.startsWith('/') || !/\.js$/.test(rel)) {
    throw new Error('非法的备份文件名。')
  }
  const { full } = safeFolderPath(nonameDir, folder)
  let backupPath
  let target
  const segs = rel.split('/')
  if (segs.length === 1) {
    if (!/^[\w.-]+\.js$/.test(segs[0])) throw new Error('非法的备份文件名。')
    backupPath = join(full, 'backup', segs[0])
    /* 备份名带源文件基名(extension.<ts>.js / index.<ts>.js):
     * 按基名还原目标,别再一律往 extension.js 里灌(包根有非入口模块时写错文件) */
    const m = /^(.*?)\.(?:pre-rollback\.)?\d{8}-\d{6}(?:-\d{6})?\.js$/i.exec(segs[0])
    target = join(full, (m ? m[1] : 'extension') + '.js')
  } else {
    const backupIdx = segs.lastIndexOf('backup')
    if (backupIdx <= 0 || backupIdx === segs.length - 1) throw new Error('非法的备份路径。')
    const backupFile = segs[backupIdx + 1]
    if (!/^[\w.-]+\.js$/.test(backupFile)) throw new Error('非法的备份文件名。')
    const dirSegs = segs.slice(0, backupIdx)
    const nameSegs = segs.slice(backupIdx + 1)
    if (dirSegs.some((x) => !/^[\w.-]+$/.test(x)) || nameSegs.some((x) => !/^[\w.-]+\.js$/.test(x))) {
      throw new Error('非法的备份路径。')
    }
    backupPath = join(full, ...dirSegs, 'backup', ...nameSegs)
    /* 备份名形如 character.20261008-002610-285001.js / extension.pre-rollback.<ts>.js
     * ——目标是**源文件**,必须把时间戳段剥掉还原(否则旧内容被写成一个新垃圾文件、
     * 真源文件纹丝不动,还返回"回滚成功":实测踩过) */
    const restoredNames = nameSegs.map((n) => {
      const m = /^(.*?)\.(?:pre-rollback\.)?\d{8}-\d{6}(?:-\d{6})?\.js$/i.exec(n)
      return m ? m[1] + '.js' : n
    })
    target = join(full, ...dirSegs, ...restoredNames)
  }
  await readFile(backupPath, 'utf8') // 存在性检查
  // 回滚前把当前版本也备份一份,保证不丢
  try {
    await readFile(target, 'utf8')
    const backupDir = join(dirname(target), 'backup')
    await mkdir(backupDir, { recursive: true })
    await copyFile(target, join(backupDir, `${basename(target, '.js')}.pre-rollback.${timestamp()}.js`))
    await pruneHistoryBackups(nonameDir, folder, await pruneBackups(backupDir, relative(nonameDir, backupDir)))
  } catch { /* 当前不存在 */ }
  await copyFile(backupPath, target)
  return { folder, restored: backupName }
}

/** 尽力从 translate 区段提取条目显示名(工坊「编辑已有条目」下拉的括号注):
 * 对象值找 name 字段,数组值取首元素(老式扩展武将 `cs_x: ['名字','描述']`),
 * 字符串值本身就是名字;x 与 x_info 以先出现者为准。提不到就不入表。 */
function extractDisplayNames(code, sectionNames = ['translate']) {
  const names = new Map()
  for (const secName of sectionNames) {
    for (const sec of findAllSections(code, secName)) {
      for (const p of sectionProperties(code, sec.open, sec.close)) {
        const base = p.name.replace(/_info$/, '')
        if (names.has(base)) continue
        const seg = code.slice(p.start, p.end + 1)
        const m = /name\s*:\s*(['"`])((?:\\.|(?!\1).)*?)\1/.exec(seg)
          || /[:[]\s*\[\s*(['"`])((?:\\.|(?!\1).)*?)\1/.exec(seg)
        let name = m && m[2] ? m[2] : ''
        if (!name && (code[p.end] === '"' || code[p.end] === "'")) {
          // 简单字符串值(`cs_a: "甲"`):整段结尾的引号字面量就是名字
          const lit = /(['"])((?:\\.|(?!\1).)*?)\1\s*$/.exec(seg)
          if (lit) name = lit[2]
        }
        if (name) names.set(base, name)
      }
    }
  }
  return names
}

/**
 * 列出扩展包内指定种类的全部条目(工坊「编辑已有武将/卡牌」的目标下拉)。
 * 聚合全包:单文件条目 + 多文件包子目录模块(const 声明形态)都认;每项带 file 归属。
 * 显示名全包聚合——多文件包的条目与它的 translate 常分处不同文件
 * (如英雄杀:条目在 character/character.js,名字在 character/translate.js)。
 * scanBlocks 锚点优先、无锚自动虚拟划分——未迁移老包(含数组形态武将)同样可用。
 * 只读,不写任何文件。
 */
export async function listEntries(nonameDir, folder, kind) {
  if (kind !== 'character' && kind !== 'card') {
    return { ok: false, kind, entries: [], error: 'kind 应为 character 或 card。' }
  }
  const { full } = safeFolderPath(nonameDir, folder)
  const files = await listPackageJsFiles(nonameDir, folder)
  if (!files.length) return { ok: false, kind, entries: [], error: '扩展包里没有任何 .js 文件。' }
  const names = new Map()
  const codes = []
  for (const f of files) {
    let code
    try { code = await readFile(join(full, f), 'utf8') } catch { continue }
    codes.push({ f, code })
    for (const [id, name] of extractDisplayNames(code)) if (!names.has(id)) names.set(id, name)
  }
  const entries = []
  const seenIds = new Set()
  for (const { f, code } of codes) {
    for (const b of scanBlocks(code).blocks) {
      if (b.kind !== kind) continue
      if (seenIds.has(b.id)) continue // 跨文件同名:保留先见文件(extension.js 优先)
      seenIds.add(b.id)
      entries.push({ id: b.id, lines: b.lines, name: names.get(b.id) || '', file: f })
    }
  }
  if (!entries.length) {
    const hasExt = files.includes('extension.js')
    return { ok: true, kind, entries, error: hasExt ? undefined : '该扩展没有 extension.js。' }
  }
  return { ok: true, kind, entries }
}

/** 从武将条目源码提取 skills 数组里的技能 id(工坊「编辑已有武将」的技能勾选)。
 * 两种形态:对象 `skills: ["a","b"]`;老式数组 `["male","wei",4,["a","b"],...]`
 * (skills 固定在第 4 个元素)。都认不出就返回空数组。 */
function entrySkillIds(entryText) {
  const clean = (raw) => raw.split(',')
    .map((s) => s.trim().replace(/^['"`]|['"`]$/g, '').replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
  const obj = /skills\s*:\s*\[([^\]]*)\]/.exec(entryText)
  if (obj) return clean(obj[1])
  // 数组形态的条目 text 以「id: [」开头(非裸数组),匹配 sex,group,hp,[skills] 前缀
  const arr = /:\s*\[\s*(['"])[\w-]+\1\s*,\s*(['"])[\w-]+\2\s*,\s*\d+\s*,\s*\[([^\]]*)\]/.exec(entryText)
  if (arr) return clean(arr[3])
  return []
}

/** 列出某个条目(武将或卡牌——卡牌也可带 skills 字段)的技能(勾选候选):
 * id + translate 显示名(尽力,全包聚合——技能名常在别的文件里)。只读。 */
export async function listEntrySkills(nonameDir, folder, entryId) {
  if (typeof entryId !== 'string' || !entryId.trim()) {
    return { ok: false, skills: [], error: '缺少条目 id。' }
  }
  const { full } = safeFolderPath(nonameDir, folder)
  const files = await listPackageJsFiles(nonameDir, folder)
  let entry = null
  const names = new Map()
  for (const f of files) {
    let code
    try { code = await readFile(join(full, f), 'utf8') } catch { continue }
    for (const [id, name] of extractDisplayNames(code)) if (!names.has(id)) names.set(id, name)
    if (!entry) {
      entry = virtualCharacterBlocks(code).find((b) => b.id === entryId.trim())
        || virtualCardBlocks(code).find((b) => b.id === entryId.trim())
    }
  }
  if (!entry) return { ok: true, skills: [] }
  const skills = entrySkillIds(entry.text).map((id) => ({ id, name: names.get(id) || '' }))
  return { ok: true, skills }
}

/** 深度枚举目录下全部 .js 绝对路径;目录不存在/读不了返回空。 */
async function listJsDeepAbs(absDir) {
  const out = []
  let entries
  try { entries = await readdir(absDir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const child = join(absDir, e.name)
    if (e.isDirectory()) out.push(...await listJsDeepAbs(child))
    else if (e.isFile() && /\.js$/i.test(e.name)) out.push(child)
  }
  return out
}

/**
 * 头像列表(工坊「👤 人物标识」下拉数据源):直接扫游戏目录,不依赖游戏运行。
 * 自带包 = <nonameDir>/character/ 递归:官方 1.11.5 新版 `const characters = {}`
 * 顶层键(findAllSections/sectionProperties)与老版 game.import 武将段
 * (virtualCharacterBlocks)两种形态都认;显示名从各文件 translate 段聚合
 * (子目录 character.js 的名字常在同名 translate.js,全文件扫自然覆盖)。
 * 扩展包复用 listEntries——工坊「编辑已有武将」同款识别。国战 gz_ 变体滤掉。
 * 只读;自带包 16MB 级+全部扩展,调用方自行缓存。返回 [{id,name}],按中文名排序。
 */
export async function listAvatars(nonameDir) {
  const ids = []
  const seen = new Set()
  const add = (id) => {
    if (id && !seen.has(id) && !/^gz_/.test(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  const names = new Map()
  // 自带包(character/ 子目录也要进:sp/、offline/ 等整目录都是包)。
  // 官方 1.11.5 新版文件里名字变量是复数 const translates(导出时才展开进
  // translate:),段名集合两种都要喂。
  for (const abs of await listJsDeepAbs(join(resolve(nonameDir), 'character'))) {
    let code
    try { code = await readFile(abs, 'utf8') } catch { continue }
    for (const [id, name] of extractDisplayNames(code, ['translate', 'translates'])) if (!names.has(id)) names.set(id, name)
    for (const sec of findAllSections(code, 'characters')) {
      for (const p of sectionProperties(code, sec.open, sec.close)) add(p.name)
    }
    for (const b of virtualCharacterBlocks(code)) add(b.id)
  }
  // 扩展包(extension/<名>/:工坊同款识别;内核自身无武将,跳过省读盘)
  let folders = []
  try {
    folders = (await readdir(extRootOf(nonameDir), { withFileTypes: true }))
      .filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { /* 没有 extension 目录就只出自带包 */ }
  for (const folder of folders) {
    if (folder === '联机助手') continue
    try {
      const r = await listEntries(nonameDir, folder, 'character')
      if (r.ok) {
        for (const e of r.entries) {
          add(e.id)
          if (e.name && !names.has(e.id)) names.set(e.id, e.name)
        }
      }
    } catch { /* 单个扩展解析失败不拖垮整个列表 */ }
  }
  const list = ids.map((id) => ({ id, name: names.get(id) || '' }))
  list.sort((a, b) => {
    const an = a.name || a.id
    const bn = b.name || b.id
    try { return an.localeCompare(bn, 'zh-Hans-CN') } catch { return an < bn ? -1 : 1 }
  })
  return list
}

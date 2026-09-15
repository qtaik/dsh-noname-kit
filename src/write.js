/**
 * noname-kit 扩展文件读写:所有对 <nonameDir>/extension/** 的落盘都经过这里。
 * 路径安全:文件夹名只允许安全字符,解析后必须仍在 extension 目录内
 * (防路径逃逸)。覆盖前自动备份到 <文件夹>/backup/。
 */
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { join, resolve, basename, relative, sep } from 'node:path'
import { validateExtensionCode, collectDefinedIds } from './validate.js'
import { scanAnchored, scanBlocks, extractBlock, assembleBlocks, checkFidelity, migrateCode, stripAnchors, findAllSections, sectionProperties } from './blocks.js'

const FOLDER_RE = /^[\w\u4e00-\u9fff-]{1,64}$/

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

function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 校验并写入扩展。两种模式:
 * - 全文模式(默认):提交 code 全文;存量包可带 editScope 做保真校验
 *   (范围外区块必须与旧文件逐字节一致,否则拒写)。
 * - 区块模式(提交 blocks/edits/deletes 之一即触发):AI 只提交改动的区块,
 *   其余文本由工具从旧文件逐字节保留——未提交区域物理上不可能被改。
 * @returns 校验失败 → {ok:false, errors, warnings};成功 → {ok:true, path, backup}
 */
export async function writeExtension(nonameDir, { folder, code, blocks, edits, deletes, editScope, style, kind, infoJson, idPrefix, writeMode }) {
  const blockMode = Array.isArray(blocks) || Array.isArray(edits) || Array.isArray(deletes)
  const { root, full } = safeFolderPath(nonameDir, folder)
  await mkdir(full, { recursive: true })
  const target = join(full, 'extension.js')

  // 旧文件:两种模式都先读(区块模式组装、全文模式保真/防丢都依赖它)
  let oldCode = null
  try { oldCode = await readFile(target, 'utf8') } catch { /* 首次写入,无旧文件 */ }

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

  const verdict = validateExtensionCode({ code: finalCode, style, kind, folder, idPrefix })
  if (!verdict.ok) return { ...verdict, wrote: false }

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
    const backupDir = join(full, 'backup')
    await mkdir(backupDir, { recursive: true })
    backup = join(relative(nonameDir, backupDir), `extension.${timestamp()}.js`).split(sep).join('/')
    await copyFile(target, join(full, basename(backup)))
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
      return { ...verdict, wrote: true, path: relative(nonameDir, target), backup, infoError: `info.json 不是合法 JSON,未写入: ${error.message}` }
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
 * 读取扩展内容。三种用法:
 * - 默认:全文整读(兼容)
 * - opts.listBlocks=true:返回区块目录 {blocks:{anchored, blocks[]}},无锚文件给虚拟区块
 * - opts.block='kind:id':只返回该区块内容(result.code + result.block)
 */
export async function readExtension(nonameDir, folder, opts = {}) {
  const { full } = safeFolderPath(nonameDir, folder)
  const names = await readdir(full)
  const result = { folder, files: names.filter((n) => !n.startsWith('.')) }
  let code
  if (names.includes('extension.js')) code = await readFile(join(full, 'extension.js'), 'utf8')
  if (opts.listBlocks) {
    result.blocks = code !== undefined
      ? scanBlocks(code)
      : { anchored: false, blocks: [] }
  } else if (opts.block) {
    const m = /^(\w+):([\w-]+)$/.exec(String(opts.block))
    if (!m) result.error = 'block 参数格式应为 kind:id,例如 skill:cs_tianfa。'
    else if (code === undefined) result.error = '该扩展没有 extension.js。'
    else {
      const text = extractBlock(code, m[1], m[2])
      if (text == null) result.error = `未找到区块「${opts.block}」(可用 listBlocks 查看目录)。`
      else { result.code = text; result.block = { kind: m[1], id: m[2] } }
    }
  } else if (code !== undefined) {
    result.code = code
  }
  if (names.includes('info.json')) {
    try { result.info = JSON.parse(await readFile(join(full, 'info.json'), 'utf8')) } catch { result.info = {} }
  }
  return result
}

/**
 * 锚点化迁移(用户在工坊手动触发,AI 永不自动执行):对无锚老文件插入
 * 锚点注释行,一个代码字符不动;写前自动备份,写后跑语法校验自证。
 */
export async function migrateAnchors(nonameDir, folder) {
  const { full } = safeFolderPath(nonameDir, folder)
  const target = join(full, 'extension.js')
  let oldCode
  try { oldCode = await readFile(target, 'utf8') } catch { return { ok: false, error: '该扩展没有 extension.js。' } }
  const r = migrateCode(oldCode)
  if (r.error) return { ok: false, error: r.error }
  const style = /game\.import\(/.test(r.code) ? 'classic' : 'module'
  const verdict = validateExtensionCode({ code: r.code, style, kind: 'character' })
  if (!verdict.ok) return { ok: false, error: '迁移后语法校验失败(不应发生,已放弃写入): ' + (verdict.errors[0] && verdict.errors[0].message || '未知') }
  const backupDir = join(full, 'backup')
  await mkdir(backupDir, { recursive: true })
  const backup = join(relative(nonameDir, backupDir), `extension.${timestamp()}.js`).split(sep).join('/')
  await copyFile(target, join(full, basename(backup)))
  await writeFile(target, r.code, 'utf8')
  return { ok: true, inserted: r.inserted, commas: r.commas, blocks: r.blocks, backup }
}

/** 列出某扩展的备份文件(新→旧)。 */
export async function listBackups(nonameDir, folder) {
  const { full } = safeFolderPath(nonameDir, folder)
  const backupDir = join(full, 'backup')
  try {
    const names = (await readdir(backupDir)).filter((n) => n.endsWith('.js')).sort().reverse()
    return names.map((n) => basename(n))
  } catch { return [] }
}

/** 回滚:把指定备份覆盖回 extension.js。返回旧内容备份名。 */
export async function rollbackExtension(nonameDir, folder, backupName) {
  if (!/^[\w.-]+\.js$/.test(backupName) || backupName.includes('..')) {
    throw new Error('非法的备份文件名。')
  }
  const { full } = safeFolderPath(nonameDir, folder)
  const backupPath = join(full, 'backup', backupName)
  const target = join(full, 'extension.js')
  await readFile(backupPath, 'utf8') // 存在性检查
  // 回滚前把当前版本也备份一份,保证不丢
  try {
    await readFile(target, 'utf8')
    const backupDir = join(full, 'backup')
    await mkdir(backupDir, { recursive: true })
    await copyFile(target, join(backupDir, `extension.pre-rollback.${timestamp()}.js`))
  } catch { /* 当前不存在 */ }
  await copyFile(backupPath, target)
  return { folder, restored: backupName }
}

/** 尽力从 translate 区段提取条目显示名(工坊「编辑已有条目」下拉的括号注):
 * 对象值找 name 字段,数组值取首元素(老式扩展武将 `cs_x: ['名字','描述']`),
 * 字符串值本身就是名字;x 与 x_info 以先出现者为准。提不到就不入表。 */
function extractDisplayNames(code) {
  const names = new Map()
  for (const sec of findAllSections(code, 'translate')) {
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
  return names
}

/**
 * 列出扩展包内指定种类的全部条目(工坊「编辑已有武将/卡牌」的目标下拉)。
 * scanBlocks 锚点优先、无锚自动虚拟划分——未迁移老包(含数组形态武将)同样可用。
 * 只读,不写任何文件。
 */
export async function listEntries(nonameDir, folder, kind) {
  if (kind !== 'character' && kind !== 'card') {
    return { ok: false, kind, entries: [], error: 'kind 应为 character 或 card。' }
  }
  const { full } = safeFolderPath(nonameDir, folder)
  let code
  try { code = await readFile(join(full, 'extension.js'), 'utf8') } catch {
    return { ok: false, kind, entries: [], error: '该扩展没有 extension.js。' }
  }
  const names = extractDisplayNames(code)
  const entries = scanBlocks(code).blocks
    .filter((b) => b.kind === kind)
    .map((b) => ({ id: b.id, lines: b.lines, name: names.get(b.id) || '' }))
  return { ok: true, kind, entries }
}

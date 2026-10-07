/**
 * JSON 状态文件的安全读写(设置、任务登记处等)。
 *
 * 为什么需要(实测数据丢失面):
 *  - 读失败一律 `catch → {}`,随后任何一次保存都**整份重写** → 一个半截损坏的
 *    noname-kit.json 过一次 read-modify-write 就只剩被改的那一个键;
 *  - 直接 writeFileSync 覆盖:进程崩溃/断电会留下半截文件,下次读又当"空"处理;
 *  - bridge token 一丢,游戏内核持旧 token 被永久 403,工坊只显示"离线"、无诊断。
 *
 * 这里给两条底线:
 *  1. **原子写**:先写同目录临时文件再 rename(同盘 rename 原子),崩溃不会留半截;
 *  2. **损坏即备份**:读到内容但解析失败,先把原文件改名成 `<名字>.corrupt-<时间戳>`,
 *     把"丢了什么"留在盘上可查,再按空处理——绝不静默覆盖用户数据。
 */

import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn('[noname-kit] ' + message)
}

/** 把损坏文件改名留档;返回备份路径或 null。 */
function stashCorrupt(file, ts) {
  try {
    const dest = `${file}.corrupt-${ts || Date.now()}`
    renameSync(file, dest)
    return dest
  } catch {
    return null
  }
}

/**
 * 同步读 JSON:文件不存在/为空 → 返回 fallback;内容坏 → 备份后返回 fallback。
 * @param {string} file 绝对路径
 * @param {object} fallback 解析失败时的返回值(调用方传新对象,避免共享可变状态)
 */
export function readJsonSafeSync(file, fallback) {
  if (!existsSync(file)) return fallback
  let raw = ''
  try {
    const size = statSync(file).size
    if (size === 0) return fallback      /* 空文件 = 还没写过,不算损坏 */
    raw = readFileSync(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const dest = stashCorrupt(file)
      warnOnce(file, `状态文件形状异常(不是对象),已留档为 ${dest || '(留档失败)'}:${file}`)
      return fallback
    }
    return parsed
  } catch (error) {
    const dest = stashCorrupt(file)
    warnOnce(file, `状态文件解析失败(${error.message}),已留档为 ${dest || '(留档失败)'} 并按空处理——原内容没有被覆盖,可从该文件恢复:${file}`)
    return fallback
  }
}

/** 异步版(与同步版同语义)。 */
export async function readJsonSafe(file, fallback) {
  if (!existsSync(file)) return fallback
  let raw = ''
  try {
    if (statSync(file).size === 0) return fallback
    raw = await readFile(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const dest = stashCorrupt(file)
      warnOnce(file, `状态文件形状异常(不是对象),已留档为 ${dest || '(留档失败)'}:${file}`)
      return fallback
    }
    return parsed
  } catch (error) {
    const dest = stashCorrupt(file)
    warnOnce(file, `状态文件解析失败(${error.message}),已留档为 ${dest || '(留档失败)'} 并按空处理——原内容没有被覆盖,可从该文件恢复:${file}`)
    return fallback
  }
}

/** 原子写:临时文件 + rename。失败时抛错,由调用方决定是否吞。 */
export function writeJsonAtomicSync(file, value) {
  const tmp = join(dirname(file), `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* 清理失败不影响报错 */ }
    throw error
  }
}

/** 异步版原子写:写临时文件后 rename。 */
export async function writeJsonAtomic(file, value) {
  const { writeFile, rename } = await import('node:fs/promises')
  const tmp = join(dirname(file), `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  } catch (error) {
    try { await (await import('node:fs/promises')).unlink(tmp) } catch { /* 忽略 */ }
    throw error
  }
}

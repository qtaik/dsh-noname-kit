/** 安全读写 JSON 状态文件。写入使用同目录临时文件与 rename；解析失败时将原文件留档为 .corrupt-<时间戳>，再返回空值，保留可恢复内容。 */

import { existsSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

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
    pruneCorruptStashes(file)
    return dest
  } catch {
    return null
  }
}

/** 每个状态文件只保留最近三份损坏留档，供排查或手动恢复。 */
function pruneCorruptStashes(file) {
  try {
    const dir = dirname(file)
    const prefix = basename(file) + '.corrupt-'
    const olds = readdirSync(dir).filter((n) => n.startsWith(prefix)).sort()
    for (const n of olds.slice(0, Math.max(0, olds.length - 3))) {
      try { unlinkSync(join(dir, n)) } catch { }
    }
  } catch { }
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

/** 原子替换 JSON，保留原始写入错误。 */
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
    try { await (await import('node:fs/promises')).unlink(tmp) } catch { }
    throw error
  }
}

/** 在本机常见位置探测无名杀本体目录。前两层允许任意目录名，更深层沿 noname、无名及 resources/app/www/src 等壳目录搜索。匹配路径最大深度为 8，其他路径限制为 4；候选目录须包含 extension 与 noname.js、noname 或 game 标记。 */
import { readdir } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const NAME_RE = /noname|无名/i
const SHELL_DIRS = new Set(['resources', 'app', 'www', 'game', 'src'])
const SKIP_DIRS = new Set([
  'node_modules', 'Windows', 'Program Files', 'Program Files (x86)',
  '$Recycle.Bin', 'System Volume Information', 'AppData', 'assets',
  'audio', 'font', 'image', 'card', 'character', 'extension', 'noname',
])
const MAX_CANDIDATES = 8

/** 目录是否像一个无名杀游戏本体根。 */
function looksLikeGameRoot(dir) {
  if (!existsSync(join(dir, 'extension'))) return false
  return ['noname.js', 'noname', 'game'].some((marker) => existsSync(join(dir, marker)))
}

async function scan(dir, depth, matched, out) {
  // 沿"名字像无名杀"的链路放宽到 8 层(decade 整合包的目标在第 6 层),
  // 非匹配路径 4 层——剪枝靠名字继承,不会全盘乱扫。
  if (depth > (matched ? 8 : 4) || out.length >= MAX_CANDIDATES) return
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    // 壳目录及名字匹配 noname 或无名的目录不受 SKIP 剪枝限制，交由递归条件和游戏根标记判断。
    if (SKIP_DIRS.has(name) && !SHELL_DIRS.has(name.toLowerCase()) && !NAME_RE.test(name)) continue
    const full = join(dir, name)
    const nameMatched = matched || NAME_RE.test(name)
    if (looksLikeGameRoot(full)) {
      out.push(full)
      if (out.length >= MAX_CANDIDATES) return
      continue // 游戏根本身不再往下扫
    }
    // 前两层无条件深入(游戏可能套在任意名字的文件夹里);
    // 更深的层只沿"名字匹配/祖先匹配/壳目录"走,避免全盘乱扫。
    if (depth < 2 || nameMatched || SHELL_DIRS.has(name.toLowerCase())) {
      await scan(full, depth + 1, nameMatched, out)
    }
  }
}

/**
 * 列出游戏目录 extension/ 下已安装的扩展包名(子目录,排序,默认上限 100)。
 * 设置页用它向用户证明"目录填对了:你的扩展包都在这里"。
 * @param {string} nonameDir - 游戏本体目录。
 * @param {number} [limit=100] - 设置页摘要上限；已有包选择传 Infinity 读取完整目录。
 * @returns {string[]}
 */
export function listExtensionFolders(nonameDir, limit = 100) {
  try {
    return readdirSync(join(nonameDir, 'extension'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * 返回本机探测到的候选游戏根目录列表。
 * @param {string[]} [rootsOverride] - 测试注入:替换默认的盘符/用户目录扫描起点。
 * @returns {Promise<string[]>}
 */
export async function detectCandidates(rootsOverride) {
  const roots = [...(rootsOverride || [])]
  if (!rootsOverride) {
    if (process.platform === 'win32') {
      for (const letter of ['C', 'D', 'E', 'F', 'G']) roots.push(`${letter}:\\`)
    } else {
      roots.push('/')
    }
    roots.push(join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop'))
    roots.push(join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'))
  }
  const out = []
  for (const root of roots) {
    if (out.length >= MAX_CANDIDATES) break
    await scan(root, 1, false, out)
  }
  return [...new Set(out)]
}

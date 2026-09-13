/**
 * noname-kit 自动探测:在本机常见位置扫描无名杀游戏本体目录。
 * 策略:从盘符根/用户目录出发,只沿"名字像无名杀(noname|无名杀)"的目录、
 * 以及它们下面的 resources/app/www 这类壳目录往下走(深度≤4),
 * 判定标准:目录下同时存在 extension/ 子目录与 noname.js(或 noname/、game/)。
 * 这样新机器上用户不用手找路径,工坊向导里点一下就行。
 */
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const NAME_RE = /noname|无名/i
const SHELL_DIRS = new Set(['resources', 'app', 'www', 'game'])
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
  if (depth > 4 || out.length >= MAX_CANDIDATES) return
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (SKIP_DIRS.has(name)) continue
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
 * 返回本机探测到的候选游戏根目录列表。
 * @returns {Promise<string[]>}
 */
export async function detectCandidates() {
  const roots = []
  if (process.platform === 'win32') {
    for (const letter of ['C', 'D', 'E', 'F', 'G']) roots.push(`${letter}:\\`)
  } else {
    roots.push('/')
  }
  roots.push(join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop'))
  roots.push(join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'))
  const out = []
  for (const root of roots) {
    if (out.length >= MAX_CANDIDATES) break
    await scan(root, 1, false, out)
  }
  return [...new Set(out)]
}

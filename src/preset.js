/** 检查并安装无名杀开发模式 preset。支持声明式宿主注册；旧宿主采用实体目录副本，通过内容哈希检测差异并支持重装，满足 DSH discovery 的 isDirectory 检查。 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const PRESET_ID = 'noname-dev'
/** 安装记录保存写入时的内容哈希和时间。运行时按目录内容重新核验。 */
export const PRESET_MANIFEST = '.noname-kit-install.json'

const COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * 宿主是否提供声明式 preset 机制(存在 @deepseek-ai/dsh-agent-preset 包)。
 *
 * DSH 0.1.7 起 preset 改为 profile YAML 声明(bundle patch 里的
 * @deepseek-ai/dsh-agent-preset 行随插件自动生效,见 cordis.patch.yml),
 * 目录式安装/哈希比对/重装全部不再需要;0.1.6 及以下仍走目录式。
 * 探测"机制是否存在"而非比较版本号:prerelease 与正式版都不用维护清单,
 * 宿主解析 peer 依赖时自然能找到(或找不到)这个包。
 */
export function hostHasDeclarativePreset() {
  try {
    createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-preset/package.json')
    return true
  } catch {
    return false
  }
}

/**
 * DSH 家目录:优先 $DSH_HOME,否则 ~/.dsh。
 * 与 DSH 自身 home-paths 的优先级一致 —— 插件运行时有 ctx.dshHomePath() 可用,
 * 但 scripts/install-preset.mjs 是独立进程,必须自己按同一规则解析,否则在
 * DSH_HOME 隔离的测试环境里会把 preset 装进真实家目录。
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/** 用户家目录里的 preset 安装位置。 */
export function presetDirOf(dshHome) {
  return join(dshHome, '.agent-presets', PRESET_ID)
}

/** 插件包内自带的 preset 源目录(唯一真源)。 */
export function bundledPresetDir() {
  return fileURLToPath(new URL('../presets/noname-dev/', import.meta.url))
}

function collectFiles(dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    // 排除隐藏条目，避免安装记录本身改变内容哈希。
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, rel, out)
    else if (entry.isFile()) out.push({ rel, full })
  }
  return out
}

/** 按相对路径排序，将路径与内容依次写入 SHA-256。计算时将行尾归一为 LF，使哈希不受检出换行形式、绝对位置或时间戳影响；目录不存在时返回 null。 */
export function hashDir(dir) {
  if (!existsSync(dir)) return null
  const files = collectFiles(dir, '', []).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of files) {
    let content
    /* 单个文件读取失败时，调用方按状态未知处理。 */
    try { content = readFileSync(file.full, 'utf8') } catch { return null }
    hash.update(file.rel)
    hash.update('\0')
    hash.update(content.replace(/\r\n/g, '\n'))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readManifest(presetDir) {
  try {
    return JSON.parse(readFileSync(join(presetDir, PRESET_MANIFEST), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 按实际内容比较已安装和随包的预设。文件读取失败或随包预设不完整时返回 unknown。
 * 哈希相同为 ok，不同为 stale；尚未安装为 missing。
 */
export function presetStatus({ presetDir, bundledDir }) {
  const bundledHash = hashDir(bundledDir)
  if (!bundledHash || !existsSync(join(bundledDir, COMPOSITION_FILE))) {
    return { state: 'unknown', error: `插件自带的 preset 源不完整(缺 ${COMPOSITION_FILE}):${bundledDir}` }
  }
  if (!existsSync(presetDir)) {
    return { state: 'missing', bundledHash, installedHash: null, installedAt: null }
  }
  const manifest = readManifest(presetDir)
  const installedHash = hashDir(presetDir)
  if (installedHash === null) {
    return {
      state: 'unknown', bundledHash, installedHash: null, installedAt: manifest?.installedAt ?? null,
      error: '已安装 preset 里有文件读不到(被占用或权限变化?)——可点「♻️ 重装 preset」整份覆盖修复',
    }
  }
  return {
    state: installedHash === bundledHash ? 'ok' : 'stale',
    bundledHash,
    installedHash,
    installedAt: manifest?.installedAt ?? null,
  }
}

/** 只保留本预设最近三份备份。清理失败不影响重装结果。 */
function prunePresetBackups(presetDir) {
  const PREFIX_KEEP = 3
  try {
    const dir = dirname(presetDir)
    const prefix = `${basename(presetDir)}.bak-`
    const baks = readdirSync(dir).filter((n) => n.startsWith(prefix)).sort()
    // 名字尾部是毫秒时间戳(等宽),字典序即时间序;留最新的 PREFIX_KEEP 个
    for (const name of baks.slice(0, Math.max(0, baks.length - PREFIX_KEEP))) {
      try { rmSync(join(dir, name), { recursive: true, force: true }) } catch { }
    }
  } catch { }
}

/**
 * 重装前保留原预设目录。备份名含点号，DSH 不会把它当成可用预设。
 * 安装位置若是符号链接或联接点，只移除链接本身。
 */
export function installPreset({ presetDir, bundledDir }) {
  if (!existsSync(join(bundledDir, COMPOSITION_FILE))) {
    return { ok: false, error: `插件自带的 preset 目录不完整(缺 ${COMPOSITION_FILE}):${bundledDir}` }
  }
  let backup = null
  if (existsSync(presetDir)) {
    if (lstatSync(presetDir).isSymbolicLink()) {
      try {
        unlinkSync(presetDir)
      } catch (error) {
        return { ok: false, error: `移除旧 preset 链接失败:${error.message}` }
      }
    } else {
      backup = `${presetDir}.bak-${Date.now()}`
      try {
        cpSync(presetDir, backup, { recursive: true })
      } catch (error) {
        return { ok: false, error: `备份旧 preset 失败:${error.message}` }
      }
      try {
        rmSync(presetDir, { recursive: true, force: true })
      } catch (error) {
        return { ok: false, error: `清理旧 preset 失败:${error.message}`, backup }
      }
      prunePresetBackups(presetDir)
    }
  }
  try {
    mkdirSync(dirname(presetDir), { recursive: true })
    cpSync(bundledDir, presetDir, { recursive: true })
  } catch (error) {
    /* 复制失败时清除不完整 preset 并尝试整体恢复备份；在错误说明中提供备份路径，供恢复失败时手动处理。 */
    let restored = false
    try {
      rmSync(presetDir, { recursive: true, force: true })
      if (backup) { cpSync(backup, presetDir, { recursive: true }); restored = true }
    } catch { /* 恢复也失败:下面文案带上备份路径供人工恢复 */ }
    const tail = backup ? (restored ? ';旧版本已自动恢复,备份仍在 ' : ';备份在 ') + backup : ''
    return { ok: false, error: `复制 preset 失败:${error.message}${tail}`, backup, restored }
  }
  const hash = hashDir(presetDir)
  try {
    writeFileSync(join(presetDir, PRESET_MANIFEST), JSON.stringify({ hash, installedAt: Date.now() }, null, 2), 'utf8')
  } catch {
    // 安装记录写入失败时仍可使用预设。缺少安装时间，内容核验仍按实际文件执行。
  }
  return { ok: true, target: presetDir, backup, hash }
}

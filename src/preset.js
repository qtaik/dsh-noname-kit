/**
 * 「无名杀开发模式」preset 的自检与安装。
 *
 * 为什么需要:preset 是插件行为的第二份手抄,装在 ~/.dsh/.agent-presets/noname-dev/,
 * 里面有 persona 正文、residentTools 工具名白名单、skills/SKILL.md 的参数文档。
 * 它和插件代码之间没有任何引用关系 —— install-preset.mjs 复制完就冻结了,插件
 * 运行时也不读它。所以代码更新后若没重装 preset,新会话会拿到自相矛盾的指令
 * (工具名对不上 → 工具在会话里静默消失;参数文档对不上 → AI 写出的调用被校验
 * 挡下),而且不报错。历史上已经踩过一次(noname_complete_task 改名残留 8 处)。
 *
 * 曾想用目录链接让漂移不可能发生,实测否决:DSH 的 preset discovery 用
 * readdir(withFileTypes).isDirectory() 判定(packages/preset/agent-presets/
 * src/discovery.ts:303),而 node 22 对 junction 和 symlink 一律报 isLink=true
 * —— 链接进去的 preset 会在界面上凭空消失(悬空链接同样静默消失,连报错都没有)。
 * 所以只能走「复制 + 盖章(内容哈希)+ 比对 + 一键重装」。
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const PRESET_ID = 'noname-dev'
/** 盖章文件:记下"这份 preset 是哪个插件版本装的、内容哈希是多少"。 */
export const PRESET_MANIFEST = '.noname-kit-install.json'

const COMPOSITION_FILE = 'agent.cordis.yml'

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
    // 跳过点开头的条目:既排除 OS 垃圾(.DS_Store),也排除本模块自己写的盖章文件
    // —— 否则"写入盖章"这个动作本身就会改变哈希,自检永远报过期。
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, rel, out)
    else if (entry.isFile()) out.push({ rel, full })
  }
  return out
}

/**
 * 目录内容哈希:按相对路径排序后逐个把「路径 + 内容」喂给 sha256。
 * 与文件系统返回顺序、绝对路径、时间戳无关,只反映内容;目录不存在返回 null。
 * 行尾统一成 LF 再哈希:同一个文件在 Windows 上检出(git autocrlf 会转 CRLF)和
 * 打包产物里可能行尾不同(实测 pnpm 装 git 依赖时 clone+checkout 就转了 CRLF),
 * 但行为完全一样 —— 不归一化就会把"完全相同的两份"误报成不一致。
 */
export function hashDir(dir) {
  if (!existsSync(dir)) return null
  const files = collectFiles(dir, '', []).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.rel)
    hash.update('\0')
    hash.update(readFileSync(file.full, 'utf8').replace(/\r\n/g, '\n'))
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
 * 自检已安装的 preset 与插件自带那份是否一致。
 * state: 'ok' 一致 / 'stale' 不一致(没重装,或你改过本地那份)/ 'missing' 没装
 * / 'unknown' 插件自带的源读不到(打包缺文件,属异常)。
 * 注意 stale 的含义是"内容不一致",不区分原因是没重装还是你手动改过 —— 界面
 * 上两句话都要说,不能只报"过期"。
 */
export function presetStatus({ presetDir, bundledDir }) {
  // 先看插件自带那份是否完整:源不完整属打包异常,不能报成"你该重装"
  // ——否则用户点重装还会再失败一次,两步都困惑。
  const bundledHash = hashDir(bundledDir)
  if (!bundledHash || !existsSync(join(bundledDir, COMPOSITION_FILE))) {
    return { state: 'unknown', error: `插件自带的 preset 源不完整(缺 ${COMPOSITION_FILE}):${bundledDir}` }
  }
  if (!existsSync(presetDir)) {
    return { state: 'missing', bundledHash, installedHash: null, installedVersion: null, installedAt: null }
  }
  const manifest = readManifest(presetDir)
  const installedHash = hashDir(presetDir)
  return {
    state: installedHash === bundledHash ? 'ok' : 'stale',
    bundledHash,
    installedHash,
    installedVersion: manifest?.pluginVersion ?? null,
    installedAt: manifest?.installedAt ?? null,
  }
}

/**
 * 安装/重装 preset:先把旧的那份整体备份成兄弟目录(名字带 .bak-<时间戳>,
 * 因为 PRESET_ID 不允许点号,DSH 的 discovery 会明确跳过这类名字,不会在
 * preset 列表里多出一条垃圾),再复制新的一份并盖章。
 * 目标位置若是个链接(含 Windows junction)则只删链接本身,绝不递归进目标。
 */
export function installPreset({ presetDir, bundledDir, pluginVersion }) {
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
    }
  }
  try {
    mkdirSync(dirname(presetDir), { recursive: true })
    cpSync(bundledDir, presetDir, { recursive: true })
  } catch (error) {
    return { ok: false, error: `复制 preset 失败:${error.message}`, backup }
  }
  const hash = hashDir(presetDir)
  try {
    writeFileSync(join(presetDir, PRESET_MANIFEST), JSON.stringify({ pluginVersion, installedAt: Date.now(), hash }, null, 2), 'utf8')
  } catch {
    // 盖章写不进去不影响 preset 本身可用,只是下次自检会报 stale —— 不视为失败
  }
  return { ok: true, target: presetDir, backup, hash }
}

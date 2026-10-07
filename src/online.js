/**
 * 联机助手:内核安装管理 + 工坊↔游戏内核的心跳桥会话。
 *
 * 架构:跨网络联机的传输层(WebRTC)必须跑在游戏进程里,所以有一个以扩展
 * 形态存在的「内核」(online-kernel/,随插件打包)。它无头运行,由本模块:
 *  1. 安装/升级到游戏 extension/联机助手/(复制 + 盖章 + 哈希配对,同 preset
 *     哲学;备份放在游戏根目录 nnk-kernel-backups/ —— 不能放 extension/ 里,
 *     游戏会把那里每个含 extension.js 的子目录都当成扩展加载);
 *  2. 经 nnk-bridge.json(安装时写入桥地址与 token)与内核保持心跳:
 *     内核轮询 POST /online/bridge 上报状态与事件、取回工坊下发的命令
 *     (create_room / join_invite / accept_answer / invite_refresh / cancel)。
 *
 * 为什么不用 preset.js 的 hashDir:安装时会往内核目录多写一个 nnk-bridge.json
 * (哈希必须忽略它),所以这里自带一份带跳过清单的目录哈希。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KERNEL_FOLDER = '联机助手'
export const KERNEL_MANIFEST = '.nnk-kernel.json'
const BRIDGE_FILE = 'nnk-bridge.json'
/** 备份目录:游戏根目录下、extension/ 之外(见模块注释)。 */
const BACKUP_DIR_NAME = 'nnk-kernel-backups'
const BACKUP_KEEP = 3
/** 命令在队列里的最长等待:内核 0.7s 一轮,60s 足够宽裕;过期丢弃防陈旧命令误执行。 */
const COMMAND_TTL_MS = 60_000
/** bridge.snapshot() 里 online 的判定窗口(内核 0.7s 一轮,3 秒没消息即视为离线)。 */
const ONLINE_WINDOW_MS = 3000

/** 插件包内自带的内核源目录(唯一真源)。 */
export function bundledKernelDir() {
  return fileURLToPath(new URL('../online-kernel/', import.meta.url))
}

export function kernelDirOf(nonameDir) {
  return join(nonameDir, 'extension', KERNEL_FOLDER)
}

/** 内核版本号:从自带 extension.js 的 __nnk__ 初始化行里读。内核源随插件冻结,
 *  运行期只读一次盘(工坊状态每 1.5s 轮询,别让它反复打文件)。 */
let cachedKernelVersion
export function bundledKernelVersion() {
  if (cachedKernelVersion !== undefined) return cachedKernelVersion
  try {
    const code = readFileSync(join(bundledKernelDir(), 'extension.js'), 'utf8')
    const m = /window\.__nnk__ = \{ version: "([^"]+)"/.exec(code)
    cachedKernelVersion = m ? m[1] : null
  } catch {
    cachedKernelVersion = null
  }
  return cachedKernelVersion
}

/** 目录树复制:逐文件 copyFileSync。
 *  ⚠️ 绝不用 fs.cpSync:实测本机 Node22/Windows 上,目标路径含非 ASCII
 *  (如「联机助手」)时 cpSync 静默复制出空目录、无任何报错——而联机内核的
 *  安装目标必然是中文目录。文件级 copyFileSync 无此问题(images.js 生产在用)。 */
function copyDirInto(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const from = join(srcDir, entry.name)
    const to = join(destDir, entry.name)
    if (entry.isDirectory()) copyDirInto(from, to)
    else if (entry.isFile()) copyFileSync(from, to)
  }
}

function collectFiles(dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    // 跳过点开头(盖盖章文件/OS 垃圾)与桥配置(安装时才写入,不属于内核内容)
    if (entry.name.startsWith('.') || entry.name === BRIDGE_FILE) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, rel, out)
    else if (entry.isFile()) out.push({ rel, full })
  }
  return out
}

/** 目录内容哈希(与 preset.js 同法:路径+内容喂 sha256,行尾归一 LF)。 */
export function hashKernelDir(dir) {
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

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, KERNEL_MANIFEST), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 内核自检:state ok/stale/missing/unknown(语义同 preset;unknown = 插件自带
 * 源不完整,打包异常,此时不能催用户重装)。
 */
export function kernelStatus({ nonameDir }) {
  const bundledHash = hashKernelDir(bundledKernelDir())
  if (!bundledHash || !existsSync(join(bundledKernelDir(), 'extension.js'))) {
    return { state: 'unknown', error: `插件自带的内核源不完整(缺 extension.js):${bundledKernelDir()}` }
  }
  const target = kernelDirOf(nonameDir)
  if (!existsSync(target)) {
    return { state: 'missing', bundledHash, installedHash: null, installedAt: null, boundApi: null }
  }
  const installedHash = hashKernelDir(target)
  /* 内核心跳绑定在哪个 dsh(装它时写入的 baseUrl)——双 dsh 共管一个游戏目录时,
   * 心跳只发绑定方,另一方会显示离线,这个字段让绑定关系可见 */
  let boundApi = null
  try {
    boundApi = JSON.parse(readFileSync(join(target, 'nnk-bridge.json'), 'utf8')).baseUrl || null
  } catch { /* 没装桥配置(未安装/老版本) */ }
  return {
    state: installedHash === bundledHash ? 'ok' : 'stale',
    bundledHash,
    installedHash,
    installedAt: readManifest(target)?.installedAt ?? null,
    boundApi,
  }
}

/**
 * 安装/重装内核:旧目录整体备份到游戏根 nnk-kernel-backups/(滚动留 3 份),
 * 复制新的一份,写入桥配置(nnk-bridge.json)并盖章。装完需重启游戏加载。
 */
export function installKernel({ nonameDir, baseUrl, token, intervalMs }) {
  const bundled = bundledKernelDir()
  if (!existsSync(join(bundled, 'extension.js'))) {
    return { ok: false, error: `插件自带的内核源不完整(缺 extension.js):${bundled}` }
  }
  const target = kernelDirOf(nonameDir)
  let backup = null
  if (existsSync(target)) {
    const backupRoot = join(nonameDir, BACKUP_DIR_NAME)
    const backupPath = join(backupRoot, `${KERNEL_FOLDER}-${Date.now()}`)
    try {
      mkdirSync(backupRoot, { recursive: true })
      copyDirInto(target, backupPath)
      backup = backupPath
    } catch (error) {
      return { ok: false, error: `备份旧内核失败:${error.message}` }
    }
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (error) {
      return { ok: false, error: `清理旧内核失败:${error.message}`, backup }
    }
    try {
      // 滚动清理:同前缀按名字(毫秒时间戳,等宽)排序,只留最新 BACKUP_KEEP 份
      const baks = readdirSync(backupRoot).filter((n) => n.startsWith(`${KERNEL_FOLDER}-`)).sort()
      for (const name of baks.slice(0, Math.max(0, baks.length - BACKUP_KEEP))) {
        try { rmSync(join(backupRoot, name), { recursive: true, force: true }) } catch { /* 单个失败跳过 */ }
      }
    } catch { /* 清理失败不影响安装 */ }
  }
  try {
    copyDirInto(bundled, target)
  } catch (error) {
    return { ok: false, error: `复制内核失败:${error.message}`, backup }
  }
  try {
    writeFileSync(join(target, BRIDGE_FILE), JSON.stringify({
      baseUrl,
      token,
      intervalMs: intervalMs || 700,
      installedAt: Date.now(),
    }, null, 2), 'utf8')
  } catch (error) {
    return { ok: false, error: `写入桥配置失败:${error.message}`, backup }
  }
  const hash = hashKernelDir(target)
  try {
    writeFileSync(join(target, KERNEL_MANIFEST), JSON.stringify({ hash, installedAt: Date.now() }, null, 2), 'utf8')
  } catch { /* 盖章失败只影响展示,不算安装失败 */ }
  return { ok: true, target, backup, hash }
}

/**
 * 心跳桥会话(每插件实例一份,内存态,不落盘):
 * 内核轮询时上报状态与事件,取回到期命令;工坊经 pushCommand 下发命令。
 * syncSource:返回希望内核处于的配置({identity:{name,avatar}, mqttUrl}),
 * 内核上报的 cfg 与之不一致时自动补发对应命令,覆盖「保存时游戏没开(命令
 * 60s TTL 内没被取走)」「换游戏目录后新内核副本没配置」两个场景。
 * mqttUrl 只在非空时强制(空 = 不覆盖,跟随各游戏目录自己的值)。
 */
export function createBridgeSession({ token, syncSource }) {
  const session = {
    token,
    lastSeen: 0,
    kernelVersion: null,
    bootStage: null,
    role: '',
    state: null,
    events: [],
    commands: [],
    nextCmdId: 1,
  }
  const lastPushed = {}
  const api = {
    /** 内核每次轮询调用:收事件、刷新在线状态、吐出到期命令。 */
    poll(payload) {
      session.lastSeen = Date.now()
      session.kernelVersion = payload?.kernel?.version ?? session.kernelVersion
      session.bootStage = payload?.kernel?.stage ?? session.bootStage
      /* 按字段更新而非粘滞:新内核每拍都上报 role(空串=当前既非主机也非客人,
       * 是真实状态,取消房间后要能落回空);旧内核(≤0.3.42)不发该字段,保持
       * 原值,工坊靠阶段启发式兜底 */
      if (typeof payload?.kernel?.role === 'string') session.role = payload.kernel.role
      session.state = payload?.state ?? session.state
      session.cfg = payload?.cfg ?? session.cfg
      /* 配置离线补发:同一个值只补一次,内核应用后 cfg 追平即不再发 */
      let want = null
      try { want = typeof syncSource === 'function' ? syncSource() : null } catch { want = null }
      if (want && payload?.cfg) {
        const id = want.identity
        if (id) {
          const key = 'id:' + JSON.stringify(id)
          const nameOk = String(payload.cfg.onlineName || '') === String(id.name || '')
          const avatarOk = String(payload.cfg.onlineAvatar || '') === String(id.avatar || '')
          if ((!nameOk || !avatarOk) && lastPushed.identity !== key) {
            lastPushed.identity = key
            api.pushCommand('set_identity', { name: String(id.name || ''), avatar: String(id.avatar || '') })
          }
        }
        const url = String(want.mqttUrl || '')
        if (url && String(payload.cfg.mqttUrl || '') !== url && lastPushed.mqttUrl !== url) {
          lastPushed.mqttUrl = url
          api.pushCommand('set_config', { key: 'mqttUrl', value: url })
        }
      }
      for (const ev of payload?.events || []) {
        session.events.push(ev)
      }
      if (session.events.length > 200) session.events.splice(0, session.events.length - 200)
      const now = Date.now()
      const due = []
      session.commands = session.commands.filter((cmd) => {
        if (now - cmd.createdAt > COMMAND_TTL_MS) return false
        due.push(cmd)
        return false
      })
      return { commands: due }
    },
    /** 工坊下发命令;返回带 id 的命令对象。 */
    pushCommand(action, args) {
      const cmd = { id: session.nextCmdId++, action, args: args || {}, createdAt: Date.now() }
      session.commands.push(cmd)
      return cmd
    },
    /** 工坊轮询的快照。 */
    snapshot() {
      return {
        online: Boolean(session.lastSeen) && Date.now() - session.lastSeen < ONLINE_WINDOW_MS,
        lastSeen: session.lastSeen || null,
        kernelVersion: session.kernelVersion,
        bootStage: session.bootStage,
        role: session.role,
        state: session.state,
        cfg: session.cfg,
        events: session.events.slice(-50),
        pending: session.commands.length,
      }
    },
    token,
  }
  return api
}

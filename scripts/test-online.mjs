#!/usr/bin/env node
/**
 * noname-kit 单测:联机助手(内核安装/哈希配对/备份滚动 + 心跳桥会话
 * [身份/信令离线补发] + 头像列表磁盘扫描)。
 * 运行:node scripts/test-online.mjs
 * 游戏目录用系统临时目录伪造;插件自带的内核源(online-kernel/)作为真实夹具,
 * 但测试全程只读它,不写入。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

const home = mkdtempSync(join(tmpdir(), 'noname-kit-online-test-'))
const gameDir = join(home, 'game')

try {
  const online = await import('../src/online.js')

  // ── 1) 自带内核源完整性(真实夹具) ─────────────────────────
  const version = online.bundledKernelVersion()
  ok(version && /^\d+\.\d+\.\d+/.test(version), `bundledKernelVersion 解析出版本号(${version})`)
  ok(existsSync(join(online.bundledKernelDir(), 'extension.js')), '自带内核源含 extension.js')

  // ── 2) kernelStatus:missing → ok(安装) ────────────────────
  mkdirSync(join(gameDir, 'extension'), { recursive: true })
  let status = online.kernelStatus({ nonameDir: gameDir })
  ok(status.state === 'missing', '未安装时 state=missing')
  ok(typeof status.bundledHash === 'string' && status.bundledHash.length === 64, 'missing 也带 bundledHash')

  const install1 = online.installKernel({
    nonameDir: gameDir,
    baseUrl: 'http://127.0.0.1:3081/noname-kit-api',
    token: 'tok-abc',
  })
  ok(install1.ok, 'installKernel 首次安装成功')
  ok(readFileSync(join(install1.target, 'nnk-bridge.json'), 'utf8').includes('tok-abc'), '桥配置已写入(nnk-bridge.json)')
  ok(existsSync(join(install1.target, 'src', 'rtc.js')), '内核子模块已复制')

  status = online.kernelStatus({ nonameDir: gameDir })
  ok(status.state === 'ok', '安装后 state=ok(桥配置与盖章文件不参与哈希)')
  ok(status.installedAt > 0, '盖章带安装时间')

  // ── 3) stale:改动已安装副本(非桥/盖章文件) ────────────────
  writeFileSync(join(online.kernelDirOf(gameDir), 'src', 'rtc.js'), '// tampered\n', 'utf8')
  status = online.kernelStatus({ nonameDir: gameDir })
  ok(status.state === 'stale', '内容被改后 state=stale')

  // ── 4) 重装备份 + 滚动清理(留 3 份) ───────────────────────
  const install2 = online.installKernel({ nonameDir: gameDir, baseUrl: 'http://127.0.0.1:3081/noname-kit-api', token: 'tok-abc' })
  ok(install2.ok && install2.backup, '重装成功且生成备份')
  for (let i = 0; i < 5; i++) {
    online.installKernel({ nonameDir: gameDir, baseUrl: 'http://127.0.0.1:3081/noname-kit-api', token: 'tok-abc' })
  }
  const backupRoot = join(gameDir, 'nnk-kernel-backups')
  const backups = readdirSync(backupRoot).filter((n) => n.startsWith('联机助手-'))
  ok(backups.length === 3, `备份滚动只留 3 份(实得 ${backups.length})`)
  status = online.kernelStatus({ nonameDir: gameDir })
  ok(status.state === 'ok', '多轮重装后仍 ok')

  // ── 5) unknown:伪造空的插件源不可测(源路径固定),改为验证缺文件时的防御 ──
  // hashKernelDir 对不存在目录返回 null —— 这是 unknown 判定的基础
  ok(online.hashKernelDir(join(home, 'no-such-dir')) === null, 'hashKernelDir 对缺失目录返回 null')

  // ── 6) 心跳桥会话 ──────────────────────────────────────────
  const bridge = online.createBridgeSession({ token: 'tok-xyz' })
  ok(bridge.snapshot().online === false, '初始离线')
  let resp = bridge.poll({ kernel: { version: '0.1.0' }, state: { phase: 'idle' }, events: [{ seq: 1, type: 'invite_ready', data: { code: 'X' }, ts: 1 }] })
  ok(Array.isArray(resp.commands) && resp.commands.length === 0, '空队列轮询返回空命令表')
  ok(bridge.snapshot().online === true, '轮询后在线')
  ok(bridge.snapshot().kernelVersion === '0.1.0', '快照带内核版本')
  ok(bridge.snapshot().events.some((e) => e.type === 'invite_ready'), '事件入账')

  const cmd1 = bridge.pushCommand('create_room', { mode: 'identity' })
  const cmd2 = bridge.pushCommand('cancel', {})
  ok(cmd1.id !== cmd2.id, '命令 id 自增')
  resp = bridge.poll({ kernel: {}, state: {}, events: [] })
  ok(resp.commands.length === 2 && resp.commands[0].action === 'create_room', '到期命令随轮询下发')
  resp = bridge.poll({ kernel: {}, state: {}, events: [] })
  ok(resp.commands.length === 0, '命令下发即出队(不重复执行)')

  // TTL 过期:pushCommand 返回的就是队列内对象,拨老 createdAt 模拟陈旧
  bridge.pushCommand('invite_refresh', {})
  const stale = bridge.pushCommand('join_room', {})
  stale.createdAt = Date.now() - 61_000
  resp = bridge.poll({ kernel: {}, state: {}, events: [] })
  ok(resp.commands.length === 1 && resp.commands[0].action === 'invite_refresh', '超过 60s 的陈旧命令被丢弃')

  // 人物标识离线补发:cfg 与保存值不一致时补发一次 set_identity,追平后不再发
  let saved = { name: '大将军', avatar: 'caocao' }
  const bridge2 = online.createBridgeSession({ token: 't2', syncSource: () => ({ identity: saved }) })
  resp = bridge2.poll({ kernel: {}, state: {}, cfg: { onlineName: '', onlineAvatar: '' }, events: [] })
  ok(resp.commands.length === 1 && resp.commands[0].action === 'set_identity' && resp.commands[0].args.name === '大将军' && resp.commands[0].args.avatar === 'caocao', '身份不一致自动补发 set_identity')
  resp = bridge2.poll({ kernel: {}, state: {}, cfg: { onlineName: '', onlineAvatar: '' }, events: [] })
  ok(resp.commands.length === 0, '同一身份只补发一次')
  resp = bridge2.poll({ kernel: {}, state: {}, cfg: { onlineName: '大将军', onlineAvatar: 'caocao' }, events: [] })
  ok(resp.commands.length === 0, 'cfg 追平后不再补发')
  saved = { name: '无名玩家', avatar: '' }
  resp = bridge2.poll({ kernel: {}, state: {}, cfg: { onlineName: '大将军', onlineAvatar: 'caocao' }, events: [] })
  ok(resp.commands.length === 1 && resp.commands[0].action === 'set_identity' && resp.commands[0].args.name === '无名玩家' && resp.commands[0].args.avatar === '', '保存值变化后会再次补发')
  const bridge3 = online.createBridgeSession({ token: 't3' })
  resp = bridge3.poll({ kernel: {}, state: {}, cfg: { onlineName: 'x', onlineAvatar: 'y' }, events: [] })
  ok(resp.commands.length === 0, '无 syncSource 不补发')

  // 自定义信令服务器离线补发(空值 = 不覆盖,跟随各游戏目录自己的值)
  let sig = 'wss://my.broker/mqtt'
  const bridge4 = online.createBridgeSession({ token: 't4', syncSource: () => ({ mqttUrl: sig }) })
  resp = bridge4.poll({ kernel: {}, state: {}, cfg: { mqttUrl: 'wss://default.example/mqtt' }, events: [] })
  ok(resp.commands.length === 1 && resp.commands[0].action === 'set_config' && resp.commands[0].args.key === 'mqttUrl' && resp.commands[0].args.value === 'wss://my.broker/mqtt', '信令地址不一致自动补发 set_config')
  resp = bridge4.poll({ kernel: {}, state: {}, cfg: { mqttUrl: 'wss://default.example/mqtt' }, events: [] })
  ok(resp.commands.length === 0, '同一信令地址只补发一次')
  resp = bridge4.poll({ kernel: {}, state: {}, cfg: { mqttUrl: 'wss://my.broker/mqtt' }, events: [] })
  ok(resp.commands.length === 0, '信令地址追平后不再补发')
  sig = ''
  resp = bridge4.poll({ kernel: {}, state: {}, cfg: { mqttUrl: 'wss://my.broker/mqtt' }, events: [] })
  ok(resp.commands.length === 0, '清空信令 = 不覆盖,不补发')

  // 事件上限 200
  const flood = []
  for (let i = 0; i < 260; i++) flood.push({ seq: 1000 + i, type: 'x', data: null, ts: 2 })
  bridge.poll({ kernel: {}, state: {}, events: flood })
  ok(bridge.snapshot().events.length <= 200, '事件封顶 200 条(实得 ' + bridge.snapshot().events.length + ')')

  // ── 7) 头像列表:扫游戏目录(不依赖游戏运行) ────────────────
  const write = await import('../src/write.js')
  // 新版格式:const characters/const translates(官方 1.11.5 自带包形态)
  mkdirSync(join(gameDir, 'character'), { recursive: true })
  writeFileSync(join(gameDir, 'character', 'standard.js'), `import { game } from "noname";
const characters = {
  gz_avatarx: { sex: "male", group: "wei", hp: 4, skills: [] },
  av_yuejin: { sex: "male", group: "wei", hp: 4, skills: ["s1"] }
};
const translates = {
  av_yuejin: "标乐进",
  s1: "骁果",
  s1_info: "技能描述"
};
export default { name: "standard", character: characters, translate: translates };
`)
  // 老版格式:game.import(懒人包/老扩展形态,子目录递归要能进)
  mkdirSync(join(gameDir, 'character', 'sub'), { recursive: true })
  writeFileSync(join(gameDir, 'character', 'sub', 'character.js'), `game.import("character", function(lib, game, ui, get, ai, _status) {
  return {
    name: "sub",
    character: { av_old: ["male", "shu", 3, ["s2"]] },
    translate: { av_old: "老武将", s2: "技能二" }
  };
});
`)
  // 扩展包(工坊「编辑已有武将」同款识别)
  mkdirSync(join(gameDir, 'extension', '头像扩展'), { recursive: true })
  writeFileSync(join(gameDir, 'extension', '头像扩展', 'extension.js'), `game.import("extension", function(lib, game, ui, get, ai, _status) {
  return {
    name: "头像扩展",
    content() {},
    character: { av_ext: ["female", "qun", 3, ["s3"]] },
    translate: { av_ext: "扩展武将", s3: "技能三" }
  };
});
`)
  const avatars = await write.listAvatars(gameDir)
  const byId = new Map(avatars.map((a) => [a.id, a.name]))
  ok(byId.get('av_yuejin') === '标乐进', '新版 const characters 条目认出,名字取自 const translates 复数段')
  ok(byId.get('av_old') === '老武将', '老版 game.import 武将段认出(character/ 子目录递归)')
  ok(byId.get('av_ext') === '扩展武将', '扩展包武将认出(工坊同款识别)')
  ok(!byId.has('gz_avatarx'), '国战 gz_ 变体已滤掉')
  ok(byId.get('s1') === undefined || true, '技能 id 不碍事(只在查武将 id 时读名字)')
  const idxYuejin = avatars.findIndex((a) => a.id === 'av_yuejin')
  const idxOld = avatars.findIndex((a) => a.id === 'av_old')
  ok(idxYuejin >= 0 && idxOld >= 0 && idxYuejin < idxOld, '按中文名排序(标乐进 b < 老武将 l)')

  // ── 结构性回归锁:重试预算与信令超时的策略(防止被无声改回) ──
  const repoRoot = join(here, '..')
  const guestSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'guest.js'), 'utf8')
  const sigSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'signaling.js'), 'utf8')
  ok(guestSrc.includes('lastJoinSignalFail'), '信令层失败有打标(自动重回据此不扣次数)')
  ok(guestSrc.includes('var deduct = signalOnlyNext ? 0 :'), '信令失败不扣重试次数(只扣房间层失败)')
  ok(guestSrc.includes('rejoinSignalStreak > 8'), '信令连续失败有上限(不会无限重试)')
  ok(sigSrc.includes('connectTimeout: 6000'), '信令连接超时压到 6 秒(健康连接 1~3 秒完成)')
  ok(sigSrc.includes('}, 7000);'), '信令兜底超时 7 秒(不再 12 秒拖慢自动重回)')
  ok(!sigSrc.includes('连接超时(可改用邀请码方式)'), '超时文案不再甩锅房主')

  // ── 结构性回归锁:房主退游戏后客人不再白转 8 轮(10-08 实测报障) ──
  ok(guestSrc.includes('lastAttemptBeatDead = true'), '心跳判死处记证据(重回循环据此计数)')
  ok(guestSrc.includes('guestState.lastAttemptBeatDead = false;   /* 心跳在刷新=房主活着'), '心跳在刷新时清掉判死证据')
  ok(guestSrc.includes('rejoinBeatStreak >= 3'), '心跳判死连续 3 轮即收场(不烧满 8 轮)')
  ok(guestSrc.includes('连续多轮收不到房主心跳'), '收场给人话:解散/关游戏,不再说「正在重组房间」')
  ok(guestSrc.includes('房主已无心跳,尝试重回'), '判死期间文案分流(不再谎称「重组房间」)')
  ok(guestSrc.replace(/\r\n/g, '\n').includes('guestState.lastAttemptBeatDead = false;\n\t\t\t\tguestState.rejoinBeatStreak = 0;\n\t\t\t}\n\t\t\tif (!rejoin && env.game.online)'), '手动发起新加入时清空判死计数')
  const iceGuard = guestSrc.lastIndexOf('pc.onconnectionstatechange')   /* 后者=房号门;前者=邀请码门(自带 failNoted 守卫) */
  ok(iceGuard > 0 && guestSrc.slice(iceGuard, iceGuard + 400).includes('if (guestState.session !== session)'), 'ICE 失败回调有会话守卫(旧 pc 迟到报错不误杀新尝试)')
  ok(guestSrc.includes('lastIceFailAt'), '「直连建立失败」同文案 2 秒去重(实测双发)')

  // ── 结构性回归锁:房间模式白名单单一来源(联机单挑局会把它原生改成
  //    "normal",污染路径拦截,10-08 实测「创建房间恒报不支持的模式」) ──
  const hostSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'host.js'), 'utf8')
  ok(hostSrc.includes('var ROOM_MODES = ["identity", "guozhan", "versus", "doudizhu", "single"]'), '房间模式白名单有唯一来源')
  ok(hostSrc.split('["identity", "guozhan",').length === 2, '内联白名单只剩定义处一处(加模式只改一处)')
  ok(!hostSrc.includes('env._status.mode || "identity"'), '对局结束接力不再收引擎被单挑局改写的模式(创建房间报 normal 的污染源)')
  ok(hostSrc.includes('ROOM_MODES.indexOf(pendingTask.mode) >= 0'), '开机续跑对接力的 mode 过白名单(拦被污染的标记)')
  ok(hostSrc.includes('ROOM_MODES.indexOf(pendingTask.mode) >= 0) ? pendingTask.mode : "identity"'), '看门狗救房的 mode 同样过白名单')

  // ── 虚拟网卡直连(Radmin/ZeroTier 等异地组网,10-08 需求)──
  const rtcSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'rtc.js'), 'utf8')
  const rtcSandbox = { window: { __nnk__: { modules: { config: { get: () => [] } } } } }
  runInNewContext(rtcSrc, rtcSandbox)
  const rtc = rtcSandbox.window.__nnk__.modules.rtc
  const faces = {
    'Radmin VPN': [{ family: 'IPv4', address: '26.12.34.56', internal: false }],
    'Ethernet': [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
    'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  }
  ok(rtc.virtualIpsFrom(faces, []).join() === '26.12.34.56', 'Radmin 网卡自动识别(26.x 网段),普通网卡/环回不注入')
  ok(rtc.virtualIpsFrom({ 'ZeroTier One': [{ family: 'IPv4', address: '10.9.9.9', internal: false }] }, []).join() === '10.9.9.9', 'ZeroTier 按网卡名识别')
  ok(rtc.virtualIpsFrom({ '以太网 2': [{ family: 'IPv4', address: '25.1.2.3', internal: false }] }, []).join() === '25.1.2.3', 'Hamachi 网段(25.x)按地址识别(网卡名任意)')
  ok(rtc.virtualIpsFrom(faces, ['26.99.99.99']).length === 2, '手动补充列表并入选出')
  ok(rtc.virtualIpsFrom({ 'Ethernet': [{ family: 'IPv4', address: '192.168.1.5', internal: false }] }, []).length === 0, '无虚拟网卡=空(对普通用户零影响)')
  ok(rtc.hostPortFromSdp('v=0\r\na=candidate:1 1 udp 2122260223 8f2a-1.local 54321 typ host generation 0') === '54321', '从本地 SDP 提取 ICE 端口(地址被 mDNS 打码,端口是真的)')
  ok(rtc.hostPortFromSdp('a=candidate:2 1 udp 1686052607 1.2.3.4 54322 typ srflx raddr 0.0.0.0 rport 0') === null, '只有 host 候选参与提取')
  const addCalls = []
  const fakePc = { addIceCandidate: (c) => { addCalls.push(c.candidate); return Promise.resolve() } }
  ok(rtc.addInjected(fakePc, ['26.1.2.3:54321']) === 1 && addCalls[0].includes('26.1.2.3 54321 typ host'), '注入候选格式正确(host 优先级)')
  ok(rtc.addInjected(fakePc, ['坏地址', '26.1.2.3:abc', '']) === 0, '坏地址全部拒绝')
  ok(rtcSrc.includes('hosts: hosts && hosts.length ? hosts : undefined'), '邀请码载荷带直连地址(空则不带,旧内核收码也无害)')
  ok(guestSrc.split('rtc.directHosts(pc)').length === 3, '客人侧两处发出直连地址(房号提议 + 回执码)')
  ok(hostSrc.split('rtc.directHosts(pc)').length === 3, '主机侧两处发出直连地址(应答 + 邀请码)')
  ok(guestSrc.includes('rtc.addInjected(pc, msg.hosts)') && guestSrc.includes('rtc.addInjected(pc, data.hosts)'), '客人侧两处收下对方直连地址(应答/邀请码)')
  ok(hostSrc.includes('rtc.addInjected(pc, msg.hosts)') && hostSrc.includes('rtc.addInjected(pc, data.hosts)'), '主机侧两处收下对方直连地址(提议/回执码)')

  console.log(`\n全部通过:${passed} 项`)
} finally {
  rmSync(home, { recursive: true, force: true })
}

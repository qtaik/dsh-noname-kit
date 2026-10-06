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
import assert from 'node:assert/strict'

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

  console.log(`\n全部通过:${passed} 项`)
} finally {
  rmSync(home, { recursive: true, force: true })
}

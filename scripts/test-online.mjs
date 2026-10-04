#!/usr/bin/env node
/**
 * noname-kit 单测:联机助手(内核安装/哈希配对/备份滚动 + 心跳桥会话)。
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

  // TTL 过期:伪造一条 61s 前的命令
  const stale = { id: 99, action: 'create_room', args: {}, createdAt: Date.now() - 61_000 }
  bridge.pushCommand('invite_refresh', {})
  bridge._session.commands.push(stale)
  resp = bridge.poll({ kernel: {}, state: {}, events: [] })
  ok(resp.commands.length === 1 && resp.commands[0].action === 'invite_refresh', '超过 60s 的陈旧命令被丢弃')

  // 事件上限 200
  const flood = []
  for (let i = 0; i < 260; i++) flood.push({ seq: 1000 + i, type: 'x', data: null, ts: 2 })
  bridge.poll({ kernel: {}, state: {}, events: flood })
  ok(bridge.snapshot().events.length <= 200, '事件封顶 200 条(实得 ' + bridge.snapshot().events.length + ')')

  console.log(`\n全部通过:${passed} 项`)
} finally {
  rmSync(home, { recursive: true, force: true })
}

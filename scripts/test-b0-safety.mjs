#!/usr/bin/env node
import testPaths from './fixtures/test-paths.cjs';
/* 旧补传协议暂停行为回归:执行真实入口代码,所有传输/文件系统/游戏均为内存桩。
 * 不执行 shell,不安装内核,不写任何游戏目录。不是完整 DSH/Electron 集成测试。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as guardModule from '../src/guard.js'
import { readWorkingDirectory } from '../presets/noname-dev/working-directory.mjs'
import { bundledKernelBuild, bundledKernelVersion, createBridgeSession, kernelRuntimeStatus } from '../src/online.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (file) => readFileSync(join(root, file), 'utf8')
const index = source('index.js')
let passed = 0, failed = 0
function test(label, fn) {
  try { fn(); passed++; console.log('  ✓ ' + label) }
  catch (error) { failed++; console.error('  ✗ ' + label + ': ' + error.message) }
}
async function asyncTest(label, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + label) }
  catch (error) { failed++; console.error('  ✗ ' + label + ': ' + error.message) }
}
function sliceBetween(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, '真实入口的源码锚点存在')
  return text.slice(a, b)
}

// 捕获 index.js 实际注册的 guard，覆盖完整入口的写入保护。
let guard
const guardContext = {
  active: true, nonameDir: 'D:/audit-game', process, resolve, readWorkingDirectory, ...guardModule,
  extRootOf: (dir) => join(dir, 'extension'),
  ctx: { tools: { guard: (fn) => { guard = fn } } },
}
runInNewContext(index.match(/const GUARDED_TOOLS =[^\n]+/)[0] + '\n' +
  sliceBetween(index, 'function pathArgOf', '/** /detect') + '\n' +
  sliceBetween(index, 'ctx.tools.guard((exec)', "ctx.inject(['webServer']"), guardContext)
for (const name of ['pwsh', 'tool:pwsh']) {
  const hit = (command, extra = {}, cwd = 'E:/agent') => guard({
    name, arguments: { command, ...extra }, agent: { session: { header: { cwd } } },
  })
  for (const command of [
    'Set-Content D:/audit-game/extension/包/extension.js x',
    'Set-Content -Path D:\\audit-game\\extension\\包\\extension.js -Value x',
    "Set-Content -LiteralPath 'D:/audit-game/extension/中文 包/extension.js' -Value x",
    'Add-Content D:/audit-game/extension./包/extension.js x',
    "'x' | Out-File D:/audit-game/extension/包/x.js",
    'Remove-Item D:/audit-game/extension/包 -Recurse',
    'Copy-Item E:/tmp/x.js D:/audit-game/extension/包/x.js',
    '[IO.File]::WriteAllText("D:/audit-game/extension/包/x.js", "x")',
    "Set-Location 'D:/audit-game/extension/包'; Set-Content extension.js x",
    'cd D:/audit-game; Set-Content extension/包/x.js x',
    'Set-Content extension/包/x.js x',
    'sc extension/包/x.js x',
    'New-Item D:/audit-game/extension/包/x.js -ItemType File',
    'Set-Location D:/audit-game; Push-Location extension/包; Add-Content x.js x',
    "'x' > D:/audit-game/extension/包/x.js",
  ]) test(name + ' 拦截: ' + command, () => assert.ok(hit(command)))
  test(name + ' 采用 workdir', () => assert.ok(hit('Set-Content x.js x', { workdir: 'D:/audit-game/extension/包' })))
  test(name + ' 相对 workdir 解析到 session cwd', () => assert.ok(hit('Set-Content x.js x', { workdir: 'extension/包' }, 'D:/audit-game')))
  test(name + ' 采用 session cwd', () => assert.ok(hit('Set-Content x.js x', {}, 'D:/audit-game/extension/包')))
  test(name + ' 保留扩展只读访问', () => assert.equal(hit('Get-Content D:/audit-game/extension/包/extension.js'), undefined))
  test(name + ' 允许非游戏写入', () => assert.equal(hit('Set-Content E:/tmp/x.js x'), undefined))
}
test('原 write 与 bash 仍受保护', () => {
  assert.ok(guard({ name: 'write', arguments: { file_path: 'D:/audit-game/extension/包/x.js' } }))
  assert.ok(guard({ name: 'bash', arguments: { command: 'echo x > D:/audit-game/extension/包/x.js' } }))
})
test('未激活时不拦工具', () => {
  guardContext.active = false
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Set-Content D:/audit-game/extension/包/x.js x' } }), undefined)
  guardContext.active = true
})

const txSource = source('online-kernel/src/transfer.js')
const quiet = { log() {}, warn() {}, error() {} }
function kernel(preinstalled = false) {
  const events = [], acks = [], frames = [], calls = { fs: 0, timers: 0, decode: 0, closed: 0, legacy: 0 }
  const bridge = { bridgeId: 'guest-1', _entered: true,
    send: (frame) => frames.push(JSON.parse(frame)), close: () => calls.closed++ }
  const lib = { message: { client: {}, server: {} }, config: {
    extensions: ['包', '联机助手'], extension_包_enable: true,
  }, characterPack: { 包武将: {} }, cardPack: {}, translate: {} }
  if (preinstalled) {
    for (const key of ['nnk_tx_begin', 'nnk_tx_file', 'nnk_tx_data', 'nnk_tx_done']) {
      lib.message.client[key] = () => { calls.legacy++; throw Error('旧接收器不应执行') }
      lib.message.client['__nnk' + key] = true
    }
    for (const [key, marker] of [['nnk_tx_progress', '__nnkTxProgress'], ['nnk_tx_ack', '__nnkTxAck']]) {
      lib.message.server[key] = () => { calls.legacy++ }
      lib.message.server[marker] = true
    }
  }
  const nnk = { version: '0.3.67', state: { host: { bridges: [bridge] } },
    env: { lib, game: { send: (func, msg) => acks.push({ func, ...msg }) }, get: { connectNickname: () => '主机' } },
    modules: { bridge: { emit: (type, data) => events.push({ type, data }) },
      config: { get: () => true }, compat: { gameRoot: () => 'D:/audit-game' } } }
  const context = { window: { __nnk__: nnk, require: () => { calls.fs++; throw Error('旧版传输不得获取文件能力') } },
    console: quiet, setTimeout: () => { calls.timers++; return 1 }, clearTimeout() {},
    Uint8Array, Buffer, btoa: () => { throw Error('不得编码内容') }, atob: () => { calls.decode++; throw Error('不得解码内容') } }
  runInNewContext(txSource, context)
  nnk.modules.transfer.install()
  return { nnk, context, lib, bridge, events, acks, frames, calls }
}
function assertContained(k) {
  assert.deepEqual(k.calls, { fs: 0, timers: 0, decode: 0, closed: 0, legacy: 0 })
  assert.ok(!k.frames.some(([func]) => /^nnk_tx_/.test(func)), '不发送文件内容/清单')
  assert.ok(!k.events.some((ev) => ['transfer_done', 'transfer_progress', 'transfer_begin'].includes(ev.type)), '不产生伪成功/进行中')
  assert.ok(k.acks.every((ack) => ack.type === 'fail' && ack.code === 'TRANSFER_PAUSED'), '只回暂停失败')
}
for (const input of ['包', ['包', '包二'], null]) test('start 拒绝手动/自动输入 ' + JSON.stringify(input), () => {
  const k = kernel()
  assert.equal(k.nnk.modules.transfer.start(input, 'guest-1'), 0)
  assert.ok(k.events.some((e) => e.type === 'transfer_failed' && e.data.code === 'TRANSFER_PAUSED'))
  assertContained(k)
})
for (const protocol of [undefined, 1, 2, 'future']) test('接收端拒绝协议 ' + protocol + ' 的完整正常单文件链', () => {
  const k = kernel()
  const begin = { id: 1, name: '包', protocol, total: 1, files: [{ rel: 'extension.js', size: 1 }] }
  k.lib.message.client.nnk_tx_begin(begin)
  k.lib.message.client.nnk_tx_file({ id: 1, name: '包', rel: 'extension.js', size: 1 })
  k.lib.message.client.nnk_tx_data({ id: 1, rel: 'extension.js', get b64() { throw Error('不得读取内容') } })
  k.lib.message.client.nnk_tx_done({ id: 1 })
  assert.ok(k.acks.length && k.acks[0].type === 'fail')
  assertContained(k)
})
test('导出 begin 也拒绝,重复请求每次得到 fail', () => {
  const k = kernel()
  k.nnk.modules.transfer.begin({ id: 2, name: '包', files: [] })
  k.nnk.modules.transfer.begin({ id: 2, name: '包', files: [] })
  assert.equal(k.acks.length, 2)
  assertContained(k)
})
test('修改导出 paused 属性不能解除内部暂停', () => {
  const k = kernel()
  k.nnk.modules.transfer.paused = false
  assert.equal(k.nnk.modules.transfer.start('包'), 0)
  k.nnk.modules.transfer.begin({ id: 3, name: '包', files: [] })
  assertContained(k)
})
test('暂停 fail 被旧协议 onAck 识别,未知 code 不导致 legacy 继续发送', () => {
  const k = kernel()
  k.lib.message.client.nnk_tx_begin({ id: 4, name: '包', files: [] })
  let resolved, cleared = 0
  // legacy onAck 处理器:验证暂停诊断不破坏旧 fail 收尾分支。
  const legacy = { ackWait: { id: 4, timer: 1, resolve: (value) => { resolved = value } },
    ackFailReason: '', clearTimeout: () => { cleared++ } }
  runInNewContext(sliceBetween(txSource, 'function onAck(msg)', 'function enteredBridges()'), legacy)
  legacy.onAck(k.acks[0])
  assert.equal(resolved, false)
  assert.equal(legacy.ackWait, null)
  assert.equal(cleared, 1)
  assert.match(legacy.ackFailReason, /补传已暂停/)
  assertContained(k)
})
test('孤立/乱序 file/data/done 不写盘,连续块不重复刷屏', () => {
  const k = kernel()
  for (let i = 0; i < 100; i++) k.lib.message.client.nnk_tx_data({ id: 9, b64: 'eA==' })
  k.lib.message.client.nnk_tx_file({ id: 10, name: '包', rel: 'x.js', size: 1 })
  k.lib.message.client.nnk_tx_done({ id: 11 })
  assert.equal(k.acks.length, 3)
  assert.equal(k.events.length, 3)
  assertContained(k)
})
test('断开的回执通道/事件桥不能令暂停处理器抛出或回落写盘', () => {
  const k = kernel()
  k.nnk.env.game.send = () => { throw Error('通道已断') }
  k.nnk.modules.bridge.emit = () => { throw Error('工坊桥不可用') }
  k.lib.message.client.nnk_tx_begin({ id: 12, name: '包' })
  k.lib.message.client.nnk_tx_data({ id: 12, b64: 'eA==' })
  k.lib.message.client.nnk_tx_done({ id: 12 })
  assert.equal(k.nnk.modules.transfer.start('包'), 0)
  assertContained(k)
})
test('已有 legacy 标记也被替换,ready/done/progress 不能解除暂停', () => {
  const k = kernel(true)
  k.nnk.modules.transfer.install()
  for (const key of ['nnk_tx_begin', 'nnk_tx_file', 'nnk_tx_data', 'nnk_tx_done']) k.lib.message.client[key]({ id: 5 })
  k.lib.message.server.nnk_tx_ack.call({ ws: k.bridge }, { id: 5, type: 'ready' })
  k.lib.message.server.nnk_tx_ack.call({ ws: k.bridge }, { id: 5, type: 'done' })
  k.lib.message.server.nnk_tx_progress({ name: '包', pct: 100 })
  assertContained(k)
})
test('重复安装暂停处理器后，已保存的处理器引用和底层本体均保持暂停', () => {
  const k = kernel()
  const saved = { ...k.lib.message.client }
  k.nnk.modules.transfer.install()
  for (const key of ['nnk_tx_begin', 'nnk_tx_file', 'nnk_tx_data', 'nnk_tx_done']) saved[key]({ id: 15 })
  // 真正的底层函数本体也有门禁,不只依赖 install 的表项包装。
  const rejects = []
  const handlers = runInNewContext(sliceBetween(txSource, 'function clientHandlers()', 'function sendAck(') + '\nclientHandlers()', {
    TRANSFER_PAUSED: true, rejectIncoming: (msg) => rejects.push(msg.id),
  })
  for (const key of Object.keys(handlers)) handlers[key]({ id: 16, b64: 'eA==' })
  assert.equal(rejects.length, 4)
  assert.equal(k.nnk.state.transferPaused, true)
  assertContained(k)
})
test('sendDirect 禁止补传帧,但保留 Manifest 定向传输', () => {
  const k = kernel()
  for (const func of ['nnk_tx_begin', 'nnk_tx_file', 'nnk_tx_data', 'nnk_tx_done']) {
    assert.equal(k.nnk.modules.transfer.sendDirect({ ws: k.bridge }, func, { name: '包' }), false)
  }
  k.bridge._entered = false
  assert.equal(k.nnk.modules.transfer.sendDirect({ ws: k.bridge }, 'nnk_manifest_diff', { exts: { missing: ['包'] } }), false)
  assert.equal(k.frames.length, 0)
  k.bridge._entered = true
  assert.equal(k.nnk.modules.transfer.sendDirect({ ws: k.bridge }, 'nnk_manifest_diff', { exts: { missing: ['包'] } }), true)
  assert.equal(k.frames.length, 1)
  assertContained(k)
})
test('缺包清单定向体检,无归属结果被忽略且重检不自动补传', () => {
  const k = kernel()
  runInNewContext(source('online-kernel/src/manifest.js'), k.context)
  k.nnk.modules.manifest.install()
  k.bridge.channel = { readyState: 'open' }
  k.bridge.onDown = () => {}
  k.nnk.modules.manifest.attach(k.bridge, 'host')
  for (let i = 0; i < 3; i++) k.lib.message.server.nnk_manifest.call({ ws: k.bridge }, { exts: [], packs: [], cards: [], kernel: '0.1.0' })
  assert.equal(k.frames.length, 3)
  assert.ok(k.frames.every(([func, result]) => func === 'nnk_manifest_diff' && result.exts.missing[0] === '包'))
  assert.ok(k.events.some((e) => e.type === 'info' && /暂停/.test(e.data.message)))
  const count = k.events.length
  k.lib.message.client.nnk_manifest_diff(k.frames[0][1])
  assert.equal(k.events.length, count)
  k.nnk.modules.manifest.detach(k.bridge)
  k.nnk.modules.manifest.sendManifest()
  assert.ok(k.acks.some((ack) => ack.func === 'nnk_manifest'))
  k.acks.pop() // Manifest 上报不是 transfer ack
  assertContained(k)
})
test('已下发/旧桥命令的真实 dispatch 仍不能绕过 start 门禁', async () => {
  const k = kernel()
  const dispatchCode = sliceBetween(source('online-kernel/src/bridge.js'), 'async function dispatch(cmd)', '/* 命令执行报错')
  const dispatch = runInNewContext(dispatchCode + '\ndispatch', { nnk: k.nnk, commandOverride:null })
  await dispatch({ action: 'transfer_pack', args: { name: '包' } })
  assert.ok(k.events.some((e) => e.type === 'transfer_failed' && e.data.code === 'TRANSFER_PAUSED'))
  assertContained(k)
})

// HTTP 分派真实分支:不启动服务,不触发配置落盘或 DSH 网络。
const routeCode = sliceBetween(index, "if (req.method === 'POST' && url.pathname === '/noname-kit-api/online/command')", "if (req.method === 'GET' && url.pathname === '/noname-kit-api/extension')")
async function command(action) {
  const pushes = []
  const fn = runInNewContext('(async function () {\n' + routeCode + '\n})', {
    req: { method: 'POST' }, url: { pathname: '/noname-kit-api/online/command' },
    readBody: async () => ({ action, args: { name: '包' } }), json: (status, body) => ({ status, body }),
    bridge: { pushCommand: (a, args) => { pushes.push({ a, args }); return { id: 1 } } },
    nonameDir:testPaths.testPath("temp/b0-no-batch"),revokeBatch:()=>false,
  })
  return { result: await fn(), pushes }
}
await asyncTest('旧 UI/混装内核手动命令在 HTTP 入队前拒绝', async () => {
  const { result, pushes } = await command('transfer_pack')
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'TRANSFER_PAUSED')
  assert.match(result.body.error, /暂停/)
  assert.equal(pushes.length, 0)
})
for (const action of ['create_room', 'join_room', 'cancel', 'clear_quarantine', 'invite_refresh']) {
  await asyncTest(action + ' 正常入队不被补传暂停阻断', async () => {
    const { result, pushes } = await command(action)
    assert.equal(result.status, 200)
    assert.equal(pushes[0].a, action)
  })
}

// UI 真函数渲染:旧 transfer_done 历史不能让当前缺包消失。
const cardCode = sliceBetween(source('client.js'), 'function renderManifestCard(', 'function leaveRoom(')
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() })
const helperCode = sliceBetween(source('client.js'), 'function onlineManifestCheck(', 'function onlineEventText(')
const render = runInNewContext(helperCode + cardCode + '\nrenderManifestCard', {
  h, e: (tag, cls, ...children) => h(tag, { className: cls }, ...children),
  bridge: { cfg: {}, kernelVersion: '0.3.67' }, setNote() {}, sendCmd() { throw Error('暂停按钮不应发命令') },
  onlinePickEvent: (evs, type) => evs.findLast((ev) => ev.type === type), onlineEventText: (ev) => ev.data.message,
})
const nodes = (tree) => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
const text = (tree) => tree && typeof tree === 'object' ? tree.children.map(text).join('') : String(tree || '')
for (const host of [true, false]) test('体检卡片 ' + (host ? '主机' : '客人') + ' 隐藏技术长提示且不抹去缺包', () => {
  const technicalNotice = /旧协议缺少客人逐请求授权|整批完整性[／/]回滚保障|不接受 legacy 降级|应用此止损/
  const emptyTree = render([], host)
  assert.doesNotMatch(text(emptyTree), technicalNotice)
  const tree = render([
    { type: 'manifest_diff', data: { exts: { missing: ['包'], extra: [] }, packs: { missing: [] }, guestKernel: '0.1.0', hostKernel: '0.1.0' } },
    { type: 'transfer_done', data: { name: '包', message: '旧版成功' } },
  ], host)
  assert.doesNotMatch(text(tree), technicalNotice)
  assert.match(text(tree), /缺以下扩展/)
  assert.doesNotMatch(text(tree), /双方扩展一致|已补传|旧版成功/)
  for (const card of [emptyTree, tree]) {
    const transferActions = nodes(card).filter((n) => n.tag === 'button' && /补传|同意本批|拒绝本批|取消本批|重新提议|重载/.test(text(n)))
    assert.equal(transferActions.length, 0, '旧协议记录只能体检，不能取得补传或重载操作')
    assert.match(text(card), /补传当前不可用|请自行安装或待补传条件就绪/)
  }
  for (const card of [emptyTree, tree]) {
    const recheck = nodes(card).filter((n) => n.tag === 'button' && text(n) === '重新体检')
    assert.equal(recheck.length, 1)
    for (const button of recheck) { assert.notEqual(button.props.disabled, true); assert.equal(typeof button.props.onClick, 'function') }
  }
})

const current = { online: true, kernelVersion: bundledKernelVersion(), kernelBuild: bundledKernelBuild(), transferPaused: true, bootStage: 'ready' }
test('安装与运行版本具有独立暂停标识', () => {
  assert.equal(current.kernelVersion, '0.3.90')
  assert.equal(current.kernelBuild, bundledKernelBuild())
  assert.ok(current.kernelBuild)
  assert.equal(kernelRuntimeStatus({ state: 'ok' }, current), 'b0_active')
})
for (const [label, disk, bridge, expected] of [
  ['旧运行版本', 'ok', { kernelVersion: '0.3.80' }, 'restart_required'],
  ['同版本无新代码标识', 'ok', { kernelBuild: null }, 'restart_required'],
  ['同版本旧代码标识', 'ok', { kernelBuild: 'obsolete-build', transferProtocol: 'nnk-transfer/1' }, 'restart_required'],
  ['同版本旧补传能力', 'ok', { transferPaused: false, transferProtocol: 'nnk-transfer/1' }, 'restart_required'],
  ['错误补传协议不能替代暂停保护', 'ok', { transferPaused: false, transferProtocol: 'nnk-transfer/0' }, 'restart_required'],
  ['暂停处理器未安装', 'ok', { transferPaused: false }, 'restart_required'],
  ['仅运行新代码但磁盘旧', 'stale', {}, 'restart_required'],
  ['启动尚未完成', 'ok', { bootStage: 'transfer-done' }, 'booting'],
  ['已离线', 'ok', { online: false }, 'offline'],
]) test(label + ' 不误判已部署生效', () => assert.equal(kernelRuntimeStatus({ state: disk }, { ...current, ...bridge }), expected))
test('当前代码的精确新协议标识可替代旧暂停保护', () => {
  assert.equal(kernelRuntimeStatus({ state: 'ok' }, { ...current, transferPaused: false, transferProtocol: 'nnk-transfer/2' }), 'b0_active')
})
test('旧内核后续心跳撤销已缓存的暂停标识', () => {
  const bridge = createBridgeSession({ token: 'mock' })
  bridge.poll({ kernel: { version: current.kernelVersion, build: current.kernelBuild, transferPaused: true, stage: 'ready' } })
  assert.equal(kernelRuntimeStatus({ state: 'ok' }, bridge.snapshot()), 'b0_active')
  bridge.poll({ kernel: { version: '0.3.80', stage: 'ready' } })
  assert.equal(bridge.snapshot().kernelBuild, null)
  assert.equal(bridge.snapshot().transferPaused, false)
  assert.equal(kernelRuntimeStatus({ state: 'ok' }, bridge.snapshot()), 'restart_required')
})
test('缺消息表时不宣称暂停处理器安装完成', () => {
  const k = kernel()
  delete k.lib.message.client
  k.nnk.modules.transfer.install()
  assert.equal(k.nnk.state.transferPaused, false)
})

console.log(`\nB0: ${passed} 项通过, ${failed} 项失败`)
if (failed) process.exitCode = 1

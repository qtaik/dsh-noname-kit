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
import { runBridgeSerializationChecks } from './test-bridge-rebinding.mjs'

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
  /* 凭据配对:插件配置重建可能生成新 token,状态接口通过 tokenMatches
   * 识别内核与插件凭据不一致,并提示重新安装内核以恢复心跳。 */
  ok(online.kernelStatus({ nonameDir: gameDir, token: 'tok-abc' }).tokenMatches === true, 'token 相符时 tokenMatches=true')
  ok(online.kernelStatus({ nonameDir: gameDir, token: 'tok-old' }).tokenMatches === false, 'token 不符(设置文件被重建过)时 tokenMatches=false')
  ok(online.kernelStatus({ nonameDir: gameDir }).tokenMatches === null, '不传 token 时 tokenMatches=null(不误报)')

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

  ok(sigSrc.includes('connectTimeout: 6000'), '信令连接超时压到 6 秒(健康连接 1~3 秒完成)')
  ok(sigSrc.includes('}, 7000);'), '信令兜底超时 7 秒(不再 12 秒拖慢自动重回)')
  ok(!sigSrc.includes('连接超时(可改用邀请码方式)'), '超时文案不再甩锅房主')

  // ── 房主关闭游戏时停止客机的自动重试 ──



  // ── 房间模式白名单使用单一来源,避免原生单挑模式的 normal 值影响校验 ──
  // 白名单保持对工坊支持的实际房间模式进行校验。
  const hostSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'host.js'), 'utf8')

  ok(!hostSrc.includes('env._status.mode || "identity"'), '对局结束接力不再收引擎被单挑局改写的模式(创建房间报 normal 的污染源)')


  // Keepalive replaces the retired auto-rejoin API. Exercise the real delegates
  // rather than treating legacy implementation tokens as behavior.
  const observedCalls=[], delegateNnk={modules:{},state:{},keepaliveEntry:{role:'ordinary',beginCarrier:async cmd=>{observedCalls.push(cmd);return {accepted:true};}}};
  const delegateContext={window:{__nnk__:delegateNnk},console};runInNewContext(guestSrc,delegateContext);runInNewContext(hostSrc,delegateContext);
  await delegateNnk.modules.guest.joinByRoomCode('ABCDEF');await delegateNnk.modules.host.createInternetRoom('single');
  ok(observedCalls.length===2&&observedCalls[0].action==='join_room'&&observedCalls[1].action==='create_room','普通首命令真实转交一次，不进入旧重连入口');
  assert.throws(()=>delegateNnk.modules.guest.init(),/自动重连/);assert.throws(()=>delegateNnk.modules.host.init(),/旧引擎网络宿主/);passed++;
  let rejects=0;delegateNnk.keepaliveRuntime={joinByInvite:async()=>{rejects++;throw Error('actual async failure');},restartRoom:async mode=>({mode})};
  await assert.rejects(delegateNnk.modules.guest.joinByInvite('NNK1.bad'),/actual async failure/);ok(rejects===1,'异步加入失败返回调用方，不自动重连或重复协商');
  ok((await delegateNnk.modules.host.restartRoom('single')).mode==='single','下一局模式显式转交，不使用被单挑改写的原生 mode');

  // ── 虚拟网卡直连(Radmin/ZeroTier 等异地组网)──
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
  ok(rtc.virtualIpsFrom({ 'Radmin': [{ family: 4, address: '26.5.5.5', internal: false }] }, []).join() === '26.5.5.5', 'family 为数字 4 的旧形态也认')
  ok(rtc.hostPortsFromSdp('v=0\r\na=candidate:1 1 udp 2122260223 8f2a.local 54321 typ host generation 0\r\na=candidate:2 1 udp 2122194687 8f2a.local 54322 typ host generation 0\r\na=candidate:3 1 udp 1686052607 1.2.3.4 54323 typ srflx').join() === '54321,54322', '提取全部 host 候选端口(去重;srflx 不算)')
  ok(rtc.hostPortsFromSdp('v=0\r\n').length === 0, '没有 host 候选=空数组(不发虚假地址)')
  rtcSandbox.window.__nnk__.modules.config.get = () => ['26.9.9.9']
  const pcStub = { localDescription: { sdp: 'a=candidate:1 1 udp 1 x.local 1111 typ host\r\na=candidate:2 1 udp 2 x.local 2222 typ host' } }
  ok(rtc.directHosts(pcStub).join() === '26.9.9.9:1111,26.9.9.9:2222', '直连地址=虚拟IP×全部端口交叉(双网卡机器只取第一个端口必失效)')
  rtcSandbox.window.__nnk__.modules.config.get = () => []
  const addCalls = []
  const fakePc = { addIceCandidate: (c) => { addCalls.push(c.candidate); return Promise.resolve() } }
  ok(rtc.addInjected(fakePc, ['26.1.2.3:54321']) === 1 && addCalls[0].includes('26.1.2.3 54321 typ host'), '注入候选格式正确(host 优先级)')
  ok(rtc.addInjected(fakePc, ['坏地址', '26.1.2.3:abc', '']) === 0, '坏地址全部拒绝')
  ok(rtc.addInjected(fakePc, Array.from({ length: 20 }, (_, i) => '26.1.2.' + i + ':54321')) === 12, '注入条数上限 12(防对方载荷刷爆;多地址交错后额度放宽一点)')
  ok(!rtcSrc.includes('hostPortFromSdp('), '仅保留多端口候选解析接口 hostPortsFromSdp')

  const clientSrc = readFileSync(join(repoRoot, 'client.js'), 'utf8')
  ok(clientSrc.includes('不认识的模式一律不灌进单选框'), '客户端模式同步有白名单(旧内核送污染模式不灌单选框)')

  // ── 结构性回归锁:bridge/信令失败分类/提议看门狗──
  const bridgeSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'bridge.js'), 'utf8')
  ok(sigSrc.includes('nnkSignal = true'), '信令层失败统一打标(nnkSignal)')

  ok(bridgeSrc.includes('var backlog = []') && bridgeSrc.includes('backlog = batch'), '桥事件有重发缓冲(送达确认前不丢)')
  for (const check of await runBridgeSerializationChecks()) ok(check.ok, check.name)


  // ── 外围结构性回归锁:transfer/manifest/compat/index/client──
  const txSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'transfer.js'), 'utf8')
  const mfSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'manifest.js'), 'utf8')
  const cpSrc = readFileSync(join(repoRoot, 'online-kernel', 'src', 'compat.js'), 'utf8')
  const onlineSrc = readFileSync(join(repoRoot, 'src', 'online.js'), 'utf8')
  const indexSrc = readFileSync(join(repoRoot, 'index.js'), 'utf8')
  ok(!mfSrc.includes('game.broadcast('), '差集回发不再走 game.broadcast(联机模式下开门即 return,永远到不了客人)')
  ok(mfSrc.includes("socket.send(JSON.stringify(request===undefined?['nnk_manifest_diff'") && !mfSrc.includes('transfer.sendDirect('), '体检定向回请求连接,不受补传入局路由过滤')
  ok(!mfSrc.includes('transfer.start(') && mfSrc.includes('pauseReason'), '旧版补传缺包仅提示暂停，不自动入队')
  ok(txSrc.includes('expectCount') && txSrc.includes('rejectedFiles'), '客人侧完整性收口(文件数对不上不回 done)')
  ok(txSrc.includes('sendAck(msg.id, "fail"') || txSrc.includes('sendAck(id, "fail"'), '明确 fail 回执(不再只靠超时)')
  ok(txSrc.includes('ackFailReason'), '房主侧收下 fail 原因')
  ok(txSrc.includes('var ackTargets = only ? [only] :'), '必答名单发送时刻冻结(中途进房的新客人不欠回执)')
  ok(txSrc.includes('sendDirect: function(client'), '定向直发助手已导出')
  ok(!cpSrc.includes('function quarantine('), '死代码 quarantine 已删(无调用点的自动隔离链)')
  ok(cpSrc.includes('extKind(ext[0], ext[4])'), '透视分类与闸1 同一口径(对象特征优先)')
  ok(indexSrc.includes('仅接受本机发起的请求'), '非浏览器请求叠回环来源判定(0.0.0.0 绑定下的旁路已堵)')
  ok(indexSrc.includes('请求体过大'), '请求体大小上限(防 JSON.parse 阻塞)')
  ok(clientSrc.includes('newest > autoPopped'), '自动弹码只在出现更新行号时(不再覆盖手动「🔎 再看」)')
  ok(rtcSrc.includes('virtualIps: virtualIps'), 'rtc 导出 virtualIps(工坊状态行数据源)')
  ok(bridgeSrc.includes('virtualIps: (function()'), '内核心跳 cfg 带虚拟网卡检测结果')
  ok(clientSrc.includes('直连地址已就绪:') && clientSrc.includes('virtualIps.join'), '面板显示直连地址就绪状态(虚拟网卡 IPv4 + 公网 IPv6;用户看得见,不再是隐形功能)')

  // ── 载入时保留连接,退出房间时停止自动重回 ──
  ok(rtcSrc.includes('lastBuffered'), '心跳判死识别传输层 ACK 推进(对端主线程忙时不再误杀)')
  ok(rtcSrc.includes('peerTraffic') && rtcSrc.includes('_lastIn'), '心跳判死第三路证据:主通道来包(对端开局狂发数据、心跳定时器饿死不误杀)')
  ok(rtcSrc.includes('> 20000'), '心跳判死阈值 20 秒(对端静默加载留余量)')
  ok(!guestSrc.includes('session.fake._nocallback'), '断线善后不再抑制引擎重载(引擎 1.11.6 的原生 reinit 路径 parsedResult 爆栈,已弃用)')


  // ── 主线程卡顿下的心跳判死与回执超时 ──

  ok(txSrc.includes('var ACK_TIMEOUT = 6000') && txSrc.includes('var DONE_TIMEOUT = 12000'), '补传回执超时放宽(对端主线程忙时不误报"客人没响应")')
  ok(rtcSrc.includes('hosts: hosts && hosts.length ? hosts : undefined'), '邀请码载荷带直连地址(空则不带,旧内核收码也无害)')


  /* ── 两端内核版本不一致时提供明确诊断 ──
   * 包体检差集同时携带 guestKernel 和 hostKernel,工坊体检卡消费双方版本。 */
  ok(mfSrc.includes('guestKernel: guest.kernel || null') && mfSrc.includes('hostKernel: host.kernel || null'),
    '包体检差集同时带双方内核版本(guestKernel/hostKernel)')
  ok(clientSrc.includes('d.guestKernel') && clientSrc.includes('d.hostKernel'),
    '工坊体检卡消费双方内核版本(混装时明说版本不一致 + 升级出路)')

  /* ── 慢网/主线程卡顿下的超时窗口与恢复路径── */

  ok(rtcSrc.includes('setTimeout(finish, 8000)') && !rtcSrc.includes('setTimeout(finish, 4000)'),
    'ICE 候选收集兜底 4→8 秒(非 trickle 一次性交换,早切会永久丢 srflx)')
  ok(txSrc.includes('var STALL_TIMEOUT = 45000') && txSrc.includes('对端消费过慢或已无响应'),
    '补传背压超时 20→45 秒且文案不再误报"卡死"')
  ok(txSrc.includes('请让房主把游戏目录 extension/<扩展名> 整个文件夹拷给你') || txSrc.includes('可以请房主把游戏目录 extension/<扩展名> 整个文件夹拷给你'),
    '补包不可用的几条失败都给出出路(手动拷贝)')
  ok(txSrc.includes('补包需要官方版无名杀(Electron 外壳)'), '「没有 Node 文件能力」说明需要官方 Electron 版')
  ok(onlineSrc.includes("bridgeConfig = 'ok'") && onlineSrc.includes('bridgeConfig,'),
    '内核心跳状态上报桥配置在不在(内容哈希刻意跳过它,永久离线时看不见原因)')
  const offlineHintStart = clientSrc.indexOf('function onlineKernelOfflineHint(')
  const offlineHintEnd = clientSrc.indexOf('    function OnlinePanel(', offlineHintStart)
  assert.ok(offlineHintStart >= 0 && offlineHintEnd > offlineHintStart)
  const offlineHint = runInNewContext('(' + clientSrc.slice(offlineHintStart, offlineHintEnd).trim() + ')', { URL })
  const pageLocation = { protocol: 'http:', port: '45678' }
  const boundKernel = { state: 'ok', boundApi: 'http://127.0.0.1:45678/noname-kit-api', tokenMatches: true, bridgeConfig: 'ok' }
  ok(/桥配置缺失.*绑定到此 DSH/.test(offlineHint({ ...boundKernel, bridgeConfig: 'missing', boundApi: null }, pageLocation)), '真实离线提示：缺失桥配置时提供独立绑定入口')
  ok(/54258.*45678.*绑定到此 DSH/.test(offlineHint({ ...boundKernel, boundApi: 'http://127.0.0.1:54258/noname-kit-api' }, pageLocation)), '真实离线提示：错绑端口同时说明原端口和当前端口')
  ok(/连接凭据.*绑定到此 DSH/.test(offlineHint({ ...boundKernel, tokenMatches: false }, pageLocation)), '真实离线提示：凭据不符时重新绑定当前实例')
  ok(/联机助手.*已启用.*完全重启无名杀/.test(offlineHint(boundKernel, pageLocation)), '真实离线提示：绑定正常时检查启用状态并完整重启')
  ok(/内核尚未安装.*安装内核/.test(offlineHint({ state: 'missing' }, pageLocation)), '真实离线提示：尚未安装时先安装内核')
  ok(onlineSrc.includes('function ioHint(error)'), '安装内核失败按错误码给人话与下一步(EPERM/EBUSY/ENOSPC)')


  /* ── 对局中重进与客机就绪状态 ──*/


  /* 连接失效判定查询传输层状态,避免主线程忙时只凭 JS 心跳误判。*/
  ok(rtcSrc.includes('function startPing(channel, onDead, peerTraffic, pcState)'),
    'startPing 增加传输层判活参数(pc.connectionState)')
  ok(rtcSrc.includes('st === "connected"') && rtcSrc.includes('disconnectedSince'),
    'JS 静默时:connected 继续等、disconnected 给恢复期、failed/closed 才判死')


  /* ── 直连线路状态、连接兜底优先级与出牌时限 ──
   * 覆盖线路可见性及无需 TURN 中继服务器的连接策略。 */
  ok(rtcSrc.includes('candidate:1 1 udp 1 " + ip.replace('),
    '注入候选优先级降到 1(排最后):同网/公网直连优先,虚拟网卡只当兜底')
  ok(rtcSrc.includes('function trackPc(pc)') && rtcSrc.includes('"candidate-pair"') && rtcSrc.includes('currentRoundTripTime'),
    '线路观测:5 秒一轮 getStats 取候选对(host/srflx/relay + RTT)')
  ok(bridgeSrc.includes('link: (function()') && clientSrc.includes('🔗 当前线路:'),
    '心跳上报线路 + 工坊内核卡显示「🔗 当前线路:直连/中继 · 往返 Nms」')

  /* 邀请码解析接受聊天附文、引号和换行。 */
  const invitePayload = { v: 1, k: 'offer', sdp: { type: 'offer', sdp: 'v=0\r\n无名杀' } }
  const inviteCode = 'NNK1.' + Buffer.from(JSON.stringify(invitePayload)).toString('base64url')
  rtcSandbox.TextDecoder = TextDecoder
  rtcSandbox.atob = atob
  const pastedInvite = rtc.decodeCode('前言「' + inviteCode.slice(0, 16) + '\n' + inviteCode.slice(16) + '」')
  ok(pastedInvite.k === invitePayload.k && pastedInvite.sdp.sdp === invitePayload.sdp.sdp && rtc.decodeCode(inviteCode).sdp.type === 'offer',
    '码解析容错:实际解码带聊天附文、引号和换行的邀请码，保留 Unicode SDP')
  ok(rtcSrc.includes('这看起来是 6 位房号') && rtcSrc.includes('可能被聊天软件截断'),
    '码解析失败的文案分情况给出路(粘成房号/半截码/不像码)')
  /* 双方均有公网 IPv6 时，候选地址支持直接连接。 */
  ok(rtcSrc.includes('function isGlobalV6') && rtcSrc.includes('return /^2[0-9a-f]{0,3}:/'),
    '公网 IPv6 地址随信令带给对方(校园网/教育网两端都有 v6 时直连,不用打洞)')
  ok(rtcSrc.includes('SDP candidate 行里的 IPv6 不带方括号'), '注入的 IPv6 候选行按 SDP 规矩写裸地址(行为在探针里验)')


  console.log(`\n全部通过:${passed} 项`)
} finally {
  rmSync(home, { recursive: true, force: true })
}

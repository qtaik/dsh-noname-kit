#!/usr/bin/env node
/**
 * noname-kit 单测:preset 自检与安装(内容哈希 / 状态判定 / 备份 / 链接防御)。
 * 运行:node scripts/test-preset.mjs
 * 全程隔离在系统临时目录,不碰真实家目录与真实 preset。
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label + ` (期望 ${JSON.stringify(expected)},实得 ${JSON.stringify(actual)})`)
  passed++
  console.log('  ✓ ' + label)
}

const home = mkdtempSync(join(tmpdir(), 'noname-kit-preset-test-'))
const bundled = join(home, 'bundled', 'noname-dev')
const presetDir = join(home, 'dsh-home', '.agent-presets', 'noname-dev')

function writeBundled() {
  mkdirSync(join(bundled, 'skills', 'noname-extension-dev'), { recursive: true })
  writeFileSync(join(bundled, 'preset.yml'), 'name: 无名杀开发模式\n')
  writeFileSync(join(bundled, 'agent.cordis.yml'), 'persona:\n  prefix: 你是无名杀扩展开发者\n')
  writeFileSync(join(bundled, 'custom-bash.mjs'), 'export const x = 1\n')
  writeFileSync(join(bundled, 'skills', 'noname-extension-dev', 'SKILL.md'), '# 规范\n')
}

try {
  const preset = await import('../src/preset.js')
  writeBundled()

  // ── 1) 内容哈希 ──
  eq(preset.hashDir(join(home, 'nope')), null, '目录不存在时哈希为 null')
  const baseHash = preset.hashDir(bundled)
  ok(/^[0-9a-f]{64}$/.test(baseHash), '哈希是 64 位十六进制')
  eq(preset.hashDir(bundled), baseHash, '同一目录两次哈希一致')
  ok(preset.hashDir(join(bundled, 'skills')) !== baseHash, '嵌套子目录的内容参与哈希(路径前缀不同)')

  // 点开头的条目必须被忽略,否则"写盖章"这个动作本身会让自检永远报过期
  writeFileSync(join(bundled, '.DS_Store'), 'junk')
  eq(preset.hashDir(bundled), baseHash, '点开头的文件(.DS_Store)不影响哈希')
  unlinkSync(join(bundled, '.DS_Store'))

  // 创建顺序不影响结果(按相对路径排序)
  const alt = join(home, 'alt')
  mkdirSync(join(alt, 'skills', 'noname-extension-dev'), { recursive: true })
  writeFileSync(join(alt, 'skills', 'noname-extension-dev', 'SKILL.md'), '# 规范\n')
  writeFileSync(join(alt, 'custom-bash.mjs'), 'export const x = 1\n')
  writeFileSync(join(alt, 'agent.cordis.yml'), 'persona:\n  prefix: 你是无名杀扩展开发者\n')
  writeFileSync(join(alt, 'preset.yml'), 'name: 无名杀开发模式\n')
  eq(preset.hashDir(alt), baseHash, '创建顺序不同但内容相同 → 哈希相同')

  // 内容变、增、删都必须被发现
  writeFileSync(join(alt, 'preset.yml'), 'name: 无名杀开发模式(改)\n')
  ok(preset.hashDir(alt) !== baseHash, '改一个字节 → 哈希变化')
  writeFileSync(join(alt, 'preset.yml'), 'name: 无名杀开发模式\n')
  writeFileSync(join(alt, 'extra.mjs'), 'export const y = 2\n')
  ok(preset.hashDir(alt) !== baseHash, '多一个文件 → 哈希变化')
  unlinkSync(join(alt, 'extra.mjs'))
  eq(preset.hashDir(alt), baseHash, '删掉多余文件 → 哈希回到原值')

  // ── 2) 状态判定 ──
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).state, 'missing', '没装 → missing')
  const installed = preset.installPreset({ presetDir, bundledDir: bundled, pluginVersion: '1.0.0' })
  ok(installed.ok && installed.target === presetDir, '安装成功并返回目标路径')
  eq(installed.backup, null, '首次安装没有备份')
  const afterInstall = preset.presetStatus({ presetDir, bundledDir: bundled })
  eq(afterInstall.state, 'ok', '装完即 ok(盖章文件不影响哈希)')
  eq(afterInstall.installedVersion, '1.0.0', '状态里带出盖章的插件版本号')
  ok(existsSync(join(presetDir, '.noname-kit-install.json')), '盖章文件已写入')
  eq(JSON.parse(readFileSync(join(presetDir, '.noname-kit-install.json'), 'utf8')).pluginVersion, '1.0.0', '盖章内容含插件版本')

  const manifest = join(presetDir, 'agent.cordis.yml')
  const original = readFileSync(manifest, 'utf8')
  writeFileSync(manifest, original + '# 用户自己加了一行\n')
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).state, 'stale', '本地被改过 → stale')
  writeFileSync(manifest, original)
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).state, 'ok', '改回去 → 又 ok')

  unlinkSync(join(presetDir, 'custom-bash.mjs'))
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).state, 'stale', '少一个文件 → stale')

  // 插件侧源目录坏了 → unknown(而不是误判成 stale)
  const brokenSource = join(home, 'broken-source')
  mkdirSync(brokenSource, { recursive: true })
  eq(preset.presetStatus({ presetDir, bundledDir: brokenSource }).state, 'unknown', '插件自带源为空 → unknown')

  // ── 3) 重装与备份 ──
  // 放一个只有"重装前"才有的标记,用来验证备份抓的是旧状态、重装换的是新内容
  writeFileSync(join(presetDir, 'USER-NOTE.txt'), '用户自己加的东西\n')
  const reinstalled = preset.installPreset({ presetDir, bundledDir: bundled, pluginVersion: '1.1.0' })
  ok(reinstalled.ok && typeof reinstalled.backup === 'string', '重装产生备份')
  ok(/\.bak-\d+$/.test(reinstalled.backup), '备份名前缀为 .bak-<时间戳>(点号让 DSH 不把它当 preset 扫出来)')
  ok(existsSync(join(reinstalled.backup, 'USER-NOTE.txt')), '备份完整保留了重装前那份(含用户加的文件)')
  ok(!existsSync(join(presetDir, 'USER-NOTE.txt')), '重装后目标目录换成了插件自带那份')
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).state, 'ok', '重装后恢复 ok')
  eq(preset.presetStatus({ presetDir, bundledDir: bundled }).installedVersion, '1.1.0', '盖章版本号已更新')

  // 目标目录不完整时不许安装(宁可不装,也不要留半份)
  const badResult = preset.installPreset({ presetDir: join(home, 'x'), bundledDir: brokenSource, pluginVersion: '1.1.0' })
  ok(!badResult.ok && /不完整/.test(badResult.error), '插件自带 preset 不完整 → 拒绝安装并报错')
  ok(!existsSync(join(home, 'x')), '拒绝安装时不会留下半份目录')

  // ── 4) 目标位置是链接时:只删链接,绝不递归进目标 ──
  const linkTarget = join(home, 'link-target')
  mkdirSync(linkTarget, { recursive: true })
  writeFileSync(join(linkTarget, 'keep-me.txt'), 'important\n')
  const linkDir = join(home, 'dsh-home', '.agent-presets', 'link-probe')
  symlinkSync(linkTarget, linkDir, process.platform === 'win32' ? 'junction' : 'dir')
  const linkResult = preset.installPreset({ presetDir: linkDir, bundledDir: bundled, pluginVersion: '1.1.0' })
  ok(linkResult.ok, '目标位置是链接时也能安装')
  ok(existsSync(join(linkTarget, 'keep-me.txt')), '链接指向的真实目录内容未被删除')
  ok(existsSync(join(linkDir, 'agent.cordis.yml')), '链接位置已换成真实的新 preset')
  eq(linkResult.backup, null, '链接不产生备份(链接本身没有内容可备份)')

  // ── 5) 家目录解析优先级 ──
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(home, 'env-home')
  eq(preset.resolveDshHome(), join(home, 'env-home'), '$DSH_HOME 优先')
  const { homedir } = await import('node:os')
  process.env.DSH_HOME = ''
  eq(preset.resolveDshHome(), join(homedir(), '.dsh'), '$DSH_HOME 为空时回落到 ~/.dsh')
  delete process.env.DSH_HOME
  eq(preset.resolveDshHome(), join(homedir(), '.dsh'), '$DSH_HOME 未设置时回落到 ~/.dsh')
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  eq(preset.presetDirOf('/tmp/x'), join('/tmp/x', '.agent-presets', 'noname-dev'), 'presetDirOf 拼出预期路径')

  // 重装把原来那个链接摘掉、换成了真实目录(链接没被"跟随",目标目录内容完好)
  ok(!lstatSync(linkDir).isSymbolicLink(), '重装后原链接位置已是真实目录(链接被摘下而非跟随写入)')
  rmSync(linkDir, { recursive: true, force: true })
  // 备份与那份 preset 同层:DSH 的 PRESET_ID 不允许点号,所以备份不会被扫成一个 preset
  const presetEntries = readdirSync(join(home, 'dsh-home', '.agent-presets'))
  ok(presetEntries.some((n) => /\.bak-\d+$/.test(n)), '备份与 preset 同层且名字带 .bak-<时间戳>')
  ok(!/^[a-z0-9][a-z0-9-]*$/.test(reinstalled.backup.split(/[\\/]/).pop()), '备份目录名不匹配 DSH 的 PRESET_ID 规则 → 不会被 discovery 收录')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

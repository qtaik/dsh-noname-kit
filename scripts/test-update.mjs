#!/usr/bin/env node
/**
 * noname-kit 单测:版本比较 / 安装形态识别 / 更新检查。
 * 运行:node scripts/test-update.mjs
 * 全程用注入的假 fetch,不发任何真实网络请求;不碰真实家目录。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const home = mkdtempSync(join(tmpdir(), 'noname-kit-update-test-'))

try {
  const version = await import('../src/version.js')
  const update = await import('../src/update.js')

  // ── 1) 版本解析 ──
  eq(version.parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' }, '解析 1.2.3')
  eq(version.parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' }, '解析带 v 前缀')
  eq(version.parseVersion(' 2.0 '), { major: 2, minor: 0, patch: 0, pre: '' }, '解析两段 + 空白')
  eq(version.parseVersion('3'), { major: 3, minor: 0, patch: 0, pre: '' }, '解析单段')
  eq(version.parseVersion('1.0.0-rc.1'), { major: 1, minor: 0, patch: 0, pre: 'rc.1' }, '解析 prerelease')
  eq(version.parseVersion('1.0.0+build.7'), { major: 1, minor: 0, patch: 0, pre: '' }, '忽略 build 元数据')
  eq(version.parseVersion('latest'), null, 'latest 不是版本号')
  eq(version.parseVersion(''), null, '空串不是版本号')
  eq(version.parseVersion('1.0.0.0'), null, '四段不是合法版本号')

  // ── 2) 版本比较(含字符串比较的经典陷阱)──
  eq(version.compareVersions('1.0.0', '1.0.0'), 0, '相同版本为 0')
  eq(version.compareVersions('1.0.1', '1.0.0'), 1, '补丁号更大')
  eq(version.compareVersions('1.10.0', '1.9.0'), 1, '1.10.0 > 1.9.0(不能按字符串比)')
  eq(version.compareVersions('2.0.0', '1.99.99'), 1, '主版本优先')
  eq(version.compareVersions('v1.0.0', '1.0.0'), 0, 'v 前缀不影响比较')
  eq(version.compareVersions('1.0.0-rc.1', '1.0.0'), -1, 'prerelease 小于正式版')
  eq(version.compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1, 'rc.2 > rc.1')
  eq(version.compareVersions('1.0.0-alpha', '1.0.0-beta'), -1, '字母段按字典序')
  eq(version.compareVersions('1.0.0-2', '1.0.0-alpha'), -1, '数字段小于字母段')
  eq(version.compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1, '字段少的更小')
  eq(version.compareVersions('abc', '1.0.0'), null, '无法解析时返回 null')
  ok(version.isNewer('1.0.1', '1.0.0'), 'isNewer 判定新版本')
  ok(!version.isNewer('1.0.0', '1.0.0'), '同版本不是"更新"')
  ok(!version.isNewer('nonsense', '1.0.0'), '远端无法解析时不说有新版本')
  eq(version.maxVersion(['v1.0.0', 'v1.10.0', 'v1.9.0', 'nightly']), 'v1.10.0', 'maxVersion 挑最大且跳过非法项')
  eq(version.maxVersion([]), null, 'maxVersion 空列表返回 null')
  eq(version.formatVersion('v1.2.0'), '1.2.0', 'formatVersion 去掉 tag 的 v 前缀')
  eq(version.formatVersion('1.2'), '1.2.0', 'formatVersion 补齐三段')
  eq(version.formatVersion('1.0.0-rc.1'), '1.0.0-rc.1', 'formatVersion 保留 prerelease')
  eq(version.formatVersion('latest'), 'latest', 'formatVersion 无法解析时原样返回')
  eq(version.formatVersion(''), '', 'formatVersion 空串返回空串')

  // ── 3) 安装 spec 分类 ──
  eq(update.classifySpec('link:D:/deepseek-harness/dsh-latest/noname-kit'), 'link', 'link: 视作本地开发')
  eq(update.classifySpec('file:../x'), 'link', 'file: 视作本地开发')
  eq(update.classifySpec('.'), 'link', '相对路径视作本地开发')
  eq(update.classifySpec('D:/foo/bar'), 'link', '绝对路径视作本地开发')
  eq(update.classifySpec('github:qtaik/dsh-noname-kit'), 'git', 'github: 视作 git 安装')
  eq(update.classifySpec('https://github.com/qtaik/dsh-noname-kit'), 'git', 'https 仓库视作 git 安装')
  eq(update.classifySpec('git@github.com:qtaik/dsh-noname-kit.git'), 'git', 'ssh 仓库视作 git 安装')
  eq(update.classifySpec('qtaik/dsh-noname-kit'), 'git', 'owner/repo 简写视作 git 安装')
  eq(update.classifySpec('^1.0.0'), 'registry', '版本范围视作 registry 安装')
  eq(update.classifySpec(''), 'unknown', '空 spec 为未知')

  eq(update.repoFromSpec('github:qtaik/dsh-noname-kit'), 'qtaik/dsh-noname-kit', '从 github: spec 抠仓库')
  eq(update.repoFromSpec('https://github.com/qtaik/dsh-noname-kit.git'), 'qtaik/dsh-noname-kit', '从 https spec 抠仓库')
  eq(update.repoFromRepositoryField({ url: 'git+https://github.com/qtaik/dsh-noname-kit.git' }), 'qtaik/dsh-noname-kit', '从 repository 字段抠仓库')
  eq(update.repoFromRepositoryField(''), null, '空 repository 返回 null')

  // ── 4) 安装形态探测(造假的 DSH 家目录)──
  const dshHome = join(home, '.dsh')
  mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
  mkdirSync(join(dshHome, 'profiles', 'prod'), { recursive: true })
  writeFileSync(join(dshHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-noname-kit': 'link:D:/dev/noname-kit' },
  }))
  eq(update.detectInstall({ dshHome }).form, 'link', '只有 link 安装 → 形态 link')
  writeFileSync(join(dshHome, 'profiles', 'prod', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-noname-kit': 'github:qtaik/dsh-noname-kit' },
  }))
  const mixed = update.detectInstall({ dshHome })
  eq(mixed.form, 'git', 'link 与 git 并存 → 优先取非 link 的那个')
  eq(mixed.profile, 'prod', '并报告该 profile 名')
  eq(mixed.profiles.length, 2, '两个 profile 都出现在明细里')
  eq(update.installHint({ form: 'link', profile: 'web' }), null, 'link 安装没有升级命令')
  eq(update.installHint({ form: 'git', profile: 'prod' }), 'dsh plugin --profile prod update dsh-noname-kit', 'git 安装给出升级命令')
  writeFileSync(join(dshHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-noname-kit': 'link:D:/dev/noname-kit' },
  }))
  rmSync(join(dshHome, 'profiles', 'prod'), { recursive: true, force: true })
  eq(update.detectInstall({ dshHome: join(home, 'nothing-here') }).form, 'unknown', '家目录不存在 → unknown')

  // ── 5) 假 fetch:各种失败都不许抛 ──
  const calls = []
  const routeFetch = (routes) => (url, opts) => {
    calls.push(String(url))
    for (const [match, reply] of Object.entries(routes)) {
      if (String(url).includes(match)) {
        if (reply === 'throw-timeout') {
          const error = new Error('The operation was aborted due to timeout')
          error.name = 'TimeoutError'
          return Promise.reject(error)
        }
        if (reply === 'throw-network') {
          const error = new Error('fetch failed')
          error.cause = { code: 'ENOTFOUND' }
          return Promise.reject(error)
        }
        return Promise.resolve({
          status: reply.status,
          ok: reply.status >= 200 && reply.status < 300,
          json: async () => {
            if (reply.badJson) throw new Error('Unexpected token < in JSON')
            return reply.body
          },
          headers: { get: () => '0' },
        })
      }
    }
    throw new Error('假 fetch 没配这条路由: ' + url)
  }

  const checkBase = { currentVersion: '1.0.0', dshHome, packageName: 'dsh-noname-kit' }

  // link 安装:一个请求都不该发
  calls.length = 0
  const linkResult = await update.checkForUpdate({ ...checkBase, fetchImpl: routeFetch({}) })
  eq(linkResult.skipped, 'link', 'link 安装直接短路')
  eq(calls.length, 0, 'link 安装不发任何网络请求')

  // npm 命中
  update.resetUpdateCache()
  writeFileSync(join(dshHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-noname-kit': '^1.0.0' },
  }))
  calls.length = 0
  const npmHit = await update.checkForUpdate({
    ...checkBase, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '1.2.0' } } }),
  })
  ok(npmHit.hasUpdate && npmHit.latest === '1.2.0' && npmHit.source === 'npm', 'npm 通道命中并判定有新版本')
  eq(calls.length, 1, 'npm 命中时只发一次请求')

  // 缓存:第二次不再联网
  const cached = await update.checkForUpdate({
    ...checkBase, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '9.9.9' } } }),
  })
  eq(calls.length, 1, '6 小时内复用缓存,不再发请求')
  ok(cached.cached === true && cached.latest === '1.2.0', '缓存返回的是上次的结果')
  // force 绕过缓存
  const forced = await update.checkForUpdate({
    ...checkBase, force: true, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '9.9.9' } } }),
  })
  ok(forced.latest === '9.9.9' && calls.length === 2, 'force 绕过缓存重新查')

  // npm 未发布 → 回退 GitHub
  update.resetUpdateCache()
  writeFileSync(join(dshHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-noname-kit': 'github:qtaik/dsh-noname-kit' },
  }))
  calls.length = 0
  const fallback = await update.checkForUpdate({
    ...checkBase,
    fetchImpl: routeFetch({
      'registry.npmjs.org': { status: 404, body: {} },
      'api.github.com': { status: 200, body: [{ name: 'v1.0.0' }, { name: 'v1.1.0' }, { name: 'v1.0.9' }] },
    }),
  })
  ok(fallback.source === 'github' && fallback.latest === '1.1.0', 'npm 404 → 回退 GitHub tags 并取最大(去掉 tag 的 v 前缀)')
  ok(fallback.hasUpdate, 'GitHub 回退也算出新版本')

  // 全部失败:只报错,不抛,且 hasUpdate 为 false
  update.resetUpdateCache()
  const allFail = await update.checkForUpdate({
    ...checkBase,
    fetchImpl: routeFetch({
      'registry.npmjs.org': { status: 500, body: {} },
      'api.github.com': { status: 403, body: {} },
    }),
  })
  ok(!allFail.hasUpdate && /限流/.test(allFail.error), 'GitHub 403 → 限流提示,不抛错')
  update.resetUpdateCache()
  const timeout = await update.checkForUpdate({
    ...checkBase,
    fetchImpl: routeFetch({ 'registry.npmjs.org': 'throw-timeout', 'api.github.com': 'throw-timeout' }),
  })
  ok(!timeout.hasUpdate && /超时/.test(timeout.error), '超时 → 友好文案,不抛错')
  update.resetUpdateCache()
  const offline = await update.checkForUpdate({
    ...checkBase,
    fetchImpl: routeFetch({ 'registry.npmjs.org': 'throw-network', 'api.github.com': 'throw-network' }),
  })
  ok(!offline.hasUpdate && /解析失败/.test(offline.error), '断网 → 友好文案,不抛错')
  update.resetUpdateCache()
  const badJson = await update.checkForUpdate({
    ...checkBase,
    fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, badJson: true }, 'api.github.com': { status: 200, badJson: true } }),
  })
  ok(!badJson.hasUpdate && typeof badJson.error === 'string', '坏 JSON → 返回错误字符串,不抛错')

  // 失败不缓存:紧接着的成功调用应该真的联网
  calls.length = 0
  const afterFail = await update.checkForUpdate({
    ...checkBase, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '1.0.0' } } }),
  })
  ok(calls.length === 1 && afterFail.latest === '1.0.0', '失败不写入缓存,下次立刻重试')

  // 新版本判定:远端更旧 / 相同 → 不提示
  update.resetUpdateCache()
  const sameVer = await update.checkForUpdate({
    ...checkBase, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '1.0.0' } } }),
  })
  ok(!sameVer.hasUpdate, '远端与本地同版本 → 不提示更新')
  update.resetUpdateCache()
  const older = await update.checkForUpdate({
    ...checkBase, fetchImpl: routeFetch({ 'registry.npmjs.org': { status: 200, body: { version: '0.9.0' } } }),
  })
  ok(!older.hasUpdate, '远端比本地旧 → 不提示更新')

  // ── 6) 模块接线:index.js 里 import 的每个名字都真的被导出 ──
  // node --check 只查语法,查不出"导入了一个不存在的导出";而这种错会让插件
  // import 失败、整个 DSH 起不来(实测踩过一次:忘了导出 cachedUpdate)。
  const indexUrl = new URL('../index.js', import.meta.url)
  const source = readFileSync(fileURLToPath(indexUrl), 'utf8')
  const importRe = /import\s*\{([^}]+)\}\s*from\s*'(\.\.?\/[^']+)'/g
  let wiring = 0
  let match
  while ((match = importRe.exec(source)) !== null) {
    const names = match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean)
    const mod = await import(new URL(match[2], indexUrl).href)
    for (const name of names) {
      ok(name in mod, `index.js 导入的 ${name} 由 ${match[2]} 导出`)
      wiring++
    }
  }
  ok(wiring >= 14, `接线检查覆盖 index.js 全部本地导入(共 ${wiring} 个名字)`)

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

/**
 * 更新检查:本插件版本 vs 远端最新版本,以及本插件是"怎么装上的"。
 *
 * 设计边界(来自对生态的调研):
 * - 只做「检测 + 明确告知」,不做一键自更新。生态里 Airmetro/dsh-update-checker
 *   那类插件已把检查+一键更新+备份回滚+重启看门狗做完了,重复造没有意义;而且
 *   更新器自身是明确的攻击面(ComfyUI-Manager 连续两个 CVE 都出在它上面)。
 * - 来源:npm registry 优先(国内可达,发布 npm 后最稳),GitHub tags 回退。
 * - 网络失败一律降级成一句"检查失败",绝不抛错、不阻塞界面(ComfyUI/Claude Code/
 *   lazy.nvim 全这么做)。
 * - 本地 link 安装(开发者自己那套)一律跳过检查 —— 代码就是源码目录,没有
 *   "更新"这回事。参考 lazy.nvim 把本地插件当一等公民而不是"坏掉的更新"。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatVersion, isNewer, maxVersion, parseVersion } from './version.js'

export const PACKAGE_NAME = 'dsh-noname-kit'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const GITHUB_API = 'https://api.github.com'
const CHECK_TIMEOUT_MS = 8000
/** 6 小时。启动时自动查一次 + 用户手动点,不值得更频繁(GitHub 未登录限流 60 次/小时)。 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

let cache = { at: 0, result: null }

/** 清空进程内缓存(测试用)。 */
export function resetUpdateCache() {
  cache = { at: 0, result: null }
}

/**
 * 读进程内缓存,不发网络请求 —— 供设置页首屏用(界面打开不该触发联网)。
 * 没查过返回 null;结果里带 cached 标记与 checkedAt,便于界面如实说明"这是上次查的"。
 */
export function cachedUpdate() {
  return cache.result ? { ...cache.result, cached: true } : null
}

function errorText(error) {
  if (error?.name === 'TimeoutError') return '联网超时'
  const cause = error?.cause
  if (cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') return '域名解析失败(网络受限?)'
  if (cause?.code === 'ECONNREFUSED') return '连接被拒绝'
  return error?.message || String(error)
}

/** 从安装 spec 判断安装形态:link(本地源码)/ git(GitHub 直装)/ registry(npm 版本范围)。 */
export function classifySpec(spec) {
  const text = String(spec || '').trim()
  if (!text) return 'unknown'
  if (/^(link|file):/i.test(text) || text.startsWith('.') || /^[a-z]:[\\/]/i.test(text)) return 'link'
  if (/^(github|git|git\+|https?:\/\/github\.com|git@github\.com)/i.test(text)) return 'git'
  if (text.includes('/') && /^[\w.-]+\/[\w.-]+(#.*)?$/.test(text)) return 'git'
  return 'registry'
}

/** 从 'github:owner/repo' 之类的 spec 里抠出 'owner/repo'。 */
export function repoFromSpec(spec) {
  const text = String(spec || '')
  const matched = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#.*)?$/i.exec(text) || /^github:([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#.*)?$/i.exec(text)
  if (matched) return matched[1]
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return text
  return null
}

/** 从 package.json 的 repository 字段抠出 'owner/repo'。 */
export function repoFromRepositoryField(url) {
  if (!url) return null
  const text = typeof url === 'string' ? url : url.url
  if (!text) return null
  const matched = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(String(text))
  return matched ? matched[1] : null
}

/**
 * 扫描 DSH 各个 profile 的 package.json,找出本插件是怎么装的。
 * 多个 profile 都装了时,优先取非 link 的那个(link 意味着"开发中,不适用更新")。
 */
export function detectInstall({ dshHome, packageName = PACKAGE_NAME }) {
  const profilesDir = join(dshHome, 'profiles')
  const found = []
  let names = []
  try {
    names = readdirSync(profilesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return { form: 'unknown', spec: null, profile: null, profiles: [] }
  }
  for (const name of names) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(profilesDir, name, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    const spec = manifest?.dependencies?.[packageName] ?? manifest?.devDependencies?.[packageName]
    if (!spec) continue
    found.push({ profile: name, spec, form: classifySpec(spec) })
  }
  if (!found.length) return { form: 'unknown', spec: null, profile: null, profiles: [] }
  const primary = found.find((item) => item.form !== 'link') || found[0]
  return { form: primary.form, spec: primary.spec, profile: primary.profile, profiles: found }
}

/** 升级命令:link 安装没有可执行的更新动作,返回 null。 */
export function installHint({ form, profile, packageName = PACKAGE_NAME }) {
  if (form === 'git' || form === 'registry') return `dsh plugin --profile ${profile} update ${packageName}`
  return null
}

async function fetchNpmLatest({ fetchImpl, packageName, timeoutMs }) {
  try {
    const response = await fetchImpl(`${NPM_REGISTRY}/${packageName}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404) return { ok: false, error: 'npm 上还没有这个包(未发布)' }
    if (!response.ok) return { ok: false, error: `npm registry 返回 ${response.status}` }
    const body = await response.json()
    if (!parseVersion(body?.version)) return { ok: false, error: 'npm 返回的版本号无法解析' }
    return { ok: true, latest: body.version, source: 'npm' }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

async function fetchGithubLatest({ fetchImpl, repo, timeoutMs }) {
  try {
    const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/tags?per_page=100`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-noname-kit' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404) return { ok: false, error: 'GitHub 仓库或 tag 不存在' }
    if (response.status === 403 || response.status === 429) {
      return { ok: false, error: 'GitHub 接口限流(未登录每小时 60 次),稍后再试' }
    }
    if (!response.ok) return { ok: false, error: `GitHub 返回 ${response.status}` }
    const tags = await response.json()
    const latest = maxVersion(Array.isArray(tags) ? tags.map((tag) => tag?.name) : [])
    if (!latest) return { ok: false, error: '仓库里没有可解析的版本 tag' }
    return { ok: true, latest, source: 'github' }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

/**
 * 查一次最新版本。成功结果缓存 6 小时,失败不缓存(下次点击立刻重试)。
 * link 安装直接短路,一个请求都不发。
 */
export async function checkForUpdate({
  currentVersion,
  dshHome,
  packageName = PACKAGE_NAME,
  repo = null,
  fetchImpl = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
  force = false,
} = {}) {
  const install = detectInstall({ dshHome, packageName })
  const base = {
    current: currentVersion,
    installForm: install.form,
    installProfile: install.profile,
    installSpec: install.spec,
    installHint: installHint({ form: install.form, profile: install.profile, packageName }),
  }
  if (install.form === 'link') {
    return { ...base, latest: null, source: null, hasUpdate: false, error: null, skipped: 'link', checkedAt: Date.now() }
  }
  if (!force && cache.result && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.result, ...base, cached: true }
  }
  const slug = repo || repoFromSpec(install.spec) || null
  const npm = await fetchNpmLatest({ fetchImpl, packageName, timeoutMs })
  let result = npm
  if (!npm.ok) result = slug ? await fetchGithubLatest({ fetchImpl, repo: slug, timeoutMs }) : npm
  if (!result.ok) {
    return { ...base, latest: null, source: null, hasUpdate: false, error: result.error, checkedAt: Date.now() }
  }
  const payload = {
    ...base,
    // 显示用规范化形式(去掉 GitHub tag 的 v 前缀,与 current 写法一致);
    // 比较仍用远端原值。
    latest: formatVersion(result.latest),
    source: result.source,
    hasUpdate: isNewer(result.latest, currentVersion),
    error: null,
    checkedAt: Date.now(),
  }
  cache = { at: Date.now(), result: payload }
  return payload
}

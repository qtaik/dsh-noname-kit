/**
 * 版本比较:自己实现,不引 semver 依赖。
 *
 * 为什么不引:semver 不是本插件任何依赖的声明依赖,只是 pnpm 偶然 hoist
 * 上来的传递依赖(实测同一台机器上能解析到 6.3.1 和 7.8.5 两份不同版本),
 * 插件包不能把它当成保证存在的 API。逻辑也就百来行,自己写更可控。
 *
 * 接受 x / x.y / x.y.z 三段形式、v 前缀、-prerelease 后缀、+build 元数据;
 * prerelease 优先级按 semver 规范(1.0.0-rc.1 < 1.0.0),因为本生态里
 * alpha/beta/rc 版本号很常见,不能一律当字符串比大小。
 */

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** 解析成 { major, minor, patch, pre };无法解析返回 null(如 'latest'、空串)。 */
export function parseVersion(input) {
  if (input === null || input === undefined) return null
  const matched = VERSION_RE.exec(String(input).trim())
  if (!matched) return null
  return {
    major: Number(matched[1]),
    minor: Number(matched[2] ?? 0),
    patch: Number(matched[3] ?? 0),
    pre: matched[4] ?? '',
  }
}

/** prerelease 段比较:无 prerelease 的更大,数字段小于字母段,字段少的更小。 */
function comparePrerelease(left, right) {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1
  const a = left.split('.')
  const b = right.split('.')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    const aNumeric = /^\d+$/.test(a[i])
    const bNumeric = /^\d+$/.test(b[i])
    if (aNumeric && bNumeric) {
      const diff = Number(a[i]) - Number(b[i])
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

function compareParsed(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.pre, right.pre)
}

/** 比较两个版本号:返回 -1 / 0 / 1;任一无法解析则返回 null(由调用方决定怎么显示)。 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  return compareParsed(a, b)
}

/** 远端版本是否比当前新。任一无法解析时为 false(宁可不说,不可误报)。 */
export function isNewer(latest, current) {
  return compareVersions(latest, current) === 1
}

/** 从版本号列表里挑最大的,返回原字符串(保留 v 前缀);全无法解析返回 null。 */
export function maxVersion(list) {
  let best = null
  let bestParsed = null
  for (const item of list || []) {
    const parsed = parseVersion(item)
    if (!parsed) continue
    if (!bestParsed || compareParsed(parsed, bestParsed) > 0) {
      best = String(item)
      bestParsed = parsed
    }
  }
  return best
}

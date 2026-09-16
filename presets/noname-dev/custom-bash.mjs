/**
 * custom-bash — a Windows-capable `bash` tool that registers under the SAME
 * name (`bash`) as the official persistent bash, with a Minimal-compatible
 * description, but executes through `ctx.subprocess.spawn` instead of a PTY.
 *
 * WHY: DeepSeek's first-request trajectory anchor keys on the tool SCHEMA
 * matching the RL training distribution (issue #11: persistent
 * bash + str_replace_editor anchored 5/5 at maxTokens=256000, pwsh/read
 * 8/8 standard-like). The official persistent bash uses a PTY, and DSH's PTY
 * backend is linux/darwin-only — `subprocess-local` throws "terminal
 * inspection is unsupported on platform win32". A custom tool that presents
 * the same name and a Minimal-like description but spawns Git Bash through
 * the ordinary (cross-platform) subprocess seam keeps the schema anchor
 * without the PTY dependency.
 *
 * Executable resolution (config `bashPath`):
 *  - explicit absolute path (e.g. `C:\Program Files\Git\bin\bash.exe`), or
 *  - `bash` resolved through `ctx.subprocess.resolveExecutable` (PATH lookup).
 *
 * Semantics mirror the official bash tool: `bash -c <command>` in a fresh
 * process, bounded output, non-zero exit reported not thrown. No sandbox
 * confinement on Windows (the sandbox backend is linux-only); the tool
 * description says so. The bootstrap catalog pairs this with
 * `str_replace_editor` (Minimal's two tools).
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'custom-bash'

/** The subprocess and tools services must exist before this tool can register. */
export const inject = ['subprocess', 'tools', 'dshHomePath']

const DEFAULT_TIMEOUT_MS = 120000
/** 出厂默认 64K:阀门太小会把任务逼成更多次小调用,总上下文消耗反而更大。
 * 用户可在工坊「⚙ 设置」页按预算调节;会话挂载时读一次,会话内恒定。 */
const DEFAULT_MAX_OUTPUT_BYTES = 64000
const MIN_MAX_OUTPUT_BYTES = 64000
const MAX_MAX_OUTPUT_BYTES = 256000

/**
 * Read `bashMaxOutputBytes` from the workshop settings file
 * (`<dsh-home>/noname-kit.json`, written by the workshop ⚙ settings page).
 * Precedence: row config > this file > DEFAULT. Any absence/malformation
 * falls through silently — settings must never block a session mount.
 */
function workshopMaxOutputBytes(ctx) {
  try {
    const homeBase = typeof ctx.dshHomePath === 'function' ? ctx.dshHomePath() : (ctx.dshHomePath || undefined)
    const { join } = process.getBuiltinModule('node:path')
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { homedir } = process.getBuiltinModule('node:os')
    const file = join(homeBase || join(homedir(), '.dsh'), 'noname-kit.json')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    const v = Number(saved && saved.bashMaxOutputBytes)
    if (Number.isSafeInteger(v) && v >= MIN_MAX_OUTPUT_BYTES && v <= MAX_MAX_OUTPUT_BYTES) return v
  } catch { /* no file / bad JSON — fall through to default */ }
  return undefined
}

/** Tool parameter schema for the model-facing command. */
const commandSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'The bash command to execute (`bash -c` string domain).',
    },
    workdir: {
      type: 'string',
      description: 'Optional working directory; defaults to the session cwd.',
    },
  },
  required: ['command'],
  additionalProperties: false,
}

/** Windows 上 Git Bash 的常见安装位置;都未命中时回退 PATH 里的 bash。 */
function detectGitBash() {
  try {
    const { existsSync } = process.getBuiltinModule('node:fs')
    const { join } = process.getBuiltinModule('node:path')
    const localAppData = process.env.LOCALAPPDATA || ''
    const candidates = [
      join('C:', 'Program Files', 'Git', 'bin', 'bash.exe'),
      join('C:', 'Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      ...(localAppData ? [join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')] : []),
    ]
    for (const candidate of candidates) if (existsSync(candidate)) return candidate
  } catch { /* 探测失败就回退 PATH */ }
  return 'bash'
}

/**
 * 全盘检索闸(纯函数,便于单测):递归检索命令的起点是文件系统根(/、/c /d 这类
 * 盘符根、C:\ 这类盘符写法、~)时,返回拒绝理由;否则返回 null。
 *
 * 为什么要有:有用户实测模型在找不到扩展目录时跑了
 * `find / -maxdepth 6 -type d -name "xxx"` —— 从盘符根翻起,几分钟都出不来结果
 * (issue #1)。09-15 又见变种:模型用 `ls /c/ /d/ /e/` 找游戏目录(issue #1 同根,
 * 非递归但照样把用户无关目录倒满上下文)——故 ls/dir 列盘根一并拦。只拦"起点是根"
 * 这一种形态:带具体子路径的检索/列目录照常放行;引号里的内容先摘掉再判,避免
 * `grep "see / this"` 这类误伤。误拦的代价可控:模型看到拒绝理由后写明确路径即可恢复。
 */
export function rootSearchIssue(command) {
  // 引号内整体恰好是根形态的,摘引号前先单独拦(find "/" / grep -r x '~' ——
  // 引号摘除防误伤的副作用是这类命令会漏,它们正是要拦的盘根检索)
  if (/(["'])\s*(\/|\/[a-z]\/?|[a-z]:[\\\/]?|~)\s*\1/i.test(String(command || ''))) {
    return '检索起点是文件系统根(写在引号里也一样),会扫到大量无关内容。游戏与扩展的路径已在系统提示的「当前环境」小节里给出:核对引擎源码直接在给出的目录下窄窗口 grep,检索官方实现用 noname_search_reference——不需要寻找路径,也不许再列盘根。'
  }
  // 先摘掉引号字符串:里面的 "/" 是文案不是检索起点
  const text = String(command || '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  // ls/dir 也在列:非递归地列盘根(issue #1 的变种,09-15 实测)同样会把用户
  // 无关目录整屏倒进上下文(实测模型用 `ls /c/ /d/ /e/` 找游戏目录,D/E 盘
  // 根目录全泄进模型上下文)。
  const RE = /(?:^|[\s;&(])(find|grep|rg|du|fd|locate|ls|dir)\b([^;|&>]*)/g
  let m
  while ((m = RE.exec(text))) {
    // 起点是根:/ 本身、/c 或 /c/ 盘符根(带不带尾斜杠都算,但 /c/ 后必须直接结束
    // ——/c/Users/x 这类真实子路径放行)、C:\ C:/ 盘符写法、或 ~
    if (/(?:^|[\s'"(=(])(?:\/(?![\w.])|\/[a-z]\/(?![\w.\-])|\/[a-z](?![\w.\-\/])|[a-z]:[\\/](?![\w.\-\/])|~(?![\w.\-\/]))/i.test(m[2])) {
      return '检索/列目录的起点是文件系统根(' + m[1] + ' …),会扫到大量无关内容。游戏与扩展的路径已在系统提示的「当前环境」小节里给出:核对引擎源码直接在给出的目录下窄窗口 grep,检索官方实现用 noname_search_reference——不需要寻找路径,也不许再列盘根。'
    }
  }
  return null
}

/** Register the model-facing `bash` tool. */
export function apply(ctx, config) {
  const bashPath = typeof config?.bashPath === 'string' && config.bashPath.length > 0 ? config.bashPath : detectGitBash()
  const timeoutMs = Number.isSafeInteger(config?.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS
  // Precedence: row config (advanced, hand-edited yml) > workshop settings page > default.
  const maxOutputBytes = Number.isSafeInteger(config?.maxOutputBytes) && config.maxOutputBytes > 0
    ? config.maxOutputBytes
    : (workshopMaxOutputBytes(ctx) ?? DEFAULT_MAX_OUTPUT_BYTES)

  ctx.tools.register({
    name: 'bash',
    description: [
      'Run commands in a bash shell (Git Bash on Windows)',
      '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
      "* You don't have access to the internet via this tool.",
      '* You do have access to a mirror of common linux and python packages via apt and pip.',
      '* State does NOT persist across command calls: each call runs in a fresh shell.',
      "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
      '* Please avoid commands that may produce a very large amount of output.',
      '* NOTE: runs without OS sandbox confinement on Windows (no landlock); treat output as untrusted.',
    ].join('\n'),
    parameters: commandSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      // 全盘检索闸:先于执行判断,拒绝时把替代做法写给模型(见 rootSearchIssue)
      const guard = rootSearchIssue(args.command)
      if (guard) throw new Error('已拒绝执行(全盘检索闸): ' + guard)
      const shell = await ctx.subprocess.resolveExecutable(bashPath, undefined, exec?.signal)
      const workdir = typeof args.workdir === 'string' && args.workdir.length > 0
        ? args.workdir
        : exec?.agent?.session?.header?.cwd
      const signal = exec?.signal
      const handle = ctx.subprocess.spawn({
        argv: [shell, '-c', args.command],
        ...workdir !== undefined ? { cwd: workdir } : {},
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        ...signal !== undefined ? { signal } : {},
        graceMs: 3000,
      })
      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        // A spawn-level failure (bad executable, EPERM) surfaces as a throw,
        // which the runtime turns into an isError result.
        throw new Error(`bash spawn failed: ${String(error)}`)
      }
      let stdout = ''
      let stderr = ''
      try {
        stdout = handle.collected.stdout.readFrom(0).text
        stderr = handle.collected.stderr.readFrom(0).text
      } catch {
        // Collected readers may be unavailable on some backends; tolerate.
      }
      const text = [stdout, stderr].filter((part) => part.length > 0).join('\n')
      const tail = text.length > 0 ? text : `exit code: ${outcome.exitCode} (no output)`
      if (outcome.exitCode !== 0) {
        // Non-zero exit is a reported failure, not a throw: the model sees the
        // command output plus the exit code.
        throw new Error(tail)
      }
      return { text: tail }
    },
  })
}

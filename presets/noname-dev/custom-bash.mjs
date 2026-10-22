/** Register a Windows-capable bash tool through ctx.subprocess.spawn without requiring a PTY. Resolve bashPath explicitly or locate bash through PATH. Each command uses a fresh bash -c process with bounded output and reported exit status. Windows execution does not provide sandbox confinement. */

import { posix, win32 } from 'node:path'
import { ensureWorkingDirectory } from './working-directory.mjs'

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

/** Read shell words without treating quoted search patterns as filesystem paths. */
function shellSegments(command) {
  const segments = [[]]
  let value = ''
  let active = false
  let quote = ''
  const finish = () => {
    if (active) segments[segments.length - 1].push(value)
    value = ''
    active = false
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = ''
      else if (quote === '"' && ch === '\\' && /["\\$\x60\n]/.test(command[i + 1] || '')) value += command[++i]
      else value += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      active = true
    } else if (ch === '\\' && !/^[a-z]:$/i.test(value) && /[\s'";&|()<>\\]/.test(command[i + 1] || '')) {
      value += command[++i]
      active = true
    } else if (/\s/.test(ch)) {
      finish()
      if (ch === '\n') segments.push([])
    } else if (/[;&|()<>]/.test(ch)) {
      finish()
      segments.push([])
    } else {
      value += ch
      active = true
    }
  }
  finish()
  return segments
}

function isRootPath(value) {
  return /^(?:\/+|\/[a-z]\/*|[a-z]:(?:[\\/]+)?|~\/*)$/i.test(value)
}

/** Inspect path operands; grep/rg/fd patterns and find predicates are not search roots. */
function searchPaths(tool, args) {
  if (tool === 'find') {
    const paths = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (paths.length === 0 && (arg === '--' || /^-(?:[HLP]|O[0-3])$/.test(arg))) continue
      if (paths.length === 0 && arg === '-D') { i++; continue }
      if (arg.startsWith('-') || arg === '!' || arg === '(') break
      paths.push(arg)
    }
    return paths
  }
  if (!['grep', 'rg', 'fd', 'fdfind'].includes(tool)) return args.filter((arg) => !arg.startsWith('-'))
  let patternGiven = false
  let optionsEnded = false
  let filesOnly = false
  const paths = []
  const valueOptions = new Set([
    '-A', '-B', '-C', '-m', '-g', '-t', '-T', '-E', '-O', '-j',
    '--after-context', '--before-context', '--context', '--max-count', '--max-depth',
    '--maxdepth', '--mindepth', '--min-depth', '--max-filesize', '--encoding',
    '--glob', '--iglob', '--type', '--type-not',
    '--type-add', '--type-clear', '--sort', '--sortr', '--threads', '--pre',
    '--pre-glob', '--ignore-file', '--path-separator', '--field-match-separator',
    '--field-context-separator', '--context-separator', '--replace', '-r',
    '--color', '--colors', '--engine', '--dfa-size-limit', '--regex-size-limit',
    '--exclude', '--exclude-dir', '--include', '--exclude-from',
    '--extension', '--size',
    '--changed-within', '--changed-before', '--owner', '--format',
  ])
  // These grep flags take no following value, unlike similarly named rg options.
  if (tool === 'grep') for (const flag of ['-r', '-E', '-T', '--color']) valueOptions.delete(flag)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!optionsEnded && arg === '--') { optionsEnded = true; continue }
    if (!optionsEnded && arg === '--files') { filesOnly = true; continue }
    if (!optionsEnded && ['fd', 'fdfind'].includes(tool) && ['--search-path', '--base-directory'].includes(arg)) { paths.push(args[++i] ?? ''); continue }
    if (!optionsEnded && ['fd', 'fdfind'].includes(tool) && /^--(?:search-path|base-directory)=/.test(arg)) { paths.push(arg.slice(arg.indexOf('=') + 1)); continue }
    if (!optionsEnded && ['-e', '--regexp', '-f', '--file'].includes(arg)) {
      patternGiven = true
      i++
      continue
    }
    if (!optionsEnded && (/^--(?:regexp|file)=/.test(arg) || /^-[ef].+/.test(arg))) { patternGiven = true; continue }
    if (!optionsEnded && valueOptions.has(arg)) { i++; continue }
    if (!optionsEnded && arg.startsWith('-') && arg !== '-') continue
    if (!patternGiven && !filesOnly) patternGiven = true
    else paths.push(arg)
  }
  return paths
}

/** Reject explicit filesystem-root queries while allowing literal root-shaped search patterns. */
export function rootSearchIssue(command) {
  const searchTools = new Set(['find', 'grep', 'rg', 'du', 'fd', 'fdfind', 'locate', 'ls', 'dir'])
  for (const words of shellSegments(String(command || ''))) {
    let i = 0
    const wrappers = new Set(['command', 'builtin', 'exec', 'sudo', 'env', 'then', 'do', 'if', 'while', 'until', '!', 'time', 'nice', 'nohup'])
    const wrapperValues = {
      sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--chroot', '--command-timeout']),
      env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
      exec: new Set(['-a']),
      time: new Set(['-f', '-o', '--format', '--output']),
      nice: new Set(['-n', '--adjustment']),
    }
    while (i < words.length) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) { i++; continue }
      if (!wrappers.has(words[i])) break
      const wrapper = words[i++]
      while (words[i]?.startsWith('-')) {
        const option = words[i++]
        if (wrapperValues[wrapper]?.has(option)) i++
      }
    }
    const tool = (words[i] || '').split(/[\\/]/).pop()
    if (searchTools.has(tool) && searchPaths(tool, words.slice(i + 1)).some(isRootPath)) {
      return '检索/列目录的起点是文件系统根(' + tool + ' …),会扫到大量无关内容。游戏与扩展的路径已在系统提示的「当前环境」小节里给出:核对引擎源码直接在给出的目录下窄窗口 grep,检索官方实现用 noname_search_reference——不需要寻找路径,也不许再列盘根。'
    }
  }
  return null
}

/** Translate Git Bash drive paths before native Windows cwd resolution. */
export function resolveBashWorkdir(cwd, workdir, platform = process.platform) {
  if (typeof workdir !== 'string' || workdir.length === 0) return cwd
  if (platform !== 'win32') return posix.resolve(cwd ?? process.cwd(), workdir)
  const drivePath = workdir.replace(/^\/([a-z])(?:\/|$)/i, (_whole, drive) => drive + ':/')
  return win32.resolve(cwd ?? process.cwd(), drivePath)
}

function abortError(signal) {
  const reason = signal.reason
  return reason instanceof Error ? reason : new Error(String(reason ?? 'bash tool call aborted'))
}

/** An aborted preparation must never proceed to spawning a command. */
async function abortable(pending, signal) {
  if (signal.aborted) throw abortError(signal)
  let onAbort
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { return await Promise.race([pending, aborted]) }
  finally { signal.removeEventListener('abort', onAbort) }
}

function readOutput(handle, channel) {
  try {
    const result = handle.collected?.[channel]?.readFrom(0)
    if (typeof result?.text !== 'string') throw new Error('collected output reader is unavailable or returned invalid text')
    const notes = []
    if (result.truncated === true || result.lossy === true) notes.push('[' + channel + ' output truncated; full output: ' + (result.spillPath ?? '(unavailable)') + ']')
    else if (result.spillPath) notes.push('[' + channel + ' full output: ' + result.spillPath + ']')
    return { text: [result.text, ...notes].filter(Boolean).join('\n') }
  } catch (error) {
    const text = '[' + channel + ' output could not be read: ' + String(error) + ']'
    return { text, failed: true }
  }
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
      '* Available commands, packages, and network access depend on the host environment.',
      '* State does NOT persist across command calls: each call runs in a fresh shell.',
      "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
      '* Output is bounded; truncation and a full-output path are reported when the host provides them.',
      '* The configured deadline stops the managed command; cancellation waits for managed process cleanup.',
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
      const controller = new AbortController()
      const signal = controller.signal
      let handle
      let timedOut = false
      let terminationFailure
      const terminate = () => {
        if (!handle) return
        try { handle.terminate() }
        catch (error) { terminationFailure = error }
      }
      const stop = (reason) => {
        if (!signal.aborted) controller.abort(reason)
        terminate()
      }
      const onAbort = () => stop(exec.signal.reason ?? new Error('bash tool call aborted'))
      exec?.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        stop(new Error('bash timed out after ' + timeoutMs + 'ms'))
      }, timeoutMs)
      try {
        if (exec?.signal?.aborted) onAbort()
        if (signal.aborted) throw abortError(signal)
        const shell = await abortable(ctx.subprocess.resolveExecutable(bashPath, undefined, signal), signal)
        const cwd = await abortable(ensureWorkingDirectory(ctx, exec?.agent, signal), signal)
        if (signal.aborted) throw abortError(signal)
        const workdir = resolveBashWorkdir(cwd, args.workdir)
        handle = ctx.subprocess.spawn({
          argv: [shell, '-c', args.command],
          ...workdir !== undefined ? { cwd: workdir } : {},
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: maxOutputBytes },
            stderr: { maxBytes: maxOutputBytes },
          },
          signal,
          graceMs: 3000,
        })
        if (signal.aborted) terminate()
        let outcome
        let failure
        try { outcome = await handle.done }
        catch (error) { failure = new Error('bash spawn failed: ' + String(error)); terminate() }
        try {
          if (typeof handle.waitForExit !== 'function') throw new Error('subprocess provider does not expose waitForExit')
          await handle.waitForExit()
        } catch (error) {
          terminate()
          let cleanupDetail = String(error)
          if (typeof handle.waitForExit === 'function') {
            try { await handle.waitForExit() }
            catch (retryError) { cleanupDetail += '; exit could not be confirmed after termination: ' + String(retryError) }
          }
          failure = new Error((failure ? String(failure) + '\n' : '') + 'bash process cleanup failed: ' + cleanupDetail)
        }
        const stdout = readOutput(handle, 'stdout')
        const stderr = readOutput(handle, 'stderr')
        const body = [stdout.text, stderr.text ? '[stderr]\n' + stderr.text : ''].filter(Boolean).join('\n') || '(no output)'
        const markers = []
        if (timedOut) markers.push('[timed out after ' + timeoutMs + 'ms]')
        else if (signal.aborted) markers.push('[aborted: ' + String(signal.reason ?? 'tool call cancelled') + ']')
        if (outcome?.signal != null) markers.push('[killed by signal: ' + outcome.signal + ']')
        if (outcome?.exitCode !== 0) markers.push('[exit code: ' + (outcome?.exitCode ?? 'unknown') + ']')
        if (terminationFailure) markers.push('[process termination failed: ' + String(terminationFailure) + ']')
        if (failure) markers.push(String(failure))
        const text = [body, ...markers].join('\n')
        if (signal.aborted || failure || terminationFailure || stdout.failed || stderr.failed || outcome?.exitCode !== 0 || outcome?.signal != null) throw new Error(text)
        return { text }
      } finally {
        clearTimeout(timer)
        exec?.signal?.removeEventListener('abort', onAbort)
      }
    },
  })
}

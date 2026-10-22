import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, rootSearchIssue, resolveBashWorkdir } from '../presets/noname-dev/custom-bash.mjs'

const blocked = [
  'find / -maxdepth 6 -name x', 'find "/" -name x', "find '/' -name x", 'find ~ -name x',
  'find . /d/ -name x', 'find -L /d -name x', 'find C:\\ -name x',
  'grep -rn connect /', 'grep -n pattern "/"', 'grep -e "/" /', 'grep -f local-patterns /',
  'grep -rn -- pattern /c/', 'rg pattern /', 'rg -g "*.js" pattern /d/', 'rg --files /',
  'rg --regexp "/" /', 'rg --regexp=/ /', 'fd pattern /', 'fdfind pattern /c',
  'du -sh /', 'du -sh "/"', 'ls -la /', 'ls /c/ /d/ /e/', 'ls "~"', 'dir C:\\',
  'printf ok; find / -name x', 'printf ok | rg pattern /', '(find / -name x)',
  'command find / -name x', 'env LANG=C find / -name x', 'sudo find / -name x',
  'sudo -u root find / -name x', 'nice -n 3 rg pattern /', 'grep -E pattern /',
  'grep -T pattern /', 'grep --color pattern /', 'fd --search-path / pattern',
  'fd --base-directory=/ pattern', 'rg --glob-case-insensitive pattern /',
  'find -- / -name x', 'find -O3 / -name x', 'find -D tree / -name x',
  'command -p find /', 'time -p find /', 'sudo -n find /', 'exec -a find-alias find /',
  'if find / -name x; then true; fi',
]
const allowed = [
  'grep -n "/" noname/init/loading.js', "printf '/'", 'printf "/"', 'echo "/d/"',
  'grep -rn "connect" noname/library', 'grep -rn "path / desc" docs/x.md',
  'grep -e "/" noname/library/x.js', 'grep -f local-patterns noname/library/x.js',
  'grep --regexp=/ noname/library/x.js', 'grep -n -- "/" noname/library/x.js',
  'rg -g "/" "connect" noname/library', 'rg -r "/" "connect" noname/library',
  'rg --regexp "/" noname/library', 'rg --files noname/library', 'fd "/" noname/library',
  'find /d/games/noname/extension -name "*.js"', 'find . -name "/"', 'find . -path "/"',
  'ls /d/wms/无名杀/resources/app', 'ls -la /d/deepseek-harness', 'find . -name x',
  'printf "find /"', "echo 'grep -r x /'", 'ls "/d/wms/noname app"',
]
for (const command of blocked) test('reject root query: ' + command, () => assert(rootSearchIssue(command)))
for (const command of allowed) test('allow ordinary query: ' + command, () => assert.equal(rootSearchIssue(command), null))

test('Git Bash drive paths resolve to Windows drives', () => {
  assert.equal(resolveBashWorkdir('D:/wms/noname/resources/app', '/d/wms/noname/resources/app', 'win32'), 'd:\\wms\\noname\\resources\\app')
  assert.equal(resolveBashWorkdir('D:/wms/noname/resources/app', '/e/测试 目录', 'win32'), 'e:\\测试 目录')
  assert.equal(resolveBashWorkdir('D:/wms/noname/resources/app', '/d', 'win32'), 'd:\\')
  assert.equal(resolveBashWorkdir('D:/wms/noname/resources/app', 'extension/启明', 'win32'), 'D:\\wms\\noname\\resources\\app\\extension\\启明')
  assert.equal(resolveBashWorkdir('D:/wms/noname/resources/app', 'E:/noname', 'win32'), 'E:\\noname')
  assert.equal(resolveBashWorkdir('/work', '/d/noname', 'linux'), '/d/noname')
  assert.equal(resolveBashWorkdir('/work', 'noname', 'linux'), '/work/noname')
  assert.equal(resolveBashWorkdir('/work', undefined, 'linux'), '/work')
})

function fixture(options = {}) {
  const state = { spawn: 0, terminate: 0, waits: 0, closed: false, done: false, reads: [], timers: [], prepSignals: [] }
  let tool
  let resolveDone, rejectDone, resolveExit
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
  const exited = new Promise((resolve) => { resolveExit = resolve })
  const finish = (outcome = options.outcome ?? { exitCode: 0, signal: null }) => {
    if (state.done) return
    state.done = true
    if (options.doneError) rejectDone(options.doneError)
    else resolveDone(outcome)
  }
  const close = () => {
    if (state.closed) return
    state.closed = true
    resolveExit(true)
  }
  const later = (fn, delay) => { const timer = setTimeout(fn, delay); state.timers.push(timer); return timer }
  const read = (channel) => ({ readFrom(offset) {
    state.reads.push({ channel, offset, closed: state.closed })
    if (options.readError === channel) throw new Error(channel + ' reader failed')
    if (options.invalidReader === channel) return undefined
    return options[channel] ?? { text: '', lossy: false }
  } })
  const ctx = {
    tools: { register(value) { tool = value } },
    workingDirectory: { async ensure(_agent, signal) {
      state.prepSignals.push(signal)
      if (options.directory) return options.directory(signal)
      return 'D:/wms/noname/resources/app'
    } },
    subprocess: {
      async resolveExecutable(_path, _env, signal) {
        state.prepSignals.push(signal)
        if (options.resolve) return options.resolve(signal)
        return 'fake-bash'
      },
      spawn(spec) {
        state.spawn++
        state.spec = spec
        if (options.spawnError) throw new Error('spawn unavailable')
        if (options.complete !== false) later(() => { finish(); if (!options.liveDescendant) close() }, options.delay ?? 0)
        return {
          done,
          collected: { stdout: read('stdout'), stderr: read('stderr') },
          terminate() {
            state.terminate++
            later(() => { finish({ exitCode: null, signal: 'SIGTERM' }); close() }, options.cleanupDelay ?? 3)
          },
          async waitForExit() {
            state.waits++
            if (options.waitError && (!options.waitErrorOnce || state.waits === 1)) throw new Error('range observation failed')
            return exited
          },
        }
      },
    },
  }
  apply(ctx, { bashPath: 'fake-bash', timeoutMs: options.timeoutMs ?? 200, maxOutputBytes: options.maxOutputBytes ?? 64000 })
  return {
    state, tool, close, finish,
    async run(args = { command: 'true' }, signal) {
      try { return await tool.execute(args, { agent: { session: {} }, ...(signal ? { signal } : {}) }) }
      finally { for (const timer of state.timers) clearTimeout(timer) }
    },
  }
}

test('normal command waits for range closure, reads both streams, and preserves output budget', async () => {
  const f = fixture({ stdout: { text: 'ok' }, stderr: { text: 'warning' }, maxOutputBytes: 128000 })
  assert.deepEqual(await f.run(), { text: 'ok\n[stderr]\nwarning' })
  assert.equal(f.state.waits, 1)
  assert.equal(f.state.terminate, 0)
  assert(f.state.closed)
  assert(f.state.reads.every((read) => read.closed && read.offset === 0))
  assert.equal(f.state.spec.stdio.stdout.maxBytes, 128000)
  assert.equal(f.state.spec.stdio.stderr.maxBytes, 128000)
  assert(f.state.spec.signal instanceof AbortSignal)
  assert(f.state.prepSignals.every((signal) => signal === f.state.spec.signal))
})

test('host lossy output reports truncation and spill path', async () => {
  const f = fixture({ stdout: { text: 'retained tail', lossy: true, spillPath: 'E:/isolated/full.txt' } })
  const result = await f.run()
  assert.match(result.text, /retained tail/)
  assert.match(result.text, /stdout output truncated; full output: E:\/isolated\/full\.txt/)
})

test('truncated compatibility output and missing spill path are explicit', async () => {
  const result = await fixture({ stderr: { text: 'tail', truncated: true } }).run()
  assert.match(result.text, /stderr output truncated; full output: \(unavailable\)/)
})

test('spill path without a loss flag remains visible', async () => {
  const result = await fixture({ stdout: { text: 'all', spillPath: 'E:/isolated/output.txt' } }).run()
  assert.match(result.text, /stdout full output: E:\/isolated\/output\.txt/)
})

test('one broken collector preserves the other stream and reports failure', async () => {
  await assert.rejects(fixture({ readError: 'stdout', stderr: { text: 'diagnostic survives' } }).run(), (error) => {
    assert.match(error.message, /stdout output could not be read/)
    assert.match(error.message, /diagnostic survives/)
    return true
  })
})

test('missing collector data is not rendered as successful empty output', async () => {
  await assert.rejects(fixture({ invalidReader: 'stderr' }).run(), /stderr output could not be read/)
})

test('nonzero exit always includes code and captured output', async () => {
  await assert.rejects(fixture({ outcome: { exitCode: 17 }, stdout: { text: 'partial' } }).run(), (error) => {
    assert.match(error.message, /partial/)
    assert.match(error.message, /\[exit code: 17\]/)
    return true
  })
})

test('empty successful output is explicit', async () => {
  assert.deepEqual(await fixture().run(), { text: '(no output)' })
})

test('signal exit is reported even if provider reports zero', async () => {
  await assert.rejects(fixture({ outcome: { exitCode: 0, signal: 'SIGTERM' } }).run(), /killed by signal: SIGTERM/)
})

test('deadline terminates and joins command before reporting timeout', async () => {
  const f = fixture({ timeoutMs: 15, complete: false, cleanupDelay: 8, stdout: { text: 'partial output' } })
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /timed out after 15ms/)
    assert.match(error.message, /partial output/)
    return true
  })
  assert(f.state.spec.signal.aborted)
  assert(f.state.terminate > 0)
  assert(f.state.done && f.state.closed)
  assert.equal(f.state.waits, 1)
})

test('deadline also terminates surviving descendants after direct command exit', async () => {
  const f = fixture({ timeoutMs: 15, liveDescendant: true })
  await assert.rejects(f.run(), /timed out after 15ms/)
  assert(f.state.done && f.state.closed)
  assert(f.state.terminate > 0)
})

test('caller cancellation terminates and joins command', async () => {
  const controller = new AbortController()
  const f = fixture({ complete: false, timeoutMs: 200 })
  const pending = f.run(undefined, controller.signal)
  setTimeout(() => controller.abort(new Error('user cancelled')), 8)
  await assert.rejects(pending, /aborted: Error: user cancelled/)
  assert(f.state.closed && f.state.done && f.state.spec.signal.aborted)
  assert(f.state.terminate > 0)
  assert.equal(f.state.waits, 1)
})

test('already cancelled call never resolves executable or spawns', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancel before start'))
  const f = fixture()
  await assert.rejects(f.run(undefined, controller.signal), /cancel before start/)
  assert.equal(f.state.spawn, 0)
  assert.equal(f.state.prepSignals.length, 0)
})

test('deadline during stalled executable lookup never spawns', async () => {
  const f = fixture({ timeoutMs: 10, resolve: () => new Promise(() => {}) })
  await assert.rejects(f.run(), /bash timed out after 10ms/)
  assert.equal(f.state.spawn, 0)
  assert(f.state.prepSignals[0].aborted)
})

test('caller cancellation during directory lookup never spawns', async () => {
  const controller = new AbortController()
  const f = fixture({ directory: () => new Promise(() => {}) })
  const pending = f.run(undefined, controller.signal)
  setTimeout(() => controller.abort(new Error('cancel directory lookup')), 8)
  await assert.rejects(pending, /cancel directory lookup/)
  assert.equal(f.state.spawn, 0)
  assert(f.state.prepSignals.every((signal) => signal.aborted))
})

test('failed spawn promise terminates and waits for cleanup', async () => {
  const f = fixture({ doneError: new Error('spawn denied') })
  await assert.rejects(f.run(), /bash spawn failed: Error: spawn denied/)
  assert(f.state.closed)
  assert(f.state.terminate > 0)
  assert.equal(f.state.waits, 1)
})

test('managed-range observation failure is explicit', async () => {
  const f = fixture({ waitError: true })
  await assert.rejects(f.run(), /bash process cleanup failed: Error: range observation failed/)
  assert(f.state.terminate > 0)
  assert.equal(f.state.waits, 2)
})

test('failed managed-range observation retries joining after termination', async () => {
  const f = fixture({ waitError: true, waitErrorOnce: true, liveDescendant: true })
  await assert.rejects(f.run(), /bash process cleanup failed: Error: range observation failed/)
  assert(f.state.closed)
  assert(f.state.terminate > 0)
  assert.equal(f.state.waits, 2)
})

test('tool success removes caller listener and clears deadline', async () => {
  const controller = new AbortController()
  let adds = 0, removes = 0
  const add = controller.signal.addEventListener.bind(controller.signal)
  const remove = controller.signal.removeEventListener.bind(controller.signal)
  controller.signal.addEventListener = (...args) => { adds++; return add(...args) }
  controller.signal.removeEventListener = (...args) => { removes++; return remove(...args) }
  const f = fixture({ timeoutMs: 15 })
  await f.run(undefined, controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 25))
  controller.abort(new Error('after completed'))
  assert.equal(adds, 1)
  assert.equal(removes, 1)
  assert.equal(f.state.terminate, 0)
  assert.equal(f.state.spec.signal.aborted, false)
})

test('root guard runs before process creation', async () => {
  const f = fixture()
  await assert.rejects(f.run({ command: 'find / -name x' }), /全盘检索闸/)
  assert.equal(f.state.spawn, 0)
})

test('description states host capabilities without fabricated package services', () => {
  const f = fixture()
  assert(!/mirror of common|via apt|don.t have access to the internet/i.test(f.tool.description))
  assert.match(f.tool.description, /network access depend on the host environment/)
})

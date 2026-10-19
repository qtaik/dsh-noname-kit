/** Explicit local bridge binding, atomic configuration writes and existing HTTP trust boundaries. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createServer, request as httpRequest } from 'node:http'
import testPaths from './fixtures/test-paths.cjs'
import batchFiles from '../online-kernel/lib/batch-files.cjs'
import { bindKernelBridge, bridgeBaseUrl, kernelRuntimeStatus, kernelStatus } from '../src/online.js'

const home = fs.mkdtempSync(testPaths.tempPrefix('bridge-binding-'))
const baseUrl = 'http://127.0.0.1:34567/noname-kit-api', currentToken = 'fixture-current-private-token'
let sequence = 0, passed = 0, failed = 0
const results = []
async function test(name, fn) {
  try { await fn(); passed++; results.push({ name, ok: true }); console.log('PASS ' + name) }
  catch (error) { failed++; results.push({ name, ok: false, error: String(error) }); console.error('FAIL ' + name + ': ' + error.stack) }
}
function fixture() {
  const root = path.join(home, String(++sequence)), target = path.join(root, 'extension', '联机助手')
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(root, 'noname.js'), '// game fixture')
  fs.writeFileSync(path.join(target, 'extension.js'), '// existing kernel fixture; do not replace')
  const config = path.join(target, 'nnk-bridge.json'), manifest = path.join(target, '.nnk-kernel.json')
  const previous = { baseUrl: 'http://127.0.0.1:10000/noname-kit-api', token: 'fixture-old-private-token', intervalMs: 1234, installedAt: 123456, extra: { retained: true } }
  fs.writeFileSync(config, JSON.stringify(previous, null, 2))
  fs.writeFileSync(manifest, '{"version":"existing","installedAt":123456,"hash":"unchanged"}')
  return { root, target, config, manifest, previous }
}
const bind = k => bindKernelBridge({ nonameDir: k.root, baseUrl, token: currentToken })
const installerCode = fs.readFileSync(new URL('../src/kernel-install.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function faultBinder(fault) {
  const io = { ...fs }
  if (fault === 'write') io.openSync = (file, ...args) => { if (/bridge-.*\.tmp$/.test(String(file))) throw Object.assign(Error('injected write fault'), { code: 'ENOSPC' }); return fs.openSync(file, ...args) }
  if (fault === 'backup') io.openSync = (file, ...args) => { if (/bridge-original-.*\.json$/.test(String(file))) throw Object.assign(Error('injected backup fault'), { code: 'ENOSPC' }); return fs.openSync(file, ...args) }
  if (fault === 'rename') io.renameSync = (from, to) => { if (String(to).endsWith('nnk-bridge.json')) throw Object.assign(Error('injected rename fault'), { code: 'EPERM' }); return fs.renameSync(from, to) }
  const sandbox = { fs: io, batchFiles, createHash, randomUUID, ...path, process }
  return runInNewContext(installerCode.replace(/^import .*\n/gm, '').replace(/export /g, '') + '\nbindKernelBridgeFiles', sandbox)
}

await test('binding updates only destination and credential, retaining interval and installation metadata', () => {
  const k = fixture(), entry = fs.readFileSync(path.join(k.target, 'extension.js')), stamp = fs.readFileSync(k.manifest)
  const result = bind(k)
  assert.deepEqual(result, { ok: true, bridgeBinding: { baseUrl, changed: true } })
  assert.deepEqual(JSON.parse(fs.readFileSync(k.config, 'utf8')), { ...k.previous, baseUrl, token: currentToken })
  assert.deepEqual(fs.readFileSync(path.join(k.target, 'extension.js')), entry)
  assert.deepEqual(fs.readFileSync(k.manifest), stamp)
  assert.equal(fs.existsSync(path.join(k.root, 'nnk-kernel-backups')), false)
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})
await test('already-current binding is an idempotent read with unchanged configuration bytes and mtime', () => {
  const k = fixture(); assert.equal(bind(k).ok, true)
  const bytes = fs.readFileSync(k.config), before = fs.statSync(k.config, { bigint: true })
  assert.deepEqual(bind(k), { ok: true, bridgeBinding: { baseUrl, changed: false } })
  assert.deepEqual(fs.readFileSync(k.config), bytes)
  assert.equal(fs.statSync(k.config, { bigint: true }).mtimeNs, before.mtimeNs)
})
await test('missing bridge configuration can be repaired without changing installed kernel code', () => {
  const k = fixture(); fs.unlinkSync(k.config)
  assert.equal(bind(k).ok, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(k.config, 'utf8')), { baseUrl, token: currentToken, intervalMs: 700 })
  assert.equal(fs.readFileSync(path.join(k.target, 'extension.js'), 'utf8'), '// existing kernel fixture; do not replace')
})
await test('a stale installed kernel can be rebound but remains subject to the unchanged runtime upgrade gate', () => {
  const k = fixture(); assert.equal(bind(k).ok, true)
  assert.equal(kernelRuntimeStatus({ state: 'stale' }, { online: true, transferProtocol: 'legacy' }), 'restart_required')
})
for (const missing of ['directory', 'entry']) await test('missing kernel ' + missing + ' is rejected without creating a replacement', () => {
  const k = fixture()
  if (missing === 'directory') fs.renameSync(k.target, path.join(k.root, 'saved-kernel'))
  else fs.unlinkSync(path.join(k.target, 'extension.js'))
  assert.equal(bind(k).code, 'KERNEL_MISSING')
  assert.equal(fs.existsSync(path.join(k.target, 'extension.js')), false)
})
for (const blocker of ['batch recovery', 'install recovery', 'live installer']) await test(blocker + ' blocks binding and retains original bytes', () => {
  const k = fixture(), before = fs.readFileSync(k.config)
  const folder = path.join(k.root, blocker === 'batch recovery' ? 'nnk-batches' : 'nnk-kernel-install')
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, blocker === 'batch recovery' ? 'active' : blocker === 'install recovery' ? 'active.json' : 'install.lock'), blocker === 'live installer' ? JSON.stringify({ pid: process.pid }) : 'preserve pending recovery')
  assert.equal(bind(k).ok, false)
  assert.deepEqual(fs.readFileSync(k.config), before)
})
for (const part of ['root', 'extension', 'target', 'work']) await test('directory junction at ' + part + ' is rejected without writing through it', () => {
  const k = fixture(), original = fs.readFileSync(k.config)
  const entry = part === 'root' ? k.root : part === 'extension' ? path.join(k.root, 'extension') : part === 'target' ? k.target : path.join(k.root, 'nnk-kernel-install')
  const saved = path.join(home, 'linked-' + sequence)
  if (part === 'work') fs.mkdirSync(saved)
  else fs.renameSync(entry, saved)
  fs.symlinkSync(saved, entry, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    assert.equal(bind(k).ok, false)
    const actual = part === 'root' ? path.join(saved, 'extension', '联机助手', 'nnk-bridge.json') : part === 'extension' ? path.join(saved, '联机助手', 'nnk-bridge.json') : part === 'target' ? path.join(saved, 'nnk-bridge.json') : k.config
    assert.deepEqual(fs.readFileSync(actual), original)
  } finally { fs.unlinkSync(entry) }
})
for (const part of ['configuration', 'entry', 'lock']) await test('hardlinked ' + part + ' is rejected without modifying either link', () => {
  const k = fixture(), original = fs.readFileSync(k.config)
  const file = part === 'configuration' ? k.config : part === 'entry' ? path.join(k.target, 'extension.js') : path.join(k.root, 'nnk-kernel-install', 'install.lock')
  if (part === 'lock') { fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, JSON.stringify({ pid: process.pid })) }
  const other = path.join(home, 'hardlink-' + sequence); fs.linkSync(file, other)
  const linkedBytes = fs.readFileSync(other)
  assert.equal(bind(k).ok, false)
  assert.deepEqual(fs.readFileSync(k.config), original)
  assert.deepEqual(fs.readFileSync(other), linkedBytes)
})
function corruptBackups(k) {
  return fs.readdirSync(path.join(k.root, 'nnk-kernel-install')).filter(name => /^bridge-original-[a-f0-9-]+\.json$/.test(name)).map(name => path.join(k.root, 'nnk-kernel-install', name))
}
for (const bad of ['{invalid', '[]', 'null', '"private-token"']) await test('explicit binding repairs corrupt configuration and preserves its exact bytes: ' + bad.slice(0, 8), () => {
  const k = fixture(); fs.writeFileSync(k.config, bad)
  const result = bind(k)
  assert.equal(result.ok, true); assert.equal(result.bridgeBinding.recovered, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(k.config, 'utf8')), { baseUrl, token: currentToken, intervalMs: 700 })
  const backups = corruptBackups(k); assert.equal(backups.length, 1); assert.deepEqual(fs.readFileSync(backups[0]), Buffer.from(bad))
  assert.equal(JSON.stringify(result).includes('private-token'), false)
  assert.equal(kernelStatus({ nonameDir: k.root, token: currentToken }).bridgeConfig, 'ok')
})
await test('corrupt non-UTF8 bytes are backed up without decoding or conversion', () => {
  const k = fixture(), bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x7b])
  fs.writeFileSync(k.config, bytes)
  assert.equal(bind(k).bridgeBinding.recovered, true)
  assert.deepEqual(fs.readFileSync(corruptBackups(k)[0]), bytes)
})
await test('malformed fields are repaired while valid object metadata is preserved', () => {
  const k = fixture(), previous = { baseUrl: 'https://outside.invalid', token: 123, intervalMs: 1234, installedAt: 987, extra: { keep: true } }
  fs.writeFileSync(k.config, JSON.stringify(previous))
  assert.equal(kernelStatus({ nonameDir: k.root, token: currentToken }).bridgeConfig, 'invalid')
  assert.equal(bind(k).ok, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(k.config, 'utf8')), { ...previous, baseUrl, token: currentToken })
  assert.equal(kernelStatus({ nonameDir: k.root, token: currentToken }).bridgeConfig, 'ok')
})
for (const bad of ['{invalid', '[]']) await test('failed atomic publication retains corrupt original and its durable backup: ' + bad, () => {
  const k = fixture(), bytes = Buffer.from(bad); fs.writeFileSync(k.config, bytes)
  assert.equal(faultBinder('rename')({ root: k.root, baseUrl, token: currentToken }).ok, false)
  assert.deepEqual(fs.readFileSync(k.config), bytes)
  const backups = corruptBackups(k); assert.equal(backups.length, 1); assert.deepEqual(fs.readFileSync(backups[0]), bytes)
  assert.deepEqual(fs.readdirSync(path.join(k.root, 'nnk-kernel-install')), [path.basename(backups[0])])
})
await test('backup failure stops repair before replacing the original corrupt file', () => {
  const k = fixture(), bytes = Buffer.from('{invalid'); fs.writeFileSync(k.config, bytes)
  assert.equal(faultBinder('backup')({ root: k.root, baseUrl, token: currentToken }).ok, false)
  assert.deepEqual(fs.readFileSync(k.config), bytes)
})
await test('separate repairs retain distinct backups and idempotent binding creates none', () => {
  const k = fixture()
  for (const bad of ['{first', '{second']) { fs.writeFileSync(k.config, bad); assert.equal(bind(k).ok, true) }
  const backups = corruptBackups(k); assert.equal(backups.length, 2)
  assert.deepEqual(backups.map(file => fs.readFileSync(file, 'utf8')).sort(), ['{first', '{second'])
  assert.equal(bind(k).bridgeBinding.changed, false); assert.equal(corruptBackups(k).length, 2)
})
for (const [name, value] of [
  ['missing address', { token: currentToken }], ['missing token', { baseUrl }],
  ['empty address', { baseUrl: '', token: currentToken }], ['non-string address', { baseUrl: 123, token: currentToken }],
  ['external address', { baseUrl: 'http://outside.invalid/noname-kit-api', token: currentToken }],
  ['address containing credentials', { baseUrl: 'http://' + currentToken + '@127.0.0.1:34567/noname-kit-api', token: currentToken }],
  ['invalid port', { baseUrl: 'http://localhost:65536/noname-kit-api', token: currentToken }],
  ['wrong path', { baseUrl: 'http://localhost:34567/unrelated', token: currentToken }],
  ['empty token', { baseUrl, token: '' }], ['non-string token', { baseUrl, token: 123 }], ['whitespace token', { baseUrl, token: ' ' }],
  ['null object', null], ['array object', []]
]) await test('kernel status reports invalid bridge fields without leaking credentials: ' + name, () => {
  const k = fixture(); fs.writeFileSync(k.config, JSON.stringify(value))
  const before = fs.readFileSync(k.config), status = kernelStatus({ nonameDir: k.root, token: currentToken })
  assert.equal(status.bridgeConfig, 'invalid'); assert.equal(status.boundApi, null); assert.equal(status.tokenMatches, null)
  assert.equal(JSON.stringify(status).includes(currentToken), false)
  assert.deepEqual(fs.readFileSync(k.config), before)
})
await test('valid bridge fields expose only destination and token equality while missing and malformed JSON remain missing', () => {
  const k = fixture()
  for (const address of [baseUrl, 'http://localhost/noname-kit-api', 'http://[::1]:65535/noname-kit-api/']) {
    fs.writeFileSync(k.config, JSON.stringify({ baseUrl: address, token: currentToken }))
    const status = kernelStatus({ nonameDir: k.root, token: currentToken })
    assert.equal(status.bridgeConfig, 'ok'); assert.equal(status.boundApi, address); assert.equal(status.tokenMatches, true)
    assert.equal(JSON.stringify(status).includes(currentToken), false)
    assert.equal(kernelStatus({ nonameDir: k.root, token: 'other-fixture-token' }).tokenMatches, false)
  }
  fs.writeFileSync(k.config, '{invalid')
  assert.equal(kernelStatus({ nonameDir: k.root, token: currentToken }).bridgeConfig, 'missing')
  fs.unlinkSync(k.config)
  assert.equal(kernelStatus({ nonameDir: k.root, token: currentToken }).bridgeConfig, 'missing')
})
for (const fault of ['write', 'rename']) await test('atomic ' + fault + ' failure leaves original binding and kernel intact', () => {
  const k = fixture(), bytes = fs.readFileSync(k.config), stamp = fs.readFileSync(k.manifest)
  assert.equal(faultBinder(fault)({ root: k.root, baseUrl, token: currentToken }).ok, false)
  assert.deepEqual(fs.readFileSync(k.config), bytes); assert.deepEqual(fs.readFileSync(k.manifest), stamp)
  assert.deepEqual(fs.readdirSync(path.join(k.root, 'nnk-kernel-install')), [])
})

for (const host of ['127.0.0.1:34567', 'localhost:34567', '[::1]:34567', '127.0.0.1', 'localhost', '[::1]']) await test('verified local Host resolves actual port: ' + host, () => {
  assert.equal(bridgeBaseUrl({ hostHeader: host, localPort: 34567, serverPort: 12345 }), baseUrl)
})
for (const host of ['', 'evil.invalid:34567', '127.0.0.1:0', 'localhost:65536', '127.0.0.1:999999', 'localhost:abc', 'localhost:34567@evil.invalid', 'localhost:34567 ', '::1:34567', '127.0.0.1:34568']) await test('unsafe or mismatched Host is rejected: ' + JSON.stringify(host), () => {
  assert.throws(() => bridgeBaseUrl({ hostHeader: host, localPort: 34567 }))
})
await test('valid port boundaries and fallback listener remain bounded', () => {
  for (const port of [1, 65535]) assert.equal(bridgeBaseUrl({ hostHeader: 'localhost:' + port, localPort: port }), `http://127.0.0.1:${port}/noname-kit-api`)
  assert.equal(bridgeBaseUrl({ hostHeader: 'localhost', serverPort: 34567 }), baseUrl)
  for (const port of [0, 65536, -1, 1.5, 'bad']) assert.throws(() => bridgeBaseUrl({ hostHeader: 'localhost', localPort: port }))
  assert.throws(() => bridgeBaseUrl({ hostHeader: 'localhost' }))
})

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const handlerBody = index.slice(index.indexOf('handler: async (req, res) => {') + 'handler: '.length, index.lastIndexOf('\n  }))')).trim()
function actualHandler(k, { webCtx = { webServer: { port: 34567 } }, onBind = () => {}, onInstall = () => {} } = {}) {
  return runInNewContext('(' + handlerBody + ')', {
    URL, Buffer, Date, console, active: true, nonameDir: k.root, bridgeToken: currentToken, bridgeBaseUrl, webCtx,
    bindKernelBridge: args => { onBind(); return bindKernelBridge(args) },
    installKernel: () => { onInstall(); return { ok: true, target: 'isolated-installation-stub' } },
    bridge: { snapshot: () => ({}), poll: () => ({ commands: [] }) },
    kernelStatus: () => ({ state: 'ok' }), kernelRuntimeStatus: () => 'offline', bundledKernelVersion: () => 'fixture',
    batchStatus: () => ({ status: 'none' }), readSettingsFile: () => ({})
  })
}
async function request(k, { method = 'POST', url = '/noname-kit-api/online/bridge/bind', host = '127.0.0.1:34567', localPort = 34567, remote = '127.0.0.1', origin = 'http://127.0.0.1:34567', ctype = 'application/json', body = '{}' } = {}) {
  let status, value, calls = 0, installations = 0
  const handler = actualHandler(k, { onBind: () => { calls++ }, onInstall: () => { installations++ } })
  await handler({ url, method, headers: { host, ...(origin === null ? {} : { origin }), ...(ctype === null ? {} : { 'content-type': ctype }) }, socket: { remoteAddress: remote, localPort }, async *[Symbol.asyncIterator]() { yield Buffer.from(body) } }, { writeHead: s => { status = s }, end: data => { value = JSON.parse(data) } })
  return { status, value, calls, installations }
}
await test('actual HTTP bind uses server port and token, ignoring supplied destinations and credentials', async () => {
  const k = fixture(), result = await request(k, { body: JSON.stringify({ baseUrl: 'https://evil.invalid', token: 'attacker' }) })
  assert.equal(result.status, 200); assert.equal(result.calls, 1); assert.equal(result.installations, 0)
  assert.deepEqual(result.value, { ok: true, bridgeBinding: { baseUrl, changed: true } })
  assert.equal(JSON.parse(fs.readFileSync(k.config, 'utf8')).token, currentToken)
})
await test('GET leaves corrupt configuration untouched; only explicit POST backs it up and repairs it', async () => {
  const k = fixture(), bytes = Buffer.from('{invalid'); fs.writeFileSync(k.config, bytes)
  assert.equal((await request(k, { method: 'GET', url: '/noname-kit-api/online/status' })).status, 200)
  assert.deepEqual(fs.readFileSync(k.config), bytes); assert.equal(fs.existsSync(path.join(k.root, 'nnk-kernel-install')), false)
  const result = await request(k)
  assert.equal(result.status, 200); assert.equal(result.value.bridgeBinding.recovered, true)
  assert.deepEqual(fs.readFileSync(corruptBackups(k)[0]), bytes)
  assert.equal(JSON.stringify(result.value).includes(currentToken), false)
})
for (const [name, options, expected] of [
  ['remote peer', { remote: '192.0.2.20' }, 403], ['missing peer', { remote: '' }, 403],
  ['cross origin', { origin: 'https://evil.invalid' }, 403], ['wrong loopback origin port', { origin: 'http://127.0.0.1:30000' }, 403],
  ['spoofed Host', { host: '127.0.0.1:30000', origin: null }, 400],
  ['zero port', { host: '127.0.0.1:0', origin: null }, 400], ['oversized port', { host: '127.0.0.1:65536', origin: null }, 400],
  ['missing content type', { ctype: null }, 415], ['form content type', { ctype: 'application/x-www-form-urlencoded' }, 415],
  ['JSON lookalike content type', { ctype: 'application/jsonp' }, 415], ['malformed JSON', { body: '{bad' }, 400],
  ['oversized body', { body: 'x'.repeat(1_048_577) }, 413],
  ['GET binding', { method: 'GET' }, 404], ['GET status', { method: 'GET', url: '/noname-kit-api/online/status' }, 200]
]) await test('actual handler refuses implicit or untrusted binding: ' + name, async () => {
  const k = fixture(), before = fs.readFileSync(k.config), result = await request(k, options)
  assert.equal(result.status, expected); assert.equal(result.calls, 0); assert.equal(result.installations, 0)
  assert.deepEqual(fs.readFileSync(k.config), before)
})
await test('ordinary bridge authentication still refuses a wrong token', async () => {
  const result = await request(fixture(), { url: '/noname-kit-api/online/bridge', origin: 'http://127.0.0.1:8089', body: '{"token":"incorrect"}' })
  assert.equal(result.status, 403); assert.equal(result.calls, 0)
})
await test('installation uses the same verified destination without invoking binding', async () => {
  const result = await request(fixture(), { url: '/noname-kit-api/online/kernel/install' })
  assert.equal(result.status, 200); assert.equal(result.calls, 0); assert.equal(result.installations, 1)
})
await test('real loopback HTTP socket binds its actual ephemeral port and rejects a forged Host port', async () => {
  const k = fixture(), webCtx = { webServer: { port: 0 } }
  const handler = actualHandler(k, { webCtx })
  const server = createServer((req, res) => { handler(req, res).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })) }) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port; webCtx.webServer.port = port
  const send = headers => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, method: 'POST', path: '/noname-kit-api/online/bridge/bind', headers: { 'content-type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', data => chunks.push(data)); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject); req.end('{}')
  })
  try {
    const result = await send({ origin: `http://127.0.0.1:${port}` })
    assert.equal(result.status, 200)
    assert.deepEqual(result.value.bridgeBinding, { baseUrl: `http://127.0.0.1:${port}/noname-kit-api`, changed: true })
    const saved = fs.readFileSync(k.config)
    assert.equal((await send({ host: '127.0.0.1:' + (port === 65535 ? port - 1 : port + 1) })).status, 400)
    assert.deepEqual(fs.readFileSync(k.config), saved)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
const report = { at: new Date().toISOString(), passed, failed, kind: 'production-binding-files-and-actual-http-handler', realFiles: true, realNetwork: true, realNetworkScope: 'one isolated loopback HTTP server; no game or P2P', formalInstallChanged: false, fixtureRoot: home, tests: results }
fs.writeFileSync(testPaths.outputPath('bridge-binding-results.json'), JSON.stringify(report, null, 2))
if (!failed) fs.rmSync(testPaths.assertTestPath(home), { recursive: true })
else process.exitCode = 1
console.log(JSON.stringify({ passed, failed, report: testPaths.outputPath('bridge-binding-results.json'), ...(failed ? { retainedFixtures: home } : {}) }))

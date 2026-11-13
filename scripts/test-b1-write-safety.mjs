#!/usr/bin/env node
// Temp-only write tests and actual registered-entry sandbox; no real game/shell writes.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { checkFidelity, assembleBlocks } from '../src/blocks.js'
import { writeExtension } from '../src/write.js'
import * as guardModule from '../src/guard.js'
import { readWorkingDirectory } from '../presets/noname-dev/working-directory.mjs'
let count = 0
async function test(label, fn) { await fn(); count++; console.log('  ✓ ' + label) }
const dir = await mkdtemp(join(tmpdir(), 'nnk-b1-'))
const old = `import { lib } from '../../noname.js';
const helper = 7; // keep whitespace${'  '}
export default function () {
  return { name: '测试包', precontent: function () { window.keep = helper; },
    skill: {
      cs_a: { content: function () { player.draw(1); } },
      cs_b: { content: function () { player.draw(2); } },
    },
    translate: { cs_a: '甲', cs_b: '乙', cs_a_info: '甲描述', cs_b_info: '乙描述' },
  };
}
`
const mod = 'export const helper = 7;\r\n// untouched  \r\n'
const target = join(dir, 'extension', '测试包', 'extension.js')
const args = { folder: '测试包', style: 'module', kind: 'character', writeMode: 'auto' }
try {
  await mkdir(join(dir, 'extension'), { recursive: true })
  await test('first write needs no editScope', async () => assert.equal((await writeExtension(dir, { ...args, code: old })).wrote, true))
  for (const mode of ['auto', 'manual']) {
    for (const scope of [undefined, null, 'cs_a']) await test(`${mode}: missing/invalid scope rejects before overwrite`, async () => {
      const r = await writeExtension(dir, { ...args, code: old.replace('draw(1)', 'draw(9)'), editScope: scope, writeMode: mode })
      assert.equal(r.ok, false); assert.equal(r.wrote, false); assert.match(r.errors[0].message, /editScope/)
      assert.equal(await readFile(target, 'utf8'), old)
    })
  }
  await test('rejection makes no overwrite backup', async () => assert.equal((await readdir(join(dir, 'extension', '测试包'))).includes('backup'), false))
  for (const [label, replacement] of [
    ['imports', old.replace('{ lib }', '{ game }')],
    ['precontent', old.replace('window.keep = helper', 'window.keep = 0')],
    ['scaffolding', old.replace('helper = 7', 'helper = 8')],
    ['comment', old.replace('keep whitespace', 'changed comment')],
    ['line endings', old.replace(/\n/g, '\r\n')],
    ['trailing whitespace', old.replace('whitespace  \n', 'whitespace\n')],
    ['other skill', old.replace('draw(2)', 'draw(99)')],
    ['interleaved translation', old.replace("cs_b: '乙'", "cs_b: '改'")],
    ['added entry', old.replace("cs_b: '乙'", "cs_c: '丙', cs_b: '乙'")],
  ]) await test(`full entry rejects unsubmitted ${label}`, async () => {
    const r = await writeExtension(dir, { ...args, code: replacement, editScope: ['cs_a'] })
    assert.equal(r.ok, false); assert.equal(r.wrote, false); assert.equal(await readFile(target, 'utf8'), old)
  })
  await test('scope admits only requested skill', async () => {
    const r = await writeExtension(dir, { ...args, code: old.replace('draw(1)', 'draw(3)'), editScope: ['skill:cs_a'] })
    assert.equal(r.wrote, true); assert.equal(await readFile(join(dir, r.backup), 'utf8'), old)
  })
  await test('scoped translation pair leaves interleaved translation untouched', () => {
    assert.equal(checkFidelity(old, old.replace("'甲'", "'甲改'").replace("'甲描述'", "'描述改'"), ['translate:cs_a']).ok, true)
    assert.equal(checkFidelity(old, old.replace("'乙'", "'乙改'"), ['translate:cs_a']).ok, false)
  })
  await test('unknown and wildcard scopes do not expand authority', () => {
    for (const scope of [['*'], ['file'], ['skill:missing']]) assert.equal(checkFidelity(old, old, scope).ok, false)
  })
  await test('duplicate-ID regions cannot acquire scope', () => {
    const duplicate = old.replace('cs_b: {', 'cs_a: {')
    assert.equal(checkFidelity(duplicate, duplicate.replace('draw(2)', 'draw(9)'), ['cs_a']).ok, false)
  })
  await test('every prefix character remains protected', () => {
    const limit = old.indexOf('cs_a: {')
    for (let i = 0; i < limit; i++) assert.equal(checkFidelity(old, old.slice(0, i) + 'X' + old.slice(i + 1), ['cs_a']).ok, false)
  })
  await test('regex and interpolated templates refuse inferred intervals', () => {
    for (const text of [old.replace('player.draw(1)', 'player.draw(/}/.test("}"))'), old.replace('player.draw(1)', 'player.draw(`${1}`)')]) {
      assert.equal(checkFidelity(text, text.replace('draw(', 'gain('), ['cs_a']).ok, false)
      assert.equal(checkFidelity(text, text, []).ok, true)
    }
  })
  await test('module scaffold edits preserve exact surrounding bytes without anchors', async () => {
    await writeExtension(dir, { ...args, file: 'helper.js', code: mod })
    const r = await writeExtension(dir, { ...args, file: 'helper.js', edits: [{ find: 'helper = 7', replace: 'helper = 8' }] })
    assert.equal(r.wrote, true); assert.deepEqual(await readFile(join(dir, r.path)), Buffer.from(mod.replace('helper = 7', 'helper = 8')))
  })
  await test('unindexed module full overwrite cannot change scaffolding', async () => {
    const r = await writeExtension(dir, { ...args, file: 'helper.js', code: mod.replace('7', '9'), editScope: [] })
    assert.equal(r.ok, false)
  })
  await test('invalid UTF-8 refuses lossy round trip', async () => {
    const bad = Buffer.from([0xff, 0x0a]); const file = join(dir, 'extension', '测试包', 'bad.js')
    await writeFile(file, bad)
    const r = await writeExtension(dir, { ...args, file: 'bad.js', code: mod, editScope: [] })
    assert.equal(r.ok, false); assert.deepEqual(await readFile(file), bad)
  })
  await test('empty existing file still requires explicit scope', async () => {
    await writeFile(join(dir, 'extension', '测试包', 'empty.js'), '')
    assert.equal((await writeExtension(dir, { ...args, file: 'empty.js', code: mod })).ok, false)
  })
  await test('empty find fails without looping', () => assert.ok(assembleBlocks(mod, [], [{ find: '', replace: 'x' }]).errors.length))
  await test('overlapping sequential edits return original on failure', () => {
    const r = assembleBlocks(mod, [], [{ find: 'helper', replace: 'renamed' }, { find: 'helper', replace: 'again' }])
    assert.ok(r.errors.length); assert.equal(r.code, mod)
  })
  await test('sequential unique edits apply to assembled current text', () => assert.equal(assembleBlocks(mod, [], [{ find: 'helper', replace: 'renamed' }, { find: 'renamed', replace: 'final' }]).code, mod.replace('helper', 'final')))
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  let tool
  const begin = index.lastIndexOf('ctx.tools.register(defineTool({', index.indexOf("name: 'noname_write_extension'"))
  runInNewContext(index.slice(begin, index.indexOf("  ctx.tools.register(defineTool({\n    name: 'noname_copy_images'", begin)), {
    ctx: { tools: { register(t) { tool = t } } }, defineTool: (t) => t, active: true, nonameDir: dir, dshHomeDir: dir,
    writeExtension, recordBackup: async () => {}, getTask: async () => ({ writeMode: 'auto' }),
  })
  await test('real registered tool entry cannot bypass scope using task/manual override', async () => {
    const r = await tool.execute({ ...args, code: old, taskId: 'task', writeMode: 'manual' })
    assert.equal(r.ok, false); assert.equal(r.wrote, false); assert.match(r.errors[0].message, /editScope/)
  })
  let guard
  const guardBegin = index.indexOf('ctx.tools.guard((exec)')
  runInNewContext(index.match(/const GUARDED_TOOLS =[^\n]+/)[0] + '\n' + index.slice(index.indexOf('function pathArgOf'), index.indexOf('/** /detect')) + '\n' + index.slice(guardBegin, index.indexOf("ctx.inject(['webServer']", guardBegin)), {
    ctx: { tools: { guard(fn) { guard = fn } } }, active: true, nonameDir: 'D:/audit-game', process, resolve,
    extRootOf: (d) => join(d, 'extension'), readWorkingDirectory, ...guardModule,
  })
  for (const cmd of [
    'Microsoft.PowerShell.Management\\Set-Content FileSystem::D:/audit-game/extension/包/x.js x',
    '& "Set-Content" D:/audit-game/extension/包/x.js x',
    '[IO.StreamWriter]::new("D:/audit-game/extension/包/x.js")',
    'New-Object -TypeName System.IO.StreamWriter D:/audit-game/extension/包/x.js',
    'Set-Content Microsoft.PowerShell.Core\\FileSystem::D:/audit-game/extension/包/x.js x',
    "Set-Content 'D:/audit-game/extension/包/.. /x.js' x",
  ]) await test('registered pwsh guard rejects alias: ' + cmd, () => assert.ok(guard({ name: 'pwsh', arguments: { command: cmd } })))
  await test('quoted direct-tool paths resolve before relative lookup', () => assert.ok(guard({ name: 'write', arguments: { file_path: "'D:/audit-game/extension/包/x.js'" } })))
  await test('ordinary read still allowed', () => assert.equal(guard({ name: 'pwsh', arguments: { command: 'Get-Content FileSystem::D:/audit-game/extension/包/x.js' } }), undefined))
  console.log(`全部通过:${count} 项`)
} finally { await rm(dir, { recursive: true, force: true }) }

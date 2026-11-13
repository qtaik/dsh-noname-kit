#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { validateFileCode } from '../src/validate.js'
import { safeEntryFilePath, writeExtension } from '../src/write.js'

let passed = 0
async function test(label, fn) { await fn(); passed++; console.log('  ✓ ' + label) }
const folder = '校验测试'
const moduleCode = 'export const skills = { cs_a: { value: 1 } };\r\n'
const entryCode = `game.import('extension', function () { return { name: '${folder}', content: function () {}, package: { skill: { skill: {}, translate: {} } } }; });`
const entryOptions = { code: entryCode, folder, style: 'classic' }

await test('default path keeps full entry validation', () => {
  assert.equal(validateFileCode(entryOptions).ok, true)
  assert.equal(validateFileCode({ code: moduleCode }).ok, false)
})
for (const file of ['extension.js', './extension.js', './/extension.js', '.\\extension.js', ...(process.platform === 'win32' ? ['./EXTENSION.JS'] : [])]) {
  await test('entry alias cannot downgrade name checks: ' + file, () => {
    const result = validateFileCode({ code: moduleCode, file })
    assert.equal(result.fileType, 'entry'); assert.equal(result.ok, false)
    assert.ok(result.errors.some(item => /name/.test(item.message)))
  })
}
for (const file of ['skill.js', 'character/character.js', 'modules\\skill.js', 'modules/extension.js']) {
  await test('module needs syntax, not extension metadata: ' + file, () => {
    const result = validateFileCode({ code: moduleCode, file, style: 'classic', folder })
    assert.equal(result.ok, true); assert.equal(result.style, 'module'); assert.deepEqual(result.errors, [])
  })
}
await test('module syntax errors remain blocking', () => assert.equal(validateFileCode({ file: 'skill.js', code: 'export const x = {' }).ok, false))
await test('requested classic style cannot relax a module into sloppy script', () => assert.equal(validateFileCode({ file: 'skill.js', style: 'classic', code: 'with ({}) {}' }).ok, false))
await test('validation never runs submitted code', () => assert.equal(validateFileCode({ file: 'skill.js', code: 'throw new Error("must not execute");' }).ok, true))
for (const file of ['../extension.js', 'a/../extension.js', '/extension.js', 'D:/extension.js', 'x.js:extension.js', 'a\u0000.js', 'file.txt', 12]) {
  await test('invalid validation path rejects: ' + JSON.stringify(file), () => assert.equal(validateFileCode({ ...entryOptions, file }).ok, false))
}
await test('JSON uses JSON grammar', () => {
  const result = validateFileCode({ file: 'info.json', code: '{"name":"校验测试"}' })
  assert.equal(result.ok, true); assert.equal(result.style, 'json'); assert.equal(result.fileType, 'json')
  for (const code of ['{name:"x"}', '{"name":"x",}', '', 'export default {}']) assert.equal(validateFileCode({ file: 'info.json', code }).ok, false)
})
await test('non-string content is rejected for every file type', () => {
  for (const file of ['extension.js', 'skill.js', 'info.json']) assert.equal(validateFileCode({ file, code: {} }).ok, false)
})

const tempBase = resolve(tmpdir())
const game = await mkdtemp(join(tempBase, 'nnk-file-validation-'))
assert.ok(resolve(game).startsWith(tempBase + sep))
const packagePath = join(game, 'extension', folder)
try {
  await mkdir(join(game, 'extension'))
  await test('invalid new entry creates no package directory', async () => {
    const result = await writeExtension(game, { folder, code: moduleCode })
    assert.equal(result.wrote, false); assert.equal(existsSync(packagePath), false)
  })
  await test('manual new module returns full original bytes without creating directories', async () => {
    const result = await writeExtension(game, { folder, file: 'modules/skill.js', code: moduleCode, writeMode: 'manual', infoJson: '{"name":"校验测试"}' })
    assert.equal(result.ok, true); assert.equal(result.wrote, false); assert.equal(result.code, moduleCode)
    assert.equal(existsSync(packagePath), false)
  })
  await test('invalid metadata rejects before a first source write', async () => {
    const result = await writeExtension(game, { folder, code: entryCode, infoJson: '{bad}' })
    assert.equal(result.ok, false); assert.equal(result.wrote, false); assert.match(result.errors[0].message, /info.json/)
    assert.equal(existsSync(packagePath), false)
  })
  await test('file-aware module preflight and writer agree', async () => {
    const result = await writeExtension(game, { folder, file: 'modules/skill.js', code: moduleCode, style: 'classic' })
    assert.equal(result.ok, validateFileCode({ file: 'modules/skill.js', code: moduleCode }).ok)
    assert.equal(result.wrote, true); assert.deepEqual(await readFile(join(packagePath, 'modules/skill.js')), Buffer.from(moduleCode))
  })
  await test('file-aware entry aliases and writer agree', async () => {
    const result = await writeExtension(game, { folder, file: './/extension.js', code: moduleCode })
    assert.equal(result.ok, false); assert.equal(result.wrote, false)
    assert.equal(existsSync(join(packagePath, 'extension.js')), false)
    assert.equal(safeEntryFilePath(game, folder, './extension.js').rel, 'extension.js')
  })
  await test('JSON validation does not expand allowed write targets', async () => {
    await assert.rejects(writeExtension(game, { folder, file: 'info.json', code: '{}' }), /相对 .js/)
  })
  await test('initial entry and metadata write succeeds', async () => {
    const result = await writeExtension(game, { folder, code: entryCode, infoJson: '{"name":"校验测试","version":"1"}' })
    assert.equal(result.ok, true); assert.equal(result.wrote, true); assert.equal(result.infoWritten, true)
  })
  const beforeEntry = await readFile(join(packagePath, 'extension.js'))
  const beforeInfo = await readFile(join(packagePath, 'info.json'))
  const edit = [{ find: 'content: function () {}', replace: 'content: function () { return 1; }' }]
  await test('invalid metadata leaves existing source, info and backup state untouched', async () => {
    const result = await writeExtension(game, { folder, edits: edit, infoJson: '{"broken":}' })
    assert.equal(result.ok, false); assert.equal(result.wrote, false)
    assert.deepEqual(await readFile(join(packagePath, 'extension.js')), beforeEntry)
    assert.deepEqual(await readFile(join(packagePath, 'info.json')), beforeInfo)
    assert.equal(existsSync(join(packagePath, 'backup')), false)
  })
  await test('manual existing edit leaves source and metadata untouched', async () => {
    const result = await writeExtension(game, { folder, edits: edit, writeMode: 'manual', infoJson: '{"name":"manual"}' })
    assert.equal(result.ok, true); assert.equal(result.wrote, false); assert.match(result.code, /return 1/)
    assert.deepEqual(await readFile(join(packagePath, 'extension.js')), beforeEntry)
    assert.deepEqual(await readFile(join(packagePath, 'info.json')), beforeInfo)
    assert.equal(existsSync(join(packagePath, 'backup')), false)
  })
  await test('successful edit still backs up exact old bytes and preserves other files', async () => {
    const result = await writeExtension(game, { folder, edits: edit })
    assert.equal(result.wrote, true)
    assert.deepEqual(await readFile(join(game, result.backup)), beforeEntry)
    assert.deepEqual(await readFile(join(packagePath, 'modules/skill.js')), Buffer.from(moduleCode))
    assert.deepEqual(await readFile(join(packagePath, 'info.json')), beforeInfo)
    assert.equal((await readdir(packagePath)).some(name => name.includes('.nnk-tmp-')), false)
  })
  console.log(`全部通过:${passed} 项`)
} finally { await rm(game, { recursive: true, force: true }) }

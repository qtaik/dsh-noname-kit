#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import testPaths from './fixtures/test-paths.cjs'

const { inspectMechanics, listMechanics } = await import(testPaths.sourceUrl('src/mechanics.js'))
const fixture = testPaths.assertTestPath(await mkdtemp(testPaths.tempPrefix('mechanics-')))
const game = join(fixture, 'game')
let passed = 0, failed = 0

async function check(name, run) {
  try {
    await run()
    passed++
    console.log(`✓ ${name}`)
  } catch (error) {
    failed++
    console.error(`✗ ${name}\n${error.stack || error}`)
  }
}

async function put(folder, file, code) {
  const path = testPaths.assertTestPath(join(game, 'extension', folder, file))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, code)
  return path
}

function sharedRule(id) {
  return `const nnkMechanic_${id} = { id: '${id}', name: '共用规则', kind: 'shared-rule', description: '规则说明', async resolve(context, options) {} }`
}

await check('读取现代模块的静态定义和原文件位置，无需求值', () => {
  const code = [
    'throw new Error("读取定义时不能执行扩展代码")',
    'export const nnkMechanic_momentum = {',
    '  id: "momentum", name: `乘势`, kind: "skill-type", description: "满足分支后触发",',
    '  createSkill(skill, options) { return skill }',
    '}',
  ].join('\r\n')
  assert.deepEqual(inspectMechanics(code, { file: 'rules/momentum.js' }), {
    ok: true,
    mechanics: [{ id: 'momentum', name: '乘势', kind: 'skill-type', description: '满足分支后触发', file: 'rules/momentum.js', line: 2 }],
  })
})

await check('经典扩展工厂可定义共用规则和全局规则', () => {
  const code = [
    'game.import("extension", function (lib, game) {',
    `  ${sharedRule('shared')}`,
    '  const nnkMechanic_global = { id: "global", name: "回合规则", kind: "global-rule", description: "回合检查", "install": () => null }',
    '  return { name: "经典包" }',
    '})',
  ].join('\n')
  const result = inspectMechanics(code)
  assert.equal(result.ok, true)
  assert.deepEqual(result.mechanics.map(({ id, file, line }) => ({ id, file, line })), [
    { id: 'shared', file: 'extension.js', line: 2 },
    { id: 'global', file: 'extension.js', line: 3 },
  ])
})

await check('忽略旧包、注释、字符串和普通对象的同形文本', () => {
  const code = `// ${sharedRule('comment')}\nconst example = ${JSON.stringify(sharedRule('example'))}\nconst unrelated = { nnkMechanic_demo: null }\ngame.import('extension', () => ({ name: '旧包' }))`
  assert.deepEqual(inspectMechanics(code), { ok: true, mechanics: [] })
})

await check('非法 ID、动态元数据、缺少方法、访问器和非 const 定义会提示', () => {
  const code = [
    sharedRule('Mismatch'),
    sharedRule('suffix').replace("id: 'suffix'", "id: 'other'"),
    sharedRule('dynamic').replace("'共用规则'", 'get.translation("规则")'),
    sharedRule('empty').replace("'规则说明'", "' '"),
    sharedRule('wrong_kind').replace("'shared-rule'", "'wrong'"),
    sharedRule('wrong_method').replace('resolve(', 'install('),
    sharedRule('accessor').replace('async resolve(context, options) {}', 'get resolve() { return () => {} }'),
    sharedRule('mutable').replace('const', 'let'),
    sharedRule('ok'),
  ].join('\n')
  const result = inspectMechanics(code)
  assert.equal(result.ok, false)
  assert.deepEqual(result.mechanics.map(({ id }) => id), ['ok'])
  assert.equal(result.warnings.length, 8)
  assert.match(result.warnings.join('\n'), /与变量名一致/)
  assert.match(result.warnings.join('\n'), /resolve 函数定义/)
})

await check('拒绝可能覆盖机制元数据的展开和重复键', () => {
  const code = [
    sharedRule('spread').replace(' = {', ' = { ...metadata,'),
    sharedRule('same_key').replace('description:', 'name: "覆盖", description:'),
  ].join('\n')
  const result = inspectMechanics(code)
  assert.equal(result.ok, false)
  assert.deepEqual(result.mechanics, [])
  assert.equal(result.warnings.length, 2)
})

await check('同文件的重复 ID 不列为可用定义', () => {
  const code = `${sharedRule('duplicate')}\nfunction otherScope() {\n  ${sharedRule('duplicate')}\n}`
  const result = inspectMechanics(code, { file: 'a.js' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.mechanics, [])
  assert.match(result.warnings[0], /duplicate.*重复定义.*a\.js:1.*a\.js:3/)
})

await check('单文件语法失败返回明确结果', () => {
  const result = inspectMechanics('const nnkMechanic_incomplete = {', { file: 'broken.js' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.mechanics, [])
  assert.match(result.error, /broken\.js.*无法静态解析/)
})

await check('跨文件查找并忽略历史备份，重复 ID 和扫描缺口都有提示', async () => {
  const source = 'throw new Error("不能执行包内文件")\n' + sharedRule('unique')
  const sourcePath = await put('Mixed', 'rules/unique.js', source)
  await put('Mixed', 'extension.js', sharedRule('overlap'))
  await put('Mixed', 'rules/duplicate.js', sharedRule('overlap').replace('resolve(', 'install('))
  await put('Mixed', 'rules/broken.js', 'const notParsable = {')
  await put('Mixed', 'backup/past.js', sharedRule('unique'))
  const result = await listMechanics(game, 'Mixed')
  assert.equal(result.ok, true)
  assert.deepEqual(result.mechanics.map(({ id, file, line }) => ({ id, file, line })), [{ id: 'unique', file: 'rules/unique.js', line: 2 }])
  assert.deepEqual(result.unavailableIds, ['overlap'])
  const warnings = result.warnings.join('\n')
  assert.match(warnings, /overlap.*重复定义.*extension\.js:1.*rules\/duplicate\.js:1/)
  assert.match(warnings, /扫描不完整.*rules\/broken\.js/)
  assert.equal(await readFile(sourcePath, 'utf8'), source)
})

await check('拒绝目录越界和不存在的扩展包', async () => {
  const outside = await listMechanics(game, '../Mixed')
  assert.equal(outside.ok, false)
  assert.match(outside.error, /非法/)
  const missing = await listMechanics(game, 'Missing')
  assert.equal(missing.ok, false)
  assert.match(missing.error, /无法读取扩展包/)
})

const outside = join(game, 'extension', 'Outside')
const linkType = process.platform === 'win32' ? 'junction' : 'dir'
await put('Outside', 'extension.js', sharedRule('outside'))
try {
  await symlink(outside, join(game, 'extension', 'Linked'), linkType)
  await symlink(outside, join(game, 'extension', 'Mixed', 'linked'), linkType)
  await check('包目录和包内文件夹均不会沿目录链接读取', async () => {
    const root = await listMechanics(game, 'Linked')
    assert.equal(root.ok, false)
    assert.match(root.error, /目录链接/)
    const nested = await listMechanics(game, 'Mixed')
    assert.deepEqual(nested.mechanics.map(({ id }) => id), ['unique'])
    assert.match(nested.warnings.join('\n'), /linked.*未跟随/)
  })
} catch (error) {
  if (!['EACCES', 'EPERM', 'ENOSYS'].includes(error.code)) throw error
  console.log(`跳过目录链接检查 (${error.code})`)
}

if (failed) {
  console.error(`${failed} 项失败，${passed} 项通过`)
  process.exitCode = 1
} else {
  console.log(`全部通过: ${passed} 项`)
}

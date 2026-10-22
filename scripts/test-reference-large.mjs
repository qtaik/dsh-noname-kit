#!/usr/bin/env node
/** Exercise the public search tool boundary and large-source pagination on disposable files. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'
import testPaths from './fixtures/test-paths.cjs'
import { searchReference } from '../src/reference.js'

const home = testPaths.assertTestPath(await mkdtemp(testPaths.tempPrefix('reference-large-')))
let passed = 0
function check(value, message) { assert.ok(value, message); passed++; console.log('  ✓ ' + message) }
async function game(name, contents) {
  const root = join(home, name)
  for (const [file, text] of Object.entries(contents)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}
const index = (await readFile(new URL('../index.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
const start = index.lastIndexOf('ctx.tools.register(defineTool({', index.indexOf("name: 'noname_search_reference'"))
const end = index.indexOf('  ctx.tools.register(defineTool({', start + 1)
function capture(root) {
  let tool
  runInNewContext(index.slice(start, end), { ctx: { tools: { register(value) { tool = value } } }, defineTool: x => x, searchReference, nonameDir: root })
  return tool
}
function declared(value, spec) {
  if (spec.type === 'object') {
    for (const key of Object.keys(value)) assert.ok(spec.properties?.[key] || spec.additionalProperties !== false, 'undeclared output field: ' + key)
    for (const [key, child] of Object.entries(spec.properties || {})) {
      if (child.required) assert.ok(Object.hasOwn(value, key), 'missing output field: ' + key)
      if (Object.hasOwn(value, key)) declared(value[key], child)
    }
  } else if (spec.type === 'array') for (const item of value) declared(item, spec.items)
}

try {
  const translated = await game('translations', { 'extension/Example/extension.js': `/*${'x'.repeat(950000)}*/\nconst translate={ fixture_name:'大包技能', fixture_name_info:'回合开始摸两张牌', fixture_extra:'大包技能改', fixture_extra_info:'回合开始摸两张牌'};\nconst skill={fixture_name:{content(){return 'REAL_DEFINITION'}}};` })
  const tool = capture(translated)
  const large = await tool.execute({ query: 'fixture_name', limit: 1 })
  check(large.ok && large.matches[0].id === 'fixture_name' && large.matches[0].snippet.includes('REAL_DEFINITION'), 'a source larger than the former 900 KB cap returns its actual definition')
  declared(large, tool.output.schema)
  const similar = await tool.execute({ query: '回合开始摸两张牌', limit: 1 })
  check(similar.truncated && similar.matches.length === 1, 'similarity truncation is returned without breaking the result limit')
  declared(similar, tool.output.schema)
  check(true, 'all emitted truncation and nested coverage fields are declared in the tool contract')
  const identifiers = await game('identifiers', { 'character/std.js': 'const translate={_fixture_hidden:"隐藏技能"};const skill={_fixture_hidden:{content(){return "HIDDEN_DEFINITION"}}};' })
  const hidden = await searchReference(identifiers, { query: '_fixture_hidden' })
  check(hidden.ok && hidden.matches[0].id === '_fixture_hidden' && hidden.matches[0].snippet.includes('HIDDEN_DEFINITION'), 'underscored skill identifiers retain exact translation and definition ownership')

  const minified = await game('minified', { 'character/min.js': 'a'.repeat(1024 * 1024) + ' UNIQUE_TAIL_MARKER' })
  const before = performance.now()
  const minResult = await searchReference(minified, { query: 'UNIQUE_TAIL_MARKER' })
  check(minResult.ok && minResult.matches[0].snippet.includes('UNIQUE_TAIL_MARKER') && minResult.matches[0].snippet.length < 13000, 'minified single-line excerpts stay bounded and retain a late match')
  check(performance.now() - before < 5000, 'a 1 MiB uninterrupted identifier does not stall translation indexing')

  const streamGame = await game('stream', { 'extension/Huge/extension.js': 'z'.repeat(9 * 1024 * 1024) + '\nBIG_STREAM_TARGET\n' })
  const streamed = await searchReference(streamGame, { query: 'BIG_STREAM_TARGET' })
  check(streamed.ok && streamed.coverage.largeFiles === 1 && streamed.matches[0].line === 2, 'a source above the eager-index threshold is searched in chunks')
  check(streamed.coverage.streamBytesRead <= streamed.coverage.scanBudgetBytes && streamed.matches[0].snippet.length <= 4000, 'stream reads and returned excerpts have separate fixed budgets')
  declared(streamed, tool.output.schema)

  const earlyGame = await game('early', { 'extension/Huge/extension.js': 'EARLY_TARGET\n' + 'z'.repeat(9 * 1024 * 1024) })
  const early = await searchReference(earlyGame, { query: 'EARLY_TARGET' })
  check(early.ok && early.coverage.partial && early.coverage.streamFilesStoppedAfterMatch === 1 && early.coverage.streamFilesExhausted === 0, 'first-excerpt search never claims the unread remainder reached EOF')

  const continuationGame = await game('continuation', { 'character/std.js': 'const translate={normal:"寻常"};const skill={normal:{}};', 'extension/Large/extension.js': 'normal\n' + 'z'.repeat(9 * 1024 * 1024) })
  const first = await searchReference(continuationGame, { query: 'normal', limit: 1 })
  check(first.nextCursor && first.coverage.largeFilesPending === 1 && first.coverage.streamBytesRead === 0, 'full small-file result pages still offer continuation into large files')
  const second = await searchReference(continuationGame, { query: 'normal', limit: 1, cursor: first.nextCursor })
  check(second.ok && second.matches[0].file === 'extension/Large/extension.js', 'an opaque cursor reaches large sources without repeating indexed matches')
  declared(first, tool.output.schema); declared(second, tool.output.schema)
  const altered = await searchReference(continuationGame, { query: 'other', cursor: first.nextCursor })
  check(!altered.ok && /变更/.test(altered.error), 'a cursor cannot be reused for a different query')
  const tampered = first.nextCursor.slice(0, -4) + 'xxxx'
  check(!(await searchReference(continuationGame, { query: 'normal', cursor: tampered })).ok, 'a tampered cursor is rejected')
  await appendFile(join(continuationGame, 'extension/Large/extension.js'), '// changed')
  const stale = await searchReference(continuationGame, { query: 'normal', cursor: first.nextCursor })
  check(!stale.ok && /变更/.test(stale.error), 'changing source invalidates byte-offset continuation')

  const concurrentGame = await game('concurrent', { 'character/std.js': 'const translate={once:"并发技能"};const skill={once:{}};' })
  const repeated = await Promise.all(Array.from({ length: 12 }, () => searchReference(concurrentGame, { query: 'once' })))
  check(repeated.every(x => x.ok && x.coverage.indexedFiles === 1), 'concurrent calls share a stable bounded index')
  check((await stat(join(streamGame, 'extension/Huge/extension.js'))).size > 8 * 1024 ** 2, 'the chunked integration fixture exceeds the real production indexing threshold')

  const budgetGame = await game('budget', { 'extension/Large/extension.js': '' })
  const budgetFile = join(budgetGame, 'extension/Large/extension.js')
  const slab = Buffer.alloc(1024 * 1024, 122)
  for (let i = 0; i < 65; i++) await appendFile(budgetFile, slab)
  await appendFile(budgetFile, '\nAFTER_SCAN_BUDGET_TARGET\n')
  let page = await searchReference(budgetGame, { query: 'AFTER_SCAN_BUDGET_TARGET' })
  check(!page.ok && page.nextCursor && page.coverage.partial && page.coverage.streamBytesRead <= 64 * 1024 ** 2, 'an unmatched first page reports incompleteness and preserves the late source region')
  let continuationCount = 0
  while (!page.ok && page.nextCursor && continuationCount++ < 12) page = await searchReference(budgetGame, { query: 'AFTER_SCAN_BUDGET_TARGET', cursor: page.nextCursor })
  check(page.ok && page.matches[0].snippet.includes('AFTER_SCAN_BUDGET_TARGET'), 'public signed continuation reaches a match beyond the 64 MiB initial read budget')
  declared(page, tool.output.schema)

  // Substitute metadata only: exercise exact 5 GiB decisions without allocating a multi-GiB file.
  const edgeGame = await game('edges', { 'character/std.js': 'const translate={normal:"边界"};const skill={normal:{}};', 'extension/Large/exact-limit.js': '', 'extension/Large/over-limit.js': '' })
  const facade = join(home, 'metadata.mjs')
  await writeFile(facade, `export { readdir,open } from 'node:fs/promises';import {lstat as real} from 'node:fs/promises';export async function lstat(file){const info=await real(file);if(file.endsWith('exact-limit.js'))info.size=5*1024**3;if(file.endsWith('over-limit.js'))info.size=5*1024**3+1;return info;}`)
  const referenceSource = (await readFile(new URL('../src/reference.js', import.meta.url), 'utf8')).replace("from 'node:fs/promises'", 'from '+JSON.stringify(pathToFileURL(facade).href)).replace("from './reference-stream.js'", 'from '+JSON.stringify(new URL('../src/reference-stream.js', import.meta.url).href))
  const isolated = join(home, 'reference-copy.mjs')
  await writeFile(isolated, referenceSource)
  const edgeSearch = (await import(pathToFileURL(isolated).href)).searchReference
  const edges = await edgeSearch(edgeGame, { query: 'normal', limit: 1 })
  check(edges.coverage.maxFileBytes === 5 * 1024 ** 3 && edges.coverage.largeFiles === 1 && edges.nextCursor, 'an exact 5 GiB metadata boundary is admitted to deferred chunked search')
  check(edges.coverage.skippedFiles === 1 && edges.coverage.skipped[0].bytes === 5 * 1024 ** 3 + 1 && /5 GiB/.test(edges.coverage.skipped[0].reason), 'a file one byte beyond 5 GiB is explicitly skipped before content allocation')
  declared(edges, tool.output.schema)
  console.log('\n全部通过:' + passed + ' 项')
} finally { testPaths.assertTestPath(home); await rm(home, { recursive: true, force: true }) }

#!/usr/bin/env node
import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import { mkdtemp, writeFile, stat, rm, rename } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  REFERENCE_MAX_FILE_BYTES,
  REFERENCE_STREAM_BUDGET_BYTES,
  searchStreamReferences,
} from '../src/reference-stream.js'

const home = await mkdtemp(join(tmpdir(), 'noname-reference-stream-'))
let passed = 0
function check(condition, message) {
  assert.ok(condition, message)
  passed++
  console.log('  ✓ ' + message)
}
async function fixture(name, data) {
  const path = join(home, name)
  await writeFile(path, data)
  const info = await stat(path)
  return { path, rel: name, size: info.size, mtimeMs: info.mtimeMs }
}
async function pages(files, input) {
  let start = { index: 0, offset: 0, line: 1 }
  const results = []
  for (let i = 0; i < 100; i++) {
    const result = await searchStreamReferences(files, { ...input, start })
    results.push(result)
    if (!result.next) return results
    assert.ok(result.next.index > start.index || result.next.offset > start.offset, 'cursor must progress')
    start = result.next
  }
  throw new Error('pagination did not terminate')
}

try {
  check(REFERENCE_MAX_FILE_BYTES === 5 * 1024 ** 3 && REFERENCE_STREAM_BUDGET_BYTES === 64 * 1024 ** 2, '5 GiB file ceiling and 64 MiB request budget are separate')

  const simple = await fixture('simple.js', '第一行\nfunction SkillAlpha() { return "DRAW 中文" }\n')
  const simpleResult = await searchStreamReferences([simple], { query: 'skillalpha draw 中文' })
  check(simpleResult.matches.length === 1 && simpleResult.matches[0].line === 2, 'case-insensitive multiple words and Chinese source line match')
  check(simpleResult.matches[0].snippet.includes('2 |') && simpleResult.next === null && simpleResult.stopReason === 'complete', 'numbered snippets and completed cursor are returned')
  check(simpleResult.filesExhausted === 1 && simpleResult.filesStoppedAfterMatch === 0, 'a match read through EOF counts as an exhausted file')
  const early = await fixture('early.js', 'EarlyTarget' + 'x'.repeat(512 * 1024))
  const earlyResult = await searchStreamReferences([early], { query: 'earlytarget' })
  check(earlyResult.matches.length === 1 && earlyResult.filesExhausted === 0 && earlyResult.filesStoppedAfterMatch === 1, 'a first-chunk match reports the unread remainder separately from EOF')

  const boundary = await fixture('boundary.js', Buffer.concat([Buffer.alloc(256 * 1024 - 4, 120), Buffer.from('跨块中文SkillBoundary\n')]))
  const boundaryResult = await searchStreamReferences([boundary], { query: '跨块中文skillboundary' })
  check(boundaryResult.matches.length === 1 && !boundaryResult.matches[0].snippet.includes('\ufffd'), 'UTF-8 keyword split across chunks matches without replacement characters')

  const splitWords = await fixture('split-words.js', 'x'.repeat(256 * 1024 - 7) + 'Alpha ' + 'y'.repeat(35) + ' beta')
  check((await searchStreamReferences([splitWords], { query: 'alpha beta' })).matches.length === 1, 'all keywords can straddle chunk boundaries within the matching window')

  const paginated = await fixture('paginated.js', '首行\n' + '甲'.repeat(21842) + '跨页中文MATCH\n' + '尾'.repeat(50000))
  const pageResults = await pages([paginated], { query: '跨页中文match', maxBytes: 64 * 1024 })
  check(pageResults.length >= 2 && pageResults.flatMap((result) => result.matches).length === 1, 'budget continuation retains split keywords without duplicate file matches')
  check(pageResults.flatMap((result) => result.matches)[0].line === 2 && pageResults.every((result) => result.bytesRead <= 64 * 1024), 'UTF-8 continuation preserves line numbers and counts overlap reads against budget')

  const newlinePrefix = ('甲乙丙\n').repeat(15000)
  const lineFixture = await fixture('lines.js', newlinePrefix + 'LineTarget\n')
  const lineResults = await pages([lineFixture], { query: 'linetarget', maxBytes: 64 * 1024 })
  check(lineResults.flatMap((result) => result.matches)[0].line === 15001, 'many-line pagination preserves exact original line numbers')

  const enormousLine = await fixture('long-line.js', 'a'.repeat(2 * 1024 * 1024) + 'LongLineTarget' + 'z'.repeat(8192))
  const longResults = await pages([enormousLine], { query: 'longlinetarget', maxBytes: 64 * 1024 })
  const longMatch = longResults.flatMap((result) => result.matches)[0]
  check(longMatch.line === 1 && longMatch.snippet.length <= 4000, 'multi-megabyte lines stay bounded and return a capped snippet')

  const outsideWindow = await fixture('far-apart.js', 'alpha' + 'x'.repeat(17 * 1024) + 'beta')
  check((await searchStreamReferences([outsideWindow], { query: 'alpha beta' })).matches.length === 0, 'multiple words are required to share a bounded source window')

  const one = await fixture('one.js', 'x'.repeat(40 * 1024))
  const two = await fixture('two.js', 'y'.repeat(40 * 1024))
  const three = await fixture('three.js', 'matchAll')
  const shared = await searchStreamReferences([one, two, three], { query: 'matchAll', maxBytes: 64 * 1024 })
  check(shared.bytesRead === 64 * 1024 && shared.filesVisited === 2 && shared.filesExhausted === 1 && shared.next.index === 1, 'all files share one actual-byte request budget')
  const sharedPages = await pages([one, two, three], { query: 'matchAll', maxBytes: 64 * 1024 })
  check(sharedPages.flatMap((result) => result.matches).length === 1, 'continuation reaches files after an exhausted global budget')

  const more = await fixture('more.js', 'draw')
  const limited = await searchStreamReferences([simple, more], { query: 'draw', limit: 1 })
  check(limited.matches.length === 1 && limited.stopReason === 'limit' && limited.next.index === 1 && limited.next.offset === 0, 'result limit advances past the matched file and preserves remaining files')
  check((await searchStreamReferences([simple, more], { query: 'draw', limit: 1, start: limited.next })).matches[0].file === 'more.js', 'result-limit continuation returns the next matching file')

  const deadline = await searchStreamReferences([enormousLine], { query: 'longlinetarget', deadlineMs: 0 })
  check(deadline.stopReason === 'deadline' && deadline.next.offset > 0 && deadline.bytesRead === 256 * 1024, 'an expired deadline permits one bounded chunk and returns a progressing cursor')

  const missing = { path: join(home, 'missing.js'), rel: 'missing.js', size: 12, mtimeMs: 0 }
  const unreadable = await searchStreamReferences([missing, more], { query: 'draw' })
  check(unreadable.unreadable.length === 1 && unreadable.unreadable[0].reason === 'ENOENT' && unreadable.matches.length === 1 && unreadable.filesExhausted === 1, 'unreadable files are reported without counting them as EOF or hiding later matches')
  const stale = { ...more, size: more.size + 1 }
  check((await searchStreamReferences([stale], { query: 'draw' })).unreadable[0].reason.includes('changed'), 'changed file metadata is reported explicitly')
  const tooBig = { ...more, size: REFERENCE_MAX_FILE_BYTES + 1 }
  check((await searchStreamReferences([tooBig], { query: 'draw' })).bytesRead === 0, 'the file ceiling is checked before opening or allocating file content')

  const actualOpen = fsPromises.open
  let openHandles = 0
  let observedOpens = 0
  let failReadPath = null
  fsPromises.open = async (...args) => {
    const handle = await actualOpen(...args)
    openHandles++
    observedOpens++
    return {
      read: async (...readArgs) => {
        if (args[0] === failReadPath) throw Object.assign(new Error('simulated read failure'), { code: 'EIO' })
        return handle.read(...readArgs)
      },
      stat: handle.stat.bind(handle),
      close: async () => { await handle.close(); openHandles-- },
    }
  }
  syncBuiltinESMExports()
  try {
    for (let i = 0; i < 12; i++) await searchStreamReferences([simple, enormousLine, missing], { query: i % 2 ? 'draw' : 'absent', maxBytes: 64 * 1024 })
    await searchStreamReferences([stale], { query: 'draw' })
    await searchStreamReferences([simple, more], { query: 'draw', limit: 1 })
    failReadPath = more.path
    const failedRead = await searchStreamReferences([more], { query: 'draw' })
    check(failedRead.unreadable[0].reason === 'EIO' && openHandles === 0, 'read failures report an explicit error and close the already opened handle')
  } finally {
    fsPromises.open = actualOpen
    syncBuiltinESMExports()
  }
  await rename(simple.path, join(home, 'renamed.js'))
  await rm(join(home, 'renamed.js'))
  check(observedOpens > 0 && openHandles === 0, 'repeated complete, limited and failed reads release every opened file handle')

  await assert.rejects(searchStreamReferences([more], { query: 'draw', maxBytes: 1024 }), /64 KiB/)
  check(true, 'undersized budgets cannot create a cursor that endlessly rereads overlap')
  console.log(`\n全部通过: ${passed} 项`)
} finally {
  await rm(home, { recursive: true, force: true })
}

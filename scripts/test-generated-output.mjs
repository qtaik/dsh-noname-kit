#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createGeneratedOutputStore } from '../src/generated-output.js'

let passed = 0
function check(value, label) { assert.ok(value, label); passed++; console.log('ok', label) }
let now = 1000
const store = createGeneratedOutputStore({ now: () => now })
const code = '甲😀乙\r\n'.repeat(2500)
const id = store.add({ folder: 'Example', code, owner: 'one' })
let text = '', offset = 0, pages = 0
while (true) {
  const page = store.read({ folder: 'Example', draftId: id, owner: 'one', offset, limit: 2001 })
  assert.equal(page.pagination.offset, offset)
  text += page.code; pages++
  if (page.pagination.complete) break
  assert(page.pagination.nextOffset > offset)
  offset = page.pagination.nextOffset
}
check(text === code && pages > 1, 'manual output pages reconstruct every character and original CRLF')
const unicodeId = store.add({ folder: 'Example', code: 'x'.repeat(7999) + '😀tail' })
const firstUnicode = store.read({ folder: 'Example', draftId: unicodeId })
const nextUnicode = store.read({ folder: 'Example', draftId: unicodeId, offset: firstUnicode.pagination.nextOffset, limit: 1 })
check(firstUnicode.code.isWellFormed() && firstUnicode.code.length === 7999, 'default generated page ends before a split supplementary character')
check(nextUnicode.code === '😀' && nextUnicode.pagination.limitAdjustedForCodePoint === true && nextUnicode.pagination.actualLength === 2, 'one-unit generated page preserves the whole Unicode character and reports adjustment')
assert.throws(() => store.read({ folder: 'Example', draftId: unicodeId, offset: 8000 }), /Unicode/); passed++
assert.throws(() => store.read({ folder: 'Example', draftId: id, owner: 'two' }), /当前会话/); passed++
assert.throws(() => store.read({ folder: 'Other', draftId: id, owner: 'one' }), /当前会话/); passed++
assert.throws(() => store.read({ folder: 'Example', file: 'other.js', draftId: id, owner: 'one' }), /当前会话/); passed++
assert.throws(() => store.read({ folder: 'Example', draftId: id, owner: 'one', offset: -1 }), /offset/); passed++
assert.throws(() => store.read({ folder: 'Example', draftId: id, owner: 'one', limit: 16001 }), /limit/); passed++
now += 15 * 60 * 1000
assert.throws(() => store.read({ folder: 'Example', draftId: id, owner: 'one' }), /过期/); passed++
const oldest = store.add({ folder: 'Example', code: 'old' })
for (let i = 0; i < 8; i++) store.add({ folder: 'Example', code: 'new ' + i })
assert.throws(() => store.read({ folder: 'Example', draftId: oldest }), /不存在/); passed++
const empty = store.add({ folder: 'Example', code: '' })
check(store.read({ folder: 'Example', draftId: empty }).pagination.complete, 'empty generated text has a finite completed page')
store.clear()
assert.throws(() => store.read({ folder: 'Example', draftId: empty }), /不存在/); passed++
console.log('全部通过:' + passed + ' 项')

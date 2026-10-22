#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { renderExtensionRead, renderExtensionWrite, renderImageCopy } from '../src/tool-output.js'
import { createGeneratedOutputStore, generatedOutputOwner } from '../src/generated-output.js'
import { registerPresetContext } from '../src/preset-context.js'
import { validateExtensionCode } from '../src/validate.js'

let passed = 0
function check(value, label) { assert.ok(value, label); passed++; console.log('ok', label) }
const rendered = fn => fn.map(x => x.text).join('\n')
check(rendered(renderExtensionRead({}, { folder: 'Example', code: 'SOURCE_VISIBLE', files: [], notes: [] })).includes('SOURCE_VISIBLE'), 'empty notes do not hide the source page')
check(rendered(renderExtensionRead({}, { folder: 'Example', code: 'SOURCE_VISIBLE', files: [], notes: ['LESSON'] })).includes('LESSON'), 'notes and source are both rendered')
check(rendered(renderExtensionRead({}, { folder: 'Example', files: ['extension.js'], error: 'READ_ERROR', coverage: { complete: false } })).includes('extension.js'), 'read errors retain file and coverage diagnostics')
check(rendered(renderExtensionWrite({ folder: 'Example' }, { ok: true, wrote: false, code: 'MANUAL_CODE' })).includes('MANUAL_CODE'), 'manual output includes the actual validated code')
const partial = rendered(renderExtensionWrite({}, { ok: true, wrote: true, path: 'Example/extension.js', infoError: 'INFO_FAIL', warnings: [{ message: 'WARN' }] }))
check(partial.includes('INFO_FAIL') && partial.includes('WARN') && partial.includes('未完整交付'), 'metadata failure and warnings remain visible after a successful code write')
check(rendered(renderImageCopy({}, { ok: true, copied: ['x.jpg'], warning: 'TASK_FAIL' })).includes('TASK_FAIL'), 'image registration failure is shown after a successful copy')
const blank = validateExtensionCode({ code: '' })
check(!blank.ok && blank.style === 'classic' && JSON.stringify(blank).includes('代码为空'), 'empty validation returns a defined schema-compatible style')

let state = { active: true, nonameDir: 'D:/game/{{literal}}' }, environment
registerPresetContext({ systemPrompt: { context(value) { environment = value } } }, () => state)
check(environment.required && environment.interpolate === false && environment.text().includes('{{literal}}'), 'configured paths survive complete persona without path interpolation')
state = { active: true, nonameDir: 'E:/new-game' }
check(environment.text().includes('E:/new-game') && !environment.text().includes('D:/game'), 'environment text follows changed workshop configuration')
state = { active: false, nonameDir: '' }
check(environment.text().includes('尚未配置'), 'unconfigured context gives a bounded configuration instruction')

const source = (await readFile(new URL('../index.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
const outputs = createGeneratedOutputStore()
let nextWrite, nextRead, imageThrows = false
const sandbox = {
  defineTool: x => x, active: true, nonameDir: '/inert', dshHomeDir: '/inert-home',
  renderExtensionRead, renderExtensionWrite, renderImageCopy, generatedOutputs: outputs, generatedOutputOwner,
  async writeExtension(_dir, args) { check(args.writeMode === 'manual', 'task-registered manual mode remains authoritative'); return nextWrite },
  async getTask() { return { writeMode: 'manual' } },
  async recordBackup() { throw new Error('BACKUP_RECORD_FAIL') },
  async readExtension() { return nextRead }, async readHistory() { return { notes: ['REAL_NOTE'] } },
  async copyImages() { return { ok: true, copied: ['x.jpg'] } },
  async setTaskImage() { if (imageThrows) throw new Error('REGISTER_THROW'); return { ok: false, error: 'REGISTER_FAIL' } },
  async archiveTask() {},
}
function capture(name) {
  let tool
  const from = source.lastIndexOf('ctx.tools.register(defineTool({', source.indexOf("name: '" + name + "'"))
  const to = source.indexOf('  ctx.tools.register(defineTool({', from + 1)
  runInNewContext(source.slice(from, to), { ...sandbox, ctx: { tools: { register(x) { tool = x } } } })
  return tool
}
const writer = capture('noname_write_extension'), reader = capture('noname_read_extension'), images = capture('noname_copy_images')
const code = 'const complete_code = true;\r\n'.repeat(1000)
nextWrite = { ok: true, wrote: false, style: 'classic', code, warnings: [] }
const write = await writer.execute({ folder: 'Example', taskId: 'task', writeMode: 'auto' }, { agent: { id: 'a' } })
check(write.draftId && write.code.length <= 16000 && !write.pagination.complete, 'large manual result is retained as resumable generated output')
let combined = write.code, offset = write.pagination.nextOffset
while (offset !== null) {
  const page = await reader.execute({ folder: 'Example', draftId: write.draftId, offset }, { agent: { id: 'a' } })
  assert(!page.error); combined += page.code; offset = page.pagination.nextOffset
}
check(combined === code, 'tool-level manual draft pagination reconstructs the exact complete generated file')
const denied = await reader.execute({ folder: 'Example', draftId: write.draftId }, { agent: { id: 'b' } })
check(denied.error && !denied.code, 'generated output cannot be fetched from another agent')
nextRead = { folder: 'Example', files: [], code: 'READABLE', coverage: { complete: true } }
const notes = await reader.execute({ folder: 'Example', notes: true })
check(rendered(reader.output.render({}, notes)).includes('READABLE') && notes.notes[0] === 'REAL_NOTE', 'read execution and rendering keep notes alongside source')
const copied = await images.execute({ folder: 'Example', taskId: 'task', images: [{ target: 'x.jpg' }] })
check(copied.warning && Object.hasOwn(images.output.schema.properties, 'warning'), 'image registration warning is declared and returned')
imageThrows = true
check((await images.execute({ folder: 'Example', taskId: 'task', images: [{ target: 'x.jpg' }] })).warning.includes('REGISTER_THROW'), 'image copy success is preserved when task bookkeeping throws')
nextWrite = { ok: true, wrote: true, path: 'Example/extension.js', backup: 'backup/file.js', warnings: [] }
const recorded = await writer.execute({ folder: 'Example', taskId: 'task' })
check(recorded.wrote && recorded.warnings[0].message.includes('BACKUP_RECORD_FAIL'), 'backup bookkeeping failure does not turn a successful write into a false failure')
console.log('全部通过:' + passed + ' 项')

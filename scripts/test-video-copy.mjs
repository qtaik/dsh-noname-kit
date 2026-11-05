#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { copyVideos } from '../src/videos.js'
import { guardMessage } from '../src/guard.js'

let passed = 0
function check(value, label) { assert.ok(value, label); passed++; console.log('ok', label) }
check(guardMessage('写入拦截').includes('noname_copy_videos'), 'write guard routes video assets to the available controlled tool')
const base = await fs.mkdtemp(path.join(process.env.NNK_TEST_ROOT || tmpdir(), 'nnk-tests-video-'))
const game = path.join(base, 'game'), root = path.join(game, 'extension', '绘世')
await fs.mkdir(root, { recursive: true })
const input = path.join(base, '用户 下载 目录')
await fs.mkdir(input)
const bytes = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 255, 13, 10, 128, 1, 2, 3])
const source = path.join(input, '1.MP4')
await fs.writeFile(source, bytes)
const copy = (videos, extra = {}) => copyVideos(game, { folder: '绘世', videos, ...extra })
const entry = target => ({ source, target })
let result = await copy([entry('huis_qiyue.mp4')])
check(result.ok && result.copied[0] === 'video/huis_qiyue.mp4', 'video is delivered at one canonical relative path')
check((await fs.readFile(path.join(root, 'video', 'huis_qiyue.mp4'))).equals(bytes), 'Chinese and spaced source path preserves arbitrary video bytes')
check(result.backups.length === 0 && !result.autoCompleted, 'new video has no backup and does not complete image or voice tasks')
await fs.writeFile(source, Buffer.from('NEW_VIDEO_BYTES'))
result = await copy([entry('huis_qiyue.mp4')])
check(!result.ok && result.errors[0].error.includes('overwrite:true'), 'existing file requires an explicit overwrite request')
check((await fs.readFile(path.join(root, 'video', 'huis_qiyue.mp4'))).equals(bytes), 'default refusal leaves the original target bytes unchanged')
result = await copy([entry('huis_qiyue.mp4')], { overwrite: true })
check(result.ok && result.backups.length === 1 && result.backups[0].path.startsWith('backup/video/'), 'explicit update returns a separate video backup path')
check((await fs.readFile(path.join(root, result.backups[0].path))).equals(bytes), 'overwrite backup retains exact old bytes')
check((await fs.readFile(path.join(root, 'video', 'huis_qiyue.mp4'))).equals(await fs.readFile(source)), 'atomic update publishes the new bytes')
const originalBackup = path.join(root, result.backups[0].path)
check(path.extname(originalBackup).toLowerCase() === '.mp4', 'backup keeps the video extension so the same controlled tool can restore it')
result = await copy([{ source: originalBackup, target: 'huis_qiyue.mp4' }], { overwrite: true })
check(result.ok && (await fs.readFile(path.join(root, 'video', 'huis_qiyue.mp4'))).equals(bytes), 'returned backup can be restored with the controlled video tool')
check((await fs.readFile(path.join(root, result.backups[0].path))).equals(await fs.readFile(source)), 'restoring a backup also preserves the replaced current video')

const badNames = ['../outside.mp4', 'image/a.mp4', 'video\\a.mp4', 'D:\\outside.mp4', 'a.mp4:stream', 'CON.mp4', 'lpt1.MP4', 'a.js', 'a.mp4.', 'a mp4.mp4']
for (const target of badNames) {
  const out = await copy([entry(target)])
  check(!out.ok && !out.copied.length, 'unsafe target refused: ' + target)
}
check(!(await fs.stat(path.join(base, 'outside.mp4')).catch(() => null)), 'invalid targets create no outside file')
const directorySource = path.join(input, 'directory.mp4')
await fs.mkdir(directorySource)
result = await copy([{ source: 'relative.mp4', target: 'relative.mp4' }, { source: directorySource, target: 'directory.mp4' }, { source: path.join(input, 'missing.mp4'), target: 'missing.mp4' }])
check(!result.ok && result.errors.length === 3 && !result.copied.length, 'relative, directory and missing sources are all rejected')
result = await copy([{ source, target: 'changed.webm' }])
check(!result.ok && result.errors[0].error.includes('不转码'), 'renaming an MP4 to another format is not presented as conversion')
for (const extension of ['webm', 'm4v', 'mov', 'ogv']) {
  const file = path.join(input, 'source.' + extension)
  await fs.writeFile(file, bytes)
  const out = await copy([{ source: file, target: '视频_' + extension + '.' + extension }])
  check(out.ok && (await fs.readFile(path.join(root, out.copied[0]))).equals(bytes), 'supported video bytes copied: ' + extension)
}
result = await copy([entry('mixed.mp4'), entry('bad.js')])
check(!result.ok && result.copied.length === 1 && result.errors.length === 1, 'partial batch reports actual successful and failed items')
result = await copy([entry('duplicate.mp4'), entry('DUPLICATE.MP4')])
check(!result.ok && result.copied.length === 1 && result.errors[0].error.includes('重复'), 'case-insensitive duplicate targets cannot silently overwrite each other')
const concurrent = await Promise.all([copy([entry('concurrent.mp4')]), copy([entry('concurrent.mp4')])])
check(concurrent.filter(x => x.ok).length === 1 && concurrent.filter(x => !x.ok).length === 1, 'concurrent default copies publish exactly one new target')
check((await fs.readdir(path.join(root, 'video'))).every(x => !x.includes('.nnk-video-')), 'successful and rejected operations leave no owned temporary files')

const shared = path.join(input, 'shared-original.mp4'), hardTarget = path.join(root, 'video', 'hardlink.mp4')
await fs.writeFile(shared, bytes)
await fs.link(shared, hardTarget)
result = await copy([entry('hardlink.mp4')], { overwrite: true })
check(result.ok && (await fs.readFile(shared)).equals(bytes), 'atomic overwrite does not modify another hard link to the old video')
check((await fs.readFile(path.join(root, result.backups[0].path))).equals(bytes), 'hard-linked old target is preserved in an independent backup')
result = await copy([{ source: hardTarget, target: 'hardlink.mp4' }], { overwrite: true })
check(!result.ok, 'copying a video over itself is rejected')
const aliasTarget = path.join(root, 'video', 'alias.mp4')
await fs.link(shared, aliasTarget)
result = await copy([{ source: shared, target: 'alias.mp4' }], { overwrite: true })
check(!result.ok && (await fs.readFile(shared)).equals(bytes), 'distinct paths to the same file inode are refused')

async function linkedFolder(name, component) {
  const pack = path.join(game, 'extension', name), outside = path.join(base, name + '-outside')
  await fs.mkdir(pack, { recursive: true }); await fs.mkdir(outside)
  const destination = path.join(pack, component)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.symlink(outside, destination, process.platform === 'win32' ? 'junction' : 'dir')
  if (component === 'backup') { await fs.mkdir(path.join(pack, 'video')); await fs.writeFile(path.join(pack, 'video', 'safe.mp4'), bytes) }
  const out = await copyVideos(game, { folder: name, videos: [entry('safe.mp4')], overwrite: true })
  check(!out.ok && !(await fs.readdir(outside)).length, component + ' junction cannot redirect video or backup writes outside the pack')
  if (component === 'backup') check((await fs.readFile(path.join(pack, 'video', 'safe.mp4'))).equals(bytes), 'backup-path refusal preserves the current video')
}
await linkedFolder('LinkedVideo', 'video')
await linkedFolder('LinkedBackup', 'backup')
const sourceAlias = path.join(base, 'SourceAlias')
await fs.symlink(input, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir')
result = await copy([{ source: path.join(sourceAlias, '1.MP4'), target: 'source-link.mp4' }])
check(!result.ok && !result.copied.length, 'a junction in the source path is refused')
const deniedPack = path.join(game, 'extension', 'BackupDenied')
await fs.mkdir(path.join(deniedPack, 'video'), { recursive: true })
await fs.writeFile(path.join(deniedPack, 'video', 'safe.mp4'), bytes)
await fs.writeFile(path.join(deniedPack, 'backup'), 'existing backup path is a regular file')
result = await copyVideos(game, { folder: 'BackupDenied', videos: [entry('safe.mp4')], overwrite: true })
check(!result.ok && (await fs.readFile(path.join(deniedPack, 'video', 'safe.mp4'))).equals(bytes), 'backup creation failure cannot modify the existing target')
check((await fs.readdir(path.join(deniedPack, 'video'))).length === 1, 'failed backup operation removes only its owned temporary video')
const leafPack = path.join(game, 'extension', 'Leaf')
await fs.mkdir(path.join(leafPack, 'video'), { recursive: true })
const protectedFile = path.join(input, 'protected.mp4')
await fs.writeFile(protectedFile, bytes)
await fs.symlink(input, path.join(leafPack, 'video', 'safe.mp4'), process.platform === 'win32' ? 'junction' : 'dir')
result = await copyVideos(game, { folder: 'Leaf', videos: [entry('safe.mp4')], overwrite: true })
check(!result.ok && (await fs.readFile(protectedFile)).equals(bytes), 'linked target leaf is refused without modifying the outside source')
for (const nested of [false, true]) {
  const physical = path.join(base, nested ? 'ancestor-physical' : 'root-physical')
  const actualGame = nested ? path.join(physical, 'game') : physical
  await fs.mkdir(path.join(actualGame, 'extension', 'RootCheck'), { recursive: true })
  const alias = path.join(base, nested ? 'ancestor-alias' : 'root-alias')
  await fs.symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const selectedGame = nested ? path.join(alias, 'game') : alias
  const out = await copyVideos(selectedGame, { folder: 'RootCheck', videos: [entry('safe.mp4')] })
  check(!out.ok && !out.copied.length && out.errors[0].error.includes('链接'), (nested ? 'linked game ancestor' : 'linked game root') + ' is refused')
  check(!(await fs.stat(path.join(actualGame, 'nnk-batches')).catch(() => null)), 'refusing ' + (nested ? 'linked ancestor' : 'linked root') + ' creates no lease metadata in its target')
}
await fs.mkdir(path.join(game, 'nnk-batches'), { recursive: true })
await fs.writeFile(path.join(game, 'nnk-batches', 'active'), 'unfinished')
result = await copy([entry('blocked.mp4')])
check(!result.ok && !result.copied.length && result.errors[0].error.includes('恢复'), 'unfinished file-recovery batch blocks ordinary video copying')

const code = (await fs.readFile(new URL('../index.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
const start = code.lastIndexOf('ctx.tools.register(defineTool({', code.indexOf("name: 'noname_copy_videos'"))
const end = code.indexOf('  ctx.tools.register(defineTool({', start + 1)
let tool, active = true, calls = 0
const sandbox = { defineTool: x => x, nonameDir: game, copyVideos: async (_dir, args) => { calls++; return { ok: false, copied: ['video/good.mp4'], backups: [{ target: 'video/good.mp4', path: 'backup/video/old.bak' }], errors: [{ target: 'bad.mp4', error: 'SOURCE_MISSING' }] } }, ctx: { tools: { register(value) { tool = value } } } }
Object.defineProperty(sandbox, 'active', { get: () => active })
runInNewContext(code.slice(start, end), sandbox)
check(tool.name === 'noname_copy_videos' && tool.parameters.videos.items.properties.target.required && tool.parameters.overwrite.type === 'boolean', 'video tool has a discoverable explicit schema')
let output = await tool.execute({ folder: '绘世', videos: [entry('good.mp4')] })
let text = tool.output.render({}, output).map(x => x.text).join('\n')
check(calls === 1 && text.includes('video/good.mp4') && text.includes('backup/video/old.bak') && text.includes('SOURCE_MISSING') && text.includes('未全部完成') && text.includes('\n') && !text.includes('\\n'), 'rendered partial result keeps successful paths, backup and error visible on real lines')
active = false
output = await tool.execute({ folder: '绘世', videos: [] })
check(!output.ok && calls === 1 && output.errors[0].error.includes('未配置'), 'inactive workshop refuses video tool without copying files')
check(tool.description.includes('not transcoding') && text.includes('不代表已验证'), 'copy result makes no untested playback claim')
console.log('全部通过:' + passed + ' 项')

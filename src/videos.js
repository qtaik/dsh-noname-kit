/** Copy user-selected video bytes to one extension's video/ directory. */
import { copyFile, link, lstat, mkdir, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { safeFolderPath, assertNoLinkPath } from './write.js'
import { withBatchWrite } from './batch.js'

const VIDEO_NAME = /^[\w\u4e00-\u9fff-]+\.(mp4|webm|m4v|mov|ogv)$/i
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const targets = new Map()

// The batch lease excludes publication; this lock also serializes local copies.
async function withTarget(target, fn) {
  const key = resolve(target).toLowerCase()
  const previous = targets.get(key) || Promise.resolve()
  let release
  const current = new Promise(done => { release = done })
  targets.set(key, current)
  await previous
  try { return await fn() }
  finally { release(); if (targets.get(key) === current) targets.delete(key) }
}

async function inspect(file) {
  assertNoLinkPath(file)
  try { return await lstat(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function sameFile(a, b) {
  return Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs)
}

async function directory(dir) {
  assertNoLinkPath(dir)
  await mkdir(dir, { recursive: true })
  const entry = await inspect(dir)
  if (!entry?.isDirectory()) throw new Error('视频或备份目录不是普通目录')
}

function videoTarget(target) {
  if (typeof target !== 'string' || target.length > 200 || !VIDEO_NAME.test(target) || target !== basename(target) || /[/\\]/.test(target) || DEVICE_NAME.test(target.slice(0, -extname(target).length))) {
    throw new Error('视频目标必须是纯文件名（中文、字母、数字、下划线或连字符），支持 mp4/webm/m4v/mov/ogv；不允许子目录或设备名。')
  }
  return target
}

async function copyOne(root, item, overwrite, backups, warnings) {
  const source = item?.source
  const name = videoTarget(item?.target)
  if (typeof source !== 'string' || !isAbsolute(source)) throw new Error('视频源必须是本地文件的绝对路径')
  if (extname(source).toLowerCase() !== extname(name).toLowerCase()) throw new Error('源视频与目标的扩展名必须一致；复制工具不转码，也不通过改后缀转换格式。')
  const videoDir = join(root, 'video'), target = join(videoDir, name)
  if (resolve(source).toLowerCase() === resolve(target).toLowerCase()) throw new Error('源视频与目标不能是同一个路径')
  return withTarget(target, async () => {
    const originalSource = await inspect(source)
    if (!originalSource?.isFile()) throw new Error('视频源不存在或不是普通文件')
    const old = await inspect(target)
    if (old && !old.isFile()) throw new Error('视频目标已存在且不是普通文件')
    if (old && !overwrite) throw new Error('同名视频已存在；如需更新，请传 overwrite:true，工具会先备份再替换。')
    if (old && old.dev === originalSource.dev && old.ino === originalSource.ino) throw new Error('源视频与目标指向同一个文件')
    await directory(videoDir)
    const temp = join(videoDir, '.' + name + '.nnk-video-' + randomUUID() + '.tmp')
    let ownedTemp = false
    try {
      assertNoLinkPath(source); assertNoLinkPath(temp)
      try { await copyFile(source, temp, constants.COPYFILE_EXCL); ownedTemp = true }
      catch (error) { if (error.code !== 'EEXIST') ownedTemp = true; throw error }
      const copied = await inspect(temp), currentSource = await inspect(source)
      if (!copied?.isFile() || copied.nlink !== 1 || copied.size !== originalSource.size || !sameFile(originalSource, currentSource)) throw new Error('复制期间源视频发生变化或临时文件异常，目标未更新。')
      if (old) {
        if (!sameFile(old, await inspect(target))) throw new Error('复制期间目标视频发生变化，拒绝覆盖。')
        const backupDir = join(root, 'backup', 'video')
        await directory(backupDir)
        const extension = extname(name)
        const backupName = name.slice(0, -extension.length) + '.' + Date.now() + '-' + randomUUID() + extension
        const backup = join(backupDir, backupName)
        assertNoLinkPath(target); assertNoLinkPath(backup)
        await copyFile(target, backup, constants.COPYFILE_EXCL)
        const backupInfo = await inspect(backup)
        if (!backupInfo?.isFile() || backupInfo.size !== old.size) throw new Error('原视频备份未完成，目标未更新。')
        backups.push({ target: 'video/' + name, path: 'backup/video/' + backupName })
        if (!sameFile(old, await inspect(target))) throw new Error('备份期间目标视频发生变化，拒绝覆盖；已创建的备份保留。')
        assertNoLinkPath(temp); assertNoLinkPath(target)
        await rename(temp, target)
        ownedTemp = false
      } else {
        // Exclusive publication cannot replace a file created by another writer.
        assertNoLinkPath(temp); assertNoLinkPath(target)
        await link(temp, target)
      }
      return 'video/' + name
    } finally {
      if (ownedTemp) {
        try { assertNoLinkPath(temp); await unlink(temp) }
        catch (error) { if (error.code !== 'ENOENT') warnings.push('临时视频文件未能清理：' + temp + '（' + error.message + '）') }
      }
    }
  })
}

export async function copyVideos(nonameDir, args = {}) {
  const copied = [], backups = [], errors = [], warnings = []
  try {
    // Acquiring a batch lease writes metadata; reject linked roots before that.
    assertNoLinkPath(nonameDir)
    await withBatchWrite(nonameDir, async () => {
      const { folder, videos, overwrite = false } = args
      if (!Array.isArray(videos) || !videos.length) throw new Error('videos 不能为空')
      if (typeof overwrite !== 'boolean') throw new Error('overwrite 必须是布尔值')
      const { full: root } = safeFolderPath(nonameDir, folder)
      if (!(await inspect(root))?.isDirectory()) throw new Error('扩展包目录不存在，请先创建扩展包。')
      const seen = new Set()
      for (const item of videos) {
        try {
          const name = videoTarget(item?.target), key = name.toLowerCase()
          if (seen.has(key)) throw new Error('同一批视频中存在重复目标（不区分大小写）')
          seen.add(key)
          copied.push(await copyOne(root, item, overwrite, backups, warnings))
        } catch (error) { errors.push({ source: String(item?.source || ''), target: String(item?.target || ''), error: error.message }) }
      }
    })
  } catch (error) { errors.push({ source: '', target: '', error: error.message }) }
  return { ok: errors.length === 0, copied, backups, errors, ...(warnings.length ? { warnings } : {}) }
}

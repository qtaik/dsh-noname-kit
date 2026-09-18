/**
 * noname-kit 配音复制:把用户提供的本地 mp3 复制进扩展包的 audio/ 子目录
 * (`extension/<folder>/audio/skill/` 与 `audio/die/`),替代把音频塞进游戏
 * 本体 audio/ 目录的老做法——扩展的音频只归扩展包。
 * 安全校验:源必须存在;目标只允许 skill/ 或 die/ 一层子目录 + 纯文件名(.mp3);
 * 目录不得逃逸。
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { safeFolderPath } from './write.js'

/**
 * 复制一批配音到扩展包的 audio/ 子目录。
 * @param {string} nonameDir - 游戏本体目录。
 * @param {object} input
 * @param {string} input.folder - 扩展文件夹名。
 * @param {Array<{source:string, target:string}>} input.audios - source=本地 mp3 绝对路径;target=存入 audio/ 的相对路径,必须是 `skill/<名>.mp3` 或 `die/<名>.mp3`。
 * @returns {{ok:boolean, copied?:Array, errors?:Array}}
 */
export async function copyAudios(nonameDir, { folder, audios }) {
  if (!Array.isArray(audios) || audios.length === 0) {
    return { ok: false, errors: [{ source: '', error: 'audios 不能为空' }] }
  }
  let root
  try { ({ full: root } = safeFolderPath(nonameDir, folder)) } catch (error) {
    return { ok: false, errors: [{ source: '', error: error.message }] }
  }
  const audioDir = join(root, 'audio')
  const copied = []
  const errors = []
  for (const item of audios) {
    try {
      const source = String(item.source || '')
      const target = String(item.target || '')
      if (!/^(skill|die)[/\\][\w\u4e00-\u9fff-]+\.mp3$/i.test(target)) {
        throw new Error(`目标路径「${target}」不合法:必须是 skill/或die/ 开头 + 纯文件名(.mp3),如 skill/my_skill1.mp3 或 die/my_general.mp3`)
      }
      if (target.includes('..')) throw new Error('目标路径不允许 ..')
      await stat(source)
      const dest = join(audioDir, ...target.split(/[\\/]/))
      await mkdir(join(audioDir, target.split(/[\\/]/)[0]), { recursive: true })
      await copyFile(source, dest)
      copied.push(target.replace(/\\/g, '/'))
    } catch (error) {
      errors.push({ source: item.source, error: error.message })
    }
  }
  return { ok: errors.length === 0, copied, errors }
}

/** 目标路径的归属目录:'skill' | 'die' | null(非配音目标形态)。
 * 与 copyAudios 的复制正则同为大小写不敏感,两处口径必须一致。 */
export function audioTargetKind(target) {
  const m = String(target || '').replace(/\\/g, '/').match(/^(skill|die)\//i)
  return m ? m[1].toLowerCase() : null
}

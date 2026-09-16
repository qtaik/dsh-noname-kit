/**
 * noname-kit 图片复制:把用户选好的本地图片复制进扩展包的专用图片文件夹
 * (`extension/<folder>/image/`),替代老包"根目录散放"的混乱方式。
 * 安全校验:源必须存在且为图片扩展名;目标名只允许安全字符;目录不得逃逸。
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { safeFolderPath } from './write.js'

const TARGET_NAME_RE = /^[\w\u4e00-\u9fff-]+\.(jpg|jpeg|png|gif|webp)$/i

/**
 * 复制一批图片到扩展包的 image/ 子目录。
 * @param {string} nonameDir - 游戏本体目录。
 * @param {object} input
 * @param {string} input.folder - 扩展文件夹名。
 * @param {Array<{source:string, target:string}>} input.images - source=本地图片绝对路径;target=存入 image/ 的文件名(含扩展名)。
 * @returns {{ok:boolean, copied?:Array, errors?:Array}}
 */
export async function copyImages(nonameDir, { folder, images }) {
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, errors: [{ source: '', error: 'images 不能为空' }] }
  }
  let root
  try { ({ full: root } = safeFolderPath(nonameDir, folder)) } catch (error) {
    return { ok: false, errors: [{ source: '', error: error.message }] }
  }
  const imageDir = join(root, 'image')
  const copied = []
  const errors = []
  for (const item of images) {
    try {
      const source = String(item.source || '')
      const target = String(item.target || basename(source))
      if (!TARGET_NAME_RE.test(target)) {
        throw new Error(`目标名「${target}」不合法:只允许中文/字母/数字/下划线/连字符 + 图片扩展名(jpg/png/gif/webp),请先重命名`)
      }
      if (target !== basename(target) || /[/\\]/.test(target)) throw new Error('目标名只能是一个文件名')
      await stat(source)
      await mkdir(imageDir, { recursive: true })
      await copyFile(source, join(imageDir, target))
      copied.push(target)
    } catch (error) {
      errors.push({ source: item.source, error: error.message })
    }
  }
  return { ok: errors.length === 0, copied, errors }
}

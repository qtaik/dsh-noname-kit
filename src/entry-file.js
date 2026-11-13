import { posix } from 'node:path'

/** Normalize a package-relative file before validation or filesystem resolution. */
export function normalizeEntryFile(file, { allowJson = false } = {}) {
  const raw = file == null || file === '' ? 'extension.js' : file
  const rel = typeof raw === 'string' ? raw.replaceAll('\\', '/') : ''
  const allowed = allowJson ? /\.(?:js|json)$/i : /\.js$/i
  if (!rel || !allowed.test(rel) || rel.includes('..') || rel.startsWith('/') || /[:\x00-\x1f]/.test(rel)) {
    throw new Error(`非法的条目文件路径「${file}」:必须是扩展包内的相对 ${allowJson ? '.js 或 .json' : '.js'} 路径。`)
  }
  return posix.normalize(rel)
}

export function entryFileType(file) {
  const rel = normalizeEntryFile(file, { allowJson: true })
  const name = process.platform === 'win32' ? rel.toLowerCase() : rel
  return { file: rel, fileType: name === 'extension.js' ? 'entry' : /\.json$/i.test(rel) ? 'json' : 'module' }
}

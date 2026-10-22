import { open } from 'node:fs/promises'

export const REFERENCE_MAX_FILE_BYTES = 5 * 1024 ** 3
export const REFERENCE_STREAM_BUDGET_BYTES = 64 * 1024 ** 2

const CHUNK_BYTES = 256 * 1024
const WINDOW_BYTES = 16 * 1024
const MIN_BUDGET_BYTES = 64 * 1024
const MAX_SNIPPET_CHARS = 4000

function countNewlines(bytes, end = bytes.length) {
  let count = 0
  for (let i = 0; i < end; i++) if (bytes[i] === 10) count++
  return count
}

function completeUtf8End(bytes) {
  if (!bytes.length) return 0
  let start = bytes.length - 1
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--
  const lead = bytes[start]
  const width = lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
  return bytes.length - start < width ? start : bytes.length
}

function utf8Start(bytes, index) {
  while (index < bytes.length && (bytes[index] & 0xc0) === 0x80) index++
  return index
}

function escapedToken(token) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findKeywords(text, expressions) {
  const hits = expressions.map((expression) => {
    expression.lastIndex = 0
    return expression.exec(text)
  })
  if (hits.some((hit) => !hit)) return null
  while (true) {
    let first = 0
    let end = 0
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].index < hits[first].index) first = i
      end = Math.max(end, hits[i].index + hits[i][0].length)
    }
    const start = hits[first].index
    // All query words must occur together in a bounded source window.
    if (end - start <= WINDOW_BYTES && Buffer.byteLength(text.slice(start, end)) <= WINDOW_BYTES) return { start, end }
    hits[first] = expressions[first].exec(text)
    if (!hits[first]) return null
  }
}

function makeMatch(text, hit, baseLine, file) {
  let contextStart = Math.max(0, hit.start - 900)
  const newline = text.lastIndexOf('\n', hit.start)
  if (newline >= contextStart) contextStart = newline + 1
  if (contextStart > 0 && /[\uDC00-\uDFFF]/.test(text[contextStart])) contextStart++
  let contextEnd = Math.min(text.length, hit.start + 2600)
  if (contextEnd < text.length && /[\uDC00-\uDFFF]/.test(text[contextEnd])) contextEnd--
  const line = baseLine + (text.slice(0, hit.start).match(/\n/g) || []).length
  const firstLine = baseLine + (text.slice(0, contextStart).match(/\n/g) || []).length
  const lines = text.slice(contextStart, contextEnd).split('\n')
  const numbered = []
  let remaining = MAX_SNIPPET_CHARS
  for (let i = 0; i < lines.length && remaining > 0; i++) {
    const prefix = `${String(firstLine + i).padStart(5)} | `
    let part = prefix + lines[i]
    if (part.length > remaining) {
      part = part.slice(0, Math.max(0, remaining - 1))
      if (/[\uD800-\uDBFF]$/.test(part)) part = part.slice(0, -1)
      part += '…'
    }
    numbered.push(part)
    remaining -= part.length + 1
  }
  return { id: '', name: '', info: '', file, line, snippet: numbered.join('\n') }
}

/** Search trusted files with bounded reads; cursor offsets refer to complete UTF-8 boundaries. */
export async function searchStreamReferences(files, {
  query,
  limit = 5,
  start = { index: 0, offset: 0, line: 1 },
  maxBytes = REFERENCE_STREAM_BUDGET_BYTES,
  deadlineMs = 2500,
} = {}) {
  const raw = String(query || '').trim()
  if (!raw || raw.length > 1024) throw new RangeError('query must contain 1–1024 characters')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_BUDGET_BYTES || maxBytes > REFERENCE_STREAM_BUDGET_BYTES) throw new RangeError('maxBytes must be between 64 KiB and 64 MiB')
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new RangeError('deadlineMs must be nonnegative')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new RangeError('limit must be between 1 and 10')
  if (!Array.isArray(files) || !Number.isSafeInteger(start.index) || start.index < 0 || start.index > files.length || !Number.isSafeInteger(start.offset) || start.offset < 0 || !Number.isSafeInteger(start.line) || start.line < 1) throw new RangeError('invalid stream cursor')

  const expressions = [...new Set(raw.split(/\s+/u))].map((token) => new RegExp(escapedToken(token), 'giu'))
  const matches = []
  const unreadable = []
  let bytesRead = 0
  let filesVisited = 0
  let filesExhausted = 0
  let filesStoppedAfterMatch = 0
  let next = { ...start }
  let stopReason = 'complete'
  const deadline = performance.now() + deadlineMs
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES)

  while (next.index < files.length) {
    if (bytesRead >= maxBytes) { stopReason = 'budget'; break }
    if ((bytesRead > 0 || filesVisited > 0) && performance.now() >= deadline) { stopReason = 'deadline'; break }
    const current = { ...next }
    const file = files[current.index]
    let handle
    let advanceFile = false
    let fileMatch = null
    try {
      filesVisited++
      if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > REFERENCE_MAX_FILE_BYTES || current.offset > file.size) throw new Error('file size exceeds the supported range')
      handle = await open(file.path, 'r')
      const info = await handle.stat()
      if (!info.isFile() || info.size !== file.size || info.mtimeMs !== file.mtimeMs) throw new Error('file changed; restart the search')
      let position = current.offset
      let tail = Buffer.alloc(0)
      let tailOffset = position
      let tailLine = current.line
      while (position < file.size) {
        if (bytesRead >= maxBytes) { stopReason = 'budget'; break }
        // A first bounded read guarantees progress even when a very short deadline has elapsed.
        if (position > current.offset && performance.now() >= deadline) { stopReason = 'deadline'; break }
        const length = Math.min(buffer.length, maxBytes - bytesRead, file.size - position)
        const read = await handle.read(buffer, 0, length, position)
        bytesRead += read.bytesRead
        if (read.bytesRead === 0) throw new Error('file changed or could not be read completely')
        position += read.bytesRead
        const combined = Buffer.concat([tail, buffer.subarray(0, read.bytesRead)])
        const completeEnd = position === file.size ? combined.length : completeUtf8End(combined)
        const text = combined.subarray(0, completeEnd).toString('utf8')
        const hit = findKeywords(text, expressions)
        if (hit) {
          fileMatch = makeMatch(text, hit, tailLine, file.rel)
          advanceFile = true
          break
        }
        const keepStart = utf8Start(combined, Math.max(0, completeEnd - WINDOW_BYTES))
        tailLine += countNewlines(combined, keepStart)
        tailOffset += keepStart
        tail = combined.subarray(keepStart)
        next = { index: current.index, offset: tailOffset, line: tailLine }
      }
      if (position >= file.size) advanceFile = true
      const after = await handle.stat()
      if (after.size !== file.size || after.mtimeMs !== file.mtimeMs) throw new Error('file changed; restart the search')
      if (position >= file.size) filesExhausted++
      else if (fileMatch) filesStoppedAfterMatch++
      if (fileMatch) matches.push(fileMatch)
    } catch (error) {
      unreadable.push({ file: file?.rel || '', reason: error.code || error.message || 'file could not be read' })
      advanceFile = true
    } finally {
      if (handle) await handle.close()
    }
    if (advanceFile) {
      next = { index: current.index + 1, offset: 0, line: 1 }
    } else break
    if (matches.length >= limit && next.index < files.length) { stopReason = 'limit'; break }
  }
  if (next.index >= files.length) { next = null; stopReason = 'complete' }
  return { matches, next, bytesRead, filesVisited, filesExhausted, filesStoppedAfterMatch, stopReason, unreadable }
}

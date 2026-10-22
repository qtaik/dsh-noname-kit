import { randomUUID } from 'node:crypto'

const MAX_BYTES = 64 * 1024 ** 2
const MAX_ENTRIES = 8
const TTL_MS = 15 * 60 * 1000

/** Retain validated manual output in bounded memory so rendering can return complete, resumable pages. */
export function createGeneratedOutputStore({ now = Date.now } = {}) {
  const entries = new Map()
  let bytes = 0
  const discard = id => { const value = entries.get(id); if (value) bytes -= value.bytes; entries.delete(id) }
  const prune = () => { for (const [id, value] of entries) if (now() - value.touchedAt >= TTL_MS) discard(id) }
  return {
    add({ folder, file = 'extension.js', code, owner = '' }) {
      prune()
      if (typeof code !== 'string') throw new TypeError('手动代码必须是字符串。')
      const size = Buffer.byteLength(code)
      if (size > MAX_BYTES) throw new Error('手动成品超过 64 MiB 临时保存上限，未写入游戏文件。')
      while (entries.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) discard(entries.keys().next().value)
      const id = randomUUID()
      entries.set(id, { folder, file, code, owner, bytes: size, touchedAt: now() }); bytes += size
      return id
    },
    read({ draftId, folder, file, owner = '', offset = 0, limit = 8000 }) {
      prune()
      const draft = entries.get(draftId)
      if (!draft || draft.owner !== owner || draft.folder !== folder || (file && file !== draft.file)) throw new Error('手动成品不存在、已过期或不属于当前会话；请重新生成，不能据此判断游戏文件缺失。')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > draft.code.length) throw new RangeError('offset 超出手动成品范围。')
      if (offset > 0 && /[\uD800-\uDBFF]/.test(draft.code[offset - 1]) && /[\uDC00-\uDFFF]/.test(draft.code[offset])) throw new RangeError('offset 位于完整 Unicode 字符中间；请使用上一页的 nextOffset。')
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw new RangeError('limit 应在 1–16000 字符之间。')
      draft.touchedAt = now()
      entries.delete(draftId); entries.set(draftId, draft)
      let end = Math.min(draft.code.length, offset + limit)
      if (end < draft.code.length && /[\uD800-\uDBFF]/.test(draft.code[end - 1]) && /[\uDC00-\uDFFF]/.test(draft.code[end])) end--
      if (end === offset && offset < draft.code.length) end = Math.min(draft.code.length, offset + 2)
      const complete = end === draft.code.length
      return {
        folder: draft.folder, file: draft.file, files: [], draftId,
        code: draft.code.slice(offset, end),
        pagination: { offset, limit, total: draft.code.length, nextOffset: complete ? null : end, complete, unit: 'characters', actualLength: end - offset, codePointSafe: true, ...(end - offset > limit ? { limitAdjustedForCodePoint: true } : {}) },
        coverage: { complete: true, partial: false, source: 'validated-manual-output', snapshot: draftId },
      }
    },
    clear() { entries.clear(); bytes = 0 },
  }
}

export function generatedOutputOwner(exec) {
  return String(exec?.agent?.session?.header?.id ?? exec?.agent?.session?.id ?? exec?.agent?.id ?? '')
}

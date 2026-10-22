function paging(value) {
  if (!value) return ''
  const next = value.nextOffset === null || value.nextOffset === undefined ? '' : `；下一页 offset=${value.nextOffset}`
  const adjusted = value.limitAdjustedForCodePoint ? '；为保留完整字符，本页含 2 个 UTF-16 单位' : ''
  return `分页：offset=${value.offset}，本页预算=${value.limit}，总量=${value.total} ${value.unit || ''}${next}${adjusted}。`
}

function warnings(value) {
  return (value || []).map(item => '- ' + (typeof item === 'string' ? item : item.message)).join('\n')
}

/** Render code and metadata independently; requesting notes must not hide the source page. */
export function renderExtensionRead(_args, value) {
  const parts = []
  if (value.error) parts.push('读取失败：' + value.error)
  if (value.notes) parts.push('历史注意点 ' + value.notes.length + ' 条：\n' + value.notes.map((text, i) => `${i + 1}. ${text}`).join('\n'))
  if (value.blocks) {
    parts.push('区块目录（当前页 ' + value.blocks.blocks.length + ' 项）：')
    for (const block of value.blocks.blocks) parts.push(`- ${block.key}（${block.lines} 行${block.virtual ? '，虚拟' : ''}${block.ambiguous ? '，存在歧义' : ''}） @ ${block.file || value.file || 'extension.js'}`)
    parts.push('精确读取请传 block 和对应 file；有分页时继续读取目录，不将当前页当成全部条目。')
  }
  if (Object.hasOwn(value, 'code')) {
    const label = value.block ? `区块 ${value.block.kind}:${value.block.id}` : value.draftId ? '手动成品草稿' : '源码'
    parts.push(`── ${label} ${value.folder}/${value.block?.file || value.file || 'extension.js'} ──`, value.code)
  }
  if (value.draftId) parts.push('draftId：' + value.draftId + '（仅当前会话；闲置 15 分钟过期，可按 offset/limit 续读，不落盘）')
  if (value.files?.length) {
    parts.push('包内目录项：' + value.files.slice(0, 20).join('、') + (value.files.length > 20 ? `……另 ${value.files.length - 20} 项；条目请用 listBlocks/query 查询。` : ''))
  }
  if (value.info) {
    const info = JSON.stringify(value.info)
    parts.push('info.json：' + info.slice(0, 2048) + (info.length > 2048 ? '……（元数据预览已截断，需要具体字段时请按已知文件路径只读查询。）' : ''))
  }
  if (value.ambiguous) parts.push('歧义来源：' + JSON.stringify(value.ambiguous))
  if (value.warnings?.length) parts.push('注意：\n' + warnings(value.warnings))
  if (value.pagination) parts.push(paging(value.pagination))
  if (value.coverage) parts.push('覆盖情况：' + JSON.stringify(value.coverage))
  return [{ type: 'text', text: parts.join('\n') || '当前读取没有返回内容，请核对文件和参数。' }]
}

/** Show partial delivery failures and the actual manual output page alongside validation messages. */
export function renderExtensionWrite(_args, value) {
  const parts = []
  if (value.error) parts.push('写入被拒：' + value.error)
  else if (!value.ok) parts.push('校验未通过，未写入。')
  else if (value.wrote) parts.push(`已写入 ${value.path}${value.backup ? '（旧版备份：' + value.backup + '）' : ''}。请重开游戏或重载扩展查看效果。`)
  else parts.push('手动模式：代码已校验，尚未写入游戏文件。以下是实际生成的代码：')
  if (value.errors?.length) parts.push('错误：\n' + warnings(value.errors))
  if (value.warnings?.length) parts.push('警告：\n' + warnings(value.warnings))
  if (value.infoError) parts.push('元数据未完整交付：' + value.infoError + '。仅确认代码文件写入，不要报告全部成功。')
  if (value.infoWritten === true) parts.push('info.json 已写入。')
  if (Object.hasOwn(value, 'code')) parts.push(value.code)
  if (value.draftId) parts.push(`成品较长，当前为分页；用 noname_read_extension({folder:${JSON.stringify(_args.folder)},draftId:${JSON.stringify(value.draftId)},offset:${value.pagination?.nextOffset || 0}}) 继续，直到 pagination.complete=true。`)
  if (value.pagination) parts.push(paging(value.pagination))
  return [{ type: 'text', text: parts.join('\n') }]
}

export function renderImageCopy(_args, value) {
  const parts = [value.ok ? `已复制 ${(value.copied || []).length} 张图片到扩展包 image/ 目录。` : '图片复制失败：' + (value.errors || []).map(x => x.error).join('; ')]
  if (value.warning) parts.push(value.warning)
  if (value.autoCompleted) parts.push('任务已自动完成并归档，无需再调用 noname_skills_written。')
  return [{ type: 'text', text: parts.join('\n') }]
}

import { join } from 'node:path'

function bashPath(value) { return String(value).replace(/^([A-Za-z]):[\\/]/, (_, drive) => '/' + drive.toLowerCase() + '/').replaceAll('\\', '/') }

/** Keep configured game paths visible even when a complete persona suppresses optional prompt sections. */
export function registerPresetContext(ctx, state) {
  if (typeof ctx.systemPrompt.context !== 'function') return false
  ctx.systemPrompt.context({
    name: 'noname-kit:environment', order: 205, required: true, interpolate: false,
    text: () => {
      const { active, nonameDir } = state()
      if (!active) return '无名杀工坊尚未配置游戏目录。请使用工坊设置配置游戏目录；未配置时不要在盘符根或用户目录搜索安装位置。'
      const extension = join(nonameDir, 'extension')
      return [
        '无名杀工坊当前环境（以本次配置为准；会话工作目录可能与游戏目录不同）：',
        '游戏目录：' + nonameDir,
        '游戏目录（Git Bash）：' + bashPath(nonameDir),
        '扩展目录：' + extension,
        '扩展目录（Git Bash）：' + bashPath(extension),
        '官方目录与游戏源码只读；扩展改动仍经 noname_write_extension 校验及原有写入门禁。',
        '参考实现用 noname_search_reference 查相似技能、武将和卡牌，可组合不同机制，不要求完全相同的组合。使用前读相应实现，不把翻译、注释或相邻条目当作该技能；未搜完不能声称不存在。',
        '对引擎 API 用法有疑问或准备判为不支持时，用通用只读工具核对当前游戏源码的定义、参数处理和直接相关分支（含相关 .js/.ts、类型与必要文档），给出依据位置。参考和证据足够后继续完成当前任务，复用源码未变的已核实结论，不要求穷举参考或审计整个引擎；无法核实时说明具体问题与限制，不猜测。遵守宿主权限、预算、超时与取消。',
        '工具结果的 coverage/分页说明优先：未解析、受限、歧义和未搜完都不能当作内容不存在。只按当前问题需要用 nextCursor 或 pagination.nextOffset 续读；已有足够参考不因 coverage.partial 强迫穷举。snapshot 变化时重新查询。',
        'reference 支持单文件至 5 GiB 的分块续搜；条目静态解析与全文读取有独立资源上限，以工具返回为准。',
        '手动生成的大成品按 draftId 用 noname_read_extension 续读，完整交付仍须读到 pagination.complete=true；草稿不会写入游戏文件。',
      ].join('\n')
    },
  })
  return true
}

/** Register the workshop tools only in this preset's scope. */
export const name = 'noname-tools'
export const inject = ['tools', 'nonameKitTools']

export function apply(ctx) {
  if (typeof ctx.nonameKitTools !== 'function') {
    throw new Error('无名杀工坊工具服务不可用，请检查插件是否已启用。')
  }
  return ctx.nonameKitTools(ctx)
}

import { createRequire } from 'node:module'

function hostScopeApi() {
  try {
    // Resolve beside the host tools service so both use the same scope identities.
    const require = createRequire(import.meta.url)
    return createRequire(require.resolve('@deepseek-ai/dsh-tools'))('@deepseek-ai/dsh-scope')
  } catch {
    return null
  }
}

/** Keep tool definitions and shared workshop state outside the global tool catalog. */
export function createPresetToolRegistrar(registerTools, scopeApi = hostScopeApi()) {
  return (ctx) => {
    const scope = scopeApi?.scopeOf?.(ctx)
    if (!scope || typeof scopeApi?.scopeChainOf !== 'function' || typeof ctx?.effect !== 'function') {
      throw new Error('无名杀工具需要支持预设作用域的 DSH，并须在无名杀开发模式中加载。')
    }
    return ctx.effect(() => {
      let live = true
      const disposers = []
      const dispose = () => {
        live = false
        for (const undo of disposers.reverse()) undo()
        disposers.length = 0
      }
      try {
        registerTools({ tools: { register(definition) {
          const wrapped = {
            ...definition,
            async execute(args, exec) {
              if (!live || !exec?.agent || !scopeApi.scopeChainOf(exec.agent).includes(scope)) {
                const error = new Error('此工具只允许在无名杀开发模式中调用，请切换预设后重试。')
                error.code = 'NONAME_PRESET_REQUIRED'
                throw error
              }
              return definition.execute(args, exec)
            },
          }
          const undo = ctx.tools.register(wrapped)
          disposers.push(undo)
          return undo
        } } })
      } catch (error) {
        dispose()
        throw error
      }
      return dispose
    }, 'noname-kit:preset-tools')
  }
}

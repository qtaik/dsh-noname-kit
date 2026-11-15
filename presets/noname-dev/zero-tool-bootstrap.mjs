/**
 * Expose resident and discovered tools from the first real request.
 * Restore phase state from session events; compaction uses the configured recovery tool set.
 * Adapted from xiaobright/dsh-anchored-standard (MIT).
 */

import { createEpochPromotion } from './compaction-epoch.mjs'
import { createSessionState, stateSchema } from './session-state.mjs'


export const name = 'zero-tool-bootstrap'

export const inject = ['tools', 'systemPrompt']



const DEFAULT_SUPPRESSED_SOURCES = ['skill-catalog', 'agent-instructions']

const SHELLS = ['bash', 'pwsh']

const RESIDENT_DISCOVERY_TOOLS = ['dev_tool_search', 'skill_search', 'skill_load']

function stringListOrEmpty(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

function sourceList(value, field, fallback) {
  if (value === undefined) return new Set(fallback)
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be an array of non-empty strings`)
  }
  return new Set(value)
}

export async function apply(ctx, config) {
  // Use the recovery set between compaction and the next assistant message.
  const compactionTools = stringListOrEmpty(config?.compactionTools, 'compactionTools')

  const residentTools = stringListOrEmpty(config?.residentTools, 'residentTools')
  const suppressedSources = sourceList(config?.suppressedContextSources, 'suppressedContextSources', DEFAULT_SUPPRESSED_SOURCES)

  const promotion = createEpochPromotion(['assistant/message'], { ctx, includeSubagents: config?.includeSubagents === true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  const selectedCounts = new WeakMap()

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
    }
  }

  /** Requested tool names remain visible across resume; assembly still filters them by the current callable catalog. */
  const unlocks = createSessionState(ctx, {
    key: 'noname-kit:tool-unlocks',
    stateVersion: 1,
    stateSchema: stateSchema((value) => value !== null && typeof value === 'object'
      && Array.isArray(value.names) && value.names.every((item) => typeof item === 'string' && item.length > 0), 'tool unlocks'),
    init: () => ({ names: [] }),
    apply(state, event) {
      if (event.type !== 'tool/call' || event.data?.name !== 'dev_tool_search') return state
      let args
      try { args = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments } catch { return state }
      if (args === null || typeof args !== 'object' || Array.isArray(args) || !Array.isArray(args.toolNames)) return state
      const names = [...new Set([...state.names, ...args.toolNames.filter((item) => typeof item === 'string' && item.length > 0)])]
      return names.length === state.names.length ? state : { names }
    },
  })
  ctx.on('session/event', (session, event) => unlocks.observe(session, event))
  const unlockedFor = (session) => session === undefined ? [] : unlocks.state(session).names

  await Promise.all([promotion.ready, unlocks.ready])

  /** Select declarations without changing the host's scoped admission or tool execution. */
  const selectTools = (tools, agent) => {
    const select = (chosen) => {
      if (agent !== undefined) selectedCounts.set(agent, chosen.length)
      return chosen
    }
    try {
      const status = promotion.status(agent)
      if (status.promoted || status.boundary < 0 || compactionTools.length === 0) {
        const available = new Set(tools.map((tool) => tool.name))
        const keep = new Set([
          ...SHELLS.filter((name) => available.has(name)),
          'str_replace_editor', ...RESIDENT_DISCOVERY_TOOLS,
          ...residentTools, ...unlockedFor(agent?.session),
        ])
        return select(tools.filter((tool) => keep.has(tool.name)))
      }
      const available = new Set(tools.map((tool) => tool.name))
      const selectedShells = SHELLS.filter((toolName) => available.has(toolName))
      // The question card is optional on hosts where only text questions are available.
      const missing = compactionTools.filter((toolName) => toolName !== 'ask_user_question' && !available.has(toolName))
      if (selectedShells.length === 0 || missing.length > 0) {
        warnOnce(name + ': expected at least one phase shell and every phase tool; '
          + 'shells=' + JSON.stringify(selectedShells) + ', missing=' + JSON.stringify(missing)
          + ' — bootstrap disabled, full catalog exposed')
        return select(tools)
      }
      const keep = new Set([...selectedShells, ...compactionTools])
      return select(tools.filter((tool) => keep.has(tool.name)))
    } catch (error) {
      warnOnce(name + ': bootstrap filter failed, exposing the full catalog: ' + String((error && error.message) || error))
      return select(tools)
    }
  }

  if (typeof ctx.tools?.setExecutor === 'function' && typeof ctx.tools?.resolve === 'function'
    && typeof ctx.tools?.executable === 'function') {
    // DSH 0.2.2+ reads declarations from the selected executor.
    // Register it in the preset's scope so the host rebinds it when presets change.
    const { NativeToolExecutor } = await import('@deepseek-ai/dsh-tool-executor-native')
    const native = new NativeToolExecutor(ctx)
    const scopes = []
    // The host evaluates prompt variables before tool declarations. Pass the agent scope
    // through a one-use token because describe() receives only the tools. Ambiguous tokens
    // fall back to the current scope's catalog, and unused tokens expire.
    ctx.systemPrompt.variable('noname_kit_bootstrap_scope', ({ scope }) => {
      const token = { scope }
      scopes.push(token)
      queueMicrotask(() => {
        const index = scopes.indexOf(token)
        if (index >= 0) scopes.splice(index, 1)
      })
      return undefined
    })
    ctx.tools.setExecutor({
      describe(tools) {
        if (scopes.length !== 1) {
          scopes.length = 0
          warnOnce(name + ': ambiguous assembly scope, exposing the full scoped catalog')
          return native.describe(tools)
        }
        return native.describe(selectTools(tools, scopes.pop().scope))
      },
      execute(input) { return native.execute(input) },
    })

  } else {
    // Older hosts expose declarations on the assembly waterfall.
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembled = await next()
      return { ...assembled, tools: selectTools(assembled.tools, context.agent) }
    })
  }


  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    try {
      const status = promotion.status(agent)
      let selected = decision
      // Older sessions may still have an empty declaration baseline. Start the
      // resident series once so newly available tools are not all deferred.
      const session = agent?.session
      if ((status.promoted || status.boundary < 0) && selectedCounts.get(agent) > 0 && typeof session?.requestHeader === 'function'
        && session.requestHeader() !== undefined) {
        const baseline = typeof session.toolHistory === 'function' ? session.toolHistory()?.tools : session.requestHeader().tools
        if (!Array.isArray(baseline) || baseline.length === 0) selected = { ...decision, startsRequestSeries: true }
      }
      if (status.promoted || status.boundary < 0 || suppressedSources.size === 0) return selected
      if (!Array.isArray(selected.messages)) return selected
      const kept = selected.messages.filter((message) => {
        const kind = message?.source?.kind
        return typeof kind !== 'string' || !suppressedSources.has(kind)
      })
      return kept.length === selected.messages.length ? selected : { ...selected, messages: kept }
    } catch (error) {
      // Keep the host's context if the recovery filter fails.
      warnOnce(`${name}: pre-step context filter failed, keeping injected context: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}

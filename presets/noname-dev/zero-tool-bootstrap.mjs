/**
 * Expose resident and discovered tools from the first real request.
 * Restore phase state from session events; compaction uses the configured recovery tool set.
 * Adapted from xiaobright/dsh-anchored-standard (MIT).
 */

import { createEpochPromotion } from './compaction-epoch.mjs'
import { createSessionState, stateSchema } from './session-state.mjs'


export const name = 'zero-tool-bootstrap'

/** Tool presentation is selected through the current host's tools service. */
export const inject = ['tools', 'systemPrompt']



/** Context source kinds suppressed during controlled requests by default. */
const DEFAULT_SUPPRESSED_SOURCES = ['skill-catalog', 'agent-instructions']

/** Shell tool candidates: custom-bash registers bash; pwsh is available on Windows. */
const SHELLS = ['bash', 'pwsh']

/** Discovery tools always resident during normal requests (the tool-search pattern). */
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

/** Register the per-session bootstrap filters. */
export async function apply(ctx, config) {
  // Core work set exposed after a compaction, before re-promotion.
  const compactionTools = stringListOrEmpty(config?.compactionTools, 'compactionTools')
  // Keep the configured development tools resident from the first request.
  
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
      // Logger unavailable — the guard exists only to avoid spamming.
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
      const missing = compactionTools.filter((toolName) => !available.has(toolName))
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
    // 0.2.2+: the selected executor owns declarations. Register on this
    // preset's standing scope so official scope rebinding handles preset
    // switches, existing blank sessions, child Agents, and disposal.
    const { NativeToolExecutor } = await import('@deepseek-ai/dsh-tool-executor-native')
    const native = new NativeToolExecutor(ctx)
    const scopes = []
    // The current host evaluates variables and tool providers synchronously,
    // in that order, before the asynchronous presentation waterfall. Carry an
    // assembly-local scope token to describe(), whose API only takes tools.
    // Reentrant or incomplete assembly must not select another Agent's phase:
    // ambiguous tokens retain the full scoped catalog, and unused tokens expire.
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


  // Register the context filter with prepend so it runs as the outermost pre-step transform.
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
      // A filter bug must never eat context: degrade to keeping every message.
      warnOnce(`${name}: pre-step context filter failed, keeping injected context: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}

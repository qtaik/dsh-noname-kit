/** Keep the first top-level request on an empty tool catalog, then expose configured resident tools and names unlocked by dev_tool_search. Promotion is reconstructed from durable session events. After compaction, expose shells and compactionTools until a new promotion signal appears. Filter configured context sources during controlled requests. Subagents start promoted unless includeSubagents is enabled; filter failures retain the full catalog. Adapted from xiaobright/dsh-anchored-standard (MIT). */

import { createEpochPromotion } from './compaction-epoch.mjs'
import { createSessionState, stateSchema } from './session-state.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'zero-tool-bootstrap'

/** Listeners access services at event time. prepend keeps the pre-step context filter outermost. */

/** Context source kinds suppressed during controlled requests by default. */
const DEFAULT_SUPPRESSED_SOURCES = ['skill-catalog', 'agent-instructions']

/** Shell tool candidates: custom-bash registers bash; pwsh is available on Windows. */
const SHELLS = ['bash', 'pwsh']

/** Discovery tools always resident after promotion (the tool-search pattern). */
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
export function apply(ctx, config) {
  // Core work set exposed after a compaction, before re-promotion.
  const compactionTools = stringListOrEmpty(config?.compactionTools, 'compactionTools')
  // noname-kit: extra tools that stay resident after promotion alongside the
  // shells / str_replace_editor / discovery set (the noname dev toolchain).
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

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    const select = (tools) => {
      if (context.agent !== undefined) selectedCounts.set(context.agent, tools.length)
      return { ...assembled, tools }
    }
    try {
      const status = promotion.status(context.agent)
      if (status.promoted) {
        // PROMOTED: keep the minimal resident set — the shells +
        // str_replace_editor + the discovery tools + whatever the model
        // explicitly unlocked via dev_tool_search — instead of dumping the
        // whole Standard catalog at once (the post-promotion regression fix).
        const available = new Set(assembled.tools.map((tool) => tool.name))
        const keep = new Set([
          ...SHELLS.filter((name) => available.has(name)),
          'str_replace_editor', ...RESIDENT_DISCOVERY_TOOLS,
          ...residentTools, ...unlockedFor(context.agent?.session),
        ])
        return select(assembled.tools.filter((tool) => keep.has(tool.name)))
      }
      const { boundary } = status
      // First request (no compaction yet): zero tools, the "we" anchor.
      if (boundary < 0) return select([])
      // Post-compaction: core work set so mid-task work can continue.
      if (compactionTools.length === 0) return select([])
      const available = new Set(assembled.tools.map((tool) => tool.name))
      const selectedShells = SHELLS.filter((toolName) => available.has(toolName))
      const missing = compactionTools.filter((toolName) => !available.has(toolName))
      if (selectedShells.length === 0 || missing.length > 0) {
        warnOnce(
          `${name}: expected at least one phase shell and every phase tool; `
          + `shells=${JSON.stringify(selectedShells)}, missing=${JSON.stringify(missing)} — `
          + 'bootstrap disabled, full catalog exposed',
        )
        return assembled
      }
      const keep = new Set([...selectedShells, ...compactionTools])
      return select(assembled.tools.filter((tool) => keep.has(tool.name)))
    } catch (error) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  })

  // Register the context filter with prepend so it runs as the outermost pre-step transform.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    try {
      const status = promotion.status(agent)
      let selected = decision
      // A zero-tool anchor has no inline declaration baseline. Start the resident
      // series once so the host does not defer every newly exposed tool.
      const session = agent?.session
      if (status.promoted && selectedCounts.get(agent) > 0 && typeof session?.requestHeader === 'function'
        && session.requestHeader() !== undefined) {
        const baseline = typeof session.toolHistory === 'function' ? session.toolHistory()?.tools : session.requestHeader().tools
        if (!Array.isArray(baseline) || baseline.length === 0) selected = { ...decision, startsRequestSeries: true }
      }
      if (status.promoted || suppressedSources.size === 0) return selected
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

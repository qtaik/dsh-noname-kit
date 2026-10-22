/** Track tool-bootstrap promotion per session and compaction boundary through durable host projections. Subagents start promoted unless includeSubagents is enabled. */

import { createSessionState, stateSchema } from './session-state.mjs'

/** Build one epoch-aware promotion tracker. */
export function createEpochPromotion(promoteEvents, options = {}) {
  const includeSubagents = options.includeSubagents === true
  const types = [...new Set(promoteEvents)].sort()
  const promote = new Set(types)
  const state = createSessionState(options.ctx, {
    key: 'noname-kit:promotion:' + JSON.stringify(types),
    stateVersion: 1,
    stateSchema: stateSchema((value) => value !== null && typeof value === 'object'
      && Number.isSafeInteger(value.boundary) && value.boundary >= -1 && typeof value.promoted === 'boolean', 'promotion'),
    init: () => ({ boundary: -1, promoted: false }),
    apply(entry, event) {
      const seq = event.seq ?? 0
      if (event.type === 'compaction/end') return { boundary: seq, promoted: false }
      if (promote.has(event.type) && seq > entry.boundary && !entry.promoted) return { ...entry, promoted: true }
      return entry
    },
  })
  return {
    /** Current bootstrap phase, rebuilt by the host when a session is restored. */
    status(agent) {
      if (agent === undefined || agent.session === undefined) return { boundary: -1, promoted: true }
      const session = agent.session
      if (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0) return { boundary: -1, promoted: true }
      return state.state(session)
    },
    /** Incremental feed retained for event-array hosts. */
    observe(session, event) { state.observe(session, event) },
  }
}

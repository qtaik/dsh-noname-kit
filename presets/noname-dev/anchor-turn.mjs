/** Queue one anchor before a fresh session's first user message. Durable pending input and consumed user history prevent duplicate anchors; cancelling unconsumed input permits a fresh anchor. */

import { createSessionState, stateSchema } from './session-state.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchor-turn'

/** Default anchor text shown to the model in the synthetic first user turn. */
export const ANCHOR_TEXT = 'This round is a test. Tools are not open yet; all tools will open next round.'

/** Current attribution plus the historical attribution accepted when reading older sessions. */
const isAnchor = (message) => message?.source?.kind === name || message?.source?.kind === 'plugin:' + name
  || (message?.source?.kind === 'plugin' && message.source.plugin === name)

/** Register the first-message anchor injection. */
export function apply(ctx, config) {
  const text = typeof config?.text === 'string' && config.text.length > 0 ? config.text : ANCHOR_TEXT
  const includeSubagents = config?.includeSubagents === true
  const history = createSessionState(ctx, {
    key: 'noname-kit:anchor-history',
    stateVersion: 3,
    stateSchema: stateSchema((value) => value !== null && typeof value === 'object'
      && typeof value.hasUser === 'boolean' && typeof value.inFlight === 'boolean' && value.pending !== null && typeof value.pending === 'object'
      && ['next-turn', 'next-step'].every((key) => Array.isArray(value.pending[key])
        && value.pending[key].every((item) => typeof item === 'boolean')), name),
    init: () => ({ hasUser: false, inFlight: false, pending: { 'next-turn': [], 'next-step': [] } }),
    apply(state, event) {
      if (event.type === 'user/message' && !state.hasUser) return { ...state, hasUser: true, inFlight: false }
      if (event.type === 'turn/end' && !state.hasUser && state.inFlight) return { ...state, inFlight: false }
      const splice = event.type === 'agent/inbox/spliced' ? event.data : undefined
      if (splice === undefined || !Object.hasOwn(state.pending, splice.target)) return state
      const queue = state.pending[splice.target]
      const next = [...queue]
      const removed = next.splice(splice.start, splice.removedCount ?? 0, ...(splice.inserted ?? []).map(isAnchor))
      const inFlight = state.inFlight || (splice.outcome !== 'canceled' && removed.some(Boolean))
      return { ...state, inFlight, pending: { ...state.pending, [splice.target]: next } }
    },
  })
  const inserting = new WeakSet()
  let warned = false
  ctx.on('session/event', (session, event) => history.observe(session, event))
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source?.kind === 'plugin' || isAnchor(message)) return
    const session = agent?.session
    if (!session || (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0)) return
    try {
      const state = history.state(session)
      if (state.hasUser || state.inFlight || Object.values(state.pending).some((queue) => queue.some(Boolean)) || inserting.has(session)) return
      inserting.add(session)
      try {
        agent.inbox.prepend('next-turn', {
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: name, form: 'notice', summary: 'zero-tool anchor turn' },
        })
      } finally { inserting.delete(session) }
    } catch (error) {
      if (warned) return
      warned = true
      try { ctx.logger.warn(name + ': could not establish fresh durable history; anchor skipped: ' + String(error?.message ?? error)) } catch {}
    }
  })
}

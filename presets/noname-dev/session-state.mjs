/** Read small durable preset state through the host projection registry, with an append-only event-array adapter for older hosts. Unavailable history is an error rather than a fresh session. */

/** Construct a JSON-state parser for the host projection checkpoint contract. */
export function stateSchema(validate, label) {
  return { parse(value) {
    if (!validate(value)) throw new TypeError(`${label}: invalid persisted preset state`)
    return value
  } }
}

/** Bind one pure fold to the current projection service or an older event-array host. */
export function createSessionState(ctx, definition) {
  const legacy = new WeakMap()
  let registered
  let handle

  const register = async () => {
    const service = typeof ctx?.get === 'function' ? ctx.get('sessionProjections') : undefined
    if (service === undefined) return undefined
    if (typeof service.register !== 'function') throw new TypeError('session-state: unsupported host projection service')
    registered = service
    const registration = await service.register(definition)
    if (typeof registration?.stateOf === 'function') handle = registration
    else if (typeof service.stateOf === 'function') handle = { stateOf: (session) => service.stateOf(session, definition.key) }
    else throw new TypeError('session-state: host projection registration has no reader')
  }
  // Await this while the plugin owns its lifecycle, before publishing consumers.
  const ready = register()

  const legacyEntry = (session) => {
    const events = session?.events
    if (!Array.isArray(events)) throw new TypeError('session-state: host supplies neither session projections nor a readable durable event array')
    let entry = legacy.get(session)
    if (entry === undefined || events.length < entry.count) {
      entry = { state: definition.init(session.header, session.inheritedEventCount), count: 0, seq: -1 }
      legacy.set(session, entry)
    }
    for (let index = entry.count; index < events.length; index++) {
      const event = events[index]
      if (Number.isSafeInteger(event?.seq) && event.seq <= entry.seq) continue
      entry.state = definition.apply(entry.state, event)
      entry.seq = Number.isSafeInteger(event?.seq) ? event.seq : entry.seq + 1
    }
    entry.count = events.length
    return entry
  }

  return {
    ready,
    state(session) {
      if (session === null || typeof session !== 'object') throw new TypeError('session-state: a readable session is required')
      if (registered !== undefined) {
        if (handle === undefined) throw new TypeError('session-state: projection registration is not ready')
        const value = handle.stateOf(session)
        if (value === undefined) throw new TypeError(`session-state: projection ${definition.key} is unavailable`)
        return value
      }
      return legacyEntry(session).state
    },
    /** Older hosts may publish a committed event before exposing a new array snapshot. */
    observe(session, event) {
      if (session === null || typeof session !== 'object' || registered !== undefined) return
      const entry = legacy.get(session)
      if (entry === undefined || (Number.isSafeInteger(event?.seq) && event.seq <= entry.seq)) return
      entry.state = definition.apply(entry.state, event)
      entry.seq = Number.isSafeInteger(event?.seq) ? event.seq : entry.seq + 1
      if (Array.isArray(session.events)) entry.count = session.events.length
    },
  }
}

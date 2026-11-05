/**
 * Search the current callable tool catalog and unlock names for later requests.
 * Unlocks are recorded in session events so they survive resume and compaction.
 */


export const name = 'dev-tool-search'

/** The tools registry must exist before this tool can register. */
export const inject = ['tools']

const MAX_RESULTS = 25

/** Minimal JSON schema compiler for tool parameters (zero dependencies). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (meta.description) prop.description = meta.description
    if (meta.items) prop.items = meta.items
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Describe capabilities outside the resident set so the model can discover tools on demand. */
const UNLOCKABLE_INDEX = [
  'web_search — internet search and web retrieval',
  'subagent / subagent_fork — delegate work to sub-agents',
  'workflow — run multi-agent workflow scripts',
  'ralph — fresh-agent iterative loop',
  'create_goal / get_goal / update_goal — long-running goals',
  'read_image — read image files',
  'job_list / job_output / job_kill — background jobs',
  'interrupt_agent / send_message / list_agents — multi-agent control',
  'todo_write — task tracking',
  'ask_user_question — ask the user',
]

/** Register the model-facing `dev_tool_search` tool. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'dev_tool_search',
    description: [
      'Discover and unlock tools that are NOT currently available.',
      '',
      'This session starts with a resident set: bash/pwsh, str_replace_editor, skill_search, skill_load, dev_tool_search, plus the resident noname dev toolchain (noname_* tools). Everything else is unlocked on demand through this tool.',
      '',
      'If the current task needs any of the following, call dev_tool_search FIRST — do not try to work around them with bash:',
      ...UNLOCKABLE_INDEX.map((line) => `- ${line}`),
      '',
      'Usage: pass `query` to search the catalog (returns matching tool names + descriptions), then pass `toolNames` with exact names to unlock them. Unlocked tools appear from the next request on and stay unlocked for the session.',
    ].join('\n'),
    parameters: toJsonSchema({
      query: { type: 'string', required: false, description: 'search keywords (e.g. "web", "subagent")' },
      toolNames: { type: 'array', required: false, description: 'exact tool names to unlock', items: { type: 'string' } },
      offset: { type: 'integer', required: false, description: 'zero-based matching result offset; use nextOffset to continue' },
      limit: { type: 'integer', required: false, description: 'results per page, 1–25; default 25' },
    }),
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string' }, total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' },
          hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
          unlocked: { type: 'array', items: { type: 'string' } }, unavailable: { type: 'array', items: { type: 'string' } },
        }, required: ['text'],
      },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute(args, exec) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const unlock = [...new Set(Array.isArray(args.toolNames) ? args.toolNames.filter((name) => typeof name === 'string' && name.length > 0) : [])]
      const offset = args.offset ?? 0
      const limit = args.limit ?? MAX_RESULTS
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
        return { text: 'Provide offset as a nonnegative safe integer and limit as an integer from 1 to 25.' }
      }
      if (query.length === 0 && unlock.length === 0) {
        return { text: 'Provide `query` to search the catalog, or `toolNames` to unlock tools.' }
      }
      try {
        // Read through the executing scope, retaining registry restrictions and presentation rules.
        const schemas = ctx.tools.schemas(exec?.agent, exec?.toolSet).filter((schema) => {
          if (typeof ctx.tools.executable === 'function') {
            return ctx.tools.executable(schema.name, exec?.agent, exec?.toolSet) !== undefined
          }
          if (typeof ctx.tools.resolveExecution === 'function') {
            return ctx.tools.resolveExecution(schema.name, exec?.agent, exec?.parent !== undefined) !== undefined
          }
          return typeof ctx.tools.get !== 'function' || ctx.tools.get(schema.name, exec?.agent) !== undefined
        })
        const available = new Set(schemas.map((schema) => schema.name))
        const unlocked = unlock.filter((name) => available.has(name))
        const unavailable = unlock.filter((name) => !available.has(name))
        const result = { text: '', unlocked, unavailable }
        const lines = []
        if (unlocked.length > 0) lines.push(`Unlocked for the next request: ${unlocked.join(', ')}`)
        if (unavailable.length > 0) lines.push(`Unavailable in this calling scope; not unlocked: ${unavailable.join(', ')}`)
        if (query.length > 0) {
          const normalized = query.toLocaleLowerCase()
          const wanted = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [normalized]
          const matches = schemas.filter((schema) => {
            const haystack = `${schema.name} ${schema.description ?? ''}`.toLocaleLowerCase()
            return wanted.every((token) => haystack.includes(token))
          })
          const page = matches.slice(offset, offset + limit)
          const hasMore = offset + page.length < matches.length
          Object.assign(result, { total: matches.length, offset, limit, hasMore, ...(hasMore ? { nextOffset: offset + page.length } : {}) })
          if (matches.length === 0) lines.push(`No tools match "${query}".`)
          else if (page.length === 0) lines.push(`No tools at offset ${offset}; ${matches.length} total matches.`)
          else {
            lines.push(`Matching tools (${offset + 1}–${offset + page.length} of ${matches.length}):`)
            for (const schema of page) {
              const desc = (schema.description || '').split('\n')[0].slice(0, 90)
              lines.push(`- ${schema.name}: ${desc}`)
            }
          }
          if (hasMore) lines.push(`Continue with the same query, offset=${result.nextOffset} and limit=${limit}.`)
          if (matches.length > 0) lines.push('Unlock with dev_tool_search({"toolNames": ["<exact name>"]}).')
        }
        result.text = lines.join('\n')
        return result
      } catch (error) {
        return { text: `Catalog search/unlock unavailable: ${String((error && error.message) || error)}`, unlocked: [], unavailable: unlock }
      }
    },
  })
}

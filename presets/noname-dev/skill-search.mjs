/** Discover and load skills on demand. skill_search returns bounded name and description matches; skill_load reads one exact skill and injects it for the next request through agent.inject. Discovery is scoped to the calling agent. Do not mount dsh-tool-skill alongside this replacement, because it injects the full catalog. */

import { ensureWorkingDirectory } from './working-directory.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-search'

/** The agent, tools, and skills services must exist before these tools can register. */
export const inject = ['agents', 'tools', 'skills']

const MAX_RESULTS = 20
let hostRenderer

/** Use the current host's canonical wrapper, with a compatible wrapper on older hosts. */
async function renderSkill(skill) {
  hostRenderer ??= import('@deepseek-ai/dsh-skill').then((mod) => mod.renderSkillContent ?? renderCompatibleSkill).catch((error) => {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
    return renderCompatibleSkill
  })
  return (await hostRenderer)(skill)
}

/** Absent invocation controls retain compatibility with hosts predating invocation policy. */
function modelInvocable(skill) {
  return skill?.invocation === undefined || skill.invocation?.modelInvocable === true
}

function checkSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('Skill lookup aborted')
}

function searchTokens(query) {
  const normalized = query.toLocaleLowerCase()
  return normalized.match(/[\p{L}\p{N}_-]+/gu) ?? (normalized.length > 0 ? [normalized] : [])
}


/** Minimal JSON schema compiler for tool parameters (zero dependencies). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Register the two on-demand skill tools. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'skill_search',
    description: 'Search the available skills by keyword and return matching skill names with short descriptions. This session keeps NO skill catalog in the prompt — if a task looks like it matches a skill (document conversion, image processing, game reviews, markdown, PDF, spreadsheets, …), call skill_search FIRST to find it, then skill_load to activate it. Do NOT assume skill names from memory.',
    parameters: toJsonSchema({
      query: { type: 'string', required: true, description: 'search keywords (Unicode supported); an empty string lists all model-invocable skills' },
      offset: { type: 'integer', required: false, description: 'zero-based matching result offset; use nextOffset to continue' },
      limit: { type: 'integer', required: false, description: 'results per page, 1–20; default 20' },
    }),
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string' }, total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' },
          hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
        }, required: ['text'],
      },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute(args, exec) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const offset = args.offset ?? 0
      const limit = args.limit ?? MAX_RESULTS
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
        return { text: 'Provide offset as a nonnegative safe integer and limit as an integer from 1 to 20.' }
      }
      const wanted = searchTokens(query)
      const scope = exec?.agent ?? ctx
      try {
        const cwd = await ensureWorkingDirectory(ctx, exec?.agent, exec?.signal)
        const all = await ctx.skills.list({ scope, cwd, signal: exec?.signal })
        checkSignal(exec?.signal)
        const matches = all.filter((skill) => {
          if (!modelInvocable(skill)) return false
          const haystack = `${skill.name} ${skill.description ?? ''} ${skill.whenToUse ?? ''}`.toLocaleLowerCase()
          return wanted.every((token) => haystack.includes(token))
        })
        const page = matches.slice(offset, offset + limit)
        const hasMore = offset + page.length < matches.length
        const result = { text: '', total: matches.length, offset, limit, hasMore, ...(hasMore ? { nextOffset: offset + page.length } : {}) }
        const lines = []
        if (matches.length === 0) lines.push(`No skills match "${query}". Use skill_search with other keywords.`)
        else if (page.length === 0) lines.push(`No skills at offset ${offset}; ${matches.length} total matches.`)
        else {
          lines.push(`Matching skills (${offset + 1}–${offset + page.length} of ${matches.length}):`)
          for (const skill of page) lines.push(`- ${skill.name}: ${(skill.description || '').split('\n')[0]}`)
        }
        if (hasMore) lines.push(`Continue with the same query, offset=${result.nextOffset} and limit=${limit}.`)
        if (matches.length > 0) lines.push('Load one with skill_load (exact name).')
        result.text = lines.join('\n')
        return result
      } catch (error) {
        return { text: `skill_search unavailable: ${String((error && error.message) || error)}` }
      }
    },
  })

  ctx.tools.register({
    name: 'skill_load',
    description: 'Load the full instructions of ONE skill by its exact name (from skill_search results) and inject them for the next request. Call this before acting on a task that matches the skill.',
    parameters: toJsonSchema({
      name: { type: 'string', required: true, description: 'exact skill name (kebab-case, from skill_search)' },
    }),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute(args, exec) {
      try {
        const agent = exec?.agent
        if (agent === undefined) return { text: 'skill_load requires an agent context.' }
        const cwd = await ensureWorkingDirectory(ctx, agent, exec?.signal)
        const lookup = { scope: agent, cwd, signal: exec?.signal }
        const summary = (await ctx.skills.list(lookup)).find((item) => item.name === args.name)
        checkSignal(exec?.signal)
        if (summary === undefined) {
          return { text: `No skill named "${args.name}". Run skill_search to list available skills.` }
        }
        if (!modelInvocable(summary)) {
          return { text: `Skill "${args.name}" is not available for model invocation.` }
        }
        const skill = await ctx.skills.get(args.name, lookup)
        checkSignal(exec?.signal)
        if (skill === undefined) {
          return { text: `No skill named "${args.name}". Run skill_search to list available skills.` }
        }
        if (!modelInvocable(skill)) {
          return { text: `Skill "${args.name}" is not available for model invocation.` }
        }
        const content = extractSkillBody(skill)
        if (content.trim().length === 0) {
          return { text: `Skill "${args.name}" has no loadable body.` }
        }
        const body = await renderSkill({ ...skill, name: skill.name ?? args.name, provider: skill.provider ?? 'legacy', content })
        checkSignal(exec?.signal)
        // Queue the skill content as a non-waking next-step context message,
        // exactly like dsh-tool-skill's invocation injection.
        agent.inject({
          id: `skill-load-${args.name}-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: body }],
          source: { kind: 'skill-invocation', name: args.name, form: 'instructions' },
        })
        return { text: `Skill "${args.name}" loaded; its instructions will be injected for the next request.` }
      } catch (error) {
        return { text: `skill_load failed: ${String((error && error.message) || error)}` }
      }
    },
  })
}

/** Extract the model-facing body of a loaded skill definition. */
function extractSkillBody(skill) {
  const content = skill?.content ?? skill?.instructions ?? skill?.body
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n')
  }
  return ''
}

/** Preserve resource coordinates when an older host does not export its renderer. */
function renderCompatibleSkill(skill) {
  const escapeText = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const escapeAttr = (value) => escapeText(value).replaceAll('"', '&quot;')
  const base = skill.resourceBase
  let hints
  if (base === undefined) hints = [`Resources for this skill are managed by provider "${escapeText(skill.provider)}".`, 'Load referenced resources only as needed.']
  else if (base.kind === 'directory') hints = [`Base directory for this skill: ${escapeText(base.path)}`, 'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.']
  else if (base.kind === 'url') hints = [`Base URL for this skill: ${escapeText(base.url)}`, 'Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.']
  else if (base.kind === 'opaque') hints = [`Resources for this skill: ${escapeText(base.description)}`, 'Load referenced resources only as needed.']
  else throw new Error(`Unsupported skill resource base: ${String(base?.kind)}`)
  return [`<skill_content name="${escapeAttr(skill.name)}">`, '<skill_resources>', ...hints, '</skill_resources>', '', '<skill_instructions>', skill.content, '</skill_instructions>', '</skill_content>'].join('\n')
}

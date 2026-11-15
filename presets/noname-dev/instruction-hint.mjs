/** List instruction files once per session and working directory. The agent reads their contents when relevant. */

import { createEpochPromotion } from './compaction-epoch.mjs'
import { ensureWorkingDirectory } from './working-directory.mjs'


export const name = 'instruction-hint'

const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

const PROJECT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']
const USER_GLOBAL_CANDIDATE = 'AGENTS.md'

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

/** Find the closest ancestor with a repository marker, falling back to the working directory. */
async function findProjectRoot(fs, cwd, signal) {
  let current = cwd
  for (;;) {
    for (const marker of ['.git', '.hg', '.svn']) {
      try {
        const target = await fs.resolve(joinPath(current, marker), { cwd, signal })
        const info = await fs.stat(target, signal)
        if (info !== undefined) return current
      } catch {
      }
    }
    const parent = parentPath(current)
    if (parent === current || parent.length === 0) return cwd
    current = parent
  }
}

async function presentInDir(fs, dir, candidates, signal) {
  const found = []
  for (const candidate of candidates) {
    try {
      const target = await fs.resolve(joinPath(dir, candidate), { cwd: dir, signal })
      const info = await fs.stat(target, signal)
      if (info !== undefined && info.type === 'file') found.push(candidate)
    } catch {
    }
  }
  return found
}

function joinPath(dir, segment) {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + segment
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + segment
}

function parentPath(path) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx <= 0) return path
  const parent = path.slice(0, idx)
  return parent.length === 0 ? path : parent
}

export async function apply(ctx, config) {
  const promoteEvents = parsePromoteOn(config.promoteOn)
  const promotion = createEpochPromotion(promoteEvents, { ctx })
  await promotion.ready
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  const hinted = new Set()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
    }
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      const status = promotion.status(agent)
      if (!status.promoted && status.boundary >= 0) return decision
      const session = agent.session
      if (session === undefined) return decision
      const fs = ctx.get('fs')
      if (fs === undefined) return decision
      const cwd = await ensureWorkingDirectory(ctx, agent, signal) ?? process.cwd()
      const hintKey = JSON.stringify([session.id, cwd])
      if (hinted.has(hintKey)) return decision
      hinted.add(hintKey)

      const projectFiles = []
      const root = await findProjectRoot(fs, cwd, signal)
      projectFiles.push(...await presentInDir(fs, root, PROJECT_CANDIDATES, signal))

      const userGlobalFiles = []
      try {
        const dshHome = process.env.DSH_HOME ?? (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\.dsh` : undefined)
        if (dshHome !== undefined) {
          userGlobalFiles.push(...await presentInDir(fs, dshHome, [USER_GLOBAL_CANDIDATE], signal))
        }
      } catch {
      }

      const sections = []
      if (projectFiles.length > 0) {
        sections.push(`Workspace instruction files exist: ${projectFiles.join(', ')} (project root: ${root}).`)
      }
      if (userGlobalFiles.length > 0) {
        sections.push(`A user-global instruction file exists: ${USER_GLOBAL_CANDIDATE}.`)
      }
      if (sections.length === 0) return decision

      const text = [
        ...sections,
        'Do NOT assume their content. When a task touches this workspace, read the relevant instruction files first and follow them.',
      ].join(' ')

      return {
        ...decision,
        messages: [...decision.messages, {
          id: `instruction-hint-${session.id}-${hinted.size}`,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'instruction-hint', form: 'hint' },
        }],
      }
    } catch (error) {
      warnOnce(`${name}: hint injection failed, skipping: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}

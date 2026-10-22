import { createRequire } from 'node:module'
import { posix } from 'node:path'
import { isEntryId } from './entry-id.js'

const { parse } = createRequire(import.meta.url)('acorn')
const aliases = new Map([
  ['skill', 'skill'], ['skills', 'skill'], ['card', 'card'], ['cards', 'card'],
  ['character', 'character'], ['characters', 'character'], ['translate', 'translate'], ['translates', 'translate'],
])
const kinds = new Set(['character', 'card', 'skill', 'translate'])
const lifecycle = new Set(['content', 'precontent', 'arenaReady'])
const translationName = /^(?:character|card|skill)?translat(?:e|es|ion|ions)$/i
const auxiliary = new Set(['sort', 'rank', 'replace', 'perfectpairs', 'intro', 'filter', 'characterfilter', 'dynamictranslate', 'pinyin'])
const parseCache = new Map()
const structureCache = new Map()
const MAX_BYTES = 12 * 1024 * 1024
const MAX_DEPTH = 40

function keyOf(prop) {
  if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init' || prop.method) return null
  const id = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
  return isEntryId(id) ? id : null
}
function fieldOf(prop) {
  if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') return null
  const id = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
  return isEntryId(id) ? id : null
}
function members(node) {
  if (node?.type !== 'MemberExpression') return null
  const rest = members(node.object) || (node.object.type === 'Identifier' ? [node.object.name] : null)
  const key = node.computed ? node.property.type === 'Literal' && node.property.value : node.property.name
  return rest && typeof key === 'string' ? [...rest, key] : null
}
function parseSource(code) {
  if (parseCache.has(code)) return parseCache.get(code)
  const result = { ast: null, comments: [], error: '', sourceType: null }
  if (Buffer.byteLength(code, 'utf8') > MAX_BYTES) result.error = 'Source exceeds static parser size limit'
  else for (const sourceType of ['module', 'script']) {
    const comments = []
    try {
      result.ast = parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true, onComment: comments })
      result.comments = comments
      result.sourceType = sourceType
      result.error = ''
      break
    } catch (error) { result.error = error.message }
  }
  if (parseCache.size >= 8) parseCache.delete(parseCache.keys().next().value)
  parseCache.set(code, result)
  return result
}
function hintFor(file) {
  const parts = String(file || '').replaceAll('\\', '/').toLowerCase().split('/')
  const base = (parts.pop() || '').replace(/\.js$/i, '')
  if (aliases.has(base)) return aliases.get(base)
  if (translationName.test(base)) return 'translate'
  if (auxiliary.has(base)) return null
  for (let i = 0; i < parts.length; i++) if (kinds.has(parts[i])) return parts[i]
  return null
}
function patternNames(node, out = []) {
  if (!node) return out
  if (node.type === 'Identifier') out.push(node.name)
  else if (node.type === 'RestElement') patternNames(node.argument, out)
  else if (node.type === 'AssignmentPattern') patternNames(node.left, out)
  else if (node.type === 'ArrayPattern') node.elements.forEach(n => patternNames(n, out))
  else if (node.type === 'ObjectPattern') node.properties.forEach(p => patternNames(p.type === 'RestElement' ? p.argument : p.value, out))
  return out
}
function moduleModel(code, file) {
  const parsed = parseSource(code)
  let scopeSequence = 0
  const root = { id: scopeSequence++, parent: null, functionScope: null, bindings: new Map(), controlled: false, fn: null }
  root.functionScope = root
  const model = { code, file, ...parsed, root, nodeScopes: new WeakMap(), parents: new WeakMap(), objects: new Map(), calls: [], imports: [], exports: [], assignments: [], topDeclarations: [] }
  if (!parsed.ast) return model
  const mutations = []
  function bind(scope, name, node, imported = null) {
    if (scope.bindings.has(name)) scope.bindings.set(name, { node: null, scope, mutated: true })
    else scope.bindings.set(name, { node, scope, imported, mutated: false })
  }
  function walk(node, scope, parent = null) {
    if (!node || typeof node !== 'object') return
    if (parent) model.parents.set(node, parent)
    model.nodeScopes.set(node, scope)
    if (/^(?:FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) bind(scope, node.id.name, node)
      const inner = { id: scopeSequence++, parent: scope, bindings: new Map(), controlled: false, fn: node }
      inner.functionScope = inner
      if (node.id) bind(inner, node.id.name, null)
      for (const param of node.params) for (const name of patternNames(param)) bind(inner, name, null)
      for (const param of node.params) walk(param, inner, node)
      walk(node.body, inner, node)
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration' && node.id) bind(scope, node.id.name, null)
      const inner = { id: scopeSequence++, parent: scope, bindings: new Map(), functionScope: scope.functionScope, controlled: true, fn: scope.fn }
      if (node.id) bind(inner, node.id.name, null)
      walk(node.superClass, scope, node); walk(node.body, inner, node)
      return
    }
    if (['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause', 'StaticBlock', 'WithStatement'].includes(node.type)) {
      scope = { id: scopeSequence++, parent: scope, bindings: new Map(), functionScope: scope.functionScope, controlled: true, fn: scope.fn }
      model.nodeScopes.set(node, scope)
      if (node.type === 'CatchClause') for (const name of patternNames(node.param)) bind(scope, name, null)
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        const at = node.kind === 'var' ? scope.functionScope : scope
        for (const name of patternNames(decl.id)) bind(at, name, decl.id.type === 'Identifier' ? decl.init : null)
      }
    }
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.type === 'ImportNamespaceSpecifier' ? '*' : spec.imported.name || spec.imported.value
        const data = { source: node.source.value, imported, local: spec.local.name }
        model.imports.push(data); bind(scope, spec.local.name, null, data)
      }
    }
    if (node.type === 'ExportDefaultDeclaration') model.exports.push({ name: 'default', node: node.declaration })
    if (node.type === 'ExportNamedDeclaration') {
      for (const spec of node.specifiers || []) model.exports.push({ name: spec.exported.name || spec.exported.value, node: spec.local, source: node.source?.value })
      if (node.declaration?.type === 'VariableDeclaration') for (const decl of node.declaration.declarations) {
        if (decl.id.type === 'Identifier') model.exports.push({ name: decl.id.name, node: decl.id })
      }
      if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id) model.exports.push({ name: node.declaration.id.name, node: node.declaration })
    }
    if (node.type === 'ObjectExpression') model.objects.set(node.start, node)
    if (node.type === 'CallExpression') model.calls.push({ node, scope })
    if (node.type === 'AssignmentExpression') {
      model.assignments.push(node)
      if (node.left.type === 'Identifier') mutations.push({ name: node.left.name, scope })
    }
    if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') mutations.push({ name: node.argument.name, scope })
    for (const [key, value] of Object.entries(node)) {
      if (key === 'id' && /Declaration$/.test(node.type)) continue
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) walk(child, scope, node) })
      else if (value?.type) walk(value, scope, node)
    }
  }
  walk(parsed.ast, root)
  for (const item of mutations) {
    let at = item.scope
    while (at && !at.bindings.has(item.name)) at = at.parent
    if (at) at.bindings.get(item.name).mutated = true
  }
  for (const statement of parsed.ast.body) {
    const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (node?.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') model.topDeclarations.push(d)
  }
  return model
}

/** Static module graph over caller-supplied sources. No filesystem or extension execution. */
export function sourceModel(code, options = {}) {
  const file = String(options.file || '').replaceAll('\\', '/')
  const supplied = options.modules instanceof Map ? options.modules : new Map(Object.entries(options.modules || {}))
  const sources = new Map(supplied)
  sources.set(file, code)
  const models = new Map()
  const sections = new Map()
  const tables = []
  const registrations = []
  const unresolved = []
  const physical = new Set(), visitedTables = new Set(), activeTables = new Set(), activeGroups = new Set(), visitedDescriptors = new Set(), registered = new Set()
  const allowedFunctions = new Set()
  const engineFactories = new Set()
  const derivedProperties = new Set()
  const addIssue = (m, reason, kind) => {
    if (!unresolved.some(x => x.file === m.file && x.reason === reason && x.kind === kind)) unresolved.push({ file: m.file, reason, ...(kind ? { kind } : {}) })
  }
  const getModel = name => {
    if (!models.has(name)) models.set(name, moduleModel(sources.get(name), name))
    return models.get(name)
  }
  const main = getModel(file)
  function importedModel(m, source) {
    if (typeof source !== 'string' || !source.startsWith('.')) return null
    const target = posix.normalize(posix.join(posix.dirname(m.file), source))
    if (target.startsWith('../') || target.startsWith('/') || !sources.has(target)) return null
    return getModel(target)
  }
  function exportRef(m, name, trail) {
    const token = 'export:' + m.file + ':' + name
    if (trail.has(token) || trail.size > MAX_DEPTH) { addIssue(m, 'Cyclic or deep export reference'); return null }
    trail = new Set(trail).add(token)
    const ex = m.exports.filter(e => e.name === name)
    if (ex.length !== 1) return null
    if (ex[0].source) {
      const target = importedModel(m, ex[0].source)
      return target ? exportRef(target, ex[0].node.name || ex[0].node.value, trail) : null
    }
    const node = ex[0].node
    return resolve(node.type === 'FunctionDeclaration' && node.id ? node.id : node, m, trail)
  }
  function resolve(node, m, trail = new Set()) {
    if (!node || trail.size > MAX_DEPTH) return null
    if (node.type !== 'Identifier') return { node, m }
    let scope = m.nodeScopes.get(node) || m.root
    while (scope && !scope.bindings.has(node.name)) scope = scope.parent
    const token = m.file + ':' + scope?.id + ':' + node.name
    if (!scope || trail.has(token)) return null
    const binding = scope.bindings.get(node.name)
    if (binding.mutated) return null
    const next = new Set(trail).add(token)
    if (binding.imported) {
      const target = importedModel(m, binding.imported.source)
      return target ? exportRef(target, binding.imported.imported, next) : null
    }
    return resolve(binding.node, m, next)
  }
  function valueOf(node, m) {
    const ref = resolve(node, m)
    return ref?.node.type === 'Literal' ? ref.node.value : null
  }
  function primitive(node, m) {
    const ref = resolve(node, m)
    if (!ref) return { known: false }
    if (ref.node.type === 'Literal' && !ref.node.regex && typeof ref.node.value !== 'bigint') return { known: true, value: ref.node.value }
    if (ref.node.type === 'UnaryExpression' && ref.node.operator === '!') {
      const argument = primitive(ref.node.argument, ref.m)
      if (argument.known) return { known: true, value: !argument.value }
    }
    return { known: false }
  }
  function registrationFlow(m, call) {
    let child = call, conditional = false
    for (let parent = m.parents.get(child); parent; child = parent, parent = m.parents.get(child)) {
      if (/^(?:FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(parent.type)) break
      if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
        if (child === parent.test) continue
        const test = primitive(parent.test, m), positive = child === parent.consequent
        if (test.known && !!test.value !== positive) return { reachable: false, conditional: false }
        if (!test.known) conditional = true
      } else if (parent.type === 'LogicalExpression' && child === parent.right) {
        const test = primitive(parent.left, m)
        if (!test.known) conditional = true
        else if (parent.operator === '&&' && !test.value || parent.operator === '||' && test.value || parent.operator === '??' && test.value != null) return { reachable: false, conditional: false }
      } else if (['ForStatement', 'WhileStatement'].includes(parent.type) && child === parent.body) {
        const test = parent.test ? primitive(parent.test, m) : { known: true, value: true }
        if (test.known && !test.value) return { reachable: false, conditional: false }
        if (!test.known) conditional = true
      } else if (['ForInStatement', 'ForOfStatement', 'SwitchCase', 'CatchClause'].includes(parent.type)) conditional = true
    }
    return { reachable: true, conditional }
  }
  function hostGame(m, scope) {
    let at = scope
    while (at && !at.bindings.has('game')) at = at.parent
    if (!at) return true
    const binding = at.bindings.get('game')
    if (binding.mutated) return false
    if (binding.imported) return binding.imported.source === 'noname' && binding.imported.imported === 'game'
    return binding.node == null && at.fn?.params?.[1]?.type === 'Identifier' && at.fn.params[1].name === 'game'
      && engineFactories.has(m.file + ':' + at.fn.start)
  }
  function characterConstructor(node, m) {
    if (node.type !== 'NewExpression' || node.arguments.length !== 1 || !['ObjectExpression', 'ArrayExpression'].includes(node.arguments[0]?.type)) return false
    const provenance = (callee, at, trail = new Set()) => {
      if (!callee || trail.size > MAX_DEPTH) return false
      if (callee.type === 'Identifier') {
        let scope = at.nodeScopes.get(callee) || at.root
        while (scope && !scope.bindings.has(callee.name)) scope = scope.parent
        const key = at.file + ':' + scope?.id + ':' + callee.name
        if (!scope || trail.has(key)) return false
        const binding = scope.bindings.get(callee.name)
        if (binding.mutated) return false
        if (binding.imported) {
          const imported = binding.imported
          const target = imported.source.startsWith('.') ? posix.normalize(posix.join(posix.dirname(at.file), imported.source)) : imported.source
          return imported.imported === 'Character' && ['noname', 'noname/library/element/index.js'].includes(target)
        }
        return provenance(binding.node, at, new Set(trail).add(key))
      }
      const chain = members(callee)
      if (!chain || chain.length !== 3 || chain[1] !== 'element' || chain[2] !== 'Character') return false
      let scope = at.nodeScopes.get(callee) || at.root
      while (scope && !scope.bindings.has(chain[0])) scope = scope.parent
      const binding = scope?.bindings.get(chain[0])
      return !binding?.mutated && binding?.imported?.source === 'noname' && binding.imported.imported === 'lib'
    }
    return provenance(node.callee, m)
  }
  function propertyData(prop, m) {
    const name = keyOf(prop)
    if (name == null) return null
    let value = prop.value
    if (characterConstructor(value, m)) value = value.arguments[0]
    let skills = value.type === 'ObjectExpression' ? value.properties.find(p => keyOf(p) === 'skills')?.value
      : value.type === 'ArrayExpression' ? value.elements[3] : null
    const hasSkills = !!skills
    const resolvedSkills = skills && resolve(skills, m)
    skills = resolvedSkills?.node
    const skillIds = skills?.type === 'ArrayExpression' ? skills.elements.map(n => valueOf(n, resolvedSkills.m)).filter(isEntryId) : []
    const skillsDynamic = hasSkills && (!skills || skills.type !== 'ArrayExpression' || skillIds.length !== skills.elements.length)
    return { name, start: prop.start, end: prop.end - 1, valueType: prop.value.type, skillIds, skillsDynamic,
      ...(prop.value.type === 'Literal' && typeof prop.value.value === 'string' ? { literalValue: prop.value.value } : {}),
      ...(prop.value.type === 'NewExpression' ? { readOnly: true, characterConstructor: characterConstructor(prop.value, m) } : {}) }
  }
  function contentShape(prop, m, kind, inferred = false) {
    if (!keyOf(prop)) return false
    const value = prop.value
    if (kind === 'translate') return value.type !== 'ObjectExpression' && value.type !== 'FunctionExpression' && value.type !== 'ArrowFunctionExpression'
    if (kind === 'character' && characterConstructor(value, m)) return true
    if (kind === 'skill') return value.type === 'ObjectExpression'
    if (value.type === 'ObjectExpression') {
      if (!inferred || kind !== 'character' || !value.properties.length) return true
      return value.properties.some(p => ['sex', 'group', 'hp', 'skills'].includes(keyOf(p)))
    }
    if (value.type !== 'ArrayExpression') return false
    return !inferred || kind !== 'character' || value.elements.length >= 4 && value.elements[3]?.type === 'ArrayExpression'
  }
  function intrinsic(m, node, name) {
    let scope = m.nodeScopes.get(node) || m.root
    while (scope) {
      if (scope.bindings.has(name)) return false
      scope = scope.parent
    }
    return !m.assignments.some(assignment => {
      const chain = members(assignment.left)
      return chain?.[0] === name || assignment.left.type === 'Identifier' && assignment.left.name === name
    })
  }
  function staticObjects(node, m, trail = new Set()) {
    const ref = resolve(node, m)
    if (!ref || trail.size > MAX_DEPTH) return null
    node = ref.node; m = ref.m
    if (node.type === 'ObjectExpression') return [ref]
    const token = m.file + ':' + node.start
    if (trail.has(token) || node.type !== 'CallExpression' || !intrinsic(m, node, 'Object')) return null
    const next = new Set(trail).add(token), chain = members(node.callee)?.join('.')
    if (chain === 'Object.freeze' && node.arguments.length === 1) return staticObjects(node.arguments[0], m, next)
    if (chain === 'Object.defineProperty' && node.arguments.length === 3 && intrinsic(m, node, 'Symbol')
      && members(node.arguments[1])?.join('.') === 'Symbol.toStringTag') {
      const meta = node.arguments[2]
      if (meta.type === 'ObjectExpression' && meta.properties.length === 1 && keyOf(meta.properties[0]) === 'value'
        && meta.properties[0].value.type === 'Literal' && meta.properties[0].value.value === 'Module') return staticObjects(node.arguments[0], m, next)
      return null
    }
    if (chain !== 'Object.assign' || !node.arguments.length) return null
    const result = []
    for (const arg of node.arguments) {
      const objects = arg.type === 'SpreadElement' ? mappedModuleObjects(arg.argument, m, next) : staticObjects(arg, m, next)
      if (!objects) return null
      result.push(...objects)
      if (result.length > 512) return null
    }
    return result
  }
  function mappedModuleObjects(node, m, trail) {
    const ref = resolve(node, m)
    if (!ref || ref.node.type !== 'CallExpression') return null
    node = ref.node; m = ref.m
    const map = node.callee, callback = node.arguments[0]
    if (map.type !== 'MemberExpression' || map.computed || map.property.name !== 'map' || node.arguments.length !== 1
      || callback?.type !== 'ArrowFunctionExpression' || callback.async || callback.params.length !== 1 || callback.params[0].type !== 'Identifier') return null
    const selected = members(callback.body)
    if (selected?.length !== 2 || selected[0] !== callback.params[0].name || selected[1] !== 'default') return null
    const values = resolve(map.object, m)
    if (values?.node.type !== 'CallExpression' || members(values.node.callee)?.join('.') !== 'Object.values'
      || values.node.arguments.length !== 1 || !intrinsic(values.m, values.node, 'Object')) return null
    const containers = staticObjects(values.node.arguments[0], values.m, trail)
    if (!containers) return null
    const modules = new Map()
    for (const container of containers) for (const prop of container.node.properties) {
      if (prop.type !== 'Property' || prop.computed || prop.method || prop.kind !== 'init') return null
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) return null
      modules.set(key, { node: prop.value, m: container.m })
    }
    const result = []
    for (const module of modules.values()) {
      const namespaces = staticObjects(module.node, module.m, trail)
      if (namespaces?.length !== 1) return null
      const namespace = namespaces[0], props = namespace.node.properties
      if (props.some(p => p.type !== 'Property' || p.computed || p.method || p.kind !== 'init')) return null
      const defaults = props.filter(p => fieldOf(p) === 'default')
      if (defaults.length !== 1) return null
      const objects = staticObjects(defaults[0].value, namespace.m, trail)
      if (!objects) return null
      result.push(...objects)
      if (result.length > 512) return null
    }
    return result
  }
  function addTable(node, m, kind, inferred = false, depth = 0, derived = false) {
    if (depth > MAX_DEPTH) { addIssue(m, 'Static table depth limit', kind); return }
    const ref = resolve(node, m)
    if (!ref || ref.node.type !== 'ObjectExpression') {
      const objects = staticObjects(node, m)
      if (objects) for (const object of objects) addTable(object.node, object.m, kind, inferred, depth + 1, true)
      else addIssue(m, 'Unresolved content table', kind)
      return
    }
    node = ref.node; m = ref.m
    const token = m.file + ':' + node.start + ':' + kind
    if (activeTables.has(token)) { addIssue(m, 'Cyclic table spread', kind); return }
    const explicit = node.properties.filter(p => p.type !== 'SpreadElement' && keyOf(p))
    const own = explicit.filter(p => contentShape(p, m, kind, inferred))
    if (inferred && explicit.length && !own.length && !node.properties.some(p => p.type === 'SpreadElement')) return
    if (derived) for (const prop of node.properties) {
      derivedProperties.add(m.file + ':' + prop.start)
      for (const table of tables) if (table.file === m.file && table.start === prop.start) { table.readOnly = true; table.indirect = true }
    }
    if (visitedTables.has(token)) return
    visitedTables.add(token)
    activeTables.add(token)
    if (!sections.has(kind)) sections.set(kind, new Map())
    sections.get(kind).set(m.file + ':' + node.start, { open: node.start, close: node.end - 1, file: m.file })
    const wrapper = node.properties.some(p => keyOf(p) === kind && p.value.type === 'ObjectExpression')
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') { addTable(prop.argument, m, kind, inferred, depth + 1, derived); continue }
      const id = keyOf(prop)
      if (wrapper && kinds.has(id)) {
        if (derived && kind === 'translate' && id !== 'translate') { addIssue(m, 'Non-translation field in a derived translation table', 'translate'); continue }
        addTable(prop.value, m, id, false, depth + 1, derived); continue
      }
      if (id === kind && prop.value.type === 'ObjectExpression') { addTable(prop.value, m, kind, false, depth + 1, derived); continue }
      if (kinds.has(id) || ['package', 'help', 'config', 'content', 'precontent', 'name', 'author', 'version', 'connect', 'type', 'list', 'editable', 'arenaReady'].includes(id)) continue
      if (!contentShape(prop, m, kind, inferred)) continue
      const key = m.file + ':' + prop.start + ':' + kind
      if (physical.has(key)) continue
      physical.add(key)
      const data = propertyData(prop, m)
      tables.push({ kind, id, file: m.file, start: prop.start, end: prop.end - 1, sectionStart: node.start, sectionEnd: node.end - 1, valueType: prop.value.type,
        readOnly: !!data.readOnly || derived || m.file !== file, indirect: derived || m.file !== file, skillIds: data.skillIds, skillsDynamic: data.skillsDynamic,
        ...(data.literalValue !== undefined ? { literalValue: data.literalValue } : {}), text: m.code.slice(prop.start, prop.end) })
    }
    activeTables.delete(token)
  }
  function grouped(node, m, kind) {
    const ref = resolve(node, m)
    if (!ref || ref.node.type !== 'ObjectExpression') { addIssue(m, 'Unresolved grouped content table', kind); return }
    const token = ref.m.file + ':' + ref.node.start + ':' + kind
    if (activeGroups.has(token)) { addIssue(ref.m, 'Cyclic grouped table spread', kind); return }
    activeGroups.add(token)
    for (const p of ref.node.properties) {
      if (p.type === 'SpreadElement') { grouped(p.argument, ref.m, kind); continue }
      if (!keyOf(p) || p.value.type === 'ArrayExpression') continue
      addTable(p.value, ref.m, kind)
    }
    activeGroups.delete(token)
  }
  function descriptor(node, m, depth = 0, required = false) {
    if (depth > MAX_DEPTH) { if (required) addIssue(m, 'Package descriptor depth limit'); return }
    const ref = resolve(node, m)
    if (!ref) { if (required) addIssue(m, 'Unresolved package descriptor'); return }
    node = ref.node; m = ref.m
    if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)) {
      allowedFunctions.add(m.file + ':' + node.start)
      if (node.body.type === 'ObjectExpression') descriptor(node.body, m, depth + 1, required)
      else {
        let returns = 0
        const visit = n => {
          if (!n || typeof n !== 'object') return
          if (n.type === 'ReturnStatement') { returns++; descriptor(n.argument, m, depth + 1, required); return }
          if (/Function/.test(n.type || '')) return
          for (const v of Object.values(n)) {
            if (Array.isArray(v)) v.forEach(x => { if (x?.type) visit(x) })
            else if (v?.type) visit(v)
          }
        }
        visit(node.body)
        if (!returns && required) addIssue(m, 'Package factory has no static return')
      }
      return
    }
    if (node.type !== 'ObjectExpression') { if (required) addIssue(m, 'Package descriptor requires runtime evaluation'); return }
    const token = m.file + ':' + node.start + ':' + required
    if (visitedDescriptors.has(token)) return
    visitedDescriptors.add(token)
    for (const prop of node.properties) {
      const name = fieldOf(prop)
      if (prop.type === 'SpreadElement') { descriptor(prop.argument, m, depth + 1, required); continue }
      if (kinds.has(name)) addTable(prop.value, m, name)
      else if (name === 'package') descriptor(prop.value, m, depth + 1, true)
      else if (name === 'characterPack') grouped(prop.value, m, 'character')
      else if (name === 'cardPack') grouped(prop.value, m, 'card')
      else if (lifecycle.has(name) && /Function/.test(prop.value?.type || '')) allowedFunctions.add(m.file + ':' + prop.value.start)
    }
  }
  function objectDescriptors(node, m) {
    const ref = resolve(node, m)
    if (!ref) return []
    if (ref.node.type === 'ObjectExpression') return [ref]
    const found = []
    if (/Function/.test(ref.node.type)) {
      if (ref.node.body.type === 'ObjectExpression') return [{ node: ref.node.body, m: ref.m }]
      const visit = n => {
        if (!n || typeof n !== 'object') return
        if (n.type === 'ReturnStatement') { const r = resolve(n.argument, ref.m); if (r?.node.type === 'ObjectExpression') found.push(r); return }
        if (/Function/.test(n.type || '')) return
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(x => { if (x?.type) visit(x) })
          else if (v?.type) visit(v)
        }
      }
      visit(ref.node.body)
    }
    return found
  }
  function register(m, call, kind, idNode, arg, flow = { conditional: false }) {
    const idValue = valueOf(idNode, m)
    const id = isEntryId(idValue) ? idValue : null
    const targets = objectDescriptors(arg, m)
    const token = m.file + ':' + call.start
    if (registered.has(token)) return
    registered.add(token)
    if (flow.conditional) addIssue(m, 'Registration depends on a runtime condition', kind)
    if (!targets.length) {
      registrations.push({ kind, id, file: m.file, descriptor: null, start: call.start, end: call.end - 1, dynamic: true })
      if (kind === 'mode') addIssue(m, 'Dynamic or unresolved mode registration', kind)
    } else for (const target of targets) {
      const isImport = members(call.callee)?.join('.') === 'game.import'
      const named = valueOf(target.node.properties.find(p => keyOf(p) === 'name')?.value, target.m)
      const effectiveId = isImport ? (isEntryId(named) ? named : null) : id
      if (kind === 'mode' && !effectiveId) addIssue(m, 'Mode identifier is dynamic', kind)
      registrations.push({ kind, id: effectiveId, file: m.file,
        descriptor: { file: target.m.file, open: target.node.start, close: target.node.end - 1 }, start: call.start, end: call.end - 1, dynamic: !effectiveId || flow.conditional,
        ...(flow.conditional ? { conditional: true } : {}) })
      descriptor(target.node, target.m)
    }
  }
  function process(m) {
    if (!m.ast) { addIssue(m, 'Parse failed: ' + m.error); return }
    for (const d of m.topDeclarations) if (aliases.has(d.id.name) && d.init) addTable(d.id, m, aliases.get(d.id.name))
    if (hintFor(m.file) === 'translate') for (const exported of m.exports) {
      if (exported.name === 'default' || !translationName.test(exported.name)) continue
      if (aliases.has(exported.name) && m.topDeclarations.some(d => d.id.name === exported.name)) continue
      const target = exportRef(m, exported.name, new Set())
      if (target && visitedTables.has(target.m.file + ':' + target.node.start + ':translate')) continue
      if (target?.node.type === 'ObjectExpression') addTable(target.node, target.m, 'translate', true, 0, true)
      else addIssue(m, 'Unresolved named translation export', 'translate')
    }
    const exported = m.exports.find(e => e.name === 'default')
    if (exported) {
      const target = exportRef(m, 'default', new Set())
      if (target) {
        descriptor(target.node, target.m)
        const node = target.node
        const isDescriptor = node.type === 'ObjectExpression' && node.properties.some(p => ['name', 'package', 'start', 'precontent', 'content', 'characterPack', 'cardPack'].includes(keyOf(p)))
        const hint = hintFor(m.file)
        if (hint && node.type === 'ObjectExpression' && !isDescriptor) {
          const base = posix.basename(m.file).replace(/\.js$/i, '')
          const derived = hint === 'translate' && !aliases.has(base.toLowerCase()) && translationName.test(base)
          if (!derived || !visitedTables.has(target.m.file + ':' + node.start + ':translate')) addTable(node, target.m, hint, true, 0, derived)
        }
        const typeBinding = m.root.bindings.get('type')
        const type = typeBinding && valueOf(typeBinding.node, m)
        const modeFile = /(?:^|\/)mode\/(?:[^/]+\.js|[^/]+\/index\.js)$/.test(m.file)
        if (type === 'mode' || modeFile) {
          for (const d of objectDescriptors(target.node, target.m)) {
            const id = valueOf(d.node.properties.find(p => keyOf(p) === 'name')?.value, d.m)
            registrations.push({ kind: 'mode', id: isEntryId(id) ? id : null, file: d.m.file, descriptor: { file: d.m.file, open: d.node.start, close: d.node.end - 1 },
              start: d.node.start, end: d.node.end - 1, dynamic: !isEntryId(id) })
          }
        }
      } else addIssue(m, 'Unresolved default export')
    }
    for (const { node, scope } of m.calls) {
      const chain = members(node.callee)
      if (chain?.join('.') === 'game.import' && scope === m.root && hostGame(m, scope)) {
        const kind = valueOf(node.arguments[0], m)
        if (['extension', 'character', 'card', 'mode'].includes(kind)) {
          const factory = resolve(node.arguments[1], m)
          if (factory && /Function/.test(factory.node.type)) engineFactories.add(factory.m.file + ':' + factory.node.start)
          descriptor(node.arguments[1], m)
          register(m, node, kind, node.arguments[0], node.arguments[1])
        }
      }
    }
  }
  process(main)
  if (options.allModules) for (const name of sources.keys()) if (name !== file) process(getModel(name))
  // Roots reached by imports are registered too, without opening unrelated files.
  for (const m of models.values()) {
    const scopeDepth = scope => { let n = 0; for (; scope; scope = scope.parent) if (scope.fn) n++; return n }
    for (const { node, scope } of [...m.calls].sort((a, b) => scopeDepth(a.scope) - scopeDepth(b.scope) || a.node.start - b.node.start)) {
      if (members(node.callee)?.join('.') !== 'game.addMode') continue
      const flow = registrationFlow(m, node)
      if (!flow.reachable) continue
      if (tables.some(t => t.file === m.file && t.kind !== 'translate' && node.start > t.start && node.end - 1 < t.end)) continue
      const allowed = (scope === m.root || scope.fn && allowedFunctions.has(m.file + ':' + scope.fn.start)) && hostGame(m, scope)
      if (allowed) register(m, node, 'mode', node.arguments[0], node.arguments[1], flow)
      else addIssue(m, 'Registration outside a trusted direct lifecycle or using a shadowed game binding', 'mode')
    }
  }
  const assignedIds = []
  for (const node of main.assignments) {
    const chain = members(node.left)
    if (chain?.length === 3 && ['pack', 'lib'].includes(chain[0]) && ['skill', 'character', 'card'].includes(chain[1]) && isEntryId(chain[2])) assignedIds.push(chain[2])
  }
  const ownObjects = new Map()
  for (const [open, node] of main.objects) ownObjects.set(open, {
    close: node.end - 1, properties: node.properties.map(p => {
      const data = propertyData(p, main)
      return data && derivedProperties.has(main.file + ':' + p.start) ? { ...data, readOnly: true, indirect: true } : data
    }).filter(Boolean),
  })
  const ownSections = new Map()
  for (const [kind, values] of sections) ownSections.set(kind, new Map([...values].filter(([,s]) => s.file === file).map(([,s]) => [s.open, { open: s.open, close: s.close }])))
  const errors = [...models.values()].filter(m => !m.ast).map(m => ({ file: m.file, message: m.error }))
  return { parsed: !!main.ast, syntaxOk: !!main.ast, parseError: main.error, parseSourceType: main.sourceType, errors,
    objects: ownObjects, sections: ownSections, comments: main.comments, assignedIds: [...new Set(assignedIds)],
    imports: main.imports, exports: main.exports.map(e => ({ name: e.name, ...(e.node.type === 'Identifier' ? { local: e.node.name } : {}) })),
    registrations, tables, unresolved }
}

export function sourceStructure(code, options = {}) {
  if (options.modules || options.allModules) return sourceModel(code, options)
  const file = options.file || ''
  const key = file + '\0' + code
  if (structureCache.has(key)) return structureCache.get(key)
  const model = sourceModel(code, options)
  if (structureCache.size >= 8) structureCache.delete(structureCache.keys().next().value)
  structureCache.set(key, model)
  return model
}
export function sourceSections(code, name, options = {}) {
  return [...(sourceStructure(code, options).sections.get(aliases.get(name) || name)?.values() || [])].sort((a, b) => a.open - b.open)
}
export function sourceProperties(code, open, close, options = {}) {
  const object = sourceStructure(code, options).objects.get(open)
  return object?.close === close ? object.properties : []
}
export function commentTrivia(code, start, end, comma = false, options = {}) {
  const comments = new Map(sourceStructure(code, options).comments.map(c => [c.start, c.end]))
  let commas = 0
  for (let i = start; i < end;) {
    if (/\s/.test(code[i])) i++
    else if (comma && code[i] === ',' && commas++ === 0) i++
    else if (comments.has(i) && comments.get(i) <= end) i = comments.get(i)
    else return false
  }
  return true
}


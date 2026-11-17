import { createRequire } from 'node:module'
import { loadPackageSources, PACKAGE_READ_LIMITS } from './package-read.js'

const { parse } = createRequire(import.meta.url)('acorn')
const PREFIX = 'nnkMechanic_'
const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const METHODS = new Map([
  ['skill-type', 'createSkill'],
  ['shared-rule', 'resolve'],
  ['global-rule', 'install'],
])

/** Cheap candidate filter; the AST still decides whether a declaration exists. */
export function hasMechanicCandidates(code) {
  if (typeof code !== 'string') return false
  if (code.includes(PREFIX)) return true
  if (!code.includes('\\u')) return false
  // JavaScript identifiers may spell ASCII with fixed or code-point escapes.
  // Decode only those characters needed by PREFIX, without evaluating source.
  return code.replace(/\\u(?:([0-9a-f]{4})|\{([0-9a-f]+)\})/gi, (escape, fixed, point) => {
    const value = Number.parseInt(fixed || point, 16)
    return value <= 0x7f ? String.fromCharCode(value) : escape
  }).includes(PREFIX)
}

function staticText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked
  return null
}

function propertyName(node) {
  if (node.type !== 'Property') return null
  if (!node.computed && node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'number') return String(node.key.value)
  return staticText(node.key)
}

function readDefinition(declaration, declarationKind, file, warnings) {
  const binding = declaration.id.name
  const id = binding.slice(PREFIX.length)
  const line = declaration.id.loc.start.line
  const source = { file, line }
  const definition = { source, claims: new Set(), start: declaration.start }
  if (ID_PATTERN.test(id)) definition.claims.add(id)
  function reject(reason) {
    warnings.push(`${file}:${line} ${binding}：${reason}`)
    return definition
  }

  if (declaration.init?.type !== 'ObjectExpression') return reject('机制定义应直接使用对象字面量。')
  definition.objectRange = [declaration.init.start, declaration.init.end]
  const fields = new Map()
  let ambiguousFields = false
  for (const property of declaration.init.properties) {
    const key = propertyName(property)
    if (key === 'id') {
      const advertisedId = staticText(property.value)
      if (advertisedId !== null && ID_PATTERN.test(advertisedId)) definition.claims.add(advertisedId)
    }
    if (key === null || fields.has(key)) {
      ambiguousFields = true
      continue
    }
    fields.set(key, property)
  }
  if (ambiguousFields) return reject('机制定义中的属性名应为可确定且唯一的键，不能通过展开添加属性。')

  if (declarationKind !== 'const') return reject('请使用 const 声明机制。')
  if (!ID_PATTERN.test(id)) return reject('ID 应以小写字母开头，后续只能使用小写字母、数字或下划线，长度为 1–64。')
  if (staticText(fields.get('id')?.value) !== id) return reject(`id 应为与变量名一致的静态文本「${id}」。`)

  const name = staticText(fields.get('name')?.value)
  const description = staticText(fields.get('description')?.value)
  if (!name?.trim() || !description?.trim()) return reject('name 和 description 应为非空的静态文本。')

  const kind = staticText(fields.get('kind')?.value)
  const method = METHODS.get(kind)
  if (!method) return reject('kind 应为 skill-type、shared-rule 或 global-rule。')
  const implementation = fields.get(method)
  if (implementation?.kind !== 'init' || implementation.value.generator ||
      !['FunctionExpression', 'ArrowFunctionExpression'].includes(implementation.value.type)) {
    return reject(`缺少 ${kind} 所需的 ${method} 函数定义。`)
  }
  definition.mechanic = { id, name, kind, description, ...source }
  return definition
}

function scanMechanics(code, file) {
  const definitions = [], warnings = []
  if (typeof code !== 'string') return { definitions, warnings, error: `${file}：源码应为字符串。` }
  if (Buffer.byteLength(code, 'utf8') > PACKAGE_READ_LIMITS.fileBytes) {
    return { definitions, warnings, error: `${file}：源码超过静态读取上限。` }
  }

  let ast, parseError
  for (const sourceType of ['module', 'script']) {
    try {
      ast = parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true, locations: true })
      break
    } catch (error) {
      parseError = error
    }
  }
  if (!ast) return { definitions, warnings, error: `${file}：无法静态解析源码：${parseError.message}` }

  const pending = [ast]
  while (pending.length) {
    const node = pending.pop()
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (declaration.id.type === 'Identifier' && declaration.id.name.startsWith(PREFIX)) {
          definitions.push(readDefinition(declaration, node.kind, file, warnings))
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) pending.push(child)
      } else if (value?.type) {
        pending.push(value)
      }
    }
  }
  definitions.sort((left, right) => left.start - right.start)
  return { definitions, warnings }
}

function availableMechanics(definitions, warnings) {
  const claims = new Map()
  for (const definition of definitions) {
    for (const id of definition.claims) {
      if (!claims.has(id)) claims.set(id, [])
      claims.get(id).push(definition.source)
    }
  }
  for (const [id, sources] of claims) {
    if (sources.length > 1) {
      warnings.push(`机制 ID「${id}」重复定义：${sources.map(({ file, line }) => `${file}:${line}`).join('、')}。`)
    }
  }
  return definitions.flatMap(({ mechanic }) => mechanic && claims.get(mechanic.id).length === 1 ? [mechanic] : [])
}

/** Inspect a single source file without reading any files or executing the extension. */
export function inspectMechanics(code, { file = 'extension.js', includeRanges = false } = {}) {
  const { definitions, warnings, error } = scanMechanics(code, file)
  if (error) return { ok: false, mechanics: [], error }
  const mechanics = availableMechanics(definitions, warnings)
  return {
    ok: !warnings.length,
    mechanics,
    ...(warnings.length ? { warnings } : {}),
    ...(includeRanges ? { objectRanges: definitions.flatMap(item => item.objectRange ? [item.objectRange] : []) } : {}),
  }
}

/** Discover definitions in the selected package, retaining useful results from readable files. */
export async function listMechanics(nonameDir, folder, { excludeFile = '' } = {}) {
  try {
    // The source writer may use inspectMechanics for validation without an eager module cycle.
    const { safeFolderPath } = await import('./write.js')
    const { full } = safeFolderPath(nonameDir, folder)
    const { modules, coverage } = await loadPackageSources(full)
    const rootGap = coverage.gaps.find(gap => gap.file === '' && gap.code === 'unreadable-directory')
    if (rootGap) return { ok: false, mechanics: [], error: `无法读取扩展包「${folder}」：${rootGap.message}` }

    const warnings = coverage.gaps.map(gap => `机制扫描不完整，${gap.file || folder}：${gap.message}`)
    const definitions = []
    for (const [file, code] of modules) {
      if (process.platform === 'win32' ? file.toLowerCase() === excludeFile.toLowerCase() : file === excludeFile) continue
      const scanned = scanMechanics(code, file)
      if (scanned.error) warnings.push(`机制扫描不完整，${scanned.error}`)
      for (const warning of scanned.warnings) warnings.push(warning)
      for (const definition of scanned.definitions) definitions.push(definition)
    }
    const mechanics = availableMechanics(definitions, warnings)
    const availableIds = new Set(mechanics.map(item => item.id))
    const unavailableIds = [...new Set(definitions.flatMap(({ claims }) => [...claims]).filter(id => !availableIds.has(id)))]
    return { ok: true, mechanics, ...(warnings.length ? { warnings } : {}), ...(unavailableIds.length ? { unavailableIds } : {}) }
  } catch (error) {
    return { ok: false, mechanics: [], error: error.message }
  }
}

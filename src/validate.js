/**
 * noname-kit 校验器:纯静态检查,不执行任何用户代码。
 *
 * 语法检查的原理:剥掉 import/export 后用 new Function 编译
 * (new Function 只编译不执行函数体),能抓住全角引号、漏括号、
 * await 用在非 async 里等语法级错误。
 * 结构规则来自官方教程与实战:全角标点、name 一致性、translate
 * 补齐、enable 技的 ai 字段、新旧写法混用。
 */
import { STRUCTURAL_NAMES, findAllSections, sectionProperties } from './blocks.js'

/** 代码区(字符串/注释之外)不允许出现的全角标点。 */
const FULLWIDTH = /[，。；：？！“”‘’【】（）〈〉《》、※]/

/**
 * 扫描出字符串与注释覆盖的字符区间,返回 (index → 是否在字符串/注释内) 的判定函数。
 * 支持单引号/双引号/模板串、行注释、块注释;不处理转义以外的怪癖,足够用于标点扫描。
 * @param {string} code
 */
function buildCodeMask(code) {
  const mask = new Uint8Array(code.length) // 1 = 字符串或注释内
  let i = 0
  while (i < code.length) {
    const c = code[i]
    const n = code[i + 1]
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') mask[i++] = 1
    } else if (c === '/' && n === '*') {
      mask[i++] = 1; mask[i++] = 1
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) mask[i++] = 1
      if (i < code.length) { mask[i++] = 1; mask[i++] = 1 }
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c
      mask[i++] = 1
      while (i < code.length) {
        if (code[i] === '\\') { mask[i++] = 1; if (i < code.length) mask[i++] = 1; continue }
        if (code[i] === quote) { mask[i++] = 1; break }
        mask[i++] = 1
      }
    } else {
      i++
    }
  }
  return mask
}

function lineOf(code, index) {
  let line = 1
  for (let i = 0; i < index && i < code.length; i++) if (code[i] === '\n') line++
  return line
}

/** 找出代码区的全角标点(最多报 10 处)。 */
function scanFullwidth(code) {
  const mask = buildCodeMask(code)
  const found = []
  for (let i = 0; i < code.length; i++) {
    if (mask[i]) continue
    if (FULLWIDTH.test(code[i])) {
      found.push({ line: lineOf(code, i), message: `代码区出现全角标点「${code[i]}」(第 ${lineOf(code, i)} 行)。字符串里的中文标点没问题,但语法区必须用半角。` })
      if (found.length >= 10) break
    }
  }
  return found
}

function detectStyle(code) {
  const classic = /game\s*\.\s*import\s*\(\s*['"]extension['"]/.test(code)
  const module = /export\s+default/.test(code)
  return { classic, module }
}

/**
 * 剥掉 ES Module 语法,保留行号(被剥的行换成等量换行),再用 new Function 编译。
 * 不执行任何代码:new Function 只编译函数体。
 */
/** 纯语法检查(不跑扩展语义规则):迁移自检用——迁移只加注释行,语法不变,
 * 而子目录模块文件(如 character/character.js 的 const character = {…})本来
 * 就不是完整扩展,没有 name 字段,validateExtensionCode 的语义规则对它不适用。 */
export function syntaxCheck(code, style) {
  return compileCheck(code, style)
}

function compileCheck(code, style) {
  if (style === 'classic') {
    try { new Function(code); return { ok: true } } catch (error) {
      return { ok: false, message: `语法错误: ${error.message}` }
    }
  }
  const stripped = code
    .replace(/^import\s*\{[^}]*\}\s*from\s*(['"])[^'"]*\1\s*;?[ \t]*$/gm, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/^import\s+\*\s+as\s+\w+\s+from\s*(['"])[^'"]*\1\s*;?[ \t]*$/gm, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/^import\s+\w+\s+from\s*(['"])[^'"]*\1\s*;?[ \t]*$/gm, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/^import\s*(['"])[^'"]*\1\s*;?[ \t]*$/gm, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/^export\s+default\s+/gm, 'var __nonameDefault = ')
    .replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/^export\s+(?=(async\s+)?(const|let|var|function|class)\b)/gm, '')
  try { new Function(stripped); return { ok: true } } catch (error) {
    return { ok: false, message: `语法错误: ${error.message}` }
  }
}

/** 从代码里猜扩展 name 字段的值。 */
function extractName(code) {
  const m = code.match(/\bname\s*:\s*(['"])([^'"]+)\1/)
  return m ? m[2] : null
}

/**
 * 启发式收集代码里定义的内部 ID(技能/武将/卡牌键名)。
 * 覆盖常见写法:pack.skill.xxx / pack.character.xxx / pack.card.xxx 赋值、
 * 对象键 "id": {...}、lib.translate.<id> =(只统计像 ID 的 ASCII 键)。
 */
/**
 * 启发式收集代码里定义的内部 ID(技能/武将/卡牌键名)。
 * 主路径=字符串感知的区段枚举(skill/character/card 各区段的 depth-1 属性,
 * 兼容裸键/引号键/任意嵌套布局;与区块扫描器共用实现)。
 * 附带老式运行时赋值:pack.skill.xxx = / lib.character.xxx =。
 * 不用逐键正则的原因:嵌套容器会让 lastIndex 争抢漏收真实 ID,裸键则完全
 * 不识别——区段枚举对两种布局都可靠。
 * 注意:**不收 translate 条目**——防丢护栏关心的是「定义」;若并入翻译键,
 * 改技能键而残留旧翻译时护栏会失明。
 */
export function collectDefinedIds(code) {
  const ids = new Set()
  const reAssign = /(?:pack|lib)\s*\.\s*(?:skill|character|card)\s*\.\s*([A-Za-z][\w]*)\s*=/g
  let m
  while ((m = reAssign.exec(code)) !== null) ids.add(m[1])
  for (const section of ['skill', 'character', 'card']) {
    for (const sec of findAllSections(code, section)) {
      for (const p of sectionProperties(code, sec.open, sec.close)) {
        if (STRUCTURAL_NAMES.has(p.name)) continue
        ids.add(p.name)
      }
    }
  }
  return [...ids]
}

/**
 * 校验一份无名杀扩展代码。
 * @param {object} input
 * @param {string} input.code - 扩展代码全文。
 * @param {'classic'|'module'} input.style - 用户选定的写法。
 * @param {'character'|'card'} input.kind - 任务类型。
 * @param {string} [input.folder] - 目标文件夹名(用于 name 一致性检查)。
 * @returns {{ok:boolean, style:string, errors:Array, warnings:Array}}
 */
export function validateExtensionCode({ code, style, kind, folder, idPrefix }) {
  const errors = []
  const warnings = []
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, style, errors: [{ message: '代码为空' }], warnings }
  }

  const detected = detectStyle(code)
  if (detected.classic && detected.module) {
    errors.push({ message: '检测到 game.import 与 export default 同时存在:老式/新式写法混用会导致扩展无法加载,只能二选一。' })
  }
  const effective = detected.module ? 'module' : 'classic'
  if ((style === 'module' && !detected.module) || (style === 'classic' && !detected.classic)) {
    warnings.push({ message: `你选的是${style === 'module' ? '新版 ES Module' : '老版 game.import'}写法,但代码看起来是${effective === 'module' ? '新式' : '老式'}——请确认。` })
  }

  // 1) 语法编译检查
  const compile = compileCheck(code, effective)
  if (!compile.ok) errors.push({ message: compile.message })

  // 2) 全角标点
  errors.push(...scanFullwidth(code))

  // 2.5) ID 前缀约定:收集到的内部 ID 若提供了前缀,未以之开头的报 warning
  if (idPrefix && /^[A-Za-z][\w-]*$/.test(idPrefix)) {
    const ids = collectDefinedIds(code)
    const offenders = ids.filter((id) => !id.startsWith(idPrefix))
    if (offenders.length > 0) {
      warnings.push({
        message: `以下内部 ID 未使用前缀「${idPrefix}」:${offenders.slice(0, 8).join(', ')}${offenders.length > 8 ? ' 等' : ''}——lib.skill/character/card 与 translate 键是全局命名空间,不加前缀容易与其他扩展包冲突。`,
      })
    }
  }

  // 3) name 字段与文件夹一致性
  const name = extractName(code)
  if (!name) {
    errors.push({ message: '没有找到扩展的 name 字段(返回对象里的 name: "扩展名")。' })
  } else if (folder && name !== folder) {
    const msg = `扩展 name 为「${name}」,与目标文件夹名「${folder}」不一致——新式写法要求二者完全一致,否则不加载。`
    if (effective === 'module') errors.push({ message: msg })
    else warnings.push({ message: msg + '(老式写法建议也保持一致)' })
  }

  // 4) translate 补齐
  if (!/lib\s*\.\s*translate\s*\.\s*\w+\s*=|translate\s*:/.test(code)) {
    warnings.push({ message: '没有发现任何 translate(翻译)定义——游戏里技能/武将/卡牌会显示原始 ID。每个 id 需要 <id> 与 <id>_info 两条。' })
  }

  // 5) 主动技的 ai 字段
  const enableCount = (code.match(/\benable\s*:/g) || []).length
  const aiCount = (code.match(/\bai\s*:\s*\{/g) || []).length
  if (enableCount > 0 && aiCount === 0) {
    warnings.push({ message: '检测到 enable(主动技)但没有 ai 字段——AI 角色不会正确使用该技能,主动技必须写 ai。' })
  }

  // 6) 按任务类型的结构提示
  if (kind === 'character') {
    if (!/\bsex\s*:/.test(code) || !/\bhp\s*:/.test(code) || !/\bskills\s*:/.test(code)) {
      warnings.push({ message: '武将条目通常需要 sex / group / hp / skills 四个字段,请核对。' })
    }
  } else if (kind === 'card') {
    if (!/\btype\s*:\s*['"]/.test(code)) {
      warnings.push({ message: '卡牌定义通常需要 type 字段(basic/trick/equip/delay)与 fullskin 等,请核对。' })
    }
    if (!/list\s*:/.test(code)) {
      warnings.push({ message: '卡牌一般还需要 package.card.list(牌堆条目),否则游戏里摸不到这张牌。' })
    }
  }

  // 7) 新式写法的 import 头
  if (effective === 'module' && !/from\s*(['"])[^'"]*noname\.js\1/.test(code)) {
    warnings.push({ message: '新式扩展需要 import { lib, game, ui, get, ai, _status } from "../../noname.js",当前代码没有引入。' })
  }

  return { ok: errors.length === 0, style: effective, errors, warnings }
}

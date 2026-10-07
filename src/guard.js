/**
 * 守卫:保护游戏 `extension/` 目录不被通用工具(AI 的 bash / write / edit)直接改写。
 *
 * 为什么需要:扩展代码必须走 noname_write_extension(校验门禁 + 覆盖前备份 +
 * 防丢护栏)。早期版本是纯字符串包含比对,实测四类写法全部绕过:
 *   ① 正斜杠  D:/game/extension/x/extension.js
 *   ② git-bash 盘符  /d/game/extension/x/extension.js
 *   ③ 缩进目录后相对路径  cd .../extension/x && echo x > extension.js
 *   ④ 进程 cwd 与会话 cwd 不同时,write/edit 的相对路径守卫失效
 * 这里改成:路径先在"可能的工作目录"下归一化(分隔符/盘符形态/.. 折叠),
 * 再判断是否落在扩展根内;bash 命令另做"先 cd 再相对写"的组合判定。
 *
 * 设计边界(用户拍板):
 *   - 只拦**写**(重定向 / rm / mv / cp / tee / sed -i);纯读命令照旧放行。
 *   - 只拦 extension 这一个根;游戏本体、家目录、临时目录一概不动。
 *   - 命中时给出出路(改用专用工具;确有需要请用户确认后手动执行)。
 */

import { isAbsolute, normalize, resolve } from 'node:path'

/* 下面几条正则刻意只用 [^...] 取反类、不用 \s 与点号,避免跨行吞掉整条命令;
   它们只负责"圈出可疑片段",真正的归属判断交给 pathHitsProtected。 */
const NOT_SEP = '[^;|&<>()\\n]'

/** 重定向目标:> file、>> file、2> file。 */
const REDIRECT_RE = new RegExp('(?:^|[ \\t;()])(?:1|2)?>>?[ \\t]*("([^"]+)"|\'([^\']+)\'|(' + NOT_SEP + '+))', 'gm')
/** 会改文件的命令名(取其后到分隔符为止的片段再抽路径)。 */
const MUTATION_CMD_RE = /(?:^|[;&|]\s*|\bthen\s+)(rm|rmdir|mv|cp|del|erase|copy|move|robocopy|tee|truncate|dd|ln)\b([^\n;|&]*)/gi
/** sed -i(就地改文件)。 */
const SED_INPLACE_RE = /(?:^|[;&|]\s*)sed\b[^\n;|&]*-i\b[^\n;|&]*/gi
/** cd / pushd 的目标目录。 */
const CD_CMD_RE = /(?:^|[;&|]\s*)(cd|pushd)\s+("([^"]+)"|'([^']+)'|([^\s;|&]+))/gi
/** 片段里"像路径"的 token(带引号或含分隔符/扩展名)。 */
const PATH_TOKEN_RE = /"([^"]+)"|'([^']+)'|([^\s"'`;|&<>()]+)/g

const FILEY = /[\\/]|\.(?:js|json|css|html|htm|mp3|jpg|jpeg|png|gif|txt|md|yml|yaml|bak)$/i

/** 把 /d/x 这类 git-bash 盘符形态换成 D:\x;其余原样。 */
export function msysToNative(p) {
  if (typeof p !== 'string' || !p) return ''
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p)
  if (m) return m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\')
  return p
}

/** 归一化:去引号、统一分隔符、折叠 ..、去尾分隔符;小写便于比较。 */
export function normalizePath(p, baseDir) {
  const raw0 = msysToNative(String(p ?? '').trim().replace(/^"|"$/g, ''))
  if (!raw0) return null
  const raw = raw0.replace(/\//g, '\\')
  const full = isAbsolute(raw) ? raw : resolve(baseDir || process.cwd(), raw)
  let n = normalize(full)
  if (n.length > 3 && (n.endsWith('\\') || n.endsWith('/'))) n = n.slice(0, -1)
  return n.toLowerCase()
}

/** 归一化后的路径是否在保护根内(含根本身;`extension-backup` 这类同前缀目录不算)。 */
export function isProtectedPath(candidate, protectRoot) {
  const c = normalizePath(candidate, process.cwd())
  const r = normalizePath(protectRoot, process.cwd())
  if (!c || !r) return false
  return c === r || c.startsWith(r + '\\') || c.startsWith(r + '/')
}

/**
 * 相对路径的归属判定:分别在每个候选基准目录下解析,任一落进保护根即命中。
 * 候选 = 会话工作目录(DSH 写工具的解析基准)/ 进程 cwd / 游戏目录。
 * 宁可多拦(误报)也不漏拦:守卫是安全边界,误报只需用户放行一次。
 */
export function pathHitsProtected(candidate, protectRoot, baseDirs) {
  const raw = String(candidate ?? '').trim()
  if (!raw) return false
  const native = msysToNative(raw)
  if (isAbsolute(native.replace(/\//g, '\\'))) {
    return isProtectedPath(native, protectRoot)
  }
  for (const base of baseDirs || []) {
    if (!base) continue
    const abs = resolve(base, native.replace(/\//g, '\\'))
    if (isProtectedPath(abs, protectRoot)) return true
  }
  return false
}

/** 从一段文本里抽"像路径"的 token。 */
function pathTokens(fragment) {
  const out = []
  if (!fragment) return out
  let m
  PATH_TOKEN_RE.lastIndex = 0
  while ((m = PATH_TOKEN_RE.exec(fragment)) !== null) {
    const tok = m[1] ?? m[2] ?? m[3]
    if (tok && tok.trim() && FILEY.test(tok.trim())) out.push(tok.trim())
  }
  return out
}

/**
 * 判断一条 bash 命令是否在写受保护目录。
 * @param {string} command 原始命令
 * @param {string} protectRoot 保护根(扩展目录)
 * @param {string[]} baseDirs 相对路径的候选基准目录(会话 cwd / 进程 cwd / 游戏目录)
 * @returns 命中的原因文本,或 null。
 */
export function bashGuardReason(command, protectRoot, baseDirs) {
  const cmd = String(command ?? '')
  if (!cmd.trim()) return null
  const bases = (baseDirs || []).filter(Boolean)
  const hitOf = (tokens) => {
    for (const t of tokens) {
      if (pathHitsProtected(t, protectRoot, bases)) return t
    }
    return null
  }

  // 1) 重定向写
  {
    const targets = []
    const re = new RegExp(REDIRECT_RE.source, 'gm')
    let m
    while ((m = re.exec(cmd)) !== null) {
      const tok = m[2] ?? m[3] ?? m[4]
      if (tok) targets.push(tok)
    }
    const hit = hitOf(targets)
    if (hit) return `bash 的重定向写入目标是游戏 extension 目录(${hit})`
  }

  // 2) 改文件的命令
  {
    const frags = []
    const re = new RegExp(MUTATION_CMD_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    const hit = hitOf(pathTokens(frags.join(' ')))
    if (hit) return `bash 的文件操作命令涉及游戏 extension 目录(${hit})`
  }

  // 3) sed -i
  {
    const frags = []
    const re = new RegExp(SED_INPLACE_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    const hit = hitOf(pathTokens(frags.join(' ')))
    if (hit) return `bash 的 sed -i 就地修改指向游戏 extension 目录(${hit})`
  }

  // 4) 先 cd/pushd 进保护目录:之后的相对路径写入同样按该目录解析
  {
    let lastDir = null
    const re = new RegExp(CD_CMD_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) {
      const dir = m[3] ?? m[4] ?? m[5]
      if (dir) lastDir = dir
    }
    if (lastDir && pathHitsProtected(lastDir, protectRoot, bases)) {
      const hasWrite = new RegExp(REDIRECT_RE.source, 'm').test(cmd)
        || new RegExp(MUTATION_CMD_RE.source, 'i').test(cmd)
        || new RegExp(SED_INPLACE_RE.source, 'i').test(cmd)
      if (hasWrite) {
        return `bash 先 cd 进了游戏 extension 目录(${lastDir}),其后的相对路径写入同样受保护`
      }
      // 纯读的 cd 放行(允许进去 grep/find 取证)
    }
  }

  return null
}

/** 守卫提示的统一出路文案。 */
export function guardMessage(detail) {
  return `noname-kit:${detail}。扩展代码请用 noname_read_extension / noname_write_extension 读写(写入前自动校验、覆盖前自动备份、防丢护栏);确有必须用通用工具完成的特殊操作,请让用户确认后手动执行。`
}

/** 静态检查通用 bash、pwsh、write 与 edit 工具对游戏 extension 目录的可识别改写，引导扩展写入经过 noname_write_extension 的校验与备份。覆盖路径归一、重定向、文件操作、就地编辑、解释器命令以及 cd 后的相对写入。8.3 短名、链接别名、动态路径和脚本内容不保证全面识别；只检查 GUARDED_TOOLS，不能替代操作系统隔离。 */

import { isAbsolute, normalize, resolve } from 'node:path'

/* 下面几条正则刻意只用 [^...] 取反类,避免跨行吞掉整条命令。 */
const NOT_SEP = '[^;|&<>()\\n]'

/** 重定向目标:> file、>> file、2> file(带不带空格都算;`2>&1` 不误伤)。 */
const REDIRECT_RE = new RegExp('(?:1|2)?>>?(?!&)[ \\t]*("([^"]+)"|\'([^\']+)\'|(' + NOT_SEP + '+))', 'gm')
/** 会改文件的命令(允许 sudo/xargs/子壳等前缀:只要命令词出现且后面有保护路径)。 */
const MUTATION_CMD_RE = /(?:^|[\s;&|()])(rm|rmdir|mv|cp|del|erase|copy|xcopy|move|robocopy|tee|truncate|dd|ln|install|touch|mkdir)\b[^\n;|&]*/gi
/** 就地修改:sed -i / perl -i / perl -pi。 */
const SED_INPLACE_RE = /(?:^|[\s;&|()])(sed|perl)\b[^\n;|&]*?(?:-[a-zA-Z]*i[a-zA-Z]*\b|\s-i\b)[^\n;|&]*/gi
/** git 的还原类命令(把文件改回去,等同写入)。 */
const GIT_REVERT_RE = /(?:^|[\s;&|()])git[ \t]+(?:checkout|restore|reset|clean)\b[^\n;|&]*/gi
/** 解释器一行式:脚本内容可能直接写文件 → 只要命令里出现保护路径就拦。 */
const INTERPRETER_RE = /(?:^|[\s;&|()])(?:node|nodejs|python|python3|py|perl|ruby|pwsh|powershell|deno|bun)\b[^\n;|&]*(?:-[a-zA-Z]*[ce]\b|-[Cc]ommand\b)/gi
/** cd / pushd 的目标目录(允许前导空白,覆盖子壳 `bash -c "cd …"`)。 */
const CD_CMD_RE = /(?:^|[\s;&|()])(?:cd|pushd)[ \t]+("([^"]+)"|'([^']+)'|([^\s;|&()]+))/gi
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

/** 按 Win32 规则去除路径分量尾部的点与空格，使 extension. 等等价写法命中相同保护根。 */
function stripWin32Tail(seg) {
  const noSpaces = seg.replace(/ +$/, '')
  if (!seg || noSpaces === '.' || noSpaces === '..') return noSpaces
  return seg.replace(/[. ]+$/, '')
}

function nativeGuardPath(p) {
  let raw = String(p ?? '').trim()
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1)
  raw = raw.replace(/^(?:Microsoft\.PowerShell\.Core\\)?FileSystem::/i, '')
  return msysToNative(raw).replace(/\//g, '\\')
}

/** 归一化:去引号、统一分隔符、折叠 ..、去尾分隔符、Win32 尾点/尾空格;小写便于比较。 */
export function normalizePath(p, baseDir) {
  const raw = nativeGuardPath(p)
  if (!raw) return null
  const full = isAbsolute(raw) ? raw : resolve(baseDir || process.cwd(), raw)
  let n = normalize(full)
  if (n.length > 3 && (n.endsWith('\\') || n.endsWith('/'))) n = n.slice(0, -1)
  n = n.split('\\').map(stripWin32Tail).join('\\')
  return normalize(n).toLowerCase()
}

/** UNC(\\server\share)与 \\?\ 前缀:无法与保护前缀可靠比对(`\\?\` 更是把 Win32 归一
 *  整个关掉,短名/尾点都成了字面量),按守卫「宁可多拦不漏拦」的既有取舍一律当命中。 */
function isAliasForm(candidate) {
  const raw = nativeGuardPath(candidate)
  return /^\\\\/.test(raw)
}

/** 归一化后的路径是否在保护根内(含根本身;`extension-backup` 这类同前缀目录不算)。 */
export function isProtectedPath(candidate, protectRoot) {
  if (isAliasForm(candidate)) return true
  const c = normalizePath(candidate, process.cwd())
  const r = normalizePath(protectRoot, process.cwd())
  if (!c || !r) return false
  return c === r || c.startsWith(r + '\\') || c.startsWith(r + '/')
}

/**
 * 将相对路径分别按会话目录、Shell workdir、进程 cwd 和游戏目录解析。
 * 任一结果位于扩展目录内时，按受保护路径处理。
 */
export function pathHitsProtected(candidate, protectRoot, baseDirs) {
  const raw = String(candidate ?? '').trim()
  if (!raw) return false
  const native = nativeGuardPath(raw)
  if (isAliasForm(native)) return true
  if (isAbsolute(native.replace(/\//g, '\\'))) {
    return isProtectedPath(native, protectRoot)
  }
  for (const base of baseDirs || []) {
    if (!base) continue
    const abs = normalizePath(native, base)
    if (isProtectedPath(abs, protectRoot)) return true
  }
  return false
}

/** 扫引号内的内容,抽出像路径的 token(解释器一行式里路径常写在脚本字符串里)。 */
function pathLikeInQuotes(text) {
  const out = []
  const re = /"([^"]+)"|'([^']+)'|`([^`]+)`/g
  let m
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const inner = m[1] ?? m[2] ?? m[3] ?? ''
    if (!inner) continue
    const re2 = /[A-Za-z]:[\/][^\s"'`]*|\/[A-Za-z]\/[^\s"'`]*|[^\s"'`]*[\/][^\s"'`]*\.js/g
    let m2
    while ((m2 = re2.exec(inner)) !== null) {
      const t = m2[0].replace(/[),;]+$/, '')
      if (t && /[\/]/.test(t)) out.push(t)
    }
  }
  return out
}

/** 从一段文本里抽"像路径"的 token(也含裸目录名,如 `rm -rf pk` 里的 pk 由基准解析)。 */
function pathTokens(fragment) {
  const out = []
  if (!fragment) return out
  let m
  PATH_TOKEN_RE.lastIndex = 0
  while ((m = PATH_TOKEN_RE.exec(fragment)) !== null) {
    const tok = m[1] ?? m[2] ?? m[3]
    if (!tok) continue
    const t = tok.trim().replace(/^[->+]+/, '')
    if (!t || t.startsWith('-')) continue
    if (FILEY.test(t)) out.push(t)
  }
  return out
}

/**
 * 判断一条 bash 命令是否在写受保护目录。
 * @param {string} command 原始命令
 * @param {string} protectRoot 保护根(扩展目录)
 * @param {string[]} baseDirs 相对路径的候选基准目录(会话 cwd / workdir / 进程 cwd / 游戏目录)
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
  const allTokens = (fragment) => {
    const out = []
    let m
    const re = new RegExp(PATH_TOKEN_RE.source, 'g')
    while ((m = re.exec(String(fragment ?? ''))) !== null) {
      const tok = m[1] ?? m[2] ?? m[3]
      if (tok && tok.trim()) out.push(tok.trim())
    }
    return out
  }

  /**
   * 递归检查 bash -c、sh -c 和括号中的子命令。
   * 即使无法推断相对路径，也能识别其中的绝对扩展路径及 cd 目标。
   */
  {
    const subRe = /(?:^|[\s;&|()])(?:bash|sh|zsh|dash)[ \t]+-c[ \t]+("([^"]+)"|'([^']+)')/gi
    let m
    while ((m = subRe.exec(cmd)) !== null) {
      const inner = m[2] ?? m[3]
      if (inner && inner.trim()) {
        const sub = bashGuardReason(inner, protectRoot, bases)
        if (sub) return `子壳命令里:${sub}`
      }
    }
  }

  // 1) 重定向写(> / >> / 2>;带不带空格都算)
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

  /* 2) 改文件的命令(rm/mv/cp/tee/mkdir…,含 sudo|xargs/find -exec 前缀)
   * 判据:该命令片段里出现的**任何**路径 token 落在保护根内即拦——
   * 不看它是源还是目标:往机场里拷东西、从机场里拷出去,都是对扩展目录的写操作面。 */
  {
    const frags = []
    const re = new RegExp(MUTATION_CMD_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    // find … -delete / -exec rm …
    const findRe = /(?:^|[\s;&|()])find\b[^\n;|&]*(?:-delete|-exec\b[^\n;|&]*)/gi
    let mf
    while ((mf = findRe.exec(cmd)) !== null) frags.push(mf[0])
    const hit = hitOf(allTokens(frags.join(' ')))
    if (hit) return `bash 的文件操作命令涉及游戏 extension 目录(${hit})`
  }

  // 3) sed -i / perl -i 就地修改
  {
    const frags = []
    const re = new RegExp(SED_INPLACE_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    const hit = hitOf(allTokens(frags.join(' ')))
    if (hit) return `bash 的就地修改(sed/perl -i)指向游戏 extension 目录(${hit})`
  }

  // 4) git checkout/restore/reset/clean
  {
    const frags = []
    const re = new RegExp(GIT_REVERT_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    const hit = hitOf(allTokens(frags.join(' ')))
    if (hit) return `bash 的 git 还原类命令涉及游戏 extension 目录(${hit})`
  }

  /* 5) 解释器一行式(node -e / python -c / pwsh -Command …):脚本里可能直接写文件,
   * 命令里出现保护路径即拦(保守;读脚本被误拦时用户确认一次即可)。
   * 路径多半写在**脚本字符串里面**(node -e "…('/path/x.js')…"),所以要把
   * 引号内的内容也扫一遍找路径。 */
  {
    const frags = []
    const re = new RegExp(INTERPRETER_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) frags.push(m[0])
    if (frags.length) {
      const hit = hitOf(allTokens(frags.join(' ')).concat(pathLikeInQuotes(cmd)))
      if (hit) return `bash 的解释器一行式(node/python/pwsh -e/-c)引用了游戏 extension 目录(${hit})`
    }
  }

  /* 进入保护目录后按该目录解析相对写入；所有写目标均为保护根外的绝对路径时放行。 */
  {
    let lastDir = null
    const re = new RegExp(CD_CMD_RE.source, 'gi')
    let m
    while ((m = re.exec(cmd)) !== null) {
      const dir = m[2] ?? m[3] ?? m[4]
      if (dir) lastDir = dir
    }
    if (lastDir && pathHitsProtected(lastDir, protectRoot, bases)) {
      const redirects = []
      const reRed = new RegExp(REDIRECT_RE.source, 'gm')
      let mr
      while ((mr = reRed.exec(cmd)) !== null) {
        const tok = mr[2] ?? mr[3] ?? mr[4]
        if (tok) redirects.push(tok)
      }
      const frags = []
      for (const src of [MUTATION_CMD_RE, SED_INPLACE_RE, GIT_REVERT_RE]) {
        const rr = new RegExp(src.source, 'gi')
        let mm
        while ((mm = rr.exec(cmd)) !== null) frags.push(mm[0])
      }
      const tokens = redirects.concat(allTokens(frags.join(' ')))
      const absoluteHit = hitOf(tokens)
      if (absoluteHit) {
        return `bash 先 cd 进了游戏 extension 目录(${lastDir}),其后的写入目标仍在保护范围内(${absoluteHit})`
      }
      for (const t of tokens) {
        const native = msysToNative(String(t).trim())
        if (isAbsolute(native.split('/').join('\\'))) continue
        const abs = resolve(msysToNative(lastDir), native.split('/').join('\\'))
        if (isProtectedPath(abs, protectRoot)) {
          return `bash 先 cd 进了游戏 extension 目录(${lastDir}),其后的相对路径写入同样受保护(${t})`
        }
      }
    }
  }

  return null
}

/** pwsh 工具交付的是脚本正文,不带 `pwsh -Command` 外壳,不能只复用 bash 解释器匹配。
 * 覆盖常见文件 cmdlet/别名、.NET 文件写入和字面量工作目录切换;
 * 保留只读命令。不是 PowerShell 解释器,动态脚本仍属于上述尽力而为边界。 */
export function powershellGuardReason(command, protectRoot, baseDirs) {
  const cmd = String(command ?? '')
  const bases = (baseDirs || []).filter(Boolean).slice()
  let locationBases = bases.slice()
  const location = /(?:^|[\s;&|()])(?:Microsoft\.PowerShell\.Management\\)?(?:Set-Location|Push-Location|cd|chdir|sl|pushd)\s+(?:(?:-Path|-LiteralPath)\s+)?("([^"]+)"|'([^']+)'|([^\s;|&()]+))/gi
  let m
  while ((m = location.exec(cmd)) !== null) {
    const dir = nativeGuardPath(m[2] ?? m[3] ?? m[4])
    // 累积候选目录(不假装能精确执行分支/子作用域),避免相对路径遗漏。
    const next = isAbsolute(dir) ? [dir] : locationBases.map((base) => resolve(base, dir))
    locationBases = [...new Set(next)]
    bases.push(...next.filter((base) => !bases.includes(base)))
  }
  const bashReason = bashGuardReason(cmd, protectRoot, bases)
  if (bashReason) return `pwsh 脚本:${bashReason}`
  const mutation = /(?:^|[\s;&|()])["']?(?:Microsoft\.PowerShell\.(?:Management|Utility)\\)?(?:Set-Content|Add-Content|Out-File|Tee-Object|(?:Set|New|Remove|Clear|Copy|Move|Rename)-Item(?:Property)?|sc|ac|ni|ri|ci|mi|si|sp)\b["']?([^\n;|&]*)/gi
  const fragments = []
  while ((m = mutation.exec(cmd)) !== null) fragments.push(m[1])
  if (/\[(?:System\.)?IO\.(?:File|Directory)\]\s*::\s*(?:Write\w*|Append\w*|OpenWrite|Create\w*|Delete|Move|Copy|Replace)\s*\(/i.test(cmd)) fragments.push(cmd)
  if (/\[(?:System\.)?IO\.StreamWriter\]\s*::\s*new\s*\(|\bNew-Object\s+(?:(?:-TypeName)\s+)?(?:System\.)?IO\.StreamWriter\b/i.test(cmd)) fragments.push(cmd)
  for (const fragment of fragments) {
    const tokens = new RegExp(PATH_TOKEN_RE.source, 'g')
    while ((m = tokens.exec(fragment)) !== null) {
      const token = (m[1] ?? m[2] ?? m[3]).trim()
      if (token && !token.startsWith('-') && pathHitsProtected(token, protectRoot, bases)) {
        return `pwsh 的文件写入命令涉及游戏 extension 目录(${token})`
      }
    }
  }
  return null
}

/** 守卫提示的统一出路文案。 */
export function guardMessage(detail) {
  return `noname-kit:${detail}。请在无名杀开发模式中使用工坊工具；扩展代码用 noname_read_extension / noname_write_extension 读写(写入前自动校验、覆盖前自动备份、防丢护栏);图片、配音、视频素材分别用 noname_copy_images / noname_copy_audio / noname_copy_videos 复制;确有必须用通用工具完成的特殊操作,请让用户确认后手动执行。`
}

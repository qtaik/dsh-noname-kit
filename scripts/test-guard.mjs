#!/usr/bin/env node
/*
 * test-guard.mjs —— 守卫(extension 目录写保护)回归用例。
 *
 * 背景:早期守卫是纯字符串包含比对,实测四类写法全部绕过(正斜杠 / git-bash
 * 盘符 / cd 后相对写 / 进程 cwd 与会话 cwd 不同时的相对路径)。本测试把
 * 「必须拦」与「必须放行」两类形态都钉死,防止以后再退化。
 *
 * 运行: node scripts/test-guard.mjs
 */
import { bashGuardReason, pathHitsProtected, isProtectedPath, msysToNative, normalizePath, guardMessage } from '../src/guard.js'

// 用不存在的盘符做测试根:路径判定纯字符串运算,不需要真实文件
const GAME = 'D:\\games\\noname\\resources\\app'
const ROOT = GAME + '\\extension'
const bases = [GAME, 'D:\\games', 'C:\\work']

let pass = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { console.log('  ✓ ' + name); pass++ } else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fails.push(name) }
}

console.log('路径归一化')
check('msys 盘符转原生', msysToNative('/d/games/x') === 'D:\\games\\x')
check('反斜杠归一化小写', normalizePath('D:/Games/Noname/') === 'd:\\games\\noname')
check('.. 折叠', normalizePath('D:/games/noname/../other') === 'd:\\games\\other')
check('保护根内的子路径命中', isProtectedPath(ROOT + '\\pk\\extension.js', ROOT))
check('保护根本身命中', isProtectedPath(ROOT, ROOT))
check('同前缀不同目录不命中', !isProtectedPath(GAME + '\\extension-backup\\x.js', ROOT))
check('游戏本体不命中', !isProtectedPath(GAME + '\\game\\x.js', ROOT))

console.log('\nbash:必须拦')
const mustBlock = [
  ['反斜杠原样写', `echo x > D:\\games\\noname\\resources\\app\\extension\\pk\\extension.js`],
  ['正斜杠写', 'echo x > D:/games/noname/resources/app/extension/pk/extension.js'],
  ['git-bash 盘符写', 'echo x > /d/games/noname/resources/app/extension/pk/extension.js'],
  ['cd 后相对写', 'cd "D:/games/noname/resources/app/extension/pk" && echo x > extension.js'],
  ['rm -rf 正斜杠', 'rm -rf "D:/games/noname/resources/app/extension/pk"'],
  ['sed -i 就地改', 'sed -i "s/a/b/" /d/games/noname/resources/app/extension/pk/extension.js'],
  ['cp 进扩展目录', 'cp /tmp/x.js "D:\\games\\noname\\resources\\app\\extension\\pk\\x.js"'],
  ['相对写(基准=游戏目录)', 'echo x > extension/pk/extension.js'],
  ['无空格重定向', 'echo x>D:/games/noname/resources/app/extension/pk/extension.js'],
  ['sudo 前缀', 'sudo rm -rf D:/games/noname/resources/app/extension/pk'],
  ['xargs 管道', 'ls /tmp | xargs rm -rf D:/games/noname/resources/app/extension/pk'],
  ['子壳 sh -c', 'sh -c "rm -rf D:/games/noname/resources/app/extension/pk"'],
  ['子壳里 cd 后相对写', 'bash -c "cd D:/games/noname/resources/app/extension/pk && echo x > extension.js"'],
  ['find -delete', 'find D:/games/noname/resources/app/extension -name "*.js" -delete'],
  ['node -e 写文件', `node -e "require('fs').writeFileSync('D:/games/noname/resources/app/extension/pk/x.js','x')"`],
  ['python -c 写文件', `python -c "open(r'D:/games/noname/resources/app/extension/pk/x.js','w').write('x')"`],
  ['perl -i 就地改', 'perl -pi -e "s/a/b/" D:/games/noname/resources/app/extension/pk/extension.js'],
  ['git checkout 还原', 'cd D:/games/noname/resources/app/extension/pk && git checkout -- extension.js'],
  ['touch 新建', 'touch D:/games/noname/resources/app/extension/pk/new.js'],
  ['mkdir 建目录', 'mkdir -p D:/games/noname/resources/app/extension/pk/sub'],
  ['无空格重定向(cd 后)', 'cd D:/games/noname/resources/app/extension/pk && echo x>extension.js'],
]
for (const [name, cmd] of mustBlock) {
  const reason = bashGuardReason(cmd, ROOT, bases)
  check(name, Boolean(reason), '竟然放行了:' + cmd)
  if (reason) check('  ↳ 提示含出路', guardMessage(reason).includes('noname_write_extension'))
}

/* 已知取舍:守卫对「改文件命令」只看命令里有没有保护路径,不看源/目标方向——
 * `cp -r <扩展包> /tmp/bak`(拷出去)也会被拦。刻意如此:守卫是安全边界,
 * 多拦一次用户确认即可,漏拦一次就是无备份直改扩展。取证式读取用不带写动作的
 * 纯读命令(见下),不受影响。 */
console.log('\nbash:必须放行')
const mustAllow = [
  ['纯读 grep', 'grep -n "foo" /d/games/noname/resources/app/extension/pk/extension.js'],
  ['纯读 cd 进目录 + ls/cat', 'cd "D:/games/noname/resources/app/extension/pk" && ls -la && cat extension.js'],
  ['纯读 find', 'find /d/games/noname/resources/app/extension -name "*.js"'],
  ['写游戏本体 game/', 'echo x > D:/games/noname/resources/app/game/test.js'],
  ['写临时目录', 'echo x > /tmp/t.js'],
  ['写用户目录', 'echo x > ~/.dsh/noname-kit.json'],
  ['写扩展备份目录', 'echo x > D:/games/noname/resources/app/extension-backup/x.js'],
  ['cd 进扩展目录后把输出写去 /tmp(取证式读取,应放行)', 'cd D:/games/noname/resources/app/extension/pk && grep -n "audio" extension.js > /tmp/audio.txt'],
]
for (const [name, cmd] of mustAllow) {
  const reason = bashGuardReason(cmd, ROOT, bases)
  check(name, reason === null, '误拦:' + (reason || ''))
}

console.log('\nwrite/edit 路径参数')
const pathCases = [
  ['绝对路径进扩展', ROOT + '\\pk\\extension.js', GAME, true],
  ['正斜杠绝对路径', 'D:/games/noname/resources/app/extension/pk/extension.js', GAME, true],
  ['会话 cwd 下的相对扩展路径', 'extension/pk/extension.js', GAME, true],
  ['同前缀不同目录', GAME + '\\extension-backup\\x.js', GAME, false],
  ['家目录', 'C:\\Users\\x\\.dsh\\noname-kit.json', GAME, false],
  ['会话 cwd 下的普通相对路径', 'src/foo.js', GAME, false],
]
for (const [name, p, cwd, want] of pathCases) {
  check(name, pathHitsProtected(p, ROOT, [cwd]) === want)
}

console.log('\n' + (fails.length === 0 ? '全部通过:' + pass + ' 项' : '失败 ' + fails.length + ' 项:' + fails.join('、')))
if (fails.length) process.exit(1)

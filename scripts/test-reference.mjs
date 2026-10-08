#!/usr/bin/env node
/**
 * noname-kit 单测:官方源码检索(noname_search_reference 的底层 searchReference)。
 * 运行:node scripts/test-reference.mjs
 * 游戏目录用系统临时目录伪造,跑完即删。
 *
 * 为什么补这个套件:这个文件此前**零测试**。0.3.67 那批「相似度阶段按 limit 截断」
 * 的改动把 `const simHits` 写成了会被重新赋值的变量,于是任何 ≥4 字的关键词查询
 * (即几乎全部真实查询)进来就抛 `TypeError: Assignment to constant variable`——
 * 工具主路径整体崩,而 AI 会自己退化去 bash grep,缺陷因此长期不被察觉(审计实测)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'noname-kit-reference-'))
let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

try {
  const { searchReference } = await import('../src/reference.js')
  const game = join(home, 'game')
  mkdirSync(join(game, 'character'), { recursive: true })
  writeFileSync(join(game, 'character', 'std.js'), [
    'const character = {',
    "  caocao: ['caocao', 'wei', 4, ['jianxiong'], ['男', '君主']],",
    '}',
    'const translate = { caocao: "曹操", jianxiong: "奸雄" }',
    'skill = {',
    '  jianxiong: {',
    '    trigger: { player: "damageBegin" },',
    '    content: function () { player.draw() },',
    '  },',
    '}',
  ].join('\n'))

  // ── 1) 长查询(≥4 字,必然进入相似度阶段)——曾整段抛 TypeError ──
  let long = null
  let longErr = null
  try { long = await searchReference(game, { query: '摸牌阶段多摸', type: 'any', limit: 5 }) } catch (e) { longErr = e }
  ok(!longErr, '长查询(4+ 字,走相似度阶段)不再抛异常' + (longErr ? ':' + longErr.message : ''))
  ok(long && typeof long.ok === 'boolean' && Array.isArray(long.matches), '长查询返回结构化结果')

  // ── 2) 精确命中(ID/名称) ──
  const byId = await searchReference(game, { query: 'jianxiong', type: 'any', limit: 5 })
  ok(byId.ok && byId.matches.some((m) => m.id === 'jianxiong'), '按 ID 精确命中技能')
  const byName = await searchReference(game, { query: '曹操', type: 'any', limit: 5 })
  ok(byName.ok && byName.matches.some((m) => m.id === 'caocao'), '按中文显示名命中武将')

  // ── 3) limit 截断:被截时要有说明字段(截断那一笔改动的本意) ──
  const small = await searchReference(game, { query: 'jianxiong', type: 'any', limit: 1 })
  ok(small.matches.length <= 1, 'limit=1 时结果被截断到 1 条')
  const wide = await searchReference(game, { query: '摸牌', type: 'any', limit: 10 })
  ok(wide.matches.length <= 10, 'limit 上限生效(≤10)')

  // ── 4) 短查询与无命中:不崩、有明确结果 ──
  const short = await searchReference(game, { query: '曹操', type: 'any', limit: 3 })
  ok(short && Array.isArray(short.matches), '短查询(≤3 字)正常')
  const none = await searchReference(game, { query: '绝不存在的技能zzz', type: 'any', limit: 5 })
  ok(none.ok === false && none.matches.length === 0, '无命中时 ok=false 且返回空列表')

  // ── 5) 未配置游戏目录:报错要给出路(不是裸异常) ──
  let dirErr = null
  try { await searchReference(join(home, 'no-such-game'), { query: 'jianxiong', type: 'character', limit: 3 }) } catch (e) { dirErr = e }
  ok(!dirErr || /目录|配置/.test(dirErr.message), '游戏目录不存在时不抛裸异常(或错误文案含出路)')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

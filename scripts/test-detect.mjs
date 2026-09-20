#!/usr/bin/env node
/**
 * noname-kit 单测:游戏目录自动探测(detectCandidates)。
 * 运行:node scripts/test-detect.mjs
 * 全程隔离在系统临时目录(假目录树),跑完即删。
 * 回归背景:B 站用户 decade 整合包在 D:\games\noname\decade\resources\app\src
 * (第 6 层),旧扫描 depth>4 剪枝永远扫不到,只能手填。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'noname-kit-detect-'))
let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

/** 建一个像游戏本体根的目录:extension/ + noname.js。 */
function makeGameRoot(dir) {
  mkdirSync(join(dir, 'extension'), { recursive: true })
  writeFileSync(join(dir, 'noname.js'), '// fake engine')
}

try {
  const { detectCandidates } = await import('../src/detect.js')

  // ── 1) decade 整合包结构:目标在第 6 层(用户实测漏扫的形态) ──
  const deep = join(home, 'games', 'noname', 'decade', 'resources', 'app', 'src')
  makeGameRoot(deep)
  const r1 = await detectCandidates([home])
  ok(r1.includes(deep), 'decade 深层结构(第 6 层)能扫到')

  // ── 2) 常规浅层结构(回归:别把老行为改坏) ──
  const shallow = join(home, '无名杀', 'resources', 'app')
  makeGameRoot(shallow)
  const r2 = await detectCandidates([home])
  ok(r2.includes(shallow), '常规浅层结构(resources/app)仍能扫到')

  // ── 3) 非 noname 名字的深层目录:不该被深入(防全盘乱扫) ──
  const unrelated = join(home, 'zzz', 'aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg')
  makeGameRoot(unrelated)
  const r3 = await detectCandidates([home])
  ok(!r3.includes(unrelated), '非 noname 名字的深层游戏目录不扫描(剪枝保留)')

  // ── 3.5) 安装路径中间有壳目录名(game):不能被 SKIP 误伤(与 noname 同型漏洞) ──
  const viaGame = join(home, 'game', 'noname', 'resources', 'app')
  makeGameRoot(viaGame)
  const r35 = await detectCandidates([home])
  ok(r35.includes(viaGame), '安装路径中间的 game 文件夹不再被 SKIP 误伤')

  // ── 3.8) 壳目录链(无名字匹配祖先):src 进壳清单后新解锁的路径 ──
  const viaShell = join(home, '某游戏', 'resources', 'app', 'src')
  makeGameRoot(viaShell)
  const r38 = await detectCandidates([home])
  ok(r38.includes(viaShell), '壳目录链(某游戏/resources/app/src)能扫到')

  // ── 3.9) rootsOverride 传空数组 = 明确不扫任何根(与不传参走默认根区分) ──
  const r39 = await detectCandidates([])
  ok(Array.isArray(r39) && r39.length === 0, 'rootsOverride 空数组:不扫默认盘符根')

  // ── 4) 空候选:什么都没有时返回空数组而不是报错 ──
  const emptyHome = mkdtempSync(join(tmpdir(), 'noname-kit-detect-empty-'))
  try {
    const r4 = await detectCandidates([emptyHome])
    ok(Array.isArray(r4) && r4.length === 0, '无游戏目录时返回空数组')
  } finally {
    rmSync(emptyHome, { recursive: true, force: true })
  }

// ── 5) listExtensionFolders:遍历 extension/ 下的扩展包(设置页展示用) ──
  const { listExtensionFolders } = await import('../src/detect.js')
  mkdirSync(join(deep, 'extension', '测试包'), { recursive: true })
  mkdirSync(join(deep, 'extension', '另一包'), { recursive: true })
  writeFileSync(join(deep, 'extension', '散落文件.txt'), '不是包')
  const folders = listExtensionFolders(deep)
  ok(folders.length === 2 && folders[0] === '另一包' && folders[1] === '测试包', '列出扩展包子目录(排除散文件,排序)')
  ok(listExtensionFolders(join(deep, 'extension', '测试包')).length === 0, '无 extension 目录的路径返回空数组')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

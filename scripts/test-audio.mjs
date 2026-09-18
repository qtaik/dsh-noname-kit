#!/usr/bin/env node
/**
 * noname-kit 单测:配音复制(copyAudios)。
 * 运行:node scripts/test-audio.mjs
 * 全程隔离在系统临时目录(假游戏目录 + 假 mp3 源文件),跑完即删。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'noname-kit-audio-test-'))
const nonameDir = join(home, 'fake-game')
let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

try {
  const { copyAudios, audioTargetKind } = await import('../src/audio.js')

  // 假源 mp3(内容无所谓,只验证复制)
  const srcDir = join(home, 'src-mp3')
  mkdirSync(srcDir, { recursive: true })
  for (const n of ['a1.mp3', 'a2.mp3', 'a3.mp3', 'bad.txt']) {
    writeFileSync(join(srcDir, n), 'fake-' + n)
  }

  // ── 1) 多文件复制:一个技能三句,落 audio/skill/ ──
  const multi = await copyAudios(nonameDir, {
    folder: '测试包',
    audios: [
      { source: join(srcDir, 'a1.mp3'), target: 'skill/tf1.mp3' },
      { source: join(srcDir, 'a2.mp3'), target: 'skill/tf2.mp3' },
      { source: join(srcDir, 'a3.mp3'), target: 'skill/tf3.mp3' },
    ],
  })
  ok(multi.ok && multi.copied.length === 3, '一次复制三条技能配音')
  const skillDir = join(nonameDir, 'extension', '测试包', 'audio', 'skill')
  ok((await readdir(skillDir)).sort().join(',') === 'tf1.mp3,tf2.mp3,tf3.mp3', '文件落进扩展包 audio/skill/(本体目录零改动)')

  // ── 2) 阵亡语音:die/ 目录 ──
  const die = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'a1.mp3'), target: 'die/wj.mp3' }] })
  ok(die.ok, '阵亡语音复制进 audio/die/')
  ok((await readdir(join(nonameDir, 'extension', '测试包', 'audio', 'die'))).join(',') === 'wj.mp3', 'die 目录文件就位')

  // ── 3) 非法目标:子目录越权/逃逸/扩展名 ──
  const badDir = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'a1.mp3'), target: 'card/x.mp3' }] })
  ok(!badDir.ok && /不合法/.test(badDir.errors[0].error), 'skill/die 之外的子目录被拒')
  const escape = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'a1.mp3'), target: 'skill/../../x.mp3' }] })
  ok(!escape.ok, '含 .. 的目标被拒')
  const notMp3 = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'bad.txt'), target: 'skill/x.txt' }] })
  ok(!notMp3.ok, '非 mp3 目标被拒')
  const deep = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'a1.mp3'), target: 'skill/sub/x.mp3' }] })
  ok(!deep.ok, '多级子目录被拒(目标只能是一层 skill/或die/)')

  // ── 4) 源不存在 / 空清单 / 坏包名 ──
  const noSrc = await copyAudios(nonameDir, { folder: '测试包', audios: [{ source: join(srcDir, 'nope.mp3'), target: 'skill/x.mp3' }] })
  ok(!noSrc.ok, '源文件不存在被拒')
  const empty = await copyAudios(nonameDir, { folder: '测试包', audios: [] })
  ok(!empty.ok, '空清单被拒')
  const badFolder = await copyAudios(nonameDir, { folder: '../逃逸', audios: [{ source: join(srcDir, 'a1.mp3'), target: 'skill/x.mp3' }] })
  ok(!badFolder.ok, '非法包名被拒')

  // ── 5) 目标归属判定 ──
  ok(audioTargetKind('skill/x.mp3') === 'skill' && audioTargetKind('die\\y.mp3') === 'die', 'audioTargetKind 识别两种目录(含反斜杠)')
  ok(audioTargetKind('card/x.mp3') === null && audioTargetKind('') === null, '非配音目标返回 null')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

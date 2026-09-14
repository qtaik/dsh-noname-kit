#!/usr/bin/env node
/**
 * noname-kit 单测:锚点区块(配对器/目录/组装/保真/迁移/集成写入)。
 * 运行:node scripts/test-blocks.mjs(临时目录隔离,跑完即删)
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'noname-kit-blocks-'))
const nonameDir = join(home, 'fake-game')
let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

const blocks = await import('../src/blocks.js')
const { writeExtension, readExtension, migrateAnchors } = await import('../src/write.js')

const ANCHORED = `game.import("extension", function (lib, game, ui, get, ai, _status) {
  return {
    name: "测试包",
    skill: {
//#noname-kit-begin skill:cs_a
      cs_a: {
        audio: 2,
        enable: "phaseUse",
        content: function () { player.draw(); },
      },
//#noname-kit-end skill:cs_a
//#noname-kit-begin skill:cs_b
      cs_b: {
        audio: 2,
        trigger: { player: "phaseBegin" },
        content: function () { player.draw(2); },
      },
//#noname-kit-end skill:cs_b
    },
    translate: {
//#noname-kit-begin translate:cs_a
      "cs_a": "奇袭",
      "cs_a_info": "出牌阶段,摸一张牌。",
//#noname-kit-end translate:cs_a
//#noname-kit-begin translate:cs_b
      "cs_b": "连破",
      "cs_b_info": "准备阶段,摸两张牌。",
//#noname-kit-end translate:cs_b
    },
  };
});`
const LEGACY = blocks.stripAnchors(ANCHORED)

try {
  // ── 1) 字符串感知配对 ──
  ok(blocks.matchBrace('{ a: "}{", b: 1 }', 0) === 16, '字符串内的花括号不参与配对')
  ok(blocks.matchBrace('{ a: /* } */ 1 }', 0) === 15, '注释内的花括号不参与配对')
  ok(blocks.matchBrace('{ a: `x${ {y:1} }z` }', 0) === 20, '模板插值内的花括号正确递归')

  // ── 2) 锚点扫描与提取 ──
  const anchored = blocks.scanAnchored(ANCHORED)
  ok(anchored.length === 4, '锚点扫描:4 个区块(2 技能 + 2 翻译)')
  ok(blocks.extractBlock(ANCHORED, 'skill', 'cs_a').includes('phaseUse'), '按 key 提取技能块')
  ok(blocks.extractBlock(ANCHORED, 'translate', 'cs_a').includes('cs_a_info'), '翻译块含名称与描述两行')

  // ── 3) 虚拟区块(无锚存量文件)──
  const vSkills = blocks.virtualSkillBlocks(LEGACY)
  ok(vSkills.length === 2 && vSkills[0].id === 'cs_a' && vSkills[1].id === 'cs_b', '无锚文件虚拟划分技能块')
  ok(blocks.virtualTranslateBlocks(LEGACY).length === 2, '无锚文件虚拟划分翻译块(名称+描述合并)')
  const dir = blocks.scanBlocks(LEGACY)
  ok(dir.anchored === false && dir.blocks.length === 4 && dir.blocks[0].virtual === true, '无锚文件目录标记为虚拟')

  // ── 4) 组装:只动提交的块,其余逐字节保留 ──
  const newA = `      cs_a: {
        audio: 2,
        enable: "phaseUse",
        content: function () { player.draw(3); },
      },`
  const r1 = blocks.assembleBlocks(ANCHORED, [{ kind: 'skill', id: 'cs_a', code: newA }], [], [])
  ok(r1.errors.length === 0 && r1.applied.includes('skill:cs_a'), '组装:提交块应用成功')
  ok(blocks.extractBlock(r1.code, 'skill', 'cs_a').includes('draw(3)'), '组装:改动生效')
  ok(blocks.extractBlock(r1.code, 'skill', 'cs_b') === blocks.extractBlock(ANCHORED, 'skill', 'cs_b'), '组装:未提交区块逐字节保留')
  ok(blocks.extractBlock(r1.code, 'translate', 'cs_b') === blocks.extractBlock(ANCHORED, 'translate', 'cs_b'), '组装:翻译区未动')

  // ── 5) 组装:新增与删除 ──
  const r2 = blocks.assembleBlocks(ANCHORED, [{ kind: 'skill', id: 'cs_c', code: '      cs_c: {},' }], [], [])
  ok(r2.errors.length === 0 && blocks.extractBlock(r2.code, 'skill', 'cs_c') !== null, '组装:新块插入 skill 区段')
  const r3 = blocks.assembleBlocks(ANCHORED, [], [], ['skill:cs_b'])
  ok(r3.errors.length === 0 && blocks.extractBlock(r3.code, 'skill', 'cs_b') === null, '组装:声明删除生效')
  ok(blocks.extractBlock(r3.code, 'skill', 'cs_a') !== null, '组装:删除不影响其他块')
  const r4 = blocks.assembleBlocks(ANCHORED, [], [], ['skill:cs_notexist'])
  ok(r4.errors.length === 1, '组装:删除不存在的块被拒')

  // ── 6) 组装:edits 精确补丁 ──
  const r5 = blocks.assembleBlocks(ANCHORED, [], [{ find: 'name: "测试包"', replace: 'name: "改名包"' }], [])
  ok(r5.errors.length === 0 && r5.code.includes('改名包'), 'edits:唯一命中即应用')
  const r6 = blocks.assembleBlocks(ANCHORED, [], [{ find: 'audio: 2,', replace: 'x' }], [])
  ok(r6.errors.length === 1 && r6.code === ANCHORED, 'edits:多处命中整单拒绝')
  const r7 = blocks.assembleBlocks(ANCHORED, [], [{ find: '不存在的文本', replace: 'x' }], [])
  ok(r7.errors.length === 1 && r7.code === ANCHORED, 'edits:未命中整单拒绝')

  // ── 7) 保真校验(全文模式)──
  const tampered = LEGACY.replace('player.draw(2);', 'player.draw(99);')
  const f1 = blocks.checkFidelity(LEGACY, tampered, ['cs_b'])
  ok(f1.ok, '保真:申报范围内改动放行')
  const f2 = blocks.checkFidelity(LEGACY, tampered, [])
  ok(!f2.ok && f2.changed.includes('cs_b'), '保真:范围外改动被标出')
  const f3 = blocks.checkFidelity(LEGACY, LEGACY, [])
  ok(f3.ok, '保真:完全一致放行')

  // ── 8) 迁移:只加注释行 ──
  const m1 = blocks.migrateCode(LEGACY)
  ok(!m1.error && m1.blocks === 4, '迁移:识别 4 个区块')
  ok(blocks.stripAnchors(m1.code) === LEGACY, '迁移自检:剥掉锚点后与原文逐字节一致')
  ok(blocks.scanAnchored(m1.code).length === 4, '迁移后锚点可扫描')
  const m2 = blocks.migrateCode(ANCHORED)
  ok(!m2.error && blocks.scanAnchored(m2.code).length === 4 && blocks.stripAnchors(m2.code) === LEGACY, '重复迁移=幂等重建(剥旧锚重打,结果一致)')

  // ── 8b) 迁移:CRLF 文件(Windows 编辑器 / git autocrlf 的真实产物)──
  // 踩过的坑:补逗号时判断"行尾最后一个非空白字符"的字符集写成 [ \t\n],漏了 \r ——
  // CRLF 下行尾是 ",\r",于是每个区块都被误判成"没逗号"、白补一个,逗号落到下一行
  // 行首 → Unexpected token ','。真实 523 区块的 CRLF 扩展整包迁移失败(靠写前语法
  // 自检拦下、没写坏文件),而当时所有测试样例都是 LF,所以没照出来。
  const { validateExtensionCode } = await import('../src/validate.js')
  const syntaxOk = (code) => validateExtensionCode({ code, style: 'classic', kind: 'character' }).ok
  const CRLF = LEGACY.split('\n').join('\r\n')
  const c1 = blocks.migrateCode(CRLF)
  ok(!c1.error && c1.blocks === 4, 'CRLF 迁移:同样识别 4 个区块')
  ok(c1.commas === 0, 'CRLF 迁移:原文每块都有逗号 → 一个都不该补')
  ok(!/[\r],/.test(c1.code), 'CRLF 迁移:没有把逗号插到回车后面')
  ok(blocks.stripAnchors(c1.code) === CRLF, 'CRLF 迁移:剥掉锚点后与原文逐字节一致')
  ok(blocks.scanAnchored(c1.code).length === 4, 'CRLF 迁移:锚点可被扫描到(行尾锚已容忍 \\r)')
  ok(syntaxOk(c1.code), 'CRLF 迁移后的代码语法校验通过')
  const CRLF_MINI = 'game.import("extension", function (lib, game, ui, get, ai, _status) {\r\n  return {\r\n    name: "x",\r\n    skill: {\r\n      cs_a: { content: function () {} }\r\n    },\r\n    translate: {\r\n      cs_a: "甲"\r\n    }\r\n  }\r\n})\r\n'
  const c2 = blocks.migrateCode(CRLF_MINI)
  ok(!c2.error && c2.commas === 2, 'CRLF 迁移:确实缺逗号的区块照旧补上(2 处)')
  ok(syntaxOk(c2.code), 'CRLF 补齐逗号后语法仍通过')
  ok(/},\r\n/.test(c2.code), 'CRLF:逗号补在回车之前(不是后面)')

  // ── 9) 集成:writeExtension 区块模式(临时游戏目录)──
  const w1 = await writeExtension(nonameDir, { folder: '测试包', code: ANCHORED, style: 'classic', kind: 'character' })
  ok(w1.ok && w1.wrote && w1.backup === '', '集成:首写成功且无备份')
  const w2 = await writeExtension(nonameDir, { folder: '测试包', kind: 'character', style: 'classic',
    blocks: [{ kind: 'skill', id: 'cs_a', code: newA }] })
  ok(w2.ok && w2.wrote && w2.backup !== '', '集成:区块写入成功且产生备份')
  const back = await readFile(join(nonameDir, 'extension', '测试包', 'extension.js'), 'utf8')
  ok(blocks.extractBlock(back, 'skill', 'cs_b') === blocks.extractBlock(ANCHORED, 'skill', 'cs_b'), '集成:区块写入未触碰其他区块')

  // ── 10) 集成:readExtension 提取模式 ──
  const rd1 = await readExtension(nonameDir, '测试包', { listBlocks: true })
  ok(rd1.blocks.anchored === true && rd1.blocks.blocks.length === 4, '集成:listBlocks 返回目录')
  const rd2 = await readExtension(nonameDir, '测试包', { block: 'skill:cs_a' })
  ok(rd2.code && rd2.code.includes('draw(3)') && rd2.block.id === 'cs_a', '集成:按块读取')

  // ── 11) 集成:全文模式保真校验 ──
  const current = await readFile(join(nonameDir, 'extension', '测试包', 'extension.js'), 'utf8')
  const tampered2 = current.replace('draw(3)', 'draw(77)')
  const w3 = await writeExtension(nonameDir, { folder: '测试包', code: tampered2, style: 'classic', kind: 'character', editScope: ['cs_a'] })
  ok(w3.ok && w3.wrote, '集成:全文+editScope 申报后放行')
  const w4 = await writeExtension(nonameDir, { folder: '测试包', code: tampered2.replace('draw(2)', 'draw(88)'), style: 'classic', kind: 'character', editScope: ['cs_a'] })
  ok(!w4.ok && !w4.wrote && /范围/.test(w4.errors[0].message), '集成:范围外改动拒写')

  // ── 12) 集成:锚点化迁移(带备份与校验)──
  rmSync(join(nonameDir, '测试包'), { recursive: true, force: true })
  await writeExtension(nonameDir, { folder: '老包', code: LEGACY, style: 'classic', kind: 'character' })
  const mg = await migrateAnchors(nonameDir, '老包')
  ok(mg.ok && mg.blocks === 4 && mg.backup !== '', '集成:老包迁移成功且自证只加注释')
  const after = await readFile(join(nonameDir, 'extension', '老包', 'extension.js'), 'utf8')
  ok(blocks.stripAnchors(after) === LEGACY, '集成:迁移后除锚点外逐字节一致')
  const mg2 = await migrateAnchors(nonameDir, '老包')
  ok(mg2.ok && blocks.stripAnchors(await readFile(join(nonameDir, 'extension', '老包', 'extension.js'), 'utf8')) === LEGACY, '集成:重复迁移幂等(重打锚点内容不变)')

  // ── 13) 防丢护栏仍生效(block 模式 deletes 豁免)──
  const w5 = await writeExtension(nonameDir, { folder: '老包', kind: 'character', style: 'classic', deletes: ['skill:cs_a', 'translate:cs_a'] })
  ok(w5.ok && w5.wrote, '集成:block 模式声明删除放行')
  const w6 = await writeExtension(nonameDir, { folder: '老包', kind: 'character', style: 'classic', code: LEGACY.replace('cs_b:', 'cs_b_renamed:') })
  ok(!w6.ok && /消失/.test(w6.errors[0].message), '集成:全文模式防丢护栏仍拦截')

  // ── 14) package 描述符布局(真实测试包结构:技能藏在 package.skill.skill)──
  const PKG = `import { lib, game, ui, get, ai, _status } from "../../noname.js";
export default function () {
  return {
    name: "测试包",
    package: {
      author: "无名杀工坊",
      character: {
        character: {
          ts_muou: { sex: "male", skills: ["ts_huikan"] }
        },
        translate: {
          ts_muou: "木偶",
          ts_huikan: "挥砍",
          ts_huikan_info: "出牌阶段限一次。"
        }
      },
      skill: {
        skill: {
          ts_huikan: {
            enable: "phaseUse",
            content: function () { player.draw(); },
          }
        },
        translate: {}
      }
    },
  };
};`
  const pkSkills = blocks.virtualSkillBlocks(PKG)
  ok(pkSkills.length === 1 && pkSkills[0].id === 'ts_huikan', 'package 布局:技能块识别为 ts_huikan(无结构键垃圾)')
  const pkTr = blocks.virtualTranslateBlocks(PKG)
  ok(pkTr.length === 2 && pkTr.some((b) => b.id === 'ts_huikan' && b.text.includes('挥砍')), 'package 布局:翻译块识别并合并名称+描述')
  const pkDir = blocks.scanBlocks(PKG)
  ok(pkDir.blocks.every((b) => !['skill', 'translate', 'card', 'character'].includes(b.id)), 'package 布局:目录无结构键垃圾')
  const pkCh = blocks.virtualCharacterBlocks(PKG)
  ok(pkCh.length === 1 && pkCh[0].id === 'ts_muou', 'package 布局:武将块识别为 ts_muou')
  const pm = blocks.migrateCode(PKG)
  ok(!pm.error && pm.blocks === 4 && blocks.scanAnchored(pm.code).length === 4, 'package 布局:迁移覆盖 4 个内容块(1 技能 + 1 武将 + 2 翻译组)')
  ok(pm.code.includes('//#noname-kit-begin character:ts_muou'), 'package 布局:武将块也打上了锚点')
  ok(blocks.stripAnchors(pm.code).replace(/[ \t]*$/gm, '').replace(/,$/gm, '') === PKG.replace(/[ \t]*$/gm, '').replace(/,$/gm, ''), 'package 布局:迁移除锚点行与收尾逗号外逐字节还原')
  ok(pm.code.includes('},\n//#noname-kit-end skill:ts_huikan'), 'package 布局:技能块收尾补逗号(后续插入不炸)')
  ok(pm.code.includes('出牌阶段限一次。",\n//#noname-kit-end translate:ts_huikan'), 'package 布局:翻译块 end 锚落在区段收口之内')

  // ── 14) card / character 区块(老式扩展的主体内容,原先只有 skill/translate 支持)──
  // 嵌套描述符布局 card:{ card:{…} } 是真实老包的常见形态(用户创神包即如此):
  // 条目在内层容器里,插新块必须落到内层,插到外层会把新卡挂到错误的层级上。
  const CARDS = `game.import("extension", function (lib, game, ui, get, ai, _status) {
  return {
    name: "卡包",
    card: {
        card: {
            tumoubugui: {
                type: "trick",
                enable: true,
            },
            shuangqiang: {
                type: "equip",
            },
        },
    },
  };
})`
  const ca = blocks.virtualCardBlocks(CARDS)
  ok(ca.length === 2 && ca.map((b) => b.id).join(',') === 'tumoubugui,shuangqiang', 'card:虚拟划分识别 2 张卡(结构键 card 不当条目)')
  ok(blocks.extractBlock(CARDS, 'card', 'tumoubugui').includes('type: "trick"'), 'card:按块读取(未锚文件走虚拟划分)')
  const cm = blocks.migrateCode(CARDS)
  ok(!cm.error && cm.blocks === 2 && cm.commas === 0, 'card:迁移打上 2 个卡的锚点、不误补逗号')
  ok(cm.code.includes('//#noname-kit-begin card:tumoubugui'), 'card:锚点内容正确')
  ok(blocks.scanAnchored(cm.code).filter((b) => b.kind === 'card').length === 2, 'card:迁移后锚点可扫描')
  ok(syntaxOk(cm.code), 'card:迁移后语法通过')

  // 插入点:嵌套布局里新卡必须落在内层容器(否则 virtualCardBlocks 认不出它)
  const ins = blocks.assembleBlocks(cm.code, [{ kind: 'card', id: 'newone', code: 'newone: { type: "basic" }' }])
  ok(ins.errors.length === 0 && ins.applied.includes('card:newone'), 'card:新卡插入成功')
  const afterIns = blocks.virtualCardBlocks(ins.code)
  ok(afterIns.some((b) => b.id === 'newone'), 'card:插入的新卡被识别为 card 区段的条目(说明落对了层级)')
  ok(syntaxOk(ins.code), 'card:插入后语法通过')
  ok(ins.code.includes('card:newone') && ins.code.includes('card:tumoubugui'), 'card:原有卡未被破坏')

  // 无锚文件直接插新武将:同样要落在内层 character 容器里
  const CHARS = 'game.import("extension", function (lib, game, ui, get, ai, _status) {\n  return {\n    name: "武将包",\n    character: {\n        character: {\n            ts_muou: { sex: "male", hp: 3 },\n        },\n    },\n  };\n})'
  const ci = blocks.assembleBlocks(CHARS, [{ kind: 'character', id: 'ts_new', code: 'ts_new: { sex: "female", hp: 4 }' }])
  ok(ci.errors.length === 0, 'character:无锚文件插入新武将成功')
  ok(blocks.virtualCharacterBlocks(ci.code).some((b) => b.id === 'ts_new'), 'character:新武将落在内层容器(层级正确)')
  ok(syntaxOk(ci.code), 'character:插入后语法通过')

  // 武将的数组形态是老式扩展的经典写法(Miku: ["female","shen",3,[...],["zhu","des:…"]]),
  // 只认"值是对象"会把整包武将排除在区块管理之外(实测真实扩展 70 个武将全军覆没)
  const CHAR_ARR = 'game.import("extension", function (lib, game, ui, get, ai, _status) {\n  return {\n    name: "武将包",\n    character: {\n        character: {\n            Miku: ["female", "shen", 3, ["aicong"], ["zhu", "des:把你miku掉"]],\n            cs_feng: { sex: "male", hp: 4 },\n        },\n    },\n  };\n})'
  const carr = blocks.virtualCharacterBlocks(CHAR_ARR)
  ok(carr.length === 2, 'character:数组形态与对象形态都算条目(2 个)')
  ok(carr.find((b) => b.id === 'Miku').text.includes('把你miku掉'), 'character:数组形态条目能整块读出')
  const carrM = blocks.migrateCode(CHAR_ARR)
  ok(!carrM.error && carrM.blocks === 2 && syntaxOk(carrM.code), 'character:数组形态条目迁移后语法通过')
  ok(carrM.code.includes('//#noname-kit-begin character:Miku'), 'character:数组形态条目也打上锚点')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

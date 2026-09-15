#!/usr/bin/env node
/**
 * noname-kit 单测:任务登记处状态机 + 写入防丢护栏。
 * 运行:node scripts/test-tasks.mjs
 * 全程隔离在系统临时目录(登记处 + 假游戏目录),跑完即删,不碰真实家目录与游戏。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'noname-kit-test-'))
const nonameDir = join(home, 'fake-game')
let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log('  ✓ ' + label)
}

try {
  const tasks = await import('../src/tasks.js')
  const { writeExtension } = await import('../src/write.js')

  // ── 1) 创建武将任务(带图):树结构 + 初始状态 ──
  const created = await tasks.createTask(home, {
    id: '测试包-01', folder: '测试包', type: 'character', title: '木偶',
    charInfo: '群,3体力', pile: { join: false }, idPrefix: 'ts_',
    skills: [{ name: '挥砍', desc: '出杀次数+1' }, { name: '格挡', desc: '受到杀的伤害-1' }],
    image: 'D:/pic/a.png',
  })
  ok(created.ok, '创建武将任务')
  ok(created.task.skills.length === 2 && created.task.skills.every((s) => s.status === 'open'), '两个技能初始均为待实现')
  ok(created.task.image === 'D:/pic/a.png', '图片登记进任务')

  // ── 2) 重复 ID / 非法 ID ──
  const dup = await tasks.createTask(home, { id: '测试包-01', folder: '测试包', type: 'character', skills: [] })
  ok(!dup.ok, '重复任务ID被拒')
  const bad = await tasks.createTask(home, { id: '坏 id!', folder: '测试包', type: 'character', skills: [] })
  ok(!bad.ok, '非法任务ID被拒')

  // ── 3) skills_written:标记待测试 + 缺失上报 ──
  const marked = await tasks.markSkillsWritten(home, { taskId: '测试包-01', skills: ['挥砍', '不存在'] })
  ok(!marked.ok && marked.missing.includes('不存在') && marked.marked === 1, 'skills_written 标记真实技能并上报缺失')
  ok(marked.task.skills[0].status === 'written', '标记后状态为待测试')
  const noted = await tasks.markSkillsWritten(home, { taskId: '测试包-01', skills: ['格挡'], notes: ['canUse(card,t,distance=false) 忽略距离', 'canUse(card,t,distance=false) 忽略距离'] })
  ok(noted.ok && noted.notesStored === 1, 'skills_written notes 去重合并(引擎级结论才该进来)')

  // ── 4) 反馈:技能打回 open + 轮次累计 ──
  await tasks.setSkillStatus(home, { taskId: '测试包-01', skill: '挥砍', status: 'confirmed' })
  const fb = await tasks.skillFeedback(home, { taskId: '测试包-01', skill: '挥砍', issue: '伤害算错' })
  ok(fb.ok && fb.task.skills[0].status === 'open' && fb.task.skills[0].rounds === 1, '反馈把已确认技能打回待实现')
  ok(fb.task.feedbacks.length === 1 && fb.task.rounds === 1, '任务级轮次+1 且日志入账')

  // ── 5) 逐技能确认 → 全确认+有图 → 自动完成 ──
  const m2 = await tasks.markSkillsWritten(home, { taskId: '测试包-01', skills: ['挥砍', '格挡'] })
  ok(m2.ok, '全部技能重新标记待测试')
  const c1 = await tasks.setSkillStatus(home, { taskId: '测试包-01', skill: '挥砍', status: 'confirmed' })
  ok(c1.ok && !c1.autoCompleted && c1.task.status === 'open', '部分确认不触发自动完成')
  const c2 = await tasks.setSkillStatus(home, { taskId: '测试包-01', skill: '格挡', status: 'confirmed' })
  ok(c2.ok && c2.autoCompleted === true && c2.task.status === 'done', '全确认+有图 → 自动完成并置 done')

  // ── 6) 缺图任务:全确认也不自动完成,补图后可就位 ──
  await tasks.createTask(home, { id: '测试包-02', folder: '测试包', type: 'card', title: '决胜符', skills: [{ name: '任意占位', desc: '效果' }] })
  const cardTask = await tasks.getTask(home, '测试包-02')
  ok(cardTask.skills.length === 1 && cardTask.skills[0].name === '决胜符', '卡牌任务生成以卡牌名命名的单节点')
  await tasks.markSkillsWritten(home, { taskId: '测试包-02', skills: ['决胜符'] })
  const c3 = await tasks.setSkillStatus(home, { taskId: '测试包-02', skill: '决胜符', status: 'confirmed' })
  ok(c3.ok && !c3.autoCompleted && c3.task.status === 'open', '缺图任务全确认也不自动完成')
  const img = await tasks.setTaskImage(home, { taskId: '测试包-02', image: 'D:/pic/b.png' })
  ok(img.ok && img.task.image === 'D:/pic/b.png', '补图写回任务')
  ok(img.autoCompleted === true && img.task.status === 'done', '全确认后补图 → 触发自动完成置 done')

  // ── 7) 重开:done → open(不动技能/轮次/反馈) ──
  const doneTask = await tasks.completeById(home, { taskId: '测试包-02', summary: '手动标记完成' })
  ok(doneTask.ok && doneTask.task.status === 'done', '手动标记完成置 done')
  const reopened = await tasks.reopenTask(home, { taskId: '测试包-02' })
  ok(reopened.ok && reopened.task.status === 'open', '重开把任务打回进行中')
  ok(reopened.task.skills.every((s) => s.status === 'confirmed'), '重开不重置技能状态')
  const reopenGhost = await tasks.reopenTask(home, { taskId: '不存在的任务' })
  ok(!reopenGhost.ok, '重开不存在的任务报错')

  // ── 8) 删除:只动登记记录 ──
  const del = await tasks.deleteTask(home, '测试包-02')
  ok(del.ok, '删除任务')
  ok((await tasks.getTask(home, '测试包-02')) === null, '删除后查无此任务')

  // ── 9) 防丢护栏:旧技能消失拒写,补回放行 ──
  const oldCode = "var pack = game.import('extension', function (lib, game, ui, get, ai) { return { name: '测试包' } });\npack.skill.ts_aaa = {};\npack.skill.ts_bbb = {};"
  const r1 = await writeExtension(nonameDir, { folder: '测试包', code: oldCode, style: 'classic', kind: 'character' })
  ok(r1.ok && r1.wrote, '首次写入成功(无旧代码,护栏不误伤)')
  const lostCode = "var pack = game.import('extension', function (lib, game, ui, get, ai) { return { name: '测试包' } });\npack.skill.ts_bbb = {};"
  const r2 = await writeExtension(nonameDir, { folder: '测试包', code: lostCode, style: 'classic', kind: 'character' })
  ok(!r2.ok && !r2.wrote && /消失/.test(r2.errors[0].message), '旧技能消失 → 拒写')
  const preserved = await readFile(join(nonameDir, 'extension', '测试包', 'extension.js'), 'utf8')
  ok(/ts_aaa/.test(preserved), '拒写后旧文件未被破坏')
  const fullCode = "var pack = game.import('extension', function (lib, game, ui, get, ai) { return { name: '测试包' } });\npack.skill.ts_aaa = {};\npack.skill.ts_bbb = {};\npack.skill.ts_ccc = {};"
  const r3 = await writeExtension(nonameDir, { folder: '测试包', code: fullCode, style: 'classic', kind: 'character' })
  ok(r3.ok && r3.wrote && r3.backup, '补回技能 → 放行,且产生备份')

  // ── 10) 编辑已有条目:createTask 的 target + listEntries(下拉数据源) ──
  const editCreated = await tasks.createTask(home, {
    id: '测试包-03', folder: '测试包', type: 'character', title: '凌霜',
    skills: [{ name: '凌霜', desc: '把天罚伤害 1 改成 2' }],
    target: { kind: 'character', id: ' cs_tianfa ' },
  })
  ok(editCreated.ok && editCreated.task.target
    && editCreated.task.target.kind === 'character' && editCreated.task.target.id === 'cs_tianfa',
    '编辑任务 target 落库(去空白)')
  const badTarget = await tasks.createTask(home, {
    id: '测试包-04', folder: '测试包', type: 'card', title: '占位',
    skills: [{ name: '占位', desc: '效果' }],
    target: { kind: 'weapon', id: 'bad id!' },
  })
  ok(badTarget.ok && badTarget.task.target === null, '非法 target(kind 不认/ID 不合法)归 null')
  const noTarget = await tasks.createTask(home, { id: '测试包-05', folder: '测试包', type: 'card', title: '占位2', skills: [{ name: '占位2', desc: '' }] })
  ok(noTarget.ok && noTarget.task.target === null, '不传 target → null(创建任务不受影响)')
  const editCard = await tasks.createTask(home, {
    id: '测试包-06', folder: '测试包', type: 'card',
    skills: [{ name: '修改 tumoubugui', desc: '伤害 1 改为 2' }],
    target: { kind: 'card', id: 'tumoubugui' },
  })
  ok(editCard.ok && editCard.task.skills.length === 1 && editCard.task.skills[0].name === '修改 tumoubugui',
    '编辑卡牌任务(无 title)节点名取 skills[0].name,不再显示「新卡牌」')

  const entriesCode = [
    "game.import('extension', function (lib, game, ui, get, ai) {",
    '  return {',
    "    name: '条目包',",
    '    character: {',
    "      ts_ren1: ['male', 'wei', 4, ['ts_skill1']],",
    "      ts_ren2: { sex: 'female', group: 'shu', hp: 3, skills: ['ts_skill2'] },",
    '    },',
    '    card: {',
    '      card: {',
    "        ts_kapai: { fullimage: true, type: 'trick' },",
    '      },',
    '    },',
    '    translate: {',
    "      ts_ren1: ['凌霜', '武将描述'],",
    "      ts_ren2: { name: '霜女' },",
    "      ts_kapai: '疾风符',",
    '    },',
    '  }',
    '});',
  ].join('\n')
  const weEntries = await writeExtension(nonameDir, { folder: '条目包', code: entriesCode, style: 'classic', kind: 'character' })
  ok(weEntries.ok && weEntries.wrote, '写入条目包(供 listEntries 测试)')
  const { listEntries } = await import('../src/write.js')
  const leChar = await listEntries(nonameDir, '条目包', 'character')
  ok(leChar.ok && leChar.entries.length === 2, 'listEntries 列出两个武将(数组+对象形态,无锚虚拟划分)')
  ok(leChar.entries.some((x) => x.id === 'ts_ren1' && x.name === '凌霜'), '数组形态武将 + translate 数组首元素显示名')
  ok(leChar.entries.some((x) => x.id === 'ts_ren2' && x.name === '霜女'), '对象形态武将 + translate.name 显示名')
  const leCard = await listEntries(nonameDir, '条目包', 'card')
  ok(leCard.ok && leCard.entries.length === 1 && leCard.entries[0].id === 'ts_kapai' && leCard.entries[0].name === '疾风符', 'listEntries 列出卡牌(嵌套 card.card 布局)+ 字符串 translate 名')
  const leBad = await listEntries(nonameDir, '条目包', 'skill')
  ok(!leBad.ok, 'listEntries 非 character/card 的 kind 被拒')

  console.log('\n全部通过:' + passed + ' 项')
} finally {
  rmSync(home, { recursive: true, force: true })
}

#!/usr/bin/env node
/** 任务反馈与再次回传的磁盘回归测试；成功清理临时 home，失败保留目录供检查。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as tasks from '../src/tasks.js'

const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const userDshHome = resolve(homedir(), '.dsh')
const within = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path))
}
const requestedRoot = resolve(process.env.NNK_TASK_FEEDBACK_ARTIFACT_ROOT || tmpdir())
assert.ok(!within(repository, requestedRoot), '临时资料必须位于仓库外')
assert.ok(!within(userDshHome, requestedRoot), '临时资料不能位于真实 DSH home')
await mkdir(requestedRoot, { recursive: true })
const artifactRoot = await realpath(requestedRoot)
assert.ok(!within(repository, artifactRoot), '临时资料实际路径必须位于仓库外')
assert.ok(!within(userDshHome, artifactRoot), '临时资料实际路径不能位于真实 DSH home')
const runRoot = await mkdtemp(join(artifactRoot, 'noname-kit-task-feedback-'))
const failures = []
let passed = 0

function node(task, name) {
  const result = task.skills.find((skill) => skill.name === name)
  assert.ok(result, `任务包含技能 ${name}`)
  return result
}

function stable(task) {
  const copy = structuredClone(task)
  delete copy.updatedAt
  return copy
}

function nonStatusState(task) {
  const copy = stable(task)
  delete copy.status
  delete copy.notes
  for (const skill of copy.skills) delete skill.status
  return copy
}

async function persisted(home, expected) {
  const raw = JSON.parse(await readFile(join(home, 'noname-kit.tasks.json'), 'utf8'))
  assert.deepEqual(raw.tasks.find((task) => task.id === expected.id), expected, '返回状态已写入登记文件')
  const reloaded = await tasks.getTask(home, expected.id)
  assert.deepEqual(reloaded, expected, '重新读盘得到同一任务')
  return reloaded
}

async function create(home, extra = {}) {
  const result = await tasks.createTask(home, {
    id: '反馈任务', folder: '反馈测试包', type: 'character', title: '双技能武将',
    charInfo: '群,4体力', pile: { join: true, entries: '黑桃 7' },
    skills: [{ name: 'A', desc: '甲技能描述' }, { name: 'B', desc: '乙技能描述' }],
    image: 'fixtures/portrait.png', writeMode: 'manual', ...extra,
  })
  assert.equal(result.ok, true)
  return persisted(home, result.task)
}

async function confirm(home, name) {
  const result = await tasks.setSkillStatus(home, { taskId: '反馈任务', skill: name, status: 'confirmed' })
  assert.equal(result.ok, true)
  await persisted(home, result.task)
  return result
}

async function completed(home, extra = {}) {
  await create(home, extra)
  const marked = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', 'B'] })
  assert.equal(marked.ok, true)
  await confirm(home, 'A')
  const result = await confirm(home, 'B')
  assert.equal(result.autoCompleted, true)
  assert.equal(result.task.status, 'done')
  return result.task
}

async function diskSnapshot(home) {
  const file = join(home, 'noname-kit.tasks.json')
  const info = await stat(file, { bigint: true })
  return {
    bytes: await readFile(file, 'utf8'),
    files: (await readdir(home)).sort(),
    identity: { ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs },
  }
}

async function noWrite(home, input) {
  const before = await diskSnapshot(home)
  await delay(10)
  const result = await tasks.markSkillsWritten(home, input)
  assert.equal(result.ok, false, '非法 retestSkills 返回失败')
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error.length > 0)
  assert.deepEqual(await diskSnapshot(home), before, '非法 retestSkills 不写盘、不生成临时文件')
}

async function test(label, body) {
  const home = await mkdtemp(join(runRoot, 'home-'))
  assert.ok(within(runRoot, home) && home !== runRoot, '每例使用独立临时 home')
  try {
    await body(home)
    passed += 1
    console.log(`PASS ${label}`)
  } catch (error) {
    const failure = { label, home, error: error.stack || String(error) }
    failures.push(failure)
    console.error(`FAIL ${label}\n${failure.error}\n保留 home: ${home}`)
    await writeFile(join(home, 'failure.txt'), `${label}\n${failure.error}\n`, 'utf8')
  }
}

console.log(`任务反馈测试临时目录: ${runRoot}`)

await test('A 已确认、B 反馈后整组回传；再次反馈 A；保留轮次、日志、图片和配音', async (home) => {
  await create(home, {
    skills: [
      { name: 'A', desc: '甲技能描述', audios: ['fixtures/a-1.mp3', 'fixtures/a-2.mp3'] },
      { name: 'B', desc: '乙技能描述', audios: ['fixtures/b.mp3'] },
    ],
    dieAudios: ['fixtures/die.mp3'],
  })
  await tasks.setSkillAudioFiles(home, { taskId: '反馈任务', skill: 'A', files: ['skill/a1.mp3', 'skill/a2.mp3'] })
  await tasks.setSkillAudioFiles(home, { taskId: '反馈任务', skill: 'B', files: ['skill/b.mp3'] })
  await tasks.setDieAudioFiles(home, { taskId: '反馈任务', files: ['die/hero.mp3'] })
  await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', 'B'], notes: ['原有注意事项'] })
  await tasks.skillFeedback(home, { taskId: '反馈任务', skill: 'A', issue: '甲技能先前反馈' })
  await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A'] })
  await confirm(home, 'A')
  await confirm(home, 'B')
  await tasks.completeById(home, { taskId: '反馈任务', summary: '既有摘要', notes: ['已有完成记录'] })
  const feedback = await tasks.skillFeedback(home, { taskId: '反馈任务', skill: 'B', issue: '乙技能需要修复' })
  assert.equal(feedback.ok, true)
  const before = await persisted(home, feedback.task)
  assert.equal(node(before, 'A').status, 'confirmed')
  assert.equal(node(before, 'B').status, 'open')
  assert.equal(before.rounds, 2)
  assert.equal(node(before, 'A').rounds, 1)
  assert.equal(node(before, 'B').rounds, 1)

  const returned = await tasks.markSkillsWritten(home, {
    taskId: '反馈任务', skills: ['A', 'B', 'A', 'B'],
    notes: ['原有注意事项', '新增注意事项', '新增注意事项'],
  })
  assert.equal(node(returned.task, 'A').status, 'confirmed', '整组回传保留 A 已确认状态')
  assert.equal(node(returned.task, 'B').status, 'written', '有反馈的 B 回到待测试')
  assert.equal(returned.ok, true)
  assert.deepEqual(returned.preservedConfirmed, ['A'])
  assert.equal(returned.marked, 1)
  assert.equal(returned.reopened, false)
  assert.deepEqual(node(returned.task, 'A'), node(before, 'A'), '已确认节点的全部资料保留')
  assert.deepEqual(nonStatusState(returned.task), nonStatusState(before), '状态回传不丢其他任务资料')
  assert.deepEqual(returned.task.notes, ['原有注意事项', '已有完成记录', '新增注意事项'])
  assert.equal(returned.notesStored, 3)
  await persisted(home, returned.task)

  const repeated = await tasks.markSkillsWritten(home, {
    taskId: '反馈任务', skills: ['A', 'B', 'B'], notes: ['新增注意事项'],
  })
  assert.deepEqual(stable(repeated.task), stable(returned.task), '重复回传不改变状态、轮次、日志或 notes')
  assert.equal(repeated.marked, 1)
  assert.deepEqual(repeated.preservedConfirmed, ['A'])
  await persisted(home, repeated.task)
  const firstDone = await confirm(home, 'B')
  assert.equal(firstDone.autoCompleted, true)
  assert.equal(firstDone.task.status, 'done', 'B 再次确认后自动完成')

  const aFeedback = await tasks.skillFeedback(home, { taskId: '反馈任务', skill: 'A', issue: '甲技能这次有问题' })
  assert.equal(aFeedback.task.status, 'open')
  assert.equal(node(aFeedback.task, 'A').status, 'open')
  const aReturned = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', 'B'] })
  assert.equal(node(aReturned.task, 'A').status, 'written', '用户反馈后 A 可正常再次进入待测试')
  assert.equal(node(aReturned.task, 'B').status, 'confirmed')
  assert.deepEqual(aReturned.preservedConfirmed, ['B'])
  assert.equal(aReturned.marked, 1)
  await persisted(home, aReturned.task)
  const final = await confirm(home, 'A')
  assert.equal(final.autoCompleted, true)
  assert.equal(final.task.status, 'done')
  assert.equal(final.task.rounds, 3)
  assert.equal(node(final.task, 'A').rounds, 2)
  assert.equal(final.task.feedbacks.length, 3)
  assert.equal(node(final.task, 'A').feedbacks.length, 2)
  assert.deepEqual(nonStatusState(final.task), nonStatusState(aFeedback.task))
})

for (const input of [
  { label: 'confirmed-only', skills: ['A', 'B', 'A'], ok: true, missing: [], preserved: ['A', 'B'] },
  { label: '空清单', skills: [], ok: true, missing: [], preserved: [] },
  { label: '未传清单', ok: true, missing: [], preserved: [] },
  { label: '全不存在', skills: ['不存在', '不存在'], ok: false, missing: ['不存在'], preserved: [] },
]) {
  await test(`done 任务收到${input.label}仍然完成`, async (home) => {
    const before = await completed(home)
    const result = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: input.skills })
    assert.equal(result.task.status, 'done', '没有待测试技能时不重开 done')
    assert.equal(result.reopened, false)
    assert.equal(result.marked, 0)
    assert.equal(result.ok, input.ok)
    assert.deepEqual(result.missing, input.missing)
    assert.deepEqual(result.preservedConfirmed, input.preserved)
    assert.deepEqual(stable(result.task), stable(before))
    await persisted(home, result.task)
    const repeated = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: input.skills, retestSkills: [] })
    assert.deepEqual(stable(repeated.task), stable(before), '显式空 retest 与默认值相同且重复回传幂等')
    assert.equal(repeated.reopened, false)
    assert.equal(repeated.marked, 0)
    await persisted(home, repeated.task)
  })
}

await test('混合未知名称保持 missing 与部分标记语义', async (home) => {
  await create(home)
  await confirm(home, 'A')
  const before = await tasks.getTask(home, '反馈任务')
  const result = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', '不存在', 'B', 'B'] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['不存在'])
  assert.deepEqual(result.preservedConfirmed, ['A'])
  assert.equal(result.marked, 1)
  assert.equal(result.reopened, false)
  assert.equal(node(result.task, 'A').status, 'confirmed')
  assert.equal(node(result.task, 'B').status, 'written')
  assert.equal(result.task.skills.length, 2)
  assert.deepEqual(nonStatusState(result.task), nonStatusState(before))
  await persisted(home, result.task)
})

await test('显式 retestSkills 精确重测指定技能并在再次确认后自动完成', async (home) => {
  await completed(home)
  const before = await tasks.getTask(home, '反馈任务')
  const result = await tasks.markSkillsWritten(home, {
    taskId: '反馈任务', skills: ['A', 'B', 'A'], retestSkills: ['B', 'B'],
  })
  assert.equal(result.ok, true)
  assert.equal(result.marked, 1)
  assert.equal(result.reopened, true)
  assert.equal(result.task.status, 'open')
  assert.deepEqual(result.preservedConfirmed, ['A'])
  assert.equal(node(result.task, 'A').status, 'confirmed')
  assert.equal(node(result.task, 'B').status, 'written')
  assert.deepEqual(nonStatusState(result.task), nonStatusState(before))
  await persisted(home, result.task)
  const repeated = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', 'B'], retestSkills: ['B'] })
  assert.equal(repeated.reopened, false)
  assert.deepEqual(stable(repeated.task), stable(result.task))
  await persisted(home, repeated.task)
  const final = await confirm(home, 'B')
  assert.equal(final.autoCompleted, true)
  assert.equal(final.task.status, 'done')
})

await test('非法 retestSkills 不改变任何登记文件或动态节点', async (home) => {
  await completed(home)
  for (const retestSkills of [null, 'A', {}, true, 3, [null], [3], [''], ['B', 'A']]) {
    await noWrite(home, { taskId: '反馈任务', skills: ['A'], retestSkills, notes: ['非法请求不能落盘'] })
  }
  await noWrite(home, { taskId: '反馈任务', skills: [], retestSkills: ['A'] })
  await noWrite(home, { taskId: '反馈任务', skills: [3], retestSkills: [3] })

  const mode = await tasks.createTask(home, { id: '动态任务', folder: '反馈测试包', type: 'mode', skills: [{ name: '已有规则' }] })
  assert.equal(mode.ok, true)
  await noWrite(home, { taskId: '动态任务', skills: ['新增规则'], retestSkills: ['范围外规则'], notes: ['不可保留'] })
  const reloaded = await tasks.getTask(home, '动态任务')
  assert.deepEqual(reloaded, mode.task, '非法请求不能提前创建动态规则')
})

await test('动态模式新增规则仍保留已有确认，且显式 retest 只重测指定规则', async (home) => {
  await create(home, {
    type: 'mode', skills: [], image: '', modeBrief: '轮流对战', modeNum: '4',
    modeWin: '存活到最后', modeRules: '保留既有规则并允许追加规则',
  })
  const initial = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['规则甲'], notes: ['模式注意事项'] })
  assert.equal(initial.ok, true)
  assert.equal(initial.marked, 1)
  const done = await confirm(home, '规则甲')
  assert.equal(done.autoCompleted, true)
  const result = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['规则甲', '规则乙', '规则乙'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.equal(result.marked, 1)
  assert.equal(result.reopened, true)
  assert.equal(result.task.status, 'open')
  assert.equal(result.task.skills.length, 2)
  assert.deepEqual(node(result.task, '规则甲'), node(done.task, '规则甲'))
  assert.deepEqual(result.preservedConfirmed, ['规则甲'])
  assert.equal(node(result.task, '规则乙').status, 'written')
  assert.equal(node(result.task, '规则乙').rounds, 0)
  assert.deepEqual(node(result.task, '规则乙').feedbacks, [])
  assert.equal(result.task.dynamicSkills, true)
  assert.equal(result.task.modeBrief, done.task.modeBrief)
  assert.equal(result.task.modeRules, done.task.modeRules)
  assert.deepEqual(result.task.notes, done.task.notes)
  await persisted(home, result.task)
  const repeated = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['规则甲', '规则乙'] })
  assert.deepEqual(stable(repeated.task), stable(result.task), '动态节点重复回传不会重复登记')
  const secondDone = await confirm(home, '规则乙')
  assert.equal(secondDone.autoCompleted, true)
  const retest = await tasks.markSkillsWritten(home, {
    taskId: '反馈任务', skills: ['规则甲', '规则乙'], retestSkills: ['规则甲'],
  })
  assert.equal(retest.marked, 1)
  assert.deepEqual(retest.preservedConfirmed, ['规则乙'])
  assert.equal(retest.reopened, true)
  assert.equal(node(retest.task, '规则甲').status, 'written')
  assert.equal(node(retest.task, '规则乙').status, 'confirmed')
  await persisted(home, retest.task)
  const final = await confirm(home, '规则甲')
  assert.equal(final.autoCompleted, true)
  assert.equal(final.task.status, 'done')
})

await test('done 仅在真正产生 written 节点时重开，未知 retest 名称仍保持 missing', async (home) => {
  await completed(home)
  const missing = await tasks.markSkillsWritten(home, {
    taskId: '反馈任务', skills: ['A', '未知名'], retestSkills: ['未知名'],
  })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.missing, ['未知名'])
  assert.deepEqual(missing.preservedConfirmed, ['A'])
  assert.equal(missing.marked, 0)
  assert.equal(missing.reopened, false)
  assert.equal(missing.task.status, 'done')
  await persisted(home, missing.task)

  await tasks.setSkillStatus(home, { taskId: '反馈任务', skill: 'B', status: 'open' })
  // 明确构造修复前遗留记录；当前 completeById 已同步确认子项，不能再借它制造旧状态。
  const legacyRegistry = JSON.parse(await readFile(join(home, 'noname-kit.tasks.json'), 'utf8'))
  const legacyTask = legacyRegistry.tasks.find((task) => task.id === '反馈任务')
  legacyTask.status = 'done'
  legacyTask.summary = '保留的旧版手工完成任务'
  await writeFile(join(home, 'noname-kit.tasks.json'), JSON.stringify(legacyRegistry, null, 2), 'utf8')
  const before = await tasks.getTask(home, '反馈任务')
  assert.equal(before.status, 'done', '兼容旧版主任务完成但子项未确认的遗留状态')
  assert.equal(node(before, 'B').status, 'open', '遗留 fixture 保留 B 的未确认状态')
  const written = await tasks.markSkillsWritten(home, { taskId: '反馈任务', skills: ['A', 'B', '未知名'] })
  assert.equal(written.ok, false)
  assert.deepEqual(written.missing, ['未知名'])
  assert.deepEqual(written.preservedConfirmed, ['A'])
  assert.equal(written.marked, 1)
  assert.equal(written.reopened, true)
  assert.equal(written.task.status, 'open')
  assert.equal(node(written.task, 'B').status, 'written')
  assert.equal(node(written.task, 'A').status, 'confirmed')
  await persisted(home, written.task)
})

if (failures.length) {
  await writeFile(join(runRoot, 'failures.json'), JSON.stringify({ passed, failed: failures.length, failures }, null, 2), 'utf8')
  console.error(`\n任务反馈回归失败: ${failures.length} 项；通过: ${passed} 项。资料保留: ${runRoot}`)
  process.exitCode = 1
} else {
  assert.ok(within(artifactRoot, runRoot) && runRoot !== artifactRoot, '仅清理本次临时目录')
  await rm(runRoot, { recursive: true, force: true })
  console.log(`\n任务反馈回归全部通过: ${passed} 项；临时目录已清理。`)
}

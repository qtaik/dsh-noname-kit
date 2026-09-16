/**
 * noname-kit 任务登记处 v2:层级任务树。
 * 任务 = 一个武将(多技能分叉)或一张卡牌(单节点):
 *   task = { id, folder, type: 'character'|'card', title, charInfo, image, idPrefix,
 *            target: { kind: 'character'|'card', id } | null,
 *            pile: { join: boolean, entries: string(每行「花色 点数」) },
 *            skills: [{name, desc, status: open|written|confirmed, rounds, feedbacks[] }],
 *            status: open|done, style, writeMode, createdAt, updatedAt }
 * target 非空 = 「编辑已有条目」任务:只改该条目对应区块,其他内容不动。
 * 每个技能独立状态机:待实现(open)→ 待测试(written)→ 确认无误(confirmed);
 * 反馈把技能打回 open 并记录日志。全部技能 confirmed 且图片就位 → 任务自动 done。
 * 删除任务 = 从登记处移除整树;不动扩展代码/备份/history 归档。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ID_RE = /^[\w\u4e00-\u9fff-]{1,64}$/

function tasksPath(dshHome) {
  return join(resolveHome(dshHome), 'noname-kit.tasks.json')
}

function resolveHome(dshHome) {
  if (dshHome) return dshHome
  return join(homedir(), '.dsh')
}

export function emptyRegistry() {
  return { version: 1, tasks: [] }
}

export async function readRegistry(dshHome) {
  try {
    const raw = await readFile(tasksPath(dshHome), 'utf8')
    const parsed = JSON.parse(raw)
    return { ...emptyRegistry(), ...parsed }
  } catch {
    return emptyRegistry()
  }
}

async function writeRegistry(dshHome, registry) {
  await writeFile(tasksPath(dshHome), JSON.stringify(registry, null, 2), 'utf8')
}

/**
 * 创建任务。ID 全局唯一;folder 只做名字合法性检查(目录在首次写入时才创建)。
 * @returns {{ok:boolean, task?:object, error?:string}}
 */
const SKILL_STATUS = new Set(['open', 'written', 'confirmed'])

function newSkill(item) {
  return {
    name: String((item && item.name) || '').slice(0, 60),
    desc: String((item && item.desc) || '').slice(0, 2000),
    status: 'open',
    rounds: 0,
    feedbacks: [],
  }
}

function touch(task) { task.updatedAt = Date.now() }

/** 是否满足自动完成:全部技能 confirmed 且图片就位。
 * 编辑已有条目任务(target 非空)豁免图片条件:立绘通常早已存在,用户没登记
 * 图片 = 本次不涉及图——实测测试包-03 全确认后因没填图片永远卡在进行中。
 * (编辑+换图场景用户会填图片路径,登记后照旧走 copy_images/补图链路。) */
function isCompletable(task) {
  const imageOk = task.target ? true : Boolean(task.image)
  return imageOk && task.skills.length > 0 && task.skills.every((s) => s.status === 'confirmed')
}

function descriptionOf(skills) {
  return Array.isArray(skills) && skills[0] && skills[0].desc ? String(skills[0].desc).slice(0, 2000) : ''
}

/**
 * 创建任务。ID 全局唯一;character 任务带 skills 分叉;card 任务单节点。
 * skills: [{name, desc}];card 类型自动生成单节点。
 * target 可选 { kind: 'character'|'card', id }:「编辑已有条目」任务,非法值归 null。
 * writeMode:'manual' 存手动,其余归 'auto'——写入工具以此为准(AI 传参不覆盖)。
 */
export async function createTask(dshHome, { id, folder, type, title, charInfo, pile, idPrefix, skills, image, target, writeMode }) {
  if (typeof id !== 'string' || !ID_RE.test(id.trim())) {
    return { ok: false, error: `任务ID「${id}」不合法:只允许中文/字母/数字/下划线/连字符,长度 1-64。` }
  }
  if (typeof folder !== 'string' || !ID_RE.test(folder.trim())) {
    return { ok: false, error: `扩展文件夹名「${folder}」不合法。` }
  }
  const cleanId = id.trim()
  const registry = await readRegistry(dshHome)
  if (registry.tasks.some((t) => t.id === cleanId)) {
    return { ok: false, error: `任务ID「${cleanId}」已存在,换一个(或加上日期/序号)。` }
  }
  const taskType = type === 'card' ? 'card' : 'character'
  const skillList = taskType === 'card'
    ? [newSkill({ name: title || (Array.isArray(skills) && skills[0] && skills[0].name) || '新卡牌', desc: descriptionOf(skills) })]
    : ((Array.isArray(skills) && skills.length ? skills : [{ name: title || '新技能', desc: '' }]).map(newSkill))
  const taskTarget = target && (target.kind === 'character' || target.kind === 'card')
    && typeof target.id === 'string' && ID_RE.test(target.id.trim())
    ? { kind: target.kind, id: target.id.trim() }
    : null
  const task = {
    id: cleanId,
    folder: folder.trim(),
    type: taskType,
    target: taskTarget,
    title: String(title || '').slice(0, 60),
    charInfo: String(charInfo || '').slice(0, 500),
    pile: pile && pile.join ? { join: true, entries: String(pile.entries || '').slice(0, 2000) } : { join: false, entries: '' },
    idPrefix: String(idPrefix || '').slice(0, 20),
    image: String(image || '').trim().slice(0, 500),
    skills: skillList,
    style: '',
    writeMode: writeMode === 'manual' ? 'manual' : 'auto',
    status: 'open',
    rounds: 0,
    feedbacks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  registry.tasks.push(task)
  if (registry.tasks.length > 300) registry.tasks = registry.tasks.slice(-300)
  await writeRegistry(dshHome, registry)
  return { ok: true, task }
}

export async function listTasks(dshHome, { openOnly } = {}) {
  const registry = await readRegistry(dshHome)
  const list = openOnly ? registry.tasks.filter((t) => t.status === 'open') : registry.tasks
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 按 ID 取任务;不存在返回 null。 */
export async function getTask(dshHome, taskId) {
  const registry = await readRegistry(dshHome)
  return registry.tasks.find((t) => t.id === taskId) || null
}

/** 重开已完成任务:done → open。不动技能状态/轮次/反馈——
 * 供补图或重新确认后再次收口(自动归档由既有确认链路触发)。 */
export async function reopenTask(dshHome, { taskId }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  task.status = 'open'
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: true, task }
}

/** 删除任务:从登记处移除整条记录(不影响扩展代码/备份/history 归档)。 */
export async function deleteTask(dshHome, taskId) {
  const registry = await readRegistry(dshHome)
  const idx = registry.tasks.findIndex((t) => t.id === taskId)
  if (idx < 0) return { ok: false, error: `找不到任务「${taskId}」` }
  const removed = registry.tasks.splice(idx, 1)[0]
  await writeRegistry(dshHome, registry)
  return { ok: true, removed }
}

/**
 * 完成任务:标记 done + 返回任务信息(调用方负责把摘要同步进扩展文件夹 history)。
 * @returns {{ok:boolean, task?:object, error?:string}}
 */
export async function completeById(dshHome, { taskId, summary, notes }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  task.status = 'done'
  task.updatedAt = Date.now()
  if (summary) task.summary = String(summary).slice(0, 2000)
  if (Array.isArray(notes) && notes.length) {
    task.notes = (task.notes || []).concat(notes.map((n) => String(n).slice(0, 500))).slice(-20)
  }
  await writeRegistry(dshHome, registry)
  return { ok: true, task }
}


function findSkill(task, skillName) {
  return task.skills.find((s) => s.name === skillName)
}

/**
 * 设置单个技能的状态(用户点确认无误 / AI 标记写入完成 / 打回)。
 * @param {string} status - open|written|confirmed
 */
export async function setSkillStatus(dshHome, { taskId, skill, status }) {
  if (!SKILL_STATUS.has(status)) return { ok: false, error: `未知状态「${status}」` }
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const node = findSkill(task, skill)
  if (!node) return { ok: false, error: `任务「${taskId}」里没有技能「${skill}」` }
  node.status = status
  touch(task)
  const autoCompleted = isCompletable(task) && task.status !== 'done'
  if (autoCompleted) task.status = 'done'
  await writeRegistry(dshHome, registry)
  const confirmed = task.skills.filter((s) => s.status === 'confirmed').length
  return { ok: true, autoCompleted, task, confirmed, total: task.skills.length }
}

/** AI 写入完成:把指定技能标为 written(待测试);可携带引擎级注意点(合并去重存任务)。 */
export async function markSkillsWritten(dshHome, { taskId, skills, notes }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const names = Array.isArray(skills) ? skills : []
  const missing = []
  for (const name of names) {
    const node = findSkill(task, name)
    if (!node) { missing.push(name); continue }
    node.status = 'written'
  }
  let notesStored = 0
  if (Array.isArray(notes) && notes.length) {
    const clean = notes.map((n) => String(n).slice(0, 500)).filter(Boolean)
    task.notes = [...new Set([...(task.notes || []), ...clean])].slice(-20)
    notesStored = task.notes.length
  }
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: missing.length === 0, missing, marked: names.length - missing.length, notesStored, task }
}

/**
 * 反馈:轮次+1(任务与技能各计)、日志追加、技能打回 open。
 * @param {string} [input.skill] - 具体技能名;不传则只推进任务轮次。
 */
export async function skillFeedback(dshHome, { taskId, skill, issue }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const issueText = String(issue || '').slice(0, 2000)
  if (!Array.isArray(task.feedbacks)) task.feedbacks = []
  task.rounds += 1
  task.status = 'open'
  let unknownSkill = null
  if (skill) {
    const node = findSkill(task, skill)
    if (node) {
      node.status = 'open'
      node.rounds += 1
      node.feedbacks.push({ at: Date.now(), issue: issueText })
      if (node.feedbacks.length > 50) node.feedbacks = node.feedbacks.slice(-50)
    } else unknownSkill = skill
  }
  task.feedbacks.push({ at: Date.now(), skill: skill || '', issue: issueText })
  if (task.feedbacks.length > 100) task.feedbacks = task.feedbacks.slice(-100)
  touch(task)
  await writeRegistry(dshHome, registry)
  // unknownSkill 非空 = 技能名不在任务清单里(日志/API 可见;状态照常打回 open)
  return { ok: true, unknownSkill, task }
}

/** 补图:设置任务图片路径(路径由用户在表单填写)。
 * 补图后若满足「全确认+有图」,自动置 done(归档由调用方完成)——
 * 否则全确认后补图的任务会永远停在 open,无人触发收口。 */
export async function setTaskImage(dshHome, { taskId, image }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  task.image = String(image || '').slice(0, 500)
  const autoCompleted = isCompletable(task) && task.status !== 'done'
  if (autoCompleted) task.status = 'done'
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: true, task, autoCompleted }
}

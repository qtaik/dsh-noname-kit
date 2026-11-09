/**
 * 保存武将、卡牌和模式任务的需求、技能状态、素材及反馈。
 * 技能状态按 open → written → confirmed 流转，反馈后回到 open。
 * 全部技能确认且所需素材齐全后自动完成；新建武将和卡牌需要图片，编辑任务和模式不要求图片。
 * 已登记的配音必须全部复制到位；模式规则可通过 skills_written 动态登记。
 * 删除任务仅移除登记记录，保留扩展源码、备份和历史。
 */
import { readJsonSafe, writeJsonAtomic } from './store.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ID_RE = /^[\w\u4e00-\u9fff-]{1,64}$/
const MAX_AUDIOS_PER_TARGET = 10

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
  /* 安全读取任务登记：损坏内容先留档，tasks 字段校验为数组，异常形状回退为空列表。 */
  const parsed = await readJsonSafe(tasksPath(dshHome), emptyRegistry())
  const registry = { ...emptyRegistry(), ...parsed }
  if (!Array.isArray(registry.tasks)) registry.tasks = []
  return registry
}

async function writeRegistry(dshHome, registry) {
  await writeJsonAtomic(tasksPath(dshHome), registry)
}

const SKILL_STATUS = new Set(['open', 'written', 'confirmed'])

/** 清洗配音源路径清单:逗号/分号/换行分隔,去空,截断长度与条数。 */
function cleanAudioPaths(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n]/)
  return list.map((p) => String(p || '').trim().slice(0, 500)).filter(Boolean).slice(0, MAX_AUDIOS_PER_TARGET)
}

function newSkill(item) {
  return {
    name: String((item && item.name) || '').slice(0, 60),
    desc: String((item && item.desc) || '').slice(0, 2000),
    audios: cleanAudioPaths(item && item.audios),
    audioFiles: [],
    status: 'open',
    rounds: 0,
    feedbacks: [],
  }
}

function touch(task) { task.updatedAt = Date.now() }

/** 全部技能 confirmed 且登记的图片与配音交付完整时自动完成。编辑已有条目的任务豁免图片条件；登记 N 条配音源路径时要求至少交付 N 个目标文件，未登记配音时不增加完成条件。 */
function isCompletable(task) {
  // 🎲 mode 任务:无预登记图片(模式扩展无立绘/卡图需求),图片条件豁免(同 target 编辑任务)
  const imageOk = task.target || task.type === 'mode' ? true : Boolean(task.image)
  const audioOk = task.skills.every((s) =>
    !(Array.isArray(s.audios) && s.audios.length) ||
    (Array.isArray(s.audioFiles) && s.audioFiles.length >= s.audios.length))
  const dieOk = !(Array.isArray(task.dieAudios) && task.dieAudios.length) ||
    (Array.isArray(task.dieAudioFiles) && task.dieAudioFiles.length >= task.dieAudios.length)
  return imageOk && audioOk && dieOk && task.skills.length > 0 && task.skills.every((s) => s.status === 'confirmed')
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
export async function createTask(dshHome, { id, folder, type, title, charInfo, newFaction, portraitVideo, pile, skills, image, dieAudios, target, writeMode, modeBrief, modeNum, modeWin, modeRules }) {
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
  // 🎲 mode = 自定义游戏模式任务:新玩法规则节点由 AI 在 skills_written 时动态登记
  // (自由描述无法预先拆规则),创建模式初始 skills 为空;编辑模式把用户填的
  // 「模式骨架改动/新增或调整的规则」预置为节点(带内容,任务树可见、逐条确认),
  // dynamicSkills 置真使 AI 回传的其他规则节点也能动态登记
  const taskType = type === 'card' ? 'card' : type === 'mode' ? 'mode' : 'character'
  const skillList = taskType === 'mode'
    ? (Array.isArray(skills) && skills.length ? skills.map(newSkill) : [])
    : taskType === 'card'
    ? [newSkill({ name: title || (Array.isArray(skills) && skills[0] && skills[0].name) || '新卡牌', desc: descriptionOf(skills) })]
    : ((Array.isArray(skills) && skills.length ? skills : [{ name: title || '新技能', desc: '' }]).map(newSkill))
  const taskTarget = target && (target.kind === 'character' || target.kind === 'card')
    && typeof target.id === 'string' && ID_RE.test(target.id.trim())
    ? { kind: target.kind, id: target.id.trim() }
    : null
  const creatingCharacter = taskType === 'character' && !target;
  let faction = null;
  let video = '';
  if (creatingCharacter && newFaction != null) {
    if (typeof newFaction.name !== 'string' || !newFaction.name.trim() || newFaction.name.trim().length > 60 ||
        typeof newFaction.image !== 'string' || !newFaction.image.trim() || newFaction.image.trim().length > 500) {
      return { ok: false, error: '新势力需要名称（不超过 60 字）和图片路径（不超过 500 字）。' }
    }
    faction = { name: newFaction.name.trim(), image: newFaction.image.trim() };
  }
  const characterVideoAllowed = taskType === 'character' && (!target || taskTarget?.kind === 'character');
  if (characterVideoAllowed && portraitVideo != null && portraitVideo !== '') {
    if (typeof portraitVideo !== 'string' || portraitVideo.trim().length > 500 || !/\.(mp4|webm|m4v|mov|ogv)$/i.test(portraitVideo.trim())) {
      return { ok: false, error: '动态立绘需要 MP4、WebM、M4V、MOV 或 OGV 视频路径（不超过 500 字）。' }
    }
    video = portraitVideo.trim();
  }
  const task = {
    id: cleanId,
    folder: folder.trim(),
    type: taskType,
    target: taskTarget,
    title: String(title || '').slice(0, 60),
    charInfo: String(charInfo || '').slice(0, 500),
    newFaction: faction,
    portraitVideo: video,
    pile: pile && pile.join ? { join: true, entries: String(pile.entries || '').slice(0, 2000) } : { join: false, entries: '' },
    image: String(image || '').trim().slice(0, 500),
    dieAudios: cleanAudioPaths(dieAudios),
    dieAudioFiles: [],
    skills: skillList,
    // 🎲 mode 专属:需求四要素留档 + 动态规则节点标志(skills_written 据此放行回传规则名)
    dynamicSkills: taskType === 'mode',
    modeBrief: taskType === 'mode' ? String(modeBrief || '').slice(0, 300) : '',
    modeNum: taskType === 'mode' ? String(modeNum || '').slice(0, 10) : '',
    modeWin: taskType === 'mode' ? String(modeWin || '').slice(0, 300) : '',
    modeRules: taskType === 'mode' ? String(modeRules || '').slice(0, 5000) : '',
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

/**
 * 重新打开已完成任务，保留技能状态、轮次和反馈。
 * 后续确认或补图仍按原有条件自动完成和归档。
 */
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
 * 用户手动完成任务:同时确认现有技能节点并标记 done，保留轮次和反馈记录。
 * manualCompletion 记录手动完成来源，不表示新增测试经过；调用方负责归档摘要。
 * @returns {{ok:boolean, task?:object, error?:string}}
 */
export async function completeById(dshHome, { taskId, summary, notes }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const completedAt = Date.now()
  const skills = Array.isArray(task.skills) ? task.skills : []
  const changed = skills.filter((s) => s.status !== 'confirmed')
    .map((s) => ({ name: s.name, from: s.status }))
  if (task.status !== 'done' || changed.length) {
    for (const node of skills) node.status = 'confirmed'
    task.manualCompletion = { at: completedAt, changed }
  }
  task.status = 'done'
  task.updatedAt = completedAt
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

/** AI 写入完成:把本轮技能标为 written(待测试)，保留已确认状态；实际修改的已确认技能须用 retestSkills 明确重新待测。
 * 可携带引擎级注意点(合并去重存任务)。
 *  🎲 mode 任务(dynamicSkills)的规则节点由 AI 回传时动态登记——自由描述无法预先拆规则。 */
export async function markSkillsWritten(dshHome, { taskId, skills, notes, retestSkills = [] }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const dynamic = task.dynamicSkills === true
  const names = [...new Set(Array.isArray(skills) ? skills : [])]
  if (!Array.isArray(retestSkills) || retestSkills.some((name) => typeof name !== 'string' || !names.includes(name))) {
    return { ok: false, error: 'retestSkills 必须是 skills 中本轮实际修改、需要重新测试的技能名称数组。' }
  }
  const retest = new Set(retestSkills)
  const missing = []
  const preservedConfirmed = []
  let marked = 0
  for (const name of names) {
    const node = findSkill(task, name)
    if (!node) {
      if (dynamic && typeof name === 'string' && name.trim()) {
        const node2 = newSkill({ name: name.trim() })
        node2.status = 'written'
        task.skills.push(node2)
        marked += 1
        continue
      }
      missing.push(name)
      continue
    }
    if (node.status === 'confirmed' && !retest.has(name)) {
      preservedConfirmed.push(name)
      continue
    }
    node.status = 'written'
    marked += 1
  }
  // 只有产生待测试技能时才重开任务，重复回传已确认清单不改变完成状态。
  const reopened = task.status === 'done' && marked > 0
  if (reopened) task.status = 'open'
  let notesStored = 0
  if (Array.isArray(notes) && notes.length) {
    const clean = notes.map((n) => String(n).slice(0, 500)).filter(Boolean)
    task.notes = [...new Set([...(task.notes || []), ...clean])].slice(-20)
    notesStored = task.notes.length
  }
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: missing.length === 0, missing, marked, preservedConfirmed, notesStored, reopened, task }
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

/**
 * 登记用户填写的任务图片路径，满足完成条件时将任务置为 done。
 * 归档由调用方处理。
 */
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

/** 追加任务级阵亡语音的已交付文件(audio/ 下相对路径,形如 die/<名>.mp3;去重)。
 * 与 setTaskImage 同语义:交付满足条件时自动置 done,归档由调用方完成。 */
export async function setDieAudioFiles(dshHome, { taskId, files }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const list = Array.isArray(files) ? files : [files]
  const clean = list.map((f) => String(f || '').trim()).filter(Boolean)
  task.dieAudioFiles = [...new Set([...(task.dieAudioFiles || []), ...clean])].slice(0, 50)
  const autoCompleted = isCompletable(task) && task.status !== 'done'
  if (autoCompleted) task.status = 'done'
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: true, task, autoCompleted }
}

/** 追加某个技能配音的已交付文件(audio/ 下相对路径,形如 skill/<名>.mp3;去重)。
 * skill 用任务里的技能显示名(与 setSkillStatus 同一 key);找不到返回 error 并附任务技能名清单。 */
export async function setSkillAudioFiles(dshHome, { taskId, skill, files }) {
  const registry = await readRegistry(dshHome)
  const task = registry.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `找不到任务「${taskId}」` }
  const node = findSkill(task, skill)
  if (!node) return { ok: false, error: `任务「${taskId}」里没有技能「${skill}」(任务技能名: ${task.skills.map((s) => s.name).join('、') || '无'})` }
  const list = Array.isArray(files) ? files : [files]
  const clean = list.map((f) => String(f || '').trim()).filter(Boolean)
  node.audioFiles = [...new Set([...(node.audioFiles || []), ...clean])].slice(0, 50)
  const autoCompleted = isCompletable(task) && task.status !== 'done'
  if (autoCompleted) task.status = 'done'
  touch(task)
  await writeRegistry(dshHome, registry)
  return { ok: true, task, autoCompleted }
}

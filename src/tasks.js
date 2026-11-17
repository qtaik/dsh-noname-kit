/**
 * 管理武将、卡牌、模式和机制任务的需求、交付状态与反馈。
 * 技能状态依次为 open、written、confirmed，提交反馈后回到 open。
 */
import { readJsonSafe, writeJsonAtomic } from './store.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ID_RE = /^[\w\u4e00-\u9fff-]{1,64}$/
const MECHANIC_ID_RE = /^[a-z][a-z0-9_]{0,63}$/
const MECHANIC_KINDS = new Set(['skill-type', 'shared-rule', 'global-rule'])
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
    ...(Array.isArray(item?.mechanicIds) ? { mechanicIds: [...new Set(item.mechanicIds.map(id => id.trim()))] } : {}),
  }
}

/** Validate mechanism requirements before either package discovery or registry writes. */
export function validateTaskMechanics({ type, title, mechanic, target, skills }) {
  const references = new Set()
  for (const node of Array.isArray(skills) ? skills : []) {
    if (node?.mechanicIds === undefined) continue
    if (!Array.isArray(node.mechanicIds) || node.mechanicIds.some(id => typeof id !== 'string' || !MECHANIC_ID_RE.test(id.trim()))) {
      return { ok: false, error: '技能引用机制须为 ID 数组，ID 以小写字母开头，只含小写字母、数字或下划线，长度 1–64。' }
    }
    for (const id of node.mechanicIds) references.add(id.trim())
  }
  if (references.size && ['card', 'mode', 'mechanic'].includes(type)) {
    return { ok: false, error: '机制引用只能登记到武将任务的技能节点。' }
  }
  if (type !== 'mechanic') {
    if (target?.kind === 'mechanic') return { ok: false, error: '编辑机制必须使用 mechanic 任务类型。' }
    return { ok: true, mechanicIds: [...references] }
  }
  if (!mechanic || typeof mechanic !== 'object' || Array.isArray(mechanic) ||
      typeof mechanic.id !== 'string' || !MECHANIC_ID_RE.test(mechanic.id.trim()) || !MECHANIC_KINDS.has(mechanic.kind)) {
    return { ok: false, error: '机制需要合法的小写 ID 和 kind（skill-type、shared-rule 或 global-rule）。' }
  }
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 60) {
    return { ok: false, error: '机制名称必填，且不能超过 60 字。' }
  }
  const id = mechanic.id.trim()
  const editing = target != null
  if (editing && (target.kind !== 'mechanic' || typeof target.id !== 'string' || target.id.trim() !== id)) {
    return { ok: false, error: '编辑机制时 target.kind 须为 mechanic，且目标 ID 必须与机制 ID 一致。' }
  }
  const required = new Set(['description'])
  if (!editing) required.add('rules')
  if (!editing && mechanic.kind === 'shared-rule') required.add('invocation')
  if (!editing && mechanic.kind === 'global-rule') { required.add('activation'); required.add('scope') }
  const normalized = { id, kind: mechanic.kind }
  for (const [field, maximum] of Object.entries({ description: 1200, rules: 5000, parameters: 2000, invocation: 2000, activation: 2000, scope: 2000, end: 2000 })) {
    const value = mechanic[field] === undefined ? '' : mechanic[field]
    if (typeof value !== 'string' || value.trim().length > maximum || (required.has(field) && !value.trim())) {
      return { ok: false, error: `机制 ${field} 须为${required.has(field) ? '非空' : ''}文本，且不能超过 ${maximum} 字。` }
    }
    normalized[field] = value.trim()
  }
  return { ok: true, mechanic: normalized, mechanicIds: [] }
}

function touch(task) { task.updatedAt = Date.now() }

/** 已确认技能且登记素材齐全后可完成任务。编辑条目、模式和机制无需立绘或卡图。 */
function isCompletable(task) {
  const imageOk = task.target || task.type === 'mode' || task.type === 'mechanic' ? true : Boolean(task.image)
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
 * 任务 ID 在登记处唯一。武将使用技能清单，卡牌和机制生成单个节点。
 * target 标记编辑已有条目。packageMeta 记录新包需求，名称取目标目录名。
 * 写入工具以登记的 writeMode 为准。
 */
export async function createTask(dshHome, { id, folder, packageMeta, type, title, mechanic, charInfo, newFaction, portraitVideo, pile, skills, image, dieAudios, target, writeMode, modeBrief, modeNum, modeWin, modeRules }) {
  if (typeof id !== 'string' || !ID_RE.test(id.trim())) {
    return { ok: false, error: `任务ID「${id}」不合法:只允许中文/字母/数字/下划线/连字符,长度 1-64。` }
  }
  if (typeof folder !== 'string' || !ID_RE.test(folder.trim())) {
    return { ok: false, error: `扩展文件夹名「${folder}」不合法。` }
  }
  const mechanism = validateTaskMechanics({ type, title, mechanic, target, skills })
  if (!mechanism.ok) return mechanism
  const cleanId = id.trim()
  let metadata
  if (packageMeta != null) {
    if (target || typeof packageMeta !== 'object' || Array.isArray(packageMeta) ||
        ['author', 'intro', 'version'].some(key => packageMeta[key] != null && typeof packageMeta[key] !== 'string')) {
      return { ok: false, error: '扩展包信息只能用于新建包，作者、简介和版本须为文本。' }
    }
    metadata = {
      name: folder.trim(),
      author: (packageMeta.author ?? '').trim(),
      intro: (packageMeta.intro ?? '').trim(),
      version: (packageMeta.version ?? '').trim() || '1.0',
    }
  }
  const registry = await readRegistry(dshHome)
  if (registry.tasks.some((t) => t.id === cleanId)) {
    return { ok: false, error: `任务ID「${cleanId}」已存在,换一个(或加上日期/序号)。` }
  }
  // 模式任务可预填规则，其他规则可在回传实现结果时登记。
  const taskType = type === 'card' ? 'card' : type === 'mode' ? 'mode' : type === 'mechanic' ? 'mechanic' : 'character'
  const skillList = taskType === 'mechanic'
    ? [newSkill({ name: title.trim(), desc: mechanism.mechanic.description })]
    : taskType === 'mode'
    ? (Array.isArray(skills) && skills.length ? skills.map(newSkill) : [])
    : taskType === 'card'
    ? [newSkill({ name: title || (Array.isArray(skills) && skills[0] && skills[0].name) || '新卡牌', desc: descriptionOf(skills) })]
    : ((Array.isArray(skills) && skills.length ? skills : [{ name: title || '新技能', desc: '' }]).map(newSkill))
  const taskTarget = taskType === 'mechanic' && target
    ? { kind: 'mechanic', id: mechanism.mechanic.id }
    : target && (target.kind === 'character' || target.kind === 'card')
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
    const color = typeof newFaction.color === 'string' ? newFaction.color.trim() : newFaction.color;
    if (color != null && color !== '') {
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
        return { ok: false, error: '势力颜色须为六位十六进制 RGB，例如 #6688AA。' }
      }
      faction.color = color.toUpperCase();
    }
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
    title: taskType === 'mechanic' ? title.trim() : String(title || '').slice(0, 60),
    ...(taskType === 'mechanic' ? { mechanic: mechanism.mechanic } : {}),
    ...(metadata ? { packageMeta: metadata } : {}),
    charInfo: String(charInfo || '').slice(0, 500),
    newFaction: faction,
    portraitVideo: video,
    pile: pile && pile.join ? { join: true, entries: String(pile.entries || '').slice(0, 2000) } : { join: false, entries: '' },
    image: taskType === 'mechanic' ? '' : String(image || '').trim().slice(0, 500),
    dieAudios: taskType === 'mechanic' ? [] : cleanAudioPaths(dieAudios),
    dieAudioFiles: [],
    skills: skillList,
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

/**
 * 已确认的技能默认保留状态。确有修改时通过 retestSkills 将其重新标为待测试。
 * 模式允许在此追加规则节点。引擎注意事项合并去重。
 */
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

/**
 * noname-kit 任务历史:每个扩展文件夹一份 noname-kit.history.json,跟着扩展走。
 * 记录:任务列表(类型/摘要/返工轮次/时间)、注意点(踩坑记录)、备份事件。
 * 历史面板(Web 界面)与 AI 的 noname_skills_written 都读写这份文件。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extRootOf, safeFolderPath } from './write.js'

const HISTORY_FILE = 'noname-kit.history.json'

function emptyHistory() {
  return { version: 1, tasks: [], notes: [], backups: [] }
}

function folderPath(nonameDir, folder) {
  const { full } = safeFolderPath(nonameDir, folder)
  return full
}

export async function readHistory(nonameDir, folder) {
  try {
    const raw = await readFile(join(folderPath(nonameDir, folder), HISTORY_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    return { ...emptyHistory(), ...parsed }
  } catch {
    return emptyHistory()
  }
}

async function updateHistory(nonameDir, folder, mutate) {
  const full = folderPath(nonameDir, folder)
  const history = await readHistory(nonameDir, folder)
  mutate(history)
  await writeFile(join(full, HISTORY_FILE), JSON.stringify(history, null, 2), 'utf8')
  return history
}

/**
 * 归档一条任务到扩展文件夹 history(幂等):同一 taskId 已存在时更新既有条目
 * (摘要/注意点合并,轮次取较大值),不再追加——防止"AI 收口 + 用户手动标记"
 * 各记一条导致的重复。
 */
export async function archiveTask(nonameDir, { folder, taskId, kind, summary, notes, rounds }) {
  const full = folderPath(nonameDir, folder)
  const history = await readHistory(nonameDir, folder)
  let entry = taskId ? history.tasks.find((t) => t.taskId === taskId) : null
  if (!entry) {
    entry = {
      id: 'task-' + Date.now(),
      taskId: taskId || null,
      folder,
      kind: kind === 'card' ? 'card' : 'character',
      summary: '',
      notes: [],
      rounds: 1,
      at: Date.now(),
    }
    history.tasks.push(entry)
    if (history.tasks.length > 200) history.tasks = history.tasks.slice(-200)
  }
  if (summary) entry.summary = String(summary).slice(0, 2000)
  entry.rounds = Math.max(entry.rounds || 1, Number(rounds) || 1)
  if (Array.isArray(notes) && notes.length) {
    for (const n of notes) {
      const v = String(n).slice(0, 500)
      if (v && !history.notes.includes(v)) history.notes.push(v)
      if (v && !entry.notes.includes(v)) entry.notes.push(v)
    }
    if (history.notes.length > 100) history.notes = history.notes.slice(-100)
    if (entry.notes.length > 20) entry.notes = entry.notes.slice(-20)
  }
  entry.updatedAt = Date.now()
  await writeFile(join(full, HISTORY_FILE), JSON.stringify(history, null, 2), 'utf8')
  return { ok: true, task: entry, totalTasks: history.tasks.length }
}

/** 记录一次写入事件(供备份清单展示)。 */
export async function recordBackup(nonameDir, folder, backupFile) {
  if (!backupFile) return
  return updateHistory(nonameDir, folder, (history) => {
    history.backups.push({ file: backupFile, at: Date.now() })
    if (history.backups.length > 50) history.backups = history.backups.slice(-50)
  })
}

/** 删除一条注意点(历史页修剪用;不动 tasks 归档)。 */
export async function deleteNote(nonameDir, folder, index) {
  const full = folderPath(nonameDir, folder)
  const history = await readHistory(nonameDir, folder)
  if (!Array.isArray(history.notes) || index < 0 || index >= history.notes.length) {
    return { ok: false, error: '注意点不存在' }
  }
  history.notes.splice(index, 1)
  await writeFile(join(full, HISTORY_FILE), JSON.stringify(history, null, 2), 'utf8')
  return { ok: true, noteCount: history.notes.length }
}

/** 列出 extension 目录下所有带历史的扩展(历史面板用)。 */
export async function listExtensionHistories(nonameDir) {
  const root = extRootOf(nonameDir)
  let folders
  try { folders = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const entry of folders) {
    if (!entry.isDirectory()) continue
    const history = await readHistory(nonameDir, entry.name)
    const last = history.tasks[history.tasks.length - 1]
    const totalRounds = history.tasks.reduce((sum, t) => sum + (t.rounds || 1), 0)
    out.push({
      folder: entry.name,
      taskCount: history.tasks.length,
      totalRounds,
      noteCount: history.notes.length,
      backupCount: history.backups.length,
      lastTask: last ? { summary: last.summary, kind: last.kind, at: last.at } : null,
    })
  }
  return out.sort((a, b) => (b.lastTask?.at || 0) - (a.lastTask?.at || 0))
}

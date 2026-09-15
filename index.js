/**
 * dsh-noname-kit — Host 半(Node 侧)
 *
 * 无名杀(Noname)扩展开发工坊:AI 写扩展代码的受限开发套件。
 * - 注入规范知识(systemPrompt 常驻),取代用户手动喂知识库
 * - 注册 6 个工具:搜官方参考 / 校验 / 读扩展 / 写扩展(校验门禁) / 复制图片 / 任务收口
 * - 守卫:拦截通用 write/edit/bash 对游戏 extension 目录的写入(防绕过校验)
 * - HTTP API:历史记录与备份回滚(浏览器工坊面板用)
 *
 * 配置:cordis.yml 行上配 nonameDir(无名杀游戏本体目录,含 extension/)。
 * 不配置时为"仅生成模式":工具可用,但不能写文件,守卫不激活。
 *
 * 浏览器半在 ./client.js(工坊页签 + 表单 + 结果卡片)。
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join, resolve } from 'node:path'
import { statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { KNOWLEDGE_TEXT } from './src/knowledge.js'
import { validateExtensionCode } from './src/validate.js'
import { searchReference } from './src/reference.js'
import { detectCandidates } from './src/detect.js'
import { writeExtension, readExtension, listBackups, rollbackExtension, extRootOf, migrateAnchors, migrateExtension, listEntries, listEntrySkills } from './src/write.js'
import { readHistory, archiveTask, listExtensionHistories, recordBackup, deleteNote } from './src/history.js'
import { copyImages } from './src/images.js'
import { createTask, listTasks, skillFeedback, markSkillsWritten, setSkillStatus, setTaskImage, completeById, deleteTask, reopenTask, getTask } from './src/tasks.js'
import { bundledPresetDir, installPreset, presetDirOf, presetStatus } from './src/preset.js'
import { cachedUpdate, checkForUpdate, detectInstall, installHint } from './src/update.js'
import pkg from './package.json' with { type: 'json' }

/** bash 单次输出上限的出厂默认与允许范围(与 custom-bash.mjs 保持一致)。
 * 默认 64K=下限:阀门太小会增加调用轮数,总上下文消耗反而更大;256K 上限
 * 已够单次倾倒,更大的口子只会放大雪球。 */
const BASH_MAX_OUTPUT_DEFAULT = 64000
const BASH_MAX_OUTPUT_MIN = 64000
const BASH_MAX_OUTPUT_MAX = 256000

function clampBashMaxOutput(v) {
  const n = Number(v)
  if (!Number.isSafeInteger(n) || n < BASH_MAX_OUTPUT_MIN || n > BASH_MAX_OUTPUT_MAX) return null
  return n
}

export const name = 'noname-kit'

export const inject = ['tools', 'systemPrompt', 'dshHomePath']

/** 部署配置。nonameDir 为空 = 仅生成模式。 */
export const Config = z.object({
  /** 无名杀游戏本体目录(含 extension/ 的那层)。 */
  nonameDir: z.string().default(''),
})

/** 这些通用工具对 extension 目录的写入会被守卫拒绝——必须走 noname_write_extension。 */
const GUARDED_TOOLS = new Set(['write', 'tool:write', 'edit', 'tool:edit', 'bash'])

function pathArgOf(exec) {
  const args = exec.arguments ?? {}
  return typeof args.file_path === 'string' ? args.file_path : null
}

/** /detect 的短缓存(60 秒),避免用户连续点击时反复扫盘。 */
const detectCache = { at: 0, list: [] }

/** 目录是否像一个无名杀游戏本体根(extension/ + noname.js|noname/|game/)。 */
function isValidGameDir(dir) {
  if (!dir) return false
  try {
    if (!statSync(join(dir, 'extension')).isDirectory()) return false
    if (existsSync(join(dir, 'noname.js'))) return true
    return statSync(join(dir, 'noname')).isDirectory() || statSync(join(dir, 'game')).isDirectory()
  } catch { return false }
}

export function apply(ctx, config) {
  // ── 0) 配置解析与初始化向导后端 ──────────────────────────────
  // 优先级:cordis.yml 行配置 > 工坊向导保存的设置文件 > 空(仅生成模式)。
  // 向导保存后立即热生效,不需要重启。
  // dshHomePath 是个解析函数,调用得到 Harness home(~/.dsh)
  const homeBase = typeof ctx.dshHomePath === 'function' ? ctx.dshHomePath() : (ctx.dshHomePath || join(homedir(), '.dsh'))
  const dshHomeDir = resolve(homeBase)
  const settingsPath = join(dshHomeDir, 'noname-kit.json')
  const readSettingsFile = () => {
    try { return JSON.parse(readFileSync(settingsPath, 'utf8')) } catch { return {} }
  }
  const saved = readSettingsFile()

  // 取第一个"有效"的来源:行配置 > 向导保存值;行配置无效时回落到向导值,
  // 这样换机/配错后用户在工坊向导里点一下就能修复,不用改 yml。
  const rowDir = config.nonameDir ? resolve(config.nonameDir) : ''
  const savedDir = saved.nonameDir ? resolve(saved.nonameDir) : ''
  let nonameDir = isValidGameDir(rowDir) ? rowDir : (isValidGameDir(savedDir) ? savedDir : (rowDir || savedDir || ''))
  let active = isValidGameDir(nonameDir)
  if (rowDir && !isValidGameDir(rowDir)) {
    console.warn(`[noname-kit] ⚠️ cordis.yml 里的 nonameDir 不是有效的无名杀目录(缺少 extension/ 等): ${rowDir}`)
  }

  /** 校验并热切换当前游戏目录;返回错误消息或 null。 */
  const setActive = (dir) => {
    if (!dir) return '路径为空'
    const resolved = resolve(dir)
    if (!isValidGameDir(resolved)) {
      return `「${resolved}」不像无名杀游戏本体目录(需要 extension/ 子目录和 noname.js),请确认后重试`
    }
    nonameDir = resolved
    active = true
    return null
  }

  console.log(`[noname-kit] 加载成功,游戏目录: ${active ? nonameDir : '(未配置或无效,仅生成模式;可在工坊向导里初始化)'}`)

  // ── 0.5) 版本与一致性自检 ────────────────────────────────────
  // preset(agent.cordis.yml 的 persona + residentTools 工具名白名单 + SKILL.md 的
  // 参数文档)是插件行为的第二份手抄,复制到 ~/.dsh/.agent-presets/ 后与代码再无
  // 任何关联:代码更新而 preset 没重装时,会话会拿到自相矛盾的指令(工具名对不上
  // →工具在会话里静默消失;参数文档对不上→AI 写出的调用被校验挡下),而且不报错。
  // 这里只负责"发现",修由用户在工坊 ⚙ 设置页点「重装 preset」。
  // (曾想用目录链接让漂移不可能发生,实测否决:DSH 的 discovery 用
  //  readdir().isDirectory() 判定,而 node 对 junction/symlink 一律报 isLink。)
  const presetDir = presetDirOf(dshHomeDir)
  const bundledDir = bundledPresetDir()
  const readPresetStatus = () => presetStatus({ presetDir, bundledDir })
  {
    const status = readPresetStatus()
    if (status.state === 'missing') {
      console.warn('[noname-kit] ⚠️ 「无名杀开发模式」preset 未安装:工坊 ⚙ 设置页点「重装 preset」,或跑 node scripts/install-preset.mjs')
    } else if (status.state === 'stale') {
      console.warn('[noname-kit] ⚠️ preset 与插件自带的不一致:工坊 ⚙ 设置页点「重装 preset」')
    } else if (status.state === 'unknown') {
      console.warn(`[noname-kit] ⚠️ ${status.error}`)
    }
  }
  // 版本检查只在启动时跑一次(结果缓存 6 小时,失败不缓存);link 安装直接短路,
  // 一个请求都不发。结果只进内存不落盘——一次网络查询不值得在用户家目录留状态。
  if (readSettingsFile().updateCheck !== false) {
    checkForUpdate({ currentVersion: pkg.version, dshHome: dshHomeDir }).then((result) => {
      if (result.error) {
        console.log(`[noname-kit] 版本检查未完成:${result.error}(不影响使用,可在 ⚙ 设置页手动重试)`)
      } else if (result.hasUpdate) {
        console.log(`[noname-kit] ⬆ 有新版本 v${result.latest}(当前 v${result.current},来源 ${result.source});升级:${result.installHint || '见 README'}`)
      }
    }).catch(() => {})
  }

  /** 设置页「版本与一致性」的载荷:本地探测不联网,网络结果只来自缓存或显式检查。 */
  const updatePayload = async (force) => {
    const install = detectInstall({ dshHome: dshHomeDir, packageName: pkg.name })
    const check = force ? await checkForUpdate({ currentVersion: pkg.version, dshHome: dshHomeDir, force: true }) : cachedUpdate()
    return {
      current: pkg.version,
      preset: readPresetStatus(),
      updateCheck: readSettingsFile().updateCheck !== false,
      installForm: install.form,
      installProfile: install.profile,
      installSpec: install.spec,
      installHint: installHint({ form: install.form, profile: install.profile, packageName: pkg.name }),
      check: check || null,
    }
  }

  // ── 1) 常驻规范知识(文本随配置状态动态生成) ─────────────────
  // POSIX 形式路径:模型在 bash 里习惯 /d/... 写法,直接给两种形式免得它自己转换/寻找
  const posixPath = (p) => String(p || '')
    .replace(/^([A-Za-z]):[\\/]/, (_m, d) => '/' + d.toLowerCase() + '/')
    .replace(/\\/g, '/')
  ctx.systemPrompt.section({
    name: 'noname-kit',
    // 排在文件工具说明(1200-1300)之后、web 工具(2000)之前:模型先懂规矩再干活
    order: 1800,
    text: () => active
      ? KNOWLEDGE_TEXT + '\n## 当前环境(工坊已配置;路径就在下面,不需要寻找)\n'
        + '- 游戏本体目录: ' + nonameDir + '(bash 里写作 ' + posixPath(nonameDir) + ')\n'
        + '- 扩展写入根: ' + extRootOf(nonameDir) + '(bash 里写作 ' + posixPath(extRootOf(nonameDir)) + ')\n'
        + '- 需要核对引擎 API/源码时,直接在上述目录下对 noname/ 子目录做窄窗口 grep——禁止用 ls/find 列盘符根、用户目录来寻找引擎或扩展路径(路径已在上面,找了也白找)。\n'
      : KNOWLEDGE_TEXT + '\n注意:当前部署未配置 nonameDir,noname_write_extension 与 noname_read_extension 不可写/不可读,生成代码后让用户自行保存。',
  })

  // ── 2) 工具定义 ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'noname_search_reference',
    description: 'Search noname source for reference implementations. Four ways: (1) Chinese skill name, e.g. 天罚; (2) skill/card ID, e.g. juedou; (3) space-separated effect keywords, e.g. 摸牌 damage; (4) a full effect sentence — similarity >=50% returns ALL close matches as compact rows ranked by score (re-search the ID of an interesting row to load its full code; add distinguishing words if too many). Tips: prefer core effect words (damage/draw/摸牌/回合), one skill per query, drop filler words.',
    parameters: {
      query: { type: 'string', required: true, description: 'Keywords, space-separated.' },
      type: { type: 'string', enum: ['any', 'skill', 'character', 'card'], description: 'Scope, default any.' },
      limit: { type: 'integer', description: 'Max matches, default 5.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        matches: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string' }, name: { type: 'string' }, info: { type: 'string' },
          score: { type: 'number' },
          file: { type: 'string', required: true }, line: { type: 'integer', required: true }, snippet: { type: 'string', required: true },
        } } },
        scanned: { type: 'integer' },
        query: { type: 'string' },
        error: { type: 'string'},
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return searchReference(nonameDir, args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'noname_validate',
    description: 'Validate a noname extension file. Run before any write.',
    parameters: {
      code: { type: 'string', required: true, description: 'Full extension.js content.' },
      style: { type: 'string', enum: ['classic', 'module'], description: 'Authoring style, default classic.' },
      kind: { type: 'string', enum: ['character', 'card'], description: 'Task type, default character.' },
      folder: { type: 'string', description: 'Target folder, for name-consistency check.' },
      idPrefix: { type: 'string', description: 'ID prefix (e.g. cs_) for the prefix-convention check.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        style: { type: 'string', required: true },
        errors: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { line: { type: 'integer' }, message: { type: 'string', required: true } } } },
        warnings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } } },
      } },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `校验通过。${value.warnings.length ? '警告(建议参考):\n' + value.warnings.map((w) => `- ${w.message}`).join('\n') : '无警告。'}`
          : `校验失败,${value.errors.length} 个错误必须修复:\n${value.errors.map((e) => `- ${e.message}`).join('\n')}${value.warnings && value.warnings.length ? '\n警告:\n' + value.warnings.map((w) => `- ${w.message}`).join('\n') : ''}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return validateExtensionCode(args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'noname_read_extension',
    description: 'Read one installed noname extension. Prefer listBlocks/block extraction on large files: list the block directory first, then read only the block you need.',
    parameters: {
      folder: { type: 'string', required: true, description: 'Extension folder name.' },
      file: { type: 'string', description: 'Relative .js path inside the extension package (multi-file packs keep entries in e.g. character/character.js). Defaults to extension.js.' },
      listBlocks: { type: 'boolean', description: 'Return the block directory (id/kind/lines/file) instead of full text. Without file, aggregates ALL .js files of the package.' },
      block: { type: 'string', description: 'Read one block only, format kind:id — kind is skill/card/character/translate (e.g. skill:cs_tianfa, card:cs_bangbang). Without file, searches the whole package and returns where it was found.' },
      notes: { type: 'boolean', description: 'Also return this package history notes (engine-level lessons). Fetch only when relevant to the current task.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        folder: { type: 'string', required: true },
        file: { type: 'string' },
        files: { type: 'array', required: true, items: { type: 'string' } },
        code: { type: 'string'},
        info: { type: 'object', additionalProperties: true },
        block: { type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', required: true },
          id: { type: 'string', required: true },
          file: { type: 'string' },
        } },
        blocks: { type: 'object', additionalProperties: false, properties: {
          anchored: { type: 'boolean', required: true },
          blocks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            key: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            id: { type: 'string', required: true },
            lines: { type: 'integer', required: true },
            virtual: { type: 'boolean', required: true },
            file: { type: 'string' },
          } } },
          files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            file: { type: 'string', required: true },
            anchored: { type: 'boolean', required: true },
            blocks: { type: 'integer', required: true },
          } } },
        } },
        error: { type: 'string'},
        notes: { type: 'array', items: { type: 'string' } },
      } },
      render: (_args, value) => {
        // render 文本是模型唯一能看到的工具结果——所有数据必须原样进文本,不能只给摘要
        if (value.error) return [{ type: 'text', text: `读取失败: ${value.error}` }]
        const parts = []
        if (value.notes) {
          parts.push(`历史注意点 ${value.notes.length} 条:`)
          value.notes.forEach((n, i) => parts.push(`${i + 1}. ${n}`))
        }
        const fileTag = (f) => (f && f !== 'extension.js' ? ` @ ${f}` : '')
        if (value.blocks) {
          const fileNames = (value.blocks.files || []).map((f) => `${f.file}(${f.blocks} 块${f.anchored ? ',已锚点化' : ''})`).join('、')
          if (fileNames) parts.push(`涉及文件: ${fileNames}`)
          parts.push(`区块目录 ${value.blocks.blocks.length} 项(${value.blocks.anchored ? '已锚点化' : '未锚点,虚拟划分'}):`)
          value.blocks.blocks.forEach((b) => parts.push(`- ${b.key}(${b.lines} 行${b.virtual ? ',虚拟' : ''})${fileTag(b.file)}`))
          parts.push(`用 block:'区块key' 读取具体区块内容;多文件包的区块读写记得带上对应的 file 参数。`)
        }
        if (value.block) {
          parts.push(`── 区块 ${value.block.kind}:${value.block.id}${fileTag(value.block.file)} ──`)
          parts.push(value.code ?? '(空)')
        } else if (!value.blocks && !value.notes) {
          parts.push(`── ${value.folder}/${value.file ?? 'extension.js'} 全文(共 ${value.code ? value.code.split('\n').length : 0} 行)──`)
          parts.push(value.code ?? '(该文件不存在或为空)')
        }
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (!active) return { folder: args.folder, files: [], error: '未配置 nonameDir,无法读取游戏目录。' }
      try {
        const r = await readExtension(nonameDir, args.folder, { file: args.file, listBlocks: args.listBlocks, block: args.block })
        if (args.notes && !r.error) r.notes = (await readHistory(nonameDir, args.folder)).notes || []
        return r
      } catch (error) { return { folder: args.folder, files: [], error: error.message } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'noname_write_extension',
    description: 'Write a noname extension (validates first; the only write channel). Two modes: full-text (code) for first write or unindexed legacy files (pass editScope so untouched blocks must stay byte-identical); block-assembly (blocks/edits/deletes) for anchored files — the tool keeps everything you do not submit, so transcription errors are structurally impossible.',
    parameters: {
      folder: { type: 'string', required: true, description: 'Extension folder name.' },
      file: { type: 'string', description: 'Relative .js path inside the extension package for multi-file packs (e.g. character/character.js). Defaults to extension.js. Block-mode requires that file to be anchored (workshop migrate button first).' },
      code: { type: 'string', description: 'Full extension.js content. Required in full-text mode; omit in block mode.' },
      style: { type: 'string', enum: ['classic', 'module'], description: 'Authoring style, default classic.' },
      kind: { type: 'string', enum: ['character', 'card'], description: 'Task type, default character.' },
      infoJson: { type: 'string', description: 'info.json content (JSON string).' },
      idPrefix: { type: 'string', description: 'ID prefix (e.g. cs_) for the prefix-convention check.' },
      writeMode: { type: 'string', enum: ['auto', 'manual'], description: 'auto=write; manual=return code only. Ignored when taskId is given — the workshop-registered mode (user form choice) wins.' },
      taskId: { type: 'string', description: 'Task ID from the task message. When given, the task-registered writeMode (user form choice) overrides the writeMode parameter.' },
      blocks: { type: 'array', description: 'Block-assembly mode: submit complete new blocks for the IDs you change; everything else is kept from the old file by the tool.', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true, description: 'Internal ID, e.g. cs_tianfa.' },
        kind: { type: 'string', enum: ['skill', 'card', 'character', 'translate'], required: true, description: 'Block type.' },
        code: { type: 'string', required: true, description: 'Full block text (property with trailing comma; tool adds one if missing).' },
      } } },
      edits: { type: 'array', description: 'Exact small patches for non-block regions (character registration, card list lines). find must occur exactly once in the current file.', items: { type: 'object', additionalProperties: false, properties: {
        find: { type: 'string', required: true, description: 'Verbatim text copied from the current file.' },
        replace: { type: 'string', required: true },
      } } },
      deletes: { type: 'array', items: { type: 'string' }, description: 'Block keys to remove, e.g. skill:cs_old. Declared deletions bypass the loss guard.' },
      editScope: { type: 'array', items: { type: 'string' }, description: 'Full-text mode on existing files: internal IDs allowed to change; anything else that differs from the old file is rejected.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        wrote: { type: 'boolean', required: true },
        style: { type: 'string'},
        path: { type: 'string'},
        backup: { type: 'string'},
        errors: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } } },
        warnings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } } },
        code: { type: 'string'},
        infoWritten: { type: 'boolean' },
        infoError: { type: 'string'},
        error: { type: 'string'},
      } },
      render: (_args, value) => [{
        type: 'text',
        text: value.error ? `写入被拒: ${value.error}`
          : !value.ok ? `校验未通过,未写入。错误:\n${(value.errors || []).map((e) => `- ${e.message}`).join('\n')}`
          : value.wrote ? `已写入 ${value.path}${value.backup ? `(旧版备份于 ${value.backup})` : ''}。请让用户重开游戏或重载扩展查看效果。`
          : '手动模式:代码已生成并通过校验,等用户复制保存。',
      }],
    },
    async execute(args) {
      if (!active) {
        return { ok: false, wrote: false, error: '未配置 nonameDir(游戏本体目录):请在插件配置里填 nonameDir 后重启,或直接复制代码手动保存。' }
      }
      try {
        // 写入方式是用户在工坊表单里的决定,不以 AI 传参为准:带 taskId 时用任务
        // 登记的 writeMode 覆盖(实测 AI 曾把「自动写入」任务误按 manual 调用)。
        if (args.taskId) {
          const task = await getTask(dshHomeDir, args.taskId)
          if (task && task.writeMode && task.writeMode !== args.writeMode) {
            args = { ...args, writeMode: task.writeMode }
          }
        }
        const result = await writeExtension(nonameDir, args)
        if (result.wrote && result.backup) await recordBackup(nonameDir, args.folder, result.backup)
        return result
      } catch (error) {
        return { ok: false, wrote: false, error: error.message }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'noname_copy_images',
    description: 'Copy user-selected local images into the extension image folder (image/). Pass taskId to mark the task image as delivered.',
    parameters: {
      folder: { type: 'string', required: true, description: 'Extension folder name.' },
      taskId: { type: 'string', description: 'Task ID from the task message. Passing it records the images as delivered so the task can auto-complete.' },
      images: {
        type: 'array', required: true,
        description: 'Images to copy.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            source: { type: 'string', required: true, description: 'Absolute local source path.' },
            target: { type: 'string', required: true, description: 'File name inside image/, e.g. image/ts_muou.jpg or ts_muou.jpg.' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        copied: { type: 'array', items: { type: 'string' } },
        errors: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          source: { type: 'string' }, error: { type: 'string', required: true },
        } } },
        autoCompleted: { type: 'boolean' },
      } },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `已复制 ${value.copied.length} 张图片到扩展包 image/ 目录。${value.autoCompleted ? '任务已自动完成并归档,无需再调用 noname_skills_written。' : ''}`
          : `图片复制失败: ${(value.errors || []).map((e) => e.error).join('; ')}`,
      }],
    },
    async execute(args) {
      if (!active) return { ok: false, errors: [{ error: '未配置 nonameDir,无法复制图片。' }] }
      const result = await copyImages(nonameDir, args)
      if (result.ok && args.taskId) {
        // 与工坊补图路由同语义:复制成功 → 登记 image/<名> → 满足条件自动完成+归档
        const firstTarget = String((args.images && args.images[0] && args.images[0].target) || '').replace(/^image\//, '')
        const done = await setTaskImage(dshHomeDir, { taskId: args.taskId, image: firstTarget ? 'image/' + firstTarget : '' })
        if (done.autoCompleted) {
          result.autoCompleted = true
          await archiveTask(nonameDir, {
            folder: args.folder, taskId: args.taskId,
            summary: '全部技能确认无误(AI 复图后自动完成)', rounds: done.task.rounds,
            notes: done.task.notes,
          }).catch(() => ({ totalTasks: 0 }))
        }
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'noname_skills_written',
    description: 'Mark task skills as written (awaiting user in-game test). Call after all skills of the task are implemented, validated and written. The task auto-completes when the user confirms every skill.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task ID from the task message, verbatim.' },
      skills: { type: 'array', required: true, items: { type: 'string' }, description: 'Skill display names implemented in this round.' },
      notes: { type: 'array', items: { type: 'string' }, description: 'OPTIONAL engine-level, reusable lessons only (API behavior, global pitfalls) worth keeping for future tasks of this package. NEVER task-specific implementation details.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        marked: { type: 'integer' },
        missing: { type: 'array', items: { type: 'string' } },
        notesStored: { type: 'integer' },
        confirmed: { type: 'integer' },
        total: { type: 'integer' },
        autoCompleted: { type: 'boolean' },
        error: { type: 'string'},
      } },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `已标记 ${value.marked} 个技能待测试(确认 ${value.confirmed}/${value.total})${value.notesStored ? `,存 ${value.notesStored} 条注意点` : ''}。告诉用户:可以进游戏测试了,测试通过请在任务列表点「✅ 确认无误」。`
          : `标记失败: ${value.error}`,
      }],
    },
    async execute(args) {
      if (!active) return { ok: false, error: '未配置 nonameDir,无法更新任务。' }
      const result = await markSkillsWritten(dshHomeDir, args)
      if (!result.ok) {
        // markSkillsWritten 的 missing 分支不设 error 字段——这里绝不能把
        // undefined 塞进返回对象(lossless JSON 拒收,实测「标记既有技能名」必炸)。
        const detail = result.error
          || ((result.missing || []).length
            ? '这些名称不在任务技能清单里: ' + result.missing.join('、')
              + ((result.task && result.task.skills || []).length
                ? '(任务技能节点: ' + result.task.skills.map((s) => s.name).join('、') + ')——skills 参数必须逐字使用任务技能节点的名称'
                : '')
            : '任务更新失败。')
        return { ok: false, error: detail }
      }
      return { ok: true, marked: result.marked, missing: result.missing, notesStored: result.notesStored || 0, confirmed: result.task.skills.filter((s) => s.status === 'confirmed').length, total: result.task.skills.length, autoCompleted: false }
    },
  }))

  // ── 3) 守卫:extension 目录的写操作必须走专用工具 ─────────────
  // 始终注册,内部动态判断 active:工坊向导热初始化后立即生效。
  ctx.tools.guard((exec) => {
    if (!active || !GUARDED_TOOLS.has(exec.name)) return undefined
    const extRootLower = extRootOf(nonameDir).toLowerCase()
    if (exec.name === 'bash') {
      const command = String(exec.arguments?.command ?? '')
      if (command.toLowerCase().includes(extRootLower)) {
        return 'noname-kit:游戏 extension 目录受保护——写入扩展请使用 noname_write_extension(先 noname_validate 校验),不要用 bash 直接改文件。'
      }
      return undefined
    }
    const path = pathArgOf(exec)
    if (path) {
      const r = resolve(String(path)).toLowerCase()
      if (r === extRootLower || r.startsWith(extRootLower + '\\') || r.startsWith(extRootLower + '/')) {
        return 'noname-kit:游戏 extension 目录受保护——写入扩展请使用 noname_write_extension(内部先校验,覆盖前自动备份)。'
      }
    }
    return undefined
  })

  // ── 4) HTTP API:状态/初始化向导/历史/回滚(浏览器工坊用) ─────
  // 可选注入:只有组合了 webServer 的部署(web UI)才挂路由;
  // headless 等无网页面部署里跳过,不阻塞启动。
  ctx.inject(['webServer'], (webCtx) => webCtx.webServer.register({
    kind: 'prefix',
    path: '/noname-kit-api',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const json = (status, body) => {
        const bodyText = JSON.stringify(body)
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(bodyText)
      }
      const readBody = async () => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      }
      try {
        // 初始化三件套:任何状态下都可用(否则没配置时连向导都没法用)
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/status') {
          return json(200, { active, nonameDir: active ? nonameDir : '', source: config.nonameDir ? 'cordis.yml' : (saved.nonameDir ? 'workshop' : 'none') })
        }
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/detect') {
          // 结果缓存 60 秒:用户反复点扫描按钮时不要反复读盘
          if (detectCache.at && Date.now() - detectCache.at < 60_000) {
            return json(200, { candidates: detectCache.list })
          }
          const candidates = await detectCandidates()
          detectCache.at = Date.now()
          detectCache.list = candidates
          return json(200, { candidates })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/init') {
          const body = await readBody()
          const error = setActive(body.nonameDir)
          if (error) return json(400, { ok: false, error })
          const next = readSettingsFile()
          next.nonameDir = nonameDir
          writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8')
          console.log(`[noname-kit] 工坊向导已启用游戏目录: ${nonameDir}`)
          return json(200, { ok: true, nonameDir })
        }
        // 工坊设置(⚙ 子页):bash 输出阀门等。任何状态可读写;bash 阀门
        // 由 custom-bash 在新会话挂载时读取,保存后对新会话生效。
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/settings') {
          // 读文件而不是用启动时的 saved 快照:否则保存后刷新页面会看到改动前的值
          const current = readSettingsFile()
          return json(200, {
            version: pkg.version,
            nonameDir: active ? nonameDir : '',
            source: config.nonameDir ? 'cordis.yml' : (current.nonameDir ? 'workshop' : 'none'),
            bashMaxOutputBytes: clampBashMaxOutput(current.bashMaxOutputBytes) ?? BASH_MAX_OUTPUT_DEFAULT,
            updateCheck: current.updateCheck !== false,
          })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/settings') {
          const body = await readBody()
          const next = readSettingsFile()
          const applied = []
          if (body.bashMaxOutputBytes !== undefined) {
            const v = clampBashMaxOutput(body.bashMaxOutputBytes)
            if (v === null) return json(400, { ok: false, error: `bashMaxOutputBytes 必须是 ${BASH_MAX_OUTPUT_MIN}~${BASH_MAX_OUTPUT_MAX} 之间的整数` })
            next.bashMaxOutputBytes = v
            applied.push(`bash 单次输出上限 ${v} 字节`)
          }
          if (body.updateCheck !== undefined) {
            next.updateCheck = Boolean(body.updateCheck)
            applied.push(`启动时检查更新 ${next.updateCheck ? '开' : '关'}`)
          }
          if (!applied.length) return json(400, { ok: false, error: '没有可保存的设置项' })
          writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8')
          console.log(`[noname-kit] 设置已保存:${applied.join(' / ')}(新会话生效)`)
          return json(200, {
            ok: true,
            bashMaxOutputBytes: clampBashMaxOutput(next.bashMaxOutputBytes) ?? BASH_MAX_OUTPUT_DEFAULT,
            updateCheck: next.updateCheck !== false,
          })
        }
        // 任务登记处:读列表不要求已配置;创建/反馈/完成要求已配置(要有扩展文件夹)
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/tasks') {
          const openOnly = url.searchParams.get('open') === '1'
          return json(200, { tasks: await listTasks(dshHomeDir, { openOnly }) })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks') {
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效),无法创建任务' })
          const body = await readBody()
          const result = await createTask(dshHomeDir, body)
          return json(result.ok ? 200 : 400, result)
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/feedback') {
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const result = await skillFeedback(dshHomeDir, body)
          return json(result.ok ? 200 : 400, result)
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/skill-status') {
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const result = await setSkillStatus(dshHomeDir, body)
          if (!result.ok) return json(400, result)
          let archived = { totalTasks: 0 }
          if (result.autoCompleted) {
            archived = await archiveTask(nonameDir, {
              folder: result.task.folder, taskId: result.task.id, kind: result.task.type,
              summary: '全部技能确认无误' + (result.task.image ? '' : '(注意:缺图片)'),
              notes: result.task.notes, rounds: result.task.rounds,
            }).catch(() => ({ totalTasks: 0 }))
          }
          return json(200, { ok: true, autoCompleted: result.autoCompleted, confirmed: result.confirmed, total: result.total, archived: archived.totalTasks })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/image') {
          // 补图 = 复制文件进扩展包 image/ + 登记进任务(一步到位)
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const src = String(body.source || '').trim()
          if (!src) return json(400, { ok: false, error: '图片本地路径为空' })
          const fileName = String(body.fileName || '').trim() || src.split(/[\\/]/).pop() || ''
          const copy = await copyImages(nonameDir, { folder: body.folder, images: [{ source: src, target: fileName }] })
          if (!copy.ok) return json(400, { ok: false, error: copy.errors.map((e) => e.error).join('; ') })
          const result = await setTaskImage(dshHomeDir, { taskId: body.taskId, image: 'image/' + fileName })
          if (!result.ok) return json(400, result)
          let archived = { totalTasks: 0 }
          if (result.autoCompleted) {
            archived = await archiveTask(nonameDir, {
              folder: result.task.folder, taskId: result.task.id, kind: result.task.type,
              summary: '全部技能确认无误(补图后自动完成)', rounds: result.task.rounds,
              notes: result.task.notes,
            }).catch(() => ({ totalTasks: 0 }))
          }
          return json(200, { ok: true, autoCompleted: result.autoCompleted, task: result.task, copied: copy.copied, archived: archived.totalTasks })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/delete') {
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const result = await deleteTask(dshHomeDir, body.taskId)
          return json(result.ok ? 200 : 400, result)
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/reopen') {
          // 重开已完成任务(补图/重新确认后再收口)
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const result = await reopenTask(dshHomeDir, body)
          return json(result.ok ? 200 : 400, result)
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/tasks/complete') {
          if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效)' })
          const body = await readBody()
          const done = await completeById(dshHomeDir, body)
          if (!done.ok) return json(400, done)
          const archived = await archiveTask(nonameDir, {
            folder: done.task.folder, taskId: done.task.id, kind: done.task.kind,
            summary: body.summary || done.task.summary || '手动标记完成',
            notes: body.notes, rounds: Math.max(body.rounds || 1, done.task.rounds || 1),
          }).catch(() => ({ totalTasks: 0 }))
          return json(200, { ok: true, task: done.task, totalTasks: archived.totalTasks })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/images/copy') {
          const body = await readBody()
          const result = await copyImages(nonameDir, body)
          return json(result.ok ? 200 : 400, result)
        }
        // 版本与一致性(⚙ 设置页):刻意放在下面这道 503 闸门之前 —— 没配游戏目录
        // 的新用户正是最需要看到「preset 未安装」的时候。
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/update') {
          return json(200, await updatePayload(false))
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/update/check') {
          return json(200, await updatePayload(true))
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/preset/install') {
          const result = installPreset({ presetDir, bundledDir })
          if (result.ok) {
            console.log(`[noname-kit] preset 已重装${result.backup ? ',旧版备份到 ' + result.backup : ''}(新会话生效)`)
          }
          return json(result.ok ? 200 : 400, { ...result, preset: readPresetStatus() })
        }
        // 以下都需要已配置
        if (!active) return json(503, { error: 'noname-kit 未配置 nonameDir(或目录无效):请在工坊「初始化向导」里完成配置' })
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/extension') {
          const folder = url.searchParams.get('folder') || ''
          try { return json(200, await readExtension(nonameDir, folder)) } catch (error) {
            return json(200, { folder, files: [], error: error.message })
          }
        }
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/entries') {
          // 工坊「编辑已有武将/卡牌」下拉:列出包内条目 id(只读)
          const folder = url.searchParams.get('folder') || ''
          const kind = url.searchParams.get('kind') || ''
          try { return json(200, await listEntries(nonameDir, folder, kind)) } catch (error) {
            return json(200, { ok: false, kind, entries: [], error: error.message })
          }
        }
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/entry-skills') {
          // 工坊「编辑已有武将」:列出选中条目 skills 数组里的技能(勾选候选,只读)
          const folder = url.searchParams.get('folder') || ''
          const entryId = url.searchParams.get('id') || ''
          try { return json(200, await listEntrySkills(nonameDir, folder, entryId)) } catch (error) {
            return json(200, { ok: false, skills: [], error: error.message })
          }
        }
        if (req.method === 'GET' && url.pathname === '/noname-kit-api/history') {
          const folder = url.searchParams.get('folder')
          if (folder) {
            return json(200, { folder, history: await readHistory(nonameDir, folder), backups: await listBackups(nonameDir, folder) })
          }
          return json(200, { extensions: await listExtensionHistories(nonameDir) })
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/history/note-delete') {
          // 注意点单条删除(历史页修剪;用户手动触发)
          if (!active) return json(503, { ok: false, error: 'noname-kit 未配置 nonameDir' })
          const body = await readBody()
          try { return json(200, await deleteNote(nonameDir, body.folder, Number(body.index))) }
          catch (error) { return json(400, { ok: false, error: error.message }) }
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/blocks/migrate') {
          // 锚点化迁移:只由用户在工坊手动触发,AI 侧没有任何工具能调它。
          // 多文件包:遍历全部 .js,对含条目的文件逐个锚点化(壳文件自动跳过)
          if (!active) return json(503, { ok: false, error: 'noname-kit 未配置 nonameDir' })
          const body = await readBody()
          try {
            const result = await migrateExtension(nonameDir, body.folder)
            if (result.ok) {
              for (const f of result.files) {
                if (f.backup) await recordBackup(nonameDir, body.folder, f.backup)
              }
            }
            return json(result.ok ? 200 : 400, result)
          } catch (error) { return json(400, { ok: false, error: error.message }) }
        }
        if (req.method === 'POST' && url.pathname === '/noname-kit-api/rollback') {
          const body = await readBody()
          const result = await rollbackExtension(nonameDir, body.folder, body.backup)
          await recordBackup(nonameDir, body.folder, `回滚自 ${body.backup}`)
          return json(200, { ok: true, ...result })
        }
        return json(404, { error: 'not found' })
      } catch (error) {
        return json(500, { error: error.message })
      }
    }
  }))
}

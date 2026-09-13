#!/usr/bin/env node
/**
 * 安装「无名杀开发模式」agent preset 到 DSH 用户 preset 目录。
 * 用法:node scripts/install-preset.mjs
 * 已存在同名 preset 时覆盖(先备份到 ~/.dsh/.agent-presets/noname-dev.bak-<时间戳>)。
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../presets/noname-dev/', import.meta.url))
const target = join(homedir(), '.dsh', '.agent-presets', 'noname-dev')

if (!existsSync(join(source, 'agent.cordis.yml'))) {
  console.error('[noname-kit] 找不到 preset 源目录:', source)
  process.exit(1)
}

if (existsSync(target)) {
  const backup = target + '.bak-' + Date.now()
  cpSync(target, backup, { recursive: true })
  console.log('[noname-kit] 已备份旧 preset 到:', backup)
}

mkdirSync(join(homedir(), '.dsh', '.agent-presets'), { recursive: true })
cpSync(source, target, { recursive: true })
console.log('[noname-kit] ✅ preset 已安装:', target)
console.log('[noname-kit] 重启 dsh web 后,新建会话界面即可选择「无名杀开发模式」。')

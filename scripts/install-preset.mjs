#!/usr/bin/env node
/**
 * 安装/更新「无名杀开发模式」agent preset 到 DSH 家目录。
 * 用法:node scripts/install-preset.mjs
 *
 * 已存在同名 preset 时整体覆盖,先备份成兄弟目录 noname-dev.bak-<时间戳>
 * (点号不在 DSH 的 preset id 允许字符里,所以备份不会被当成一个 preset 扫出来)。
 * 实际安装逻辑在 src/preset.js,工坊设置页的「重装 preset」按钮走的是同一个函数。
 */
import { readFileSync } from 'node:fs'
import { bundledPresetDir, installPreset, presetDirOf, resolveDshHome } from '../src/preset.js'

const dshHome = resolveDshHome()
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const result = installPreset({
  presetDir: presetDirOf(dshHome),
  bundledDir: bundledPresetDir(),
  pluginVersion: version,
})

if (!result.ok) {
  console.error('[noname-kit] ❌ ' + result.error)
  process.exit(1)
}
if (result.backup) console.log('[noname-kit] 已备份旧 preset 到:' + result.backup)
console.log(`[noname-kit] ✅ preset 已安装(v${version}):${result.target}`)
console.log('[noname-kit] 重启 dsh web 后,新建会话界面即可选择「无名杀开发模式」;已开的会话不受影响。')

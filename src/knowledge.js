/** 兼容旧导入；开发规范与 Skill 使用同一份正文，不在全局会话注入。 */
import { readFileSync } from 'node:fs'

export const KNOWLEDGE_TEXT = readFileSync(new URL('../presets/noname-dev/skills/noname-extension-dev/SKILL.md', import.meta.url), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

/**
 * 提示词注入（个人版功能，不随开源版发布）
 *
 * pi 在创建会话时读取 `~/.pi/agent/APPEND_SYSTEM.md`（全局）或 `<项目>/.pi/APPEND_SYSTEM.md`（项目）。
 * 这里把用户自己写的一段文本以「带标记的块」写进那个文件：
 * - 只动标记块，标记块以外的内容原样保留；
 * - 每次写入前把原文件备份到 `<userData>/prompt-inject-backups/`；
 * - 停用时只摘掉标记块，等于完整还原。
 *
 * 本模块不内置任何提示词文本，内容完全由用户输入。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import { resolveActiveAgentDir } from './agent-dir'
import { configStore, type PromptInjectConfig, type PromptInjectScope } from './config-store'

export const INJECT_BLOCK_START = '<!-- pi-desktop:prompt-inject:start -->'
export const INJECT_BLOCK_END = '<!-- pi-desktop:prompt-inject:end -->'

const BLOCK_PATTERN = /(?:^|\r?\n)<!-- pi-desktop:prompt-inject:start -->[\s\S]*?<!-- pi-desktop:prompt-inject:end -->[ \t]*(?=\r?\n|$)/

export type PromptInjectBackup = { name: string; size: number; mtime: number }

export type PromptInjectState = {
  enabled: boolean
  text: string
  scope: PromptInjectScope
  targetPath: string
  fileExists: boolean
  /** 目标文件里现在是否有本功能写入的标记块 */
  injected: boolean
  /** 目标文件在标记块之外是否还有内容（他人的 / 手写的内容） */
  hasOtherContent: boolean
  backups: PromptInjectBackup[]
}

export function hasInjectBlock(content: string): boolean {
  return BLOCK_PATTERN.test(content)
}

/** 去掉标记块，并收敛多余空行；不触碰标记块之外的任何一行。 */
export function stripInjectBlock(content: string): string {
  if (!content) return ''
  return content
    .replace(new RegExp(BLOCK_PATTERN.source, 'g'), '')
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '')
}

/** 生成写盘内容：保留原有内容，按需替换/追加标记块。 */
export function composeInjectFile(existing: string, text: string, enabled: boolean): string {
  const base = stripInjectBlock(existing)
  const body = String(text || '').trim()
  if (!enabled || !body) return base ? `${base}\n` : ''
  const block = `${INJECT_BLOCK_START}\n${body}\n${INJECT_BLOCK_END}`
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

export function promptInjectTarget(scope: PromptInjectScope, workspaceId?: string): string {
  const cwd = String(workspaceId || '').trim()
  if (scope === 'project' && cwd) return join(cwd, '.pi', 'APPEND_SYSTEM.md')
  return join(resolveActiveAgentDir(), 'APPEND_SYSTEM.md')
}

function backupDir(): string {
  return join(app.getPath('userData'), 'prompt-inject-backups')
}

function readFileOrEmpty(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : ''
  } catch {
    return ''
  }
}

function backupCurrent(targetPath: string, scope: PromptInjectScope): void {
  const current = readFileOrEmpty(targetPath)
  if (!current.trim()) return
  const dir = backupDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(join(dir, `${stamp}-${scope}.md`), current, 'utf-8')
  pruneBackups(20)
}

function pruneBackups(keep: number): void {
  try {
    const dir = backupDir()
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      // 文件名以 ISO 时间戳开头：mtime 相同（同一毫秒写入）时用名称兜底
      .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
    for (const stale of files.slice(keep)) {
      try {
        unlinkSync(join(dir, stale.name))
      } catch {
        /* keep going */
      }
    }
  } catch {
    /* no backup dir yet */
  }
}

export function listPromptInjectBackups(): PromptInjectBackup[] {
  try {
    const dir = backupDir()
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => {
        const path = join(dir, name)
        const info = statSync(path)
        return { name, size: info.size, mtime: info.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
      .slice(0, 20)
  } catch {
    return []
  }
}

function writeTarget(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, content, 'utf-8')
}

export function readPromptInjectConfig(): PromptInjectConfig {
  return configStore.get('promptInject')
}

export function getPromptInjectState(workspaceId?: string): PromptInjectState {
  const config = readPromptInjectConfig()
  const targetPath = promptInjectTarget(config.scope, workspaceId)
  const existing = readFileOrEmpty(targetPath)
  return {
    enabled: config.enabled,
    text: config.text,
    scope: config.scope,
    targetPath,
    fileExists: existsSync(targetPath),
    injected: hasInjectBlock(existing),
    hasOtherContent: !!stripInjectBlock(existing).trim(),
    backups: listPromptInjectBackups(),
  }
}

/** 保存配置并立刻写盘（enabled=false 等于摘掉标记块）。 */
export function applyPromptInject(
  patch: Partial<PromptInjectConfig>,
  workspaceId?: string,
): PromptInjectState {
  const current = readPromptInjectConfig()
  const next: PromptInjectConfig = {
    enabled: patch.enabled ?? current.enabled,
    text: patch.text ?? current.text,
    scope: patch.scope ?? current.scope,
  }
  configStore.set('promptInject', next)

  const targetPath = promptInjectTarget(next.scope, workspaceId)
  const existing = readFileOrEmpty(targetPath)
  const composed = composeInjectFile(existing, next.text, next.enabled)
  if (composed !== existing) {
    backupCurrent(targetPath, next.scope)
    writeTarget(targetPath, composed)
  }
  return getPromptInjectState(workspaceId)
}

/** 停用并摘掉标记块（保留文件里其它内容）。 */
export function revertPromptInject(workspaceId?: string): PromptInjectState {
  return applyPromptInject({ enabled: false }, workspaceId)
}

/** 用某份备份覆盖目标文件。 */
export function restorePromptInjectBackup(name: string, workspaceId?: string): PromptInjectState {
  const safe = String(name || '')
  if (!/^(?=.*[A-Za-z0-9])[\w.-]+\.md$/.test(safe)) throw new Error('invalid_backup_name')
  const path = join(backupDir(), safe)
  if (!existsSync(path)) throw new Error('backup_not_found')
  const content = readFileSync(path, 'utf-8')
  const config = readPromptInjectConfig()
  const targetPath = promptInjectTarget(config.scope, workspaceId)
  backupCurrent(targetPath, config.scope)
  writeTarget(targetPath, content)
  return getPromptInjectState(workspaceId)
}

/** 删除单份备份，防止越积越多。 */
export function deletePromptInjectBackup(name: string): void {
  const safe = String(name || '')
  if (!/^(?=.*[A-Za-z0-9])[\w.-]+\.md$/.test(safe)) throw new Error('invalid_backup_name')
  const path = join(backupDir(), safe)
  if (!existsSync(path)) throw new Error('backup_not_found')
  unlinkSync(path)
}

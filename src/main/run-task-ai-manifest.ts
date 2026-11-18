import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * 「AI 生成过哪些运行任务」的账本（app 私有状态，放 userData，不碰 `~/.pi/agent/settings.json`）。
 *
 * 为什么需要：AI 检测是往 `.vscode/tasks.json` **合并**写入的，重跑一次就会多一套
 * `一键运行 (AI)` / 过期的 `dev:api`，底部的「选择要一起运行的任务」于是变成只增不减的历史垃圾。
 * 记下每次 AI 写了哪些 label，下一次检测时先把上一批删掉再写 → 列表始终等于「当前项目真实可跑的」。
 *
 * 容错：文件缺失/损坏按空处理；任务被用户手动删掉后，残留 label 在下次写入时自动收敛。
 */
export type RunTaskAiEntry = { labels: string[]; updatedAt: number }
type ManifestFile = { version: 1; workspaces: Record<string, RunTaskAiEntry> }

const VERSION = 1 as const
const MAX_WORKSPACES = 100

function emptyFile(): ManifestFile {
  return { version: VERSION, workspaces: {} }
}

function keyOf(cwd: string): string {
  const resolved = resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export class RunTaskAiManifest {
  private readonly path: string
  private data: ManifestFile | null = null

  constructor(dir: string) {
    this.path = join(dir, 'run-task-ai-manifest.json')
  }

  private load(): ManifestFile {
    if (this.data) return this.data
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as ManifestFile
      this.data =
        parsed && parsed.version === VERSION && parsed.workspaces && typeof parsed.workspaces === 'object'
          ? parsed
          : emptyFile()
    } catch {
      this.data = emptyFile()
    }
    return this.data
  }

  private persist(): void {
    const data = this.load()
    const keys = Object.keys(data.workspaces)
    if (keys.length > MAX_WORKSPACES) {
      const sorted = keys.sort((a, b) => data.workspaces[a].updatedAt - data.workspaces[b].updatedAt)
      for (const key of sorted.slice(0, keys.length - MAX_WORKSPACES)) delete data.workspaces[key]
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      console.warn('[RunTaskAiManifest] 写入失败（忽略）:', error)
    }
  }

  get(cwd: string): string[] {
    const entry = this.load().workspaces[keyOf(cwd)]
    return Array.isArray(entry?.labels) ? entry.labels.filter((label) => typeof label === 'string') : []
  }

  set(cwd: string, labels: readonly string[], now = Date.now()): void {
    const key = keyOf(cwd)
    const data = this.load()
    const clean = [...new Set(labels.filter((label) => typeof label === 'string' && label.trim()))]
    if (!clean.length) {
      if (data.workspaces[key]) {
        delete data.workspaces[key]
        this.persist()
      }
      return
    }
    data.workspaces[key] = { labels: clean, updatedAt: now }
    this.persist()
  }

  clear(cwd: string): void {
    const key = keyOf(cwd)
    const data = this.load()
    if (!data.workspaces[key]) return
    delete data.workspaces[key]
    this.persist()
  }
}

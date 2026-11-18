import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunTaskAiManifest } from '../../run-task-ai-manifest'

const handlers = new Map<string, (request: Record<string, unknown>) => Promise<Record<string, unknown>>>()
const roots: string[] = []
let manifest: RunTaskAiManifest

vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: (cwd: string) => ({ ok: true, cwd }) }))
vi.mock('../../plugin-model', () => ({ completeWithPluginModel: vi.fn(async () => ({ ok: false, error: 'unused' })) }))
vi.mock('../../run-task-ai-manifest-instance', () => ({ getRunTaskAiManifest: () => manifest }))
vi.mock('../registry', () => ({
  registerHandlerWithSchema: (
    channel: string,
    _schema: unknown,
    handler: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) => {
    handlers.set(channel, handler)
  },
}))

const { registerWorkspaceTaskHandlers } = await import('./workspace-tasks')
registerWorkspaceTaskHandlers()

function project(tasks: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-run-tasks-'))
  roots.push(root)
  mkdirSync(join(root, '.vscode'), { recursive: true })
  writeFileSync(join(root, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks }, null, 2), 'utf8')
  return root
}

const readTasks = (root: string): Array<Record<string, unknown>> =>
  (JSON.parse(readFileSync(join(root, '.vscode', 'tasks.json'), 'utf8')) as { tasks: Array<Record<string, unknown>> }).tasks

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ai-manifest-'))
  roots.push(dir)
  manifest = new RunTaskAiManifest(dir)
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('run task management', () => {
  it('returns a one-line description for every selectable task', async () => {
    const root = project([
      { label: 'dev:api', command: 'npm', args: ['run', 'dev:api'] },
      { label: '发布', dependsOn: ['dev:api'] },
      { label: 'run-api', command: 'dotnet', args: ['run', '--project', 'Api.csproj'], detail: '运行后端 API' },
    ])
    const result = await handlers.get('ipc:workspace.tasks.get')!({ cwd: root })
    const definitions = result.definitions as Array<{ label: string; detail: string }>
    expect(definitions.find((item) => item.label === 'dev:api')?.detail).toBe('运行开发服务（dev:api）')
    expect(definitions.find((item) => item.label === '发布')?.detail).toBe('发布：依次执行 1 个任务')
    // AI 写了 detail 就用 AI 的，别覆盖
    expect(definitions.find((item) => item.label === 'run-api')?.detail).toBe('运行后端 API')
  })

  it('deletes a group and the tasks that only existed to serve it', async () => {
    const root = project([
      { label: 'api', command: 'npm', args: ['run', 'dev:api'] },
      { label: 'web', command: 'npm', args: ['run', 'dev:web'] },
      { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true } },
      { label: '发布', dependsOn: ['web'], group: 'publish' },
    ])

    const result = await handlers.get('ipc:workspace.tasks.delete')!({ cwd: root, label: '一键运行' })
    expect(result.ok).toBe(true)
    const labels = readTasks(root).map((task) => task.label)
    // 组合没了，只为它服务的 api 也清掉；web 还被「发布」引用，必须留着
    expect(labels).toEqual(['web', '发布'])
    expect((result.groups as Array<{ label: string }>).map((group) => group.label)).toEqual(['发布'])
  })

  it('keeps standalone tasks even when the deleted group was their only reference', async () => {
    const root = project([
      { label: 'api', command: 'npm', args: ['run', 'dev:api'], group: 'build' },
      { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true } },
    ])

    await handlers.get('ipc:workspace.tasks.delete')!({ cwd: root, label: '一键运行' })
    expect(readTasks(root).map((task) => task.label)).toEqual(['api'])
  })

  it('reports a missing group instead of writing a broken file', async () => {
    const root = project([{ label: 'api', command: 'npm', args: ['run', 'dev'] }])
    const result = await handlers.get('ipc:workspace.tasks.delete')!({ cwd: root, label: '不存在的组合' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('not_found')
    expect(readTasks(root)).toHaveLength(1)
  })

  it('treats AI detection as a snapshot: saving twice replaces the previous draft', async () => {
    const root = project([{ label: 'keep-me', command: 'echo', args: ['hi'] }])
    const first = {
      version: '2.0.0',
      tasks: [
        { label: 'api', command: 'npm', args: ['run', 'dev:api'], detail: '运行后端' },
        { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true }, detail: '启动后端' },
      ],
    }
    const saved = await handlers.get('ipc:workspace.tasks.save')!({ cwd: root, content: `${JSON.stringify(first)}\n` })
    expect(saved.ok).toBe(true)
    expect(readTasks(root).map((task) => task.label)).toEqual(['keep-me', 'api', '一键运行'])

    // 第二次检测（项目脚本变了）：旧的 AI 任务必须被替换，而不是叠出「一键运行 (AI)」
    const second = {
      version: '2.0.0',
      tasks: [
        { label: 'api', command: 'npm', args: ['run', 'serve:api'], detail: '运行后端' },
        { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true }, detail: '启动后端' },
      ],
    }
    const again = await handlers.get('ipc:workspace.tasks.save')!({ cwd: root, content: `${JSON.stringify(second)}\n` })
    expect(again.ok).toBe(true)
    const tasks = readTasks(root)
    expect(tasks.map((task) => task.label)).toEqual(['keep-me', 'api', '一键运行'])
    // 用户自己写的任务原样保留，AI 的那份换成了新内容
    expect(tasks.find((task) => task.label === 'api')?.args).toEqual(['run', 'serve:api'])
    expect((again.groups as Array<{ label: string }>).map((group) => group.label)).toEqual(['一键运行'])
  })
})

describe('legacy AI duplicates', () => {
  it('cleans up "(AI)" suffixed tasks left by older versions on the first detection', async () => {
    const root = project([
      { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true } },
      { label: 'api', command: 'npm', args: ['run', 'dev:api'] },
      // 旧版本合并写入时撞名改出来的副本
      { label: '一键运行 (AI)', dependsOn: ['api'], group: { kind: 'build', isDefault: true } },
    ])
    const draft = {
      version: '2.0.0',
      tasks: [
        { label: 'api', command: 'npm', args: ['run', 'dev:api'], detail: '运行后端' },
        { label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true }, detail: '启动后端' },
      ],
    }
    const result = await handlers.get('ipc:workspace.tasks.save')!({ cwd: root, content: `${JSON.stringify(draft)}\n` })
    expect(result.ok).toBe(true)
    const labels = readTasks(root).map((task) => task.label)
    expect(labels.filter((label) => String(label).includes('(AI)'))).toEqual([])
    expect((result.groups as Array<{ label: string }>).map((group) => group.label)).toEqual(['一键运行'])
  })
})

describe('legacy cleanup safety', () => {
  it('never removes a hand-made group while cleaning legacy "(AI)" duplicates', async () => {
    const root = project([
      // 用户自己建的组合（管理对话框写入时带 pi-app-exact 标记）
      { label: 'my-run', dependsOn: ['api'], group: 'build', presentation: { group: 'pi-app-exact' } },
      { label: 'api', command: 'npm', args: ['run', 'dev'] },
      { label: 'my-run (AI)', dependsOn: ['api'], group: 'build' },
    ])
    const draft = {
      version: '2.0.0',
      tasks: [{ label: '一键运行', dependsOn: ['api'], group: { kind: 'build', isDefault: true }, detail: '启动后端' }],
    }
    const result = await handlers.get('ipc:workspace.tasks.save')!({ cwd: root, content: `${JSON.stringify(draft)}\n` })
    expect(result.ok).toBe(true)
    const labels = readTasks(root).map((task) => String(task.label))
    expect(labels).toContain('my-run')
    expect(labels).not.toContain('my-run (AI)')
    expect(labels).toContain('一键运行')
  })
})

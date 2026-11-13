import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { applyEdits, modify } from 'jsonc-parser'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { completeWithPluginModel } from '../../plugin-model'
import { inferRunTasks, mergeTaskDocument, parseJsonDocument, parseTaskGroups, tasksOf } from '../../workspace-tasks'
import { registerHandlerWithSchema } from '../registry'

const TASK_PROMPT = `你是项目启动助手。根据项目文件判断怎样本地运行和发布，只输出一个 VS Code tasks.json 对象，不要 Markdown。
规则：
1. 根对象只包含 version 和 tasks。
2. 每个可执行任务必须有 label、command、args。command 只能是项目已有的程序或脚本命令。
3. 一键运行使用 label 为“运行”、dependsOn 为需要同时启动的任务、group 为 {"kind":"build","isDefault":true}。
4. 能发布时，一键发布使用 label 为“发布”、dependsOn 为发布任务、group 为 "publish"。不能可靠判断就不要编造发布任务。
5. 多端项目用 options.cwd 指向对应子目录，并用 presentation.group 标记 build 或 publish。
6. 不要包含注释、密钥、绝对用户路径或未在项目中出现的命令。`

const cwdSchema = z.object({ cwd: z.string().min(1) }).strict()
const draftSchema = z.object({
  cwd: z.string().min(1),
  files: z.array(z.object({ path: z.string(), content: z.string().max(20_000) }).strict()).max(40),
}).strict()
const saveSchema = z.object({ cwd: z.string().min(1), content: z.string().min(2).max(500_000).optional(), group: z.object({ label: z.string().trim().min(1).max(200), dependsOn: z.array(z.string().min(1).max(200)).min(1).max(100), originalLabel: z.string().min(1).max(200).optional() }).strict().optional() }).strict().refine((value) => !!value.content !== !!value.group)

async function tasksDocument(cwd: string): Promise<{ groups: ReturnType<typeof parseTaskGroups>; raw: string | null }> {
  const path = join(cwd, '.vscode', 'tasks.json')
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (!raw) return { groups: [], raw: null }
  try {
    return { groups: parseTaskGroups(cwd, parseJsonDocument(raw.replace(/^\uFEFF/, ''))), raw }
  } catch {
    return { groups: [], raw }
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = (fenced?.[1] || text).trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no_json')
  return JSON.parse(source.slice(start, end + 1))
}

export function registerWorkspaceTaskHandlers(): void {
  registerHandlerWithSchema('ipc:workspace.tasks.get', cwdSchema, async ({ cwd }) => {
    const authorized = authorizeProjectCwd(cwd)
    if (!authorized.ok) return { ok: false, error: authorized.error, groups: [] }
    const document = await tasksDocument(authorized.cwd)
    let definitions: Array<{ label: string; dependsOn: string[] }> = []
    if (document.raw) try { definitions = tasksOf(parseJsonDocument(document.raw)).filter((task) => typeof task.label === 'string').map((task) => ({ label: String(task.label), dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.filter((item): item is string => typeof item === 'string') : typeof task.dependsOn === 'string' ? [task.dependsOn] : [] })) } catch { void 0 }
    return { ok: true, groups: document.groups, labels: definitions.map((task) => task.label), definitions, hasFile: document.raw != null }
  })

  registerHandlerWithSchema('ipc:workspace.tasks.draft', draftSchema, async ({ cwd, files }) => {
    const authorized = authorizeProjectCwd(cwd)
    if (!authorized.ok) return { ok: false, error: authorized.error }
    const listing = files.map((file) => `FILE ${file.path}\n${file.content}`).join('\n\n')
    const result = await completeWithPluginModel({
      system: TASK_PROMPT,
      user: `项目根目录：${authorized.cwd}\n\n${listing || '没有提供项目文件。'}`,
      maxTokens: 8192,
    })
    if (!result.ok) return result
    try {
      const parsed = extractJson(result.text) as { tasks?: unknown }
      let groups = parseTaskGroups(authorized.cwd, parsed)
      const hasRunGroup = groups.some((item) => item.kind === 'build' && item.tasks.some((task) => !/publish|release|deploy|build|发布|打包/i.test([task.label, task.command, ...task.args].join(' '))))
      if (!hasRunGroup && Array.isArray(parsed.tasks)) {
        const inferred = inferRunTasks(files)
        const used = new Set(tasksOf(parsed).map((task) => task.label).filter((label): label is string => typeof label === 'string'))
        for (const task of inferred) {
          const base = String(task.label)
          let label = base
          let index = 2
          while (used.has(label)) label = `${base} ${index++}`
          task.label = label
          used.add(label)
        }
        if (inferred.length) {
          let label = '一键运行'
          let index = 2
          while (used.has(label)) label = `一键运行 ${index++}`
          parsed.tasks.push(...inferred, { label, dependsOn: inferred.map((task) => task.label), dependsOrder: 'parallel', group: { kind: 'build', isDefault: true } })
          groups = parseTaskGroups(authorized.cwd, parsed)
        }
      }
      if (!groups.length) return { ok: false, error: 'plugin_model_failed', detail: 'tasks_not_runnable' }
      return { ok: true, content: `${JSON.stringify(parsed, null, 2)}\n`, groups }
    } catch (error) {
      return { ok: false, error: 'plugin_model_failed', detail: error instanceof Error ? error.message : 'invalid_json' }
    }
  })

  registerHandlerWithSchema('ipc:workspace.tasks.save', saveSchema, async ({ cwd, content, group }) => {
    const authorized = authorizeProjectCwd(cwd)
    if (!authorized.ok) return { ok: false, error: authorized.error }
    const path = join(authorized.cwd, '.vscode', 'tasks.json')
    const existing = await readFile(path, 'utf8').catch(() => null)
    let parsed: unknown
    let output: string
    try {
      const current = existing ? parseJsonDocument(existing.replace(/^\uFEFF/, '')) : { version: '2.0.0', tasks: [] }
      const currentTasks = tasksOf(current)
      const labels = new Set(currentTasks.map((task) => task.label).filter((label): label is string => typeof label === 'string'))
      const incoming = group ? [{ label: group.label, dependsOn: group.dependsOn, dependsOrder: 'parallel', group: 'build', presentation: { group: 'pi-app-exact' } }] : tasksOf(JSON.parse(content!))
      if (group && group.dependsOn.some((label) => !labels.has(label))) return { ok: false, error: 'invalid_task_group' }
      if (group?.originalLabel) {
        const index = currentTasks.findIndex((task) => task.label === group.originalLabel && task.dependsOn != null)
        if (index < 0 || group.label !== group.originalLabel || !existing) return { ok: false, error: 'invalid_task_group' }
        const byLabel = new Map(currentTasks.map((task) => [task.label, task]))
        const reachesCurrent = (label: string, seen: Set<string>): boolean => {
          if (label === group.originalLabel) return true
          if (seen.has(label)) return false
          seen.add(label)
          const dependency = byLabel.get(label)?.dependsOn
          return (Array.isArray(dependency) ? dependency : typeof dependency === 'string' ? [dependency] : []).some((item) => typeof item === 'string' && reachesCurrent(item, seen))
        }
        if (group.dependsOn.some((label) => reachesCurrent(label, new Set()))) return { ok: false, error: 'invalid_task_group' }
        output = applyEdits(existing, modify(existing, ['tasks', index, 'dependsOn'], group.dependsOn, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
      } else {
        if (group && labels.has(group.label)) return { ok: false, error: 'invalid_task_group' }
        output = mergeTaskDocument(existing, incoming)
      }
      parsed = parseJsonDocument(output.replace(/^\uFEFF/, ''))
    } catch { return { ok: false, error: 'invalid_json' } }
    const groups = parseTaskGroups(authorized.cwd, parsed)
    if (!groups.length) return { ok: false, error: 'tasks_not_runnable' }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, output.endsWith('\n') ? output : `${output}\n`, 'utf8')
    return { ok: true, groups }
  })
}

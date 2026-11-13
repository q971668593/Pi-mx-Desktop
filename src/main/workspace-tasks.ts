import { isAbsolute, relative, resolve, sep } from 'node:path'
import { applyEdits, modify } from 'jsonc-parser'

export function tasksOf(value: unknown): Array<Record<string, unknown>> {
  const tasks = (value as { tasks?: unknown } | null)?.tasks
  return Array.isArray(tasks) ? tasks.filter((task): task is Record<string, unknown> => !!task && typeof task === 'object' && !Array.isArray(task)) : []
}

export function inferRunTasks(files: Array<{ path: string; content: string }>): Array<Record<string, unknown>> {
  const tasks: Array<Record<string, unknown>> = []
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/')
    if (path.startsWith('/') || path.split('/').includes('..')) continue
    const slash = path.lastIndexOf('/')
    const directory = slash < 0 ? '' : path.slice(0, slash)
    const cwd = directory ? `\${workspaceFolder}/${directory}` : '${workspaceFolder}'
    if (path === 'package.json' || path.endsWith('/package.json')) {
      try {
        const scripts = (JSON.parse(file.content) as { scripts?: Record<string, unknown> }).scripts || {}
        const script = typeof scripts.dev === 'string' ? 'dev' : typeof scripts['dev:h5'] === 'string' ? 'dev:h5' : ''
        if (script) tasks.push({ label: `运行 ${directory || '项目'}`, type: 'shell', command: 'npm', args: ['run', script], options: { cwd }, isBackground: true })
      } catch { void 0 }
    } else if (/\.csproj$/i.test(path) && /Microsoft\.NET\.Sdk\.Web/i.test(file.content)) {
      tasks.push({ label: `运行 ${directory || path}`, type: 'shell', command: 'dotnet', args: ['run', '--project', path.slice(slash + 1)], options: { cwd }, isBackground: true })
    }
  }
  return tasks
}

export function mergeTaskDocument(existing: string | null, incoming: Array<Record<string, unknown>>): string {
  const current = existing ? parseJsonDocument(existing.replace(/^\uFEFF/, '')) : { version: '2.0.0', tasks: [] }
  if (!current || typeof current !== 'object' || !Array.isArray((current as { tasks?: unknown }).tasks)) throw new Error('invalid_json')
  const used = new Set(tasksOf(current).map((task) => task.label).filter((label): label is string => typeof label === 'string'))
  const renamed = new Map<string, string>()
  for (const task of incoming) {
    if (typeof task.label !== 'string') continue
    const original = task.label
    if (renamed.has(original)) throw new Error('duplicate_task_label')
    let next = original
    let index = 1
    while (used.has(next)) next = `${original} (AI${index++ === 1 ? '' : ` ${index - 1}`})`
    renamed.set(original, next)
    used.add(next)
  }
  let output = existing || '{\n  "version": "2.0.0",\n  "tasks": []\n}\n'
  for (const task of incoming) {
    if (typeof task.label !== 'string') continue
    const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn.map((label) => typeof label === 'string' ? renamed.get(label) || label : label) : typeof task.dependsOn === 'string' ? renamed.get(task.dependsOn) || task.dependsOn : task.dependsOn
    const next = { ...task, label: renamed.get(task.label) || task.label, ...(dependsOn === undefined ? {} : { dependsOn }) }
    output = applyEdits(output, modify(output, ['tasks', -1], next, { isArrayInsertion: true, formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  }
  return output
}

export type TaskLaunch = {
  label: string
  command: string
  args: string[]
  cwd: string
  background: boolean
}

export type TaskGroup = {
  kind: string
  label: string
  isDefault: boolean
  tasks: TaskLaunch[]
}

type RawTask = {
  label?: unknown
  command?: unknown
  args?: unknown
  dependsOn?: unknown
  isBackground?: unknown
  group?: unknown
  options?: { cwd?: unknown } | null
  presentation?: { group?: unknown } | null
}

const keyOf = (task: TaskLaunch) => `${task.cwd}\u0000${task.command}\u0000${task.args.join('\u0001')}`

function expandWorkspace(value: string, root: string): string {
  return value.split('${workspaceFolder}').join(root).split('${workspaceRoot}').join(root)
}

function resolveTaskCwd(raw: unknown, root: string): string {
  const value = typeof raw === 'string' && raw.trim() ? raw : '${workspaceFolder}'
  const expanded = expandWorkspace(value, root)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(root, expanded)
}

function buildTask(raw: RawTask, label: string, root: string): TaskLaunch | null {
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (!command) return null
  const args = Array.isArray(raw.args) ? raw.args.filter((item): item is string => typeof item === 'string') : []
  return {
    label,
    command,
    args,
    cwd: resolveTaskCwd(raw.options?.cwd, root),
    background: raw.isBackground === true,
  }
}

function dependencies(raw: RawTask): string[] {
  if (Array.isArray(raw.dependsOn)) return raw.dependsOn.filter((item): item is string => typeof item === 'string')
  return typeof raw.dependsOn === 'string' ? [raw.dependsOn] : []
}

function expand(
  label: string,
  byLabel: Map<string, RawTask>,
  root: string,
  stack: string[],
  out: TaskLaunch[],
): void {
  if (stack.includes(label)) return
  const raw = byLabel.get(label)
  if (!raw) return
  stack.push(label)
  const task = buildTask(raw, label, root)
  if (task) out.push(task)
  else for (const dependency of dependencies(raw)) expand(dependency, byLabel, root, stack, out)
  stack.pop()
}

function unique(tasks: TaskLaunch[]): TaskLaunch[] {
  const seen = new Set<string>()
  return tasks.filter((task) => {
    const key = keyOf(task)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function groupKind(raw: RawTask): { kind: string; isDefault: boolean; label: string } | null {
  const group = raw.group
  const kind = typeof group === 'string' ? group : group && typeof group === 'object' && typeof (group as { kind?: unknown }).kind === 'string' ? (group as { kind: string }).kind : ''
  if (!kind) return null
  return {
    kind,
    isDefault: !!(group && typeof group === 'object' && (group as { isDefault?: unknown }).isDefault === true),
    label: typeof raw.label === 'string' ? raw.label : kind,
  }
}

function presentationGroup(raw: RawTask | undefined): string | null {
  const value = raw?.presentation?.group
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function inferPresentation(labels: string[], byLabel: Map<string, RawTask>): string | null {
  const values = [...new Set(labels.map((label) => presentationGroup(byLabel.get(label))).filter((value): value is string => !!value))].sort()
  return values.length === 1 ? values[0] : null
}

function uiKind(kind: string, isDefault: boolean, presentation: string | null): string {
  if (presentation === 'publish' || kind === 'publish') return 'publish'
  if (isDefault || kind === 'build') return 'build'
  return presentation || kind
}

export function parseTaskGroups(root: string, parsed: unknown): TaskGroup[] {
  const tasks = parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
    ? ((parsed as { tasks: unknown[] }).tasks.filter((item): item is RawTask => !!item && typeof item === 'object'))
    : []
  const byLabel = new Map(tasks.filter((task) => typeof task.label === 'string').map((task) => [task.label as string, task]))
  const groups: TaskGroup[] = []
  const seen = new Set<string>()

  for (const task of tasks) {
    if (typeof task.label !== 'string' || task.dependsOn == null) continue
    const parsedGroup = groupKind(task)
    if (!parsedGroup) continue
    const deps = dependencies(task)
    const kind = uiKind(parsedGroup.kind, parsedGroup.isDefault, inferPresentation(deps, byLabel))
    if (seen.has(task.label)) continue
    seen.add(task.label)
    const expanded: TaskLaunch[] = []
    for (const dependency of deps) expand(dependency, byLabel, root, [], expanded)
    const launches = unique(expanded)
    if (launches.length) groups.push({ kind, label: parsedGroup.label, isDefault: parsedGroup.isDefault, tasks: launches })
  }

  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => Number(!a.group.isDefault) - Number(!b.group.isDefault) || a.index - b.index)
    .map((entry) => entry.group)
}

export function commandLine(task: Pick<TaskLaunch, 'command' | 'args'>, shellKind: string): string {
  const quote = (value: string) => {
    if (shellKind === 'cmd' || shellKind === 'pwsh' || shellKind === 'powershell') return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    return /[^\w@%+=:,./-]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value
  }
  return [task.command, ...task.args].map(quote).join(' ')
}

export function shellSetup(cwd: string, shellKind: string): string {
  if (shellKind === 'cmd') return `cd /d "${cwd.replace(/"/g, '""')}"`
  if (shellKind === 'pwsh' || shellKind === 'powershell') return `Set-Location -LiteralPath "${cwd.replace(/"/g, '`"')}"`
  const drive = /^([a-zA-Z]):[\\/](.*)$/.exec(cwd)
  const shellCwd = shellKind === 'wsl' && drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}` : cwd
  return `cd -- '${shellCwd.replace(/'/g, `'\\''`)}'`
}

export function isPathInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath) && !relativePath.split(sep).includes('..'))
}

/** VS Code tasks.json allows comments and trailing commas. Text inside strings stays unchanged. */
export function parseJsonDocument(text: string): unknown {
  let out = ''
  let held = ''
  let quoted = false
  let escaped = false
  const emit = (value: string) => {
    out += held + value
    held = ''
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      emit(char)
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') {
      quoted = true
      emit(char)
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      index += 1
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    if (char === ',') {
      held = ','
      continue
    }
    if (held && (char === '}' || char === ']')) {
      held = ''
      out += char
      continue
    }
    if (held && /\s/.test(char)) {
      held += char
      continue
    }
    emit(char)
  }
  return JSON.parse(out + held)
}

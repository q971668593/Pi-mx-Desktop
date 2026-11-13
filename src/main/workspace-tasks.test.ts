import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandLine, mergeTaskDocument, parseJsonDocument, parseTaskGroups, shellSetup } from './workspace-tasks'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('workspace task groups', () => {
  it('preserves existing comments and tasks when adding AI tasks and multiple groups', () => {
    const existing = '{\n  // existing settings\n  "version": "2.0.0",\n  "tasks": [{ "label": "web", "command": "old" }],\n}'
    const merged = mergeTaskDocument(existing, [
      { label: 'web', command: 'new' },
      { label: 'frontend', dependsOn: ['web'], group: 'build' },
      { label: 'everything', dependsOn: ['frontend'], group: 'build' },
    ])
    expect(merged).toContain('// existing settings')
    const parsed = parseJsonDocument(merged) as { tasks: Array<{ label: string; command?: string; dependsOn?: string[] }> }
    expect(parsed.tasks.find((task) => task.label === 'web')?.command).toBe('old')
    expect(parsed.tasks.find((task) => task.label === 'web (AI)')?.command).toBe('new')
    expect(parsed.tasks.find((task) => task.label === 'frontend')?.dependsOn).toEqual(['web (AI)'])
    expect(parseTaskGroups('/project', parsed).map((group) => group.label)).toEqual(['frontend', 'everything'])
  })

  it('keeps a custom combination limited to its selected tasks', () => {
    const parsed = { tasks: [
      { label: 'frontend', command: 'npm', presentation: { group: 'build' } },
      { label: 'backend', command: 'dotnet', presentation: { group: 'build' } },
      { label: 'only frontend', dependsOn: ['frontend'], group: 'build', presentation: { group: 'pi-app-exact' } },
    ] }
    expect(parseTaskGroups('/project', parsed)[0].tasks.map((task) => task.label)).toEqual(['frontend'])
  })
  it('expands build and publish groups and keeps the default group first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tasks-'))
    dirs.push(root)
    await mkdir(join(root, '.vscode'), { recursive: true })
    await writeFile(join(root, '.vscode', 'tasks.json'), JSON.stringify({
      tasks: [
        { label: 'web', command: 'npm', args: ['run', 'dev'], options: { cwd: '${workspaceFolder}/web' }, presentation: { group: 'build' } },
        { label: 'api', command: 'dotnet', args: ['watch'], options: { cwd: '${workspaceFolder}/api' }, presentation: { group: 'build' } },
        { label: 'Run', dependsOn: ['web', 'api'], group: { kind: 'build', isDefault: true } },
        { label: 'pack', command: 'npm', args: ['run', 'build'], presentation: { group: 'publish' } },
        { label: 'Publish', dependsOn: ['pack'], group: 'publish' },
      ],
    }), 'utf8')

    const { readFile } = await import('node:fs/promises')
    const groups = parseTaskGroups(root, JSON.parse(await readFile(join(root, '.vscode', 'tasks.json'), 'utf8')))
    expect(groups.map((group) => group.kind)).toEqual(['build', 'publish'])
    expect(groups[0].tasks.map((task) => task.label)).toEqual(['web', 'api'])
    expect(groups[0].tasks[0].cwd.replace(/\\/g, '/')).toContain('/web')
    expect(commandLine(groups[0].tasks[0], 'powershell')).toBe('npm run dev')
    expect(shellSetup('C:\\work', 'cmd')).toBe('cd /d "C:\\work"')
  })

  it('quotes arguments that would otherwise be interpreted by the shell', () => {
    expect(commandLine({ command: 'echo', args: ['hello world'] }, 'bash')).toBe("echo 'hello world'")
    expect(commandLine({ command: 'echo', args: ['a&b'] }, 'powershell')).toBe('echo "a&b"')
  })

  it('keeps strings while accepting comments and trailing commas', () => {
    const text = [
      '{',
      '  // one-click run',
      '  "tasks": [',
      '    { "label": "web", "command": "echo", "args": ["https://example.com", "a,}"], },',
      '  ],',
      '}',
    ].join('\n')
    expect(parseJsonDocument(text)).toEqual({
      tasks: [{ label: 'web', command: 'echo', args: ['https://example.com', 'a,}'] }],
    })
  })
})

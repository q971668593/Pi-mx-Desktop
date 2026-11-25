import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 复现：/澄清 抛 exception会话建不起来。
 * 走真链路（schema 校验 + 授权 + 落盘）只把 electron 和工作区换成临时的。
 */
const dirs = vi.hoisted(() => ({ userData: '', cwd: '', ws: '' }))
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? dirs.userData : dirs.userData),
    getAppPath: () => dirs.cwd,
  },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
}))
// config-store（electron-store）在单测里起不来：这里只关心授权认不认这个目录。
vi.mock('./config-store', () => ({
  configStore: { get: (key: string) => (key === 'recentProjects' ? [dirs.ws] : undefined) },
}))

import { registerGrowHandlers } from './ipc/handlers/grow'
import { invokeHandler } from './ipc/registry'

describe('grow session handlers', () => {
  it('waits for a project lock held by another process before reading and updating the tree', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-process-lock-'))
    dirs.ws = ws
    let processHandle: ReturnType<typeof spawn> | undefined
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const session = { workspaceId: ws, sessionId }
      // Create the shared database before the child takes its SQLite write lock.
      await invokeHandler('ipc:grow:beginPlan', session)
      const file = join(ws, '.文档', 'grow-me', sessionId, 'tree.json')
      const lock = join(ws, '.文档', 'grow-me', '.project-lock.sqlite')
      processHandle = spawn(process.execPath, ['--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(process.argv[1]);
        db.exec('BEGIN IMMEDIATE');
        console.log('locked');
        process.stdin.once('data', () => { db.exec('ROLLBACK'); db.close(); process.exit(0); });
      `, lock], { stdio: ['pipe', 'pipe', 'pipe'] })
      const child = processHandle
      const exited = new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`lock process exited: ${code}`)))
      })
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once('data', () => resolve())
        child.once('error', reject)
        child.once('exit', (code) => reject(new Error(`lock process exited before ready: ${code}`)))
      })
      let completed = false
      const update = invokeHandler<any>('ipc:grow:putQuestions', {
        ...session, round: 1, expectedRevision: 1, questions: [{ id: 'q', question: '问题' }],
      }).then((result) => { completed = true; return result })
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(completed).toBe(false)
      const tree = JSON.parse(await readFile(file, 'utf8'))
      tree.revision = 2
      await writeFile(file, JSON.stringify(tree))
      child.stdin!.end('release')
      await exited
      expect(await update).toEqual({ ok: false, error: 'revision_conflict', revision: 2 })
      expect(JSON.parse(await readFile(file, 'utf8')).nodes).toEqual([])
    } finally {
      processHandle?.kill()
      await rm(ws, { recursive: true, force: true })
    }
  })
  it('lists project trees without selecting a latest tree implicitly', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-list-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      expect(await invokeHandler('ipc:grow:listSessions', { workspaceId: ws })).toEqual({ ok: true, trees: [], unreadable: 0 })
      const first = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws, requirement: '用户管理' })
      const second = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws, requirement: '订单流程' })
      await invokeHandler('ipc:grow:putQuestions', { workspaceId: ws, sessionId: first.sessionId, round: 1, questions: [{ id: 'q1', question: '谁使用？' }] })
      expect(await invokeHandler('ipc:grow:listSessions', { workspaceId: ws })).toMatchObject({ ok: true, unreadable: 0, trees: expect.arrayContaining([
        expect.objectContaining({ sessionId: first.sessionId, requirement: '用户管理', pendingCount: 1 }),
        expect.objectContaining({ sessionId: second.sessionId, requirement: '订单流程', pendingCount: 0 }),
      ]) })
      await writeFile(join(ws, '.文档', 'grow-me', second.sessionId, 'tree.json'), '{broken')
      expect(await invokeHandler('ipc:grow:listSessions', { workspaceId: ws })).toMatchObject({ ok: true, unreadable: 1, trees: [expect.objectContaining({ sessionId: first.sessionId })] })
    } finally { await rm(ws, { recursive: true, force: true }) }
  })
  it('guards plan generation against revisions, incomplete files, reviews, and overlapping retries', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-plan-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const session = { workspaceId: ws, sessionId }
      const dir = join(ws, '.文档', 'grow-me', sessionId)
      const begin = () => invokeHandler<any>('ipc:grow:beginPlan', session)
      const finish = (expectedRevision: number) => invokeHandler<any>('ipc:grow:finishPlan', { ...session, expectedRevision })
      const state = () => invokeHandler<any>('ipc:grow:getState', session)
      const first = await begin()
      expect(first).toEqual({ ok: true, revision: 1 })
      expect(await state()).toMatchObject({ state: { planStale: true } })
      expect(await finish(first.revision)).toMatchObject({ ok: false, error: 'no_plan' })
      await writeFile(join(dir, '方案.html'), '<h1>计划</h1>')
      for (const manifest of ['invalid', JSON.stringify({ chapters: [] }), JSON.stringify({ chapters: [{ id: ' ', title: 'X' }] })]) {
        await writeFile(join(dir, 'task.manifest.json'), manifest)
        expect(await finish(first.revision)).toMatchObject({ ok: false, error: 'invalid_manifest' })
        expect(await state()).toMatchObject({ state: { planStale: true } })
      }
      await writeFile(join(dir, 'task.manifest.json'), JSON.stringify({ chapters: [{ id: 'a', title: '章节' }] }))
      const second = await begin()
      expect(await finish(first.revision)).toMatchObject({ ok: false, error: 'revision_conflict', revision: second.revision })
      expect(await invokeHandler('ipc:grow:putQuestions', { ...session, round: 1, questions: [{ id: 'q', question: '问题' }] })).toMatchObject({ ok: true })
      expect(await finish(second.revision)).toMatchObject({ ok: false, error: 'revision_conflict' })
      await invokeHandler('ipc:grow:submitAnswer', { ...session, nodeId: 'q', action: 'unclear' })
      const third = await begin()
      expect(await finish(third.revision)).toMatchObject({ ok: false, error: 'needs_review' })
      expect(await state()).toMatchObject({ state: { planStale: true } })
      await invokeHandler('ipc:grow:submitAnswer', { ...session, nodeId: 'q', action: 'answer', text: '回答' })
      const last = await begin()
      expect(await Promise.all([finish(last.revision), finish(last.revision)])).toEqual([
        { ok: true, revision: last.revision }, { ok: true, revision: last.revision },
      ])
      expect(await state()).toMatchObject({ state: { planStale: false } })
      await expect(invokeHandler('ipc:grow:finishPlan', session)).rejects.toThrow('expectedRevision')
    } finally { await rm(ws, { recursive: true, force: true }) }
  })
  it('serializes revision checks and preserves previously answered nodes', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-revision-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const start = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const base = { workspaceId: ws, sessionId: start.sessionId, round: 1 }
      const put = (questions: unknown[], expectedRevision?: number) => invokeHandler<any>('ipc:grow:putQuestions', { ...base, questions, expectedRevision })
      const q = (id: string) => ({ id, question: `Question ${id}` })
      const results = await Promise.all([put([q('a')], 0), put([q('b')], 0)])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(results.filter((r) => r.error === 'revision_conflict')).toHaveLength(1)
      const state = await invokeHandler<any>('ipc:grow:getState', { workspaceId: ws, sessionId: start.sessionId })
      const id = state.state.nodes[0].id
      await invokeHandler('ipc:grow:submitAnswer', { workspaceId: ws, sessionId: start.sessionId, nodeId: id, action: 'answer', text: 'answer' })
      expect(await put([q('new')])).toMatchObject({ ok: true })
      expect(await put([q('dup'), q(' dup ')])).toMatchObject({ ok: false, error: 'duplicate_id' })
      expect(await put([{ id, question: 'different' }])).toMatchObject({ ok: false, error: 'answered_question_conflict' })
      const after = await invokeHandler<any>('ipc:grow:getState', { workspaceId: ws, sessionId: start.sessionId })
      expect(after.state.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id, answer: 'answer' }), expect.objectContaining({ id: 'new' })]))
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
  it('reads only the requested tree and refreshes its questions and plan from disk', async () => {
    dirs.userData = await mkdtemp(join(tmpdir(), 'pi-grow-repro-user-'))
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-repro-ws-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const start = (requirement: string) => invokeHandler<{ ok: boolean; sessionId: string }>(
        'ipc:grow:startSession', { workspaceId: ws, requirement },
      )
      const old = await start('旧方案')
      const current = await start('当前方案')
      expect(old.ok && current.ok).toBe(true)
      const getState = (sessionId: string) => invokeHandler('ipc:grow:getState', { workspaceId: ws, sessionId })
      const oldDir = join(ws, '.文档', 'grow-me', old.sessionId)
      await writeFile(join(oldDir, 'task.manifest.json'), JSON.stringify({ chapters: [{ id: 'old', title: '旧章节' }] }))
      expect(await getState(current.sessionId)).toMatchObject({ state: { nodes: [], chapters: [], docFile: null } })
      expect(await getState('missing')).toMatchObject({ state: { ready: false, chapters: [] } })
      expect(await invokeHandler('ipc:grow:convertToTeam', { workspaceId: ws, sessionId: current.sessionId }))
        .toEqual({ ok: false, error: 'no_chapters' })

      const currentDir = join(ws, '.文档', 'grow-me', current.sessionId)
      const docFile = join(currentDir, '方案.html')
      await writeFile(join(currentDir, 'tree.json'), '\uFEFF' + JSON.stringify({
        session_id: current.sessionId, nodes: [{ id: 'q1', question: '给谁用？', status: 'pending' }],
      }))
      await writeFile(docFile, '<h1>当前方案</h1>')
      await writeFile(join(currentDir, 'task.manifest.json'), '\uFEFF' + JSON.stringify({
        chapters: [{ id: 'ch1', title: '问卷设计' }],
      }))
      expect(await getState(current.sessionId)).toMatchObject({ state: {
        sessionId: current.sessionId, nodes: [{ id: 'q1', question: '给谁用？' }],
        pendingCount: 1, docFile, chapters: [{ id: 'ch1', title: '问卷设计', ready: true }],
      } })
    } finally {
      await rm(dirs.userData, { recursive: true, force: true })
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('converts a legacy root tree while another session is updated', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-legacy-lock-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const base = join(ws, '.文档', 'grow-me')
      await writeFile(join(base, 'tree.json'), JSON.stringify({ session_id: 'legacy', revision: 0, nodes: [] }))
      await writeFile(join(base, 'task.manifest.json'), JSON.stringify({ chapters: [{ id: 'a', title: '旧章节' }] }))
      const convert = () => invokeHandler<any>('ipc:grow:convertToTeam', { workspaceId: ws })
      const [first, second, update] = await Promise.all([
        convert(), convert(), invokeHandler<any>('ipc:grow:beginPlan', { workspaceId: ws, sessionId }),
      ])
      expect([first.created.length, second.created.length].sort()).toEqual([0, 1])
      expect(update).toEqual({ ok: true, revision: 1 })
    } finally { await rm(ws, { recursive: true, force: true }) }
  })

  it('converts chapters once even when the request is repeated or concurrent', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-convert-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws, requirement: '问卷' })
      await writeFile(join(ws, '.文档', 'grow-me', sessionId, 'task.manifest.json'), JSON.stringify({ chapters: [
        { id: 'a', title: '目标人群' }, { id: 'b', title: '评估维度' },
      ] }))
      const convert = () => invokeHandler<{ ok: boolean; created: Array<{ id: string }> }>('ipc:grow:convertToTeam', { workspaceId: ws, sessionId })
      const result = await Promise.all([convert(), convert()])
      expect(result.map((item) => item.created.length).sort()).toEqual([0, 2])
      expect((await convert()).created).toHaveLength(0)
    } finally { await rm(ws, { recursive: true, force: true }) }
  })

  it('retains dependency branches and marks downstream answers and the saved plan for review', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-branches-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws, requirement: '设计问卷' })
      const session = { workspaceId: ws, sessionId }
      const questions = [
        { id: 'a', question: '目标？', kind: 'text', depends_on: [], chapter_id: 'a' },
        { id: 'b', question: '进一步？', kind: 'text', depends_on: ['a'], chapter_id: 'a' },
        { id: 'c', question: '再次追问？', kind: 'text', depends_on: ['b'], chapter_id: 'a' },
        { id: 'd', question: '其他问题？', kind: 'text', depends_on: [], chapter_id: 'd' },
      ]
      expect(await invokeHandler('ipc:grow:putQuestions', { ...session, round: 1, questions })).toMatchObject({ ok: true })
      for (const nodeId of ['a', 'b', 'c', 'd']) await invokeHandler('ipc:grow:submitAnswer', { ...session, nodeId, action: 'answer', text: '原回答' })
      await writeFile(join(ws, '.文档', 'grow-me', sessionId, '方案.html'), '<h1>旧方案</h1>')
      await invokeHandler('ipc:grow:submitAnswer', { ...session, nodeId: 'a', action: 'answer', text: '新回答' })
      expect(await invokeHandler('ipc:grow:getState', session)).toMatchObject({ state: {
        requirement: '设计问卷', planStale: true, nodes: [
          { id: 'a', status: 'answered', depends_on: [] },
          { id: 'b', status: 'needs_review', answer: '原回答', depends_on: ['a'] },
          { id: 'c', status: 'needs_review', answer: '原回答', depends_on: ['b'] },
          { id: 'd', status: 'answered' },
        ],
      } })
      expect(await invokeHandler('ipc:grow:putQuestions', { ...session, round: 2, questions: [
        { id: 'bad', question: '错误引用', kind: 'text', depends_on: ['missing'] },
      ] })).toEqual({ ok: false, error: 'invalid_dependencies' })
    } finally { await rm(ws, { recursive: true, force: true }) }
  })

  it('validates values and cardinality against the saved question and preserves concurrent replies', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'pi-grow-choices-'))
    dirs.ws = ws
    try {
      registerGrowHandlers()
      const { sessionId } = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const session = { workspaceId: ws, sessionId }
      const questions = [
        { id: 'q1', question: '展示几个结果？', kind: 'single', options: ['一个', '三个'] },
        { id: 'q2', question: '覆盖哪些人群？', kind: 'multiple', options: ['应届生', '在职人群', '自由职业者'] },
        { id: 'q3', question: '还有什么限制？', kind: 'text' },
      ]
      const put = () => invokeHandler('ipc:grow:putQuestions', { ...session, round: 1, questions })
      const select = (nodeId: string, selectedOptions: string[], publishedFormat?: { kind: string; options: string[] }) => invokeHandler('ipc:grow:submitAnswer', {
        ...session, nodeId, selectedOptions, action: 'select', ...(publishedFormat && { publishedFormat }),
      })
      expect(await put()).toMatchObject({ ok: true, revision: 1 })
      for (const [id, options] of [
        ['q1', ['一个', '三个']], ['q1', ['五个']], ['q2', ['应届生', '应届生']], ['q3', ['一个']],
      ] as const) {
        expect(await select(id, [...options])).toEqual({ ok: false, error: 'invalid_selection' })
      }
      const legacyPath = join(ws, '.文档', 'grow-me', sessionId, 'tree.json')
      const savedNodes = questions.map((question) => ({
        ...question, kind: question.id === 'q2' ? undefined : question.kind, round: 1, status: 'pending',
      }))
      await writeFile(legacyPath, JSON.stringify({ session_id: sessionId, revision: 1, nodes: savedNodes }))
      expect(await invokeHandler('ipc:grow:getState', session)).toMatchObject({ state: { nodes: [
        { id: 'q1' }, { id: 'q2', options: ['应届生', '在职人群', '自由职业者'] }, { id: 'q3' },
      ] } })
      expect(await select('q2', ['其他'], { kind: 'multiple', options: ['应届生', '其他'] }))
        .toEqual({ ok: false, error: 'invalid_selection' })
      const [single, multiple] = await Promise.all([
        select('q1', ['三个']),
        select('q2', ['自由职业者', '应届生'], { kind: 'multiple', options: ['应届生', '在职人群', '自由职业者'] }),
      ])
      expect(single).toMatchObject({ ok: true, revision: 2, node: { status: 'answered', selectedOptions: ['三个'] } })
      expect(multiple).toMatchObject({ ok: true, revision: 3, node: { status: 'answered', answer: '应届生、自由职业者' } })
      expect(await put()).toMatchObject({ ok: true, revision: 4 })
      expect(await invokeHandler('ipc:grow:getState', session)).toMatchObject({ state: { nodes: [
        { id: 'q1', kind: 'single', answer: '三个', selectedOptions: ['三个'] },
        { id: 'q2', kind: 'multiple', answer: '应届生、自由职业者', selectedOptions: ['应届生', '自由职业者'] },
        { id: 'q3', kind: 'text', status: 'pending' },
      ] } })
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})

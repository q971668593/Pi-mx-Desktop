import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeGrowQuestionFormat, resolveGrowQuestionFormat } from '@shared/grow-question'
import type { GrowNodeStatus, GrowNodeView } from '@shared/ipc-contract'
import { canonicalTeamRole, isTeamRole } from '@shared/team-board'
import { GROW_DOC_TEMPLATE } from './grow-template'
import { registerHandlerWithSchema } from '../registry'
import {
  growBeginPlanSchema,
  growConvertToTeamSchema,
  growFinishPlanSchema,
  growGetStateSchema,
  growListSessionsSchema,
  growPutQuestionsSchema,
  growStartSessionSchema,
  growSubmitAnswerSchema,
  growWorkspaceSchema,
} from '../schemas'
import { createTeamTask, initTeamProject, readTeamSnapshot } from '../../team-board'
import { authorizeProjectCwd, authorizeTrustedSessionFile } from '../../trusted-workspace'
import { readGrowBinding, writeGrowBinding } from '../../grow-bindings'
import { withGrowProjectLock } from '../../grow-project-transaction'

interface GrowTreeNode extends GrowNodeView {
  rationale?: string
}

interface GrowTree {
  session_id: string
  revision: number
  current_round: number
  requirement: string
  plan_stale?: boolean
  nodes: GrowTreeNode[]
}

function newSessionId(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `g-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomUUID()}`
}

function isGrowNodeStatus(s: unknown): s is GrowNodeStatus {
  return s === 'pending' || s === 'answered' || s === 'needs_review' || s === 'deferred'
}

function normalizeTree(raw: unknown, fallbackId: string): GrowTree | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<GrowTree>
  if (!Array.isArray(t.nodes)) return null
  return {
    ...t,
    session_id: typeof t.session_id === 'string' && t.session_id ? t.session_id : fallbackId,
    revision: typeof t.revision === 'number' ? t.revision : 0,
    current_round: typeof t.current_round === 'number' ? t.current_round : 1,
    requirement: typeof t.requirement === 'string' ? t.requirement : '',
    plan_stale: t.plan_stale === true,
    nodes: (t.nodes as GrowTreeNode[]).filter((n) => n && typeof n.id === 'string').map((n) => ({
      ...n,
      ...normalizeGrowQuestionFormat(n.kind, n.options),
      id: n.id,
      question: typeof n.question === 'string' ? n.question : '',
      rationale: typeof n.rationale === 'string' ? n.rationale : undefined,
      status: isGrowNodeStatus(n.status) ? n.status : 'pending',
      answer: typeof n.answer === 'string' ? n.answer : undefined,
      selectedOptions: Array.isArray(n.selectedOptions) ? n.selectedOptions.filter((option) => typeof option === 'string') : undefined,
      round: typeof n.round === 'number' ? n.round : undefined,
      depends_on: Array.isArray(n.depends_on) ? n.depends_on.filter((id): id is string => typeof id === 'string' && !!id.trim()).slice(0, 8) : undefined,
      chapter_id: typeof n.chapter_id === 'string' ? n.chapter_id : undefined,
    })),
  }
}

function growDir(workspaceId: string): string {
  return join(workspaceId, '.文档', 'grow-me')
}

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    const text = await readFile(path, 'utf8')
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  } catch {
    return null
  }
}

const treeWrites = new Map<string, Promise<unknown>>()

async function serializeWrite<T>(file: string, update: () => Promise<T>): Promise<T> {
  const pending = treeWrites.get(file) ?? Promise.resolve()
  const write = pending.then(update, update)
  treeWrites.set(file, write)
  try {
    return await write
  } finally {
    if (treeWrites.get(file) === write) treeWrites.delete(file)
  }
}

async function updateTree<T>(workspace: string, file: string, update: () => Promise<T>): Promise<T> {
  return serializeWrite(file, () => withGrowProjectLock(workspace, update))
}

async function saveTree(file: string, tree: GrowTree): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(tree, null, 2), 'utf8')
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

interface GrowManifest {
  session_id?: string
  session?: string
  chapters?: Array<{ id: string; title: string; summary?: string; acceptance?: string[] }>
}

function manifestChapters(manifest: GrowManifest | null) {
  return Array.isArray(manifest?.chapters)
    ? manifest.chapters.filter((chapter) => typeof chapter?.id === 'string' && typeof chapter.title === 'string' && chapter.title.trim())
    : []
}

/** 找到最近更新的会话子目录（没有则回 null，调用方再兼容根 tree.json） */
async function findLatestSessionDir(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const candidates: Array<{ dirPath: string; mtime: number }> = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      const st = await stat(join(dir, e.name, 'tree.json'))
      candidates.push({ dirPath: join(dir, e.name), mtime: st.mtimeMs })
    } catch { /* skip */ }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.dirPath ?? null
}

async function readGrowSession(base: string, sessionId?: string) {
  let dir = sessionId ? join(base, sessionId) : base
  let tree = normalizeTree(await readJsonIfExists(join(dir, 'tree.json')), sessionId ?? '')
  if (!tree && !sessionId) {
    const latest = await findLatestSessionDir(base)
    if (latest) {
      dir = latest
      tree = normalizeTree(await readJsonIfExists(join(dir, 'tree.json')), '')
    }
  }
  return { dir, tree }
}

export function registerGrowHandlers(): void {
  registerHandlerWithSchema('ipc:grow:listSessions', growListSessionsSchema, async (request) => {
    const { workspaceId } = request
    if ('action' in request && (request.action === 'getBinding' || request.action === 'setBinding')) {
      const auth = await authorizeTrustedSessionFile(workspaceId, request.sessionFile)
      if (!auth.ok) return { ok: false as const, error: auth.error }
      try {
        if (request.action === 'setBinding') {
          const { tree } = await readGrowSession(growDir(auth.cwd), request.sessionId)
          if (!tree || tree.session_id !== request.sessionId) return { ok: false as const, error: 'no_session' }
          await writeGrowBinding(auth.cwd, auth.sessionFile, request.sessionId)
          return { ok: true as const, sessionId: request.sessionId }
        }
        return { ok: true as const, sessionId: await readGrowBinding(auth.cwd, auth.sessionFile) }
      } catch {
        return { ok: false as const, error: 'binding_failed' }
      }
    }
    const auth = authorizeProjectCwd(workspaceId)
    if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
    const base = growDir(auth.cwd)
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true as const, trees: [], unreadable: 0 }
      return { ok: false as const, error: 'read_failed' }
    }
    const trees: Array<{ sessionId: string; requirement: string; pendingCount: number; reviewCount: number; updatedAt: number }> = []
    let unreadable = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.name)) continue
      const file = join(base, entry.name, 'tree.json')
      try {
        const [content, metadata] = await Promise.all([readFile(file, 'utf8'), stat(file)])
        const tree = normalizeTree(JSON.parse(content.replace(/^\uFEFF/, '')), entry.name)
        if (!tree || tree.session_id !== entry.name) { unreadable++; continue }
        trees.push({ sessionId: entry.name, requirement: tree.requirement,
          pendingCount: tree.nodes.filter((node) => node.status === 'pending').length,
          reviewCount: tree.nodes.filter((node) => node.status === 'needs_review').length,
          updatedAt: metadata.mtimeMs })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++
      }
    }
    trees.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    return { ok: true as const, trees, unreadable }
  })

  registerHandlerWithSchema('ipc:grow:getState', growGetStateSchema, async ({ workspaceId, sessionId }) => {
    const auth = authorizeProjectCwd(workspaceId)
    if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
    const { dir, tree } = await readGrowSession(growDir(auth.cwd), sessionId)
    if (!tree) {
      return { ok: true as const, state: { ready: false, nodes: [], chapters: [], pendingCount: 0, reviewCount: 0 } }
    }
    const nodes = tree.nodes
    const pendingCount = nodes.filter((n) => n.status === 'pending').length
    const reviewCount = nodes.filter((n) => n.status === 'needs_review').length
    const manifest = (await readJsonIfExists(join(dir, 'task.manifest.json'))) as GrowManifest | null
    const chapters = manifestChapters(manifest).map(({ id, title }) => ({ id, title, ready: true }))
    const docFile = join(dir, '方案.html')
    const docExists = await stat(docFile).then((entry) => entry.isFile(), () => false)
    return {
      ok: true as const,
      state: {
        ready: true,
        sessionId: tree.session_id,
        requirement: tree.requirement,
        planStale: tree.plan_stale === true,
        revision: tree.revision ?? 0,
        currentRound: tree.current_round ?? 1,
        nodes,
        chapters,
        pendingCount,
        reviewCount,
        docFile: docExists ? docFile : null,
      },
    }
  })

  registerHandlerWithSchema(
    'ipc:grow:ensureDir',
    growWorkspaceSchema,
    async ({ workspaceId }) => {
      const auth = authorizeProjectCwd(workspaceId)
      if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
      const dir = growDir(auth.cwd)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '.gitkeep'), '', { flag: 'a' }).catch(() => {})
      return { ok: true as const, dir }
    },
  )

  /**
   * 果子一键转看板：把 task.manifest.json 的章节变成团队任务。
   * 看板没初始化就先按新建初始化；同一真相复用 createTeamTask，编号 T-xxx 自动递增。
   */
  registerHandlerWithSchema(
    'ipc:grow:convertToTeam',
    growConvertToTeamSchema,
    async ({ workspaceId, role, sessionId }) => {
      const auth = authorizeProjectCwd(workspaceId)
      if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
      const cwd = auth.cwd
      const { dir } = await readGrowSession(growDir(cwd), sessionId)
      return serializeWrite(join(cwd, '.文档', '开发规范', '看板', '当前批次.md'), () => updateTree(cwd, join(dir, 'tree.json'), async () => {
      const tree = normalizeTree(await readJsonIfExists(join(dir, 'tree.json')), sessionId ?? '')
      const manifest = tree ? (await readJsonIfExists(join(dir, 'task.manifest.json'))) as GrowManifest | null : null
      const chapters = manifestChapters(manifest)
      if (chapters.length === 0) return { ok: false as const, error: 'no_chapters' }
      if (tree?.plan_stale || tree?.nodes.some((node) => node.status === 'needs_review')) return { ok: false as const, error: 'plan_stale' }
      const canonical = role ? canonicalTeamRole(role) : 'Leader'
      const taskRole = isTeamRole(canonical) ? canonical : 'Leader'
      try {
        initTeamProject(cwd, { mode: 'new' })
      } catch (err) {
        // 已初始化就继续；其他错误直接抛给调用方
        if (!/已初始化看板/.test(String((err as Error)?.message ?? err))) throw err
      }
      const created: Array<{ id: string; title: string }> = []
      const sourceSession = tree?.session_id ?? sessionId ?? manifest?.session_id ?? manifest?.session
      if (!sourceSession) return { ok: false as const, error: 'no_session' }
      const existing = readTeamSnapshot(cwd).tasks
      for (const chapter of chapters) {
        const marker = `需求树果子转入（grow-me/${sourceSession}·${chapter.id}）`
        if (existing.some((task) => task.note === marker)) continue
        const title = chapter.title.trim().slice(0, 200)
        const acceptance = Array.isArray(chapter.acceptance)
          ? chapter.acceptance.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim().slice(0, 300)).slice(0, 20)
          : []
        const summary = typeof chapter.summary === 'string' ? chapter.summary.trim().slice(0, 2000) : ''
        const snapshot = createTeamTask(cwd, {
          title,
          role: taskRole,
          output: summary || `需求果子${chapter.id}：${title}`,
          note: marker,
          acceptance,
        })
        const last = snapshot.tasks[snapshot.tasks.length - 1]
        if (last) created.push({ id: last.id, title: last.title })
      }
      return { ok: true as const, created }
      }))
    },
  )

  /**
   * 开场：建会话目录 + 空 tree.json。题目由智能体按访谈协议逐轮写入（grow:putQuestions）。
   */
  registerHandlerWithSchema(
    'ipc:grow:startSession',
    growStartSessionSchema,
    async ({ workspaceId, requirement }) => {
      const auth = authorizeProjectCwd(workspaceId)
      if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
      const sessionId = newSessionId()
      const dir = join(growDir(auth.cwd), sessionId)
      await mkdir(growDir(auth.cwd), { recursive: true })
      await mkdir(dir)
      const tree: GrowTree = {
        session_id: sessionId,
        revision: 0,
        current_round: 1,
        requirement: (requirement ?? '').trim().slice(0, 4000),
        nodes: [],
      }
      await writeFile(join(dir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf8')
      // 方案样式模板：智能体收尾时照着填，不自创样式
      await writeFile(join(dir, '_模板.html'), GROW_DOC_TEMPLATE, 'utf8')
      return { ok: true as const, sessionId, revision: 0 }
    },
  )

  registerHandlerWithSchema('ipc:grow:beginPlan', growBeginPlanSchema, async ({ workspaceId, sessionId }) => {
    const auth = authorizeProjectCwd(workspaceId)
    if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
    const file = join(growDir(auth.cwd), sessionId, 'tree.json')
    return updateTree(auth.cwd, file, async () => {
      const tree = normalizeTree(await readJsonIfExists(file), sessionId)
      if (!tree) return { ok: false as const, error: 'no_session' }
      tree.plan_stale = true
      tree.revision += 1
      await saveTree(file, tree)
      return { ok: true as const, revision: tree.revision }
    })
  })

  registerHandlerWithSchema('ipc:grow:finishPlan', growFinishPlanSchema, async ({ workspaceId, sessionId, expectedRevision }) => {
    const auth = authorizeProjectCwd(workspaceId)
    if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
    const dir = join(growDir(auth.cwd), sessionId)
    const file = join(dir, 'tree.json')
    return updateTree(auth.cwd, file, async () => {
      const tree = normalizeTree(await readJsonIfExists(file), sessionId)
      if (!tree) return { ok: false as const, error: 'no_session' }
      if (tree.revision !== expectedRevision) return { ok: false as const, error: 'revision_conflict', revision: tree.revision }
      if (tree.nodes.some((node) => node.status === 'needs_review')) return { ok: false as const, error: 'needs_review' }
      const docExists = await stat(join(dir, '方案.html')).then((entry) => entry.isFile(), () => false)
      if (!docExists) return { ok: false as const, error: 'no_plan' }
      const manifest = await readJsonIfExists(join(dir, 'task.manifest.json')) as GrowManifest | null
      const chapters = manifestChapters(manifest)
      if (!Array.isArray(manifest?.chapters) || !chapters.length || chapters.length !== manifest.chapters.length || chapters.some((chapter) => !chapter.id.trim())) {
        return { ok: false as const, error: 'invalid_manifest' }
      }
      if (tree.plan_stale) {
        tree.plan_stale = false
        await saveTree(file, tree)
      }
      return { ok: true as const, revision: tree.revision }
    })
  })

  /**
   * 智能体写入一轮题目（3-5 题）。同轮覆盖写入，revision+1。
   */
  registerHandlerWithSchema(
    'ipc:grow:putQuestions',
    growPutQuestionsSchema,
    async ({ workspaceId, sessionId, round, questions, expectedRevision }) => {
      const auth = authorizeProjectCwd(workspaceId)
      if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
      const file = join(growDir(auth.cwd), sessionId, 'tree.json')
      return updateTree(auth.cwd, file, async () => {
        const tree = normalizeTree(await readJsonIfExists(file), sessionId)
        if (!tree) return { ok: false as const, error: 'no_session' }
        if (expectedRevision !== undefined && tree.revision !== expectedRevision) return { ok: false as const, error: 'revision_conflict', revision: tree.revision }
        const ids = questions.map((question) => question.id.trim())
        if (new Set(ids).size !== ids.length || new Set(tree.nodes.map((node) => node.id)).size !== tree.nodes.length) {
          return { ok: false as const, error: 'duplicate_id' }
        }
        const keep = new Map(tree.nodes.map((node) => [node.id, node]))
        for (const question of questions) {
          const previous = keep.get(question.id.trim())
          if (previous && previous.round !== undefined && previous.round !== round) return { ok: false as const, error: 'duplicate_id' }
          if (previous && previous.status !== 'pending' && (previous.question !== question.question.trim() ||
              (question.kind !== undefined && question.kind !== previous.kind) ||
              (question.options !== undefined && JSON.stringify(question.options) !== JSON.stringify(previous.options)))) {
            return { ok: false as const, error: 'answered_question_conflict' }
          }
        }
        const incoming: GrowTreeNode[] = questions.map((question) => {
          const id = question.id.trim()
          const previous = keep.get(id)
          const format = question.kind === undefined
            ? { kind: previous?.kind, options: previous?.options }
            : normalizeGrowQuestionFormat(question.kind, question.options)
          return {
            ...previous,
            ...format,
            options: format.kind ? format.options : previous?.options,
            id,
            question: question.question.trim(),
            rationale: question.rationale?.trim() || undefined,
            depends_on: question.depends_on ?? previous?.depends_on,
            chapter_id: question.chapter_id ?? previous?.chapter_id,
            status: previous?.status ?? 'pending',
            round,
          }
        })
        const replaced = new Set(incoming.map((node) => node.id))
        const combined = [...tree.nodes.filter((node) => !replaced.has(node.id)), ...incoming]
        const byId = new Map(combined.map((node) => [node.id, node]))
        if (byId.size !== combined.length) return { ok: false as const, error: 'invalid_dependencies' }
        const visited = new Set<string>()
        const visiting = new Set<string>()
        const valid = (id: string): boolean => {
          if (visiting.has(id)) return false
          if (visited.has(id)) return true
          const item = byId.get(id)
          if (!item) return false
          visiting.add(id)
          for (const dependency of item.depends_on ?? []) if (!valid(dependency)) return false
          visiting.delete(id)
          visited.add(id)
          return true
        }
        if (!combined.every((item) => valid(item.id))) return { ok: false as const, error: 'invalid_dependencies' }
        const affected = new Set(incoming.filter((node) => {
          const previous = keep.get(node.id)
          return previous && JSON.stringify([previous.question, previous.kind, previous.options, previous.depends_on]) !==
            JSON.stringify([node.question, node.kind, node.options, node.depends_on])
        }).map((node) => node.id))
        let expanded = true
        while (expanded) {
          expanded = false
          for (const node of combined) {
            if (!affected.has(node.id) && node.depends_on?.some((id) => affected.has(id))) {
              affected.add(node.id)
              expanded = true
            }
          }
        }
        for (const node of combined) {
          if (affected.has(node.id) && (node.status === 'answered' || node.status === 'deferred')) node.status = 'needs_review'
        }
        tree.nodes = combined
        tree.current_round = round
        if (await stat(join(growDir(auth.cwd), sessionId, '方案.html')).then((entry) => entry.isFile(), () => false)) tree.plan_stale = true
        tree.revision += 1
        await saveTree(file, tree)
        return { ok: true as const, revision: tree.revision, count: incoming.length }
      })
    },
  )

  /**
   * 用户提交选项、文字回复，或标记稍后答和待解释。
   */
  registerHandlerWithSchema(
    'ipc:grow:submitAnswer',
    growSubmitAnswerSchema,
    async ({ workspaceId, sessionId, nodeId, action, text, selectedOptions, publishedFormat }) => {
      const auth = authorizeProjectCwd(workspaceId)
      if (!auth.ok) return { ok: false as const, error: 'unauthorized' }
      const file = join(growDir(auth.cwd), sessionId, 'tree.json')
      return updateTree(auth.cwd, file, async () => {
        const tree = normalizeTree(await readJsonIfExists(file), sessionId)
        if (!tree) return { ok: false as const, error: 'no_session' }
        const node = tree.nodes.find((n) => n.id === nodeId)
        if (!node) return { ok: false as const, error: 'no_node' }
        const answer = (text ?? '').trim()
        const previousAnswer = JSON.stringify([node.status, node.answer, node.selectedOptions])
        if (action === 'select') {
          const { kind, options } = resolveGrowQuestionFormat(node, publishedFormat ?? {})
          if ((kind !== 'single' && kind !== 'multiple') || !options || !selectedOptions?.length ||
              (kind === 'single' && selectedOptions.length !== 1)) {
            return { ok: false as const, error: 'invalid_selection' }
          }
          const selected = options.filter((option) => selectedOptions.includes(option))
          if (selected.length !== selectedOptions.length) return { ok: false as const, error: 'invalid_selection' }
          node.kind = kind
          node.options = options
          node.status = 'answered'
          node.selectedOptions = selected
          node.answer = selected.join('、')
        } else if (action === 'answer' || action === 'confirm') {
          if (!answer) return { ok: false as const, error: 'empty_answer' }
          node.status = 'answered'
          node.answer = answer
          node.selectedOptions = undefined
        } else {
          node.status = action === 'defer' ? 'deferred' : 'needs_review'
          if (action === 'unclear' && answer) node.answer = answer
        }
        const changed = previousAnswer !== JSON.stringify([node.status, node.answer, node.selectedOptions])
        if (changed) {
          const affected = new Set([node.id])
          let expanded = true
          while (expanded) {
            expanded = false
            for (const child of tree.nodes) {
              if (!affected.has(child.id) && child.depends_on?.some((id) => affected.has(id))) {
                affected.add(child.id)
                if (child.status === 'answered' || child.status === 'deferred') child.status = 'needs_review'
                expanded = true
              }
            }
          }
          if (await stat(join(growDir(auth.cwd), sessionId, '方案.html')).then((entry) => entry.isFile(), () => false)) tree.plan_stale = true
        }
        tree.revision += 1
        await saveTree(file, tree)
        return { ok: true as const, revision: tree.revision, node }
      })
    },
  )
}

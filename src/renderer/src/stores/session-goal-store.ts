import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { SessionGoal } from '@shared/session-goal'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * 目标条的渲染层状态（唯一事实源仍是主进程的 session-goals.json）。
 *
 * 这里只做三件事：跟着当前会话拉取目标、把编辑动作转成 IPC、把自动循环读到的
 * remaining 变化反映到 UI。任何写操作都以主进程返回的 goal 为准，不做本地乐观合并——
 * 目标一旦和磁盘不一致，注入给模型的 system prompt 就会和用户看到的条不一致。
 */
type SessionGoalState = {
  /** 已绑定的会话（规范化后）；null = 没有会话，目标条不出现 */
  sessionFile: string | null
  goal: SessionGoal | null
  loading: boolean
  autoRun: Record<string, number>
  setAutoRun: (sessionFile: string, enabled: boolean) => void
  /** 最近一次 IPC 失败的原因（UI 只读，不弹窗轰炸） */
  error: string | null
  load: (sessionFile: string | null) => Promise<void>
  setGoal: (goal: string, criteria?: string[]) => Promise<SessionGoal | null>
  toggleCriterion: (index: number) => Promise<SessionGoal | null>
  markCriteriaDone: (indices: number[]) => Promise<SessionGoal | null>
  clear: () => Promise<boolean>
  /** 供自动循环/跨窗口同步直接写入（不再往返 IPC） */
  applyGoal: (goal: SessionGoal | null) => void
}

function keyOf(sessionFile: string | null): string | null {
  if (!sessionFile) return null
  return normalizeSessionFileKey(sessionFile) || sessionFile
}

export const useSessionGoalStore = create<SessionGoalState>((set, get) => {
  /** 只有仍是同一个会话时才写回，避免切会话时的迟到响应覆盖当前会话。 */
  const sameSession = (requested: string | null): boolean => get().sessionFile === requested
  let autoRunVersion = 0

  const invokeGoalMutation = async (
    channel: string,
    key: string,
    request: Record<string, unknown>,
  ): Promise<SessionGoal | null> => {
    try {
      const response = (await ipcClient.invoke(channel, request)) as { goal?: SessionGoal | null } | null
      const goal = response?.goal ?? null
      if (!sameSession(key)) return goal
      set({ goal, error: null })
      return goal
    } catch (error) {
      console.warn(`[SessionGoal] ${channel} failed:`, error)
      set({ error: String((error as Error)?.message ?? error) })
      return null
    }
  }

  return {
    sessionFile: null,
    goal: null,
    loading: false,
    error: null,
    autoRun: {},
    setAutoRun: (sessionFile, enabled) => {
      const key = keyOf(sessionFile)
      if (!key) return
      set((state) => {
        const autoRun = { ...state.autoRun }
        if (enabled) autoRun[key] = ++autoRunVersion
        else delete autoRun[key]
        return { autoRun }
      })
    },

    load: async (sessionFile) => {
      const key = keyOf(sessionFile)
      if (!key) {
        set({ sessionFile: null, goal: null, loading: false, error: null })
        return
      }
      const switched = get().sessionFile !== key
      set({ sessionFile: key, loading: true, ...(switched ? { goal: null, error: null } : {}) })
      try {
        const response = (await ipcClient.invoke('sessionGoal.get', { sessionFile: key })) as
          | { goal?: SessionGoal | null }
          | null
        if (!sameSession(key)) return
        set({ goal: response?.goal ?? null, loading: false, error: null })
      } catch (error) {
        if (!sameSession(key)) return
        set({ loading: false, error: String((error as Error)?.message ?? error) })
      }
    },

    setGoal: async (goal, criteria) => {
      const key = get().sessionFile
      if (!key) return null
      get().setAutoRun(key, false)
      const request: Record<string, unknown> = { sessionFile: key, goal }
      if (criteria !== undefined) request.criteria = criteria
      return invokeGoalMutation('sessionGoal.set', key, request)
    },

    toggleCriterion: async (index) => {
      const key = get().sessionFile
      if (!key) return null
      return invokeGoalMutation('sessionGoal.toggleCriterion', key, { sessionFile: key, index })
    },

    markCriteriaDone: async (indices) => {
      const key = get().sessionFile
      if (!key || indices.length === 0) return get().goal
      return invokeGoalMutation('sessionGoal.markDone', key, { sessionFile: key, indices })
    },

    clear: async () => {
      const key = get().sessionFile
      if (!key) return false
      get().setAutoRun(key, false)
      try {
        const response = (await ipcClient.invoke('sessionGoal.clear', { sessionFile: key })) as
          | { cleared?: boolean }
          | null
        if (sameSession(key)) set({ goal: null, error: null })
        return response?.cleared === true
      } catch (error) {
        console.warn('[SessionGoal] clear failed:', error)
        set({ error: String((error as Error)?.message ?? error) })
        return false
      }
    },

    applyGoal: (goal) => set({ goal }),
  }
})

/** 目标条当前剩多少项没达成（0 = 达成；没有目标也返回 0）。 */
export function useGoalRemaining(): number {
  return useSessionGoalStore((state) =>
    state.goal ? state.goal.criteria.filter((criterion) => !criterion.done).length : 0,
  )
}

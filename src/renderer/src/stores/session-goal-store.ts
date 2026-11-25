import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { GoalStopReason, SessionGoal } from '@shared/session-goal'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * 目标条的渲染层状态（唯一事实源仍是主进程的 session-goals.json）。
 *
 * 这里只做三件事：跟着当前会话拉取目标、把编辑动作转成 IPC、把自动循环读到的
 * remaining 变化反映到 UI。任何写操作都以主进程返回的 goal 为准，不做本地乐观合并——
 * 目标一旦和磁盘不一致，注入给模型的 system prompt 就会和用户看到的条不一致。
 *
 * 「自动推进开着没有」现在跟着目标一起落盘（goal.autoRun），所以这里只是一份镜像：
 * 重启、切会话、热更新之后 autoRun 会从主进程重新拉回来，不会像以前那样一重启就
 * 变成「开着还是关着」谁也说不清。
 */
type SessionGoalState = {
  /** 已绑定的会话（规范化后）；null = 没有会话，目标条不出现 */
  sessionFile: string | null
  goal: SessionGoal | null
  loading: boolean
  /** 自动推进的本地代次：值是递增版本号，用来让自动循环丢弃过期的一轮。 */
  autoRun: Record<string, number>
  setAutoRun: (sessionFile: string, enabled: boolean, stopReason?: GoalStopReason) => void
  /** 最近一次 IPC 失败的原因（UI 只读，不弹窗轰炸） */
  error: string | null
  /**
   * 「开始自动推进」没发出去的原因（例：会话唤醒失败）。
   * 目标条据此提示一句，总比按钮点下去毫无反应强。
   */
  startBlocked: string | null
  clearStartBlocked: () => void
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

  /**
   * 主进程是「开没开」的唯一事实源：每次拿到 goal 都把本地代次对齐，
   * 这样重启后目标还开着就继续跑，用户按过暂停就保持暂停。
   */
  const syncAutoRun = (key: string, goal: SessionGoal | null): Record<string, number> => {
    const autoRun = { ...get().autoRun }
    if (goal?.autoRun === true) {
      if (autoRun[key] === undefined) autoRun[key] = ++autoRunVersion
    } else {
      delete autoRun[key]
    }
    return autoRun
  }

  const invokeGoalMutation = async (
    channel: string,
    key: string,
    request: Record<string, unknown>,
  ): Promise<SessionGoal | null> => {
    try {
      const response = (await ipcClient.invoke(channel, request)) as { goal?: SessionGoal | null } | null
      const goal = response?.goal ?? null
      if (!sameSession(key)) return goal
      set({ goal, error: null, autoRun: syncAutoRun(key, goal) })
      return goal
    } catch (error) {
      console.warn(`[SessionGoal] ${channel} failed:`, error)
      set({ error: String((error as Error)?.message ?? error) })
      return null
    }
  }

  /** 把「开始/暂停」同步到主进程（落盘），失败只记错误，不回滚本地观感。 */
  const persistAutoRun = (key: string, enabled: boolean, stopReason?: GoalStopReason): void => {
    void ipcClient
      .invoke('sessionGoal.setAutoRun', {
        sessionFile: key,
        enabled,
        ...(stopReason ? { stopReason } : {}),
      })
      .then((response) => {
        const payload = response as
          | { goal?: SessionGoal | null; started?: boolean; reason?: string }
          | null
        const goal = payload?.goal ?? null
        if (!sameSession(key)) return
        // 开着但这一轮没发出去（会话唤醒失败）：把原因留住，UI 才有的显示。
        const blocked = enabled && payload?.started === false && payload?.reason ? payload.reason : null
        set({
          goal,
          error: null,
          startBlocked: blocked,
          autoRun: syncAutoRun(key, goal),
        })
      })
      .catch((error) => {
        console.warn('[SessionGoal] setAutoRun failed:', error)
        set({ error: String((error as Error)?.message ?? error) })
      })
  }

  return {
    sessionFile: null,
    goal: null,
    loading: false,
    error: null,
    startBlocked: null,
    autoRun: {},
    clearStartBlocked: () => set({ startBlocked: null }),
    /**
     * 开关是**本地先动**：用户点暂停要立刻生效（自动循环马上停手），落盘在后台跟上。
     * 主进程回包后再用磁盘值校正一次，两边最终一致。
     */
    setAutoRun: (sessionFile, enabled, stopReason) => {
      const key = keyOf(sessionFile)
      if (!key) return
      set((state) => {
        const autoRun = { ...state.autoRun }
        if (enabled) autoRun[key] = ++autoRunVersion
        else delete autoRun[key]
        return { autoRun, startBlocked: null }
      })
      persistAutoRun(key, enabled, stopReason)
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
        const goal = response?.goal ?? null
        set({ goal, loading: false, error: null, autoRun: syncAutoRun(key, goal) })
      } catch (error) {
        if (!sameSession(key)) return
        set({ loading: false, error: String((error as Error)?.message ?? error) })
      }
    },

    setGoal: async (goal, criteria) => {
      const key = get().sessionFile
      if (!key) return null
      // 改目标 = 换了一个要推进的东西，旧的制动计数不再适用，顺手把自动推进关掉：
      // 用户改完目标通常想先看一眼，再自己按开始。
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
        if (sameSession(key)) {
          set((state) => {
            const autoRun = { ...state.autoRun }
            delete autoRun[key]
            return { goal: null, error: null, autoRun }
          })
        }
        return response?.cleared === true
      } catch (error) {
        console.warn('[SessionGoal] clear failed:', error)
        set({ error: String((error as Error)?.message ?? error) })
        return false
      }
    },

    applyGoal: (goal) => {
      const key = get().sessionFile
      set({ goal, ...(key ? { autoRun: syncAutoRun(key, goal) } : {}) })
    },
  }
})

/** 目标条当前剩多少项没达成（0 = 达成；没有目标也返回 0）。 */
export function useGoalRemaining(): number {
  return useSessionGoalStore((state) =>
    state.goal ? state.goal.criteria.filter((criterion) => !criterion.done).length : 0,
  )
}

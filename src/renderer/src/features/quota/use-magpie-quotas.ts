import { useCallback, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'
import type { MagpieQuotaEntry, MagpieQuotasResponse } from '@shared/ipc-contract'

const WANT = new Set(['codex', 'opencode-go'])

export interface UseMagpieQuotasResult {
  entries: MagpieQuotaEntry[]
  codex?: MagpieQuotaEntry
  opencode?: MagpieQuotaEntry
  error: string | null
  refresh: () => void
}

/** 只取 codex（GPT）与 opencode-go（opencode）两条；popover 打开时 5s 轮询，否则 30s。 */
export function useMagpieQuotas(fast: boolean): UseMagpieQuotasResult {
  const [entries, setEntries] = useState<MagpieQuotaEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = (await ipcClient.invoke('magpie.quotas', {})) as MagpieQuotasResponse
      if (!res || !res.ok) {
        setError(res?.error || 'load-failed')
        return
      }
      const list = Array.isArray(res.data) ? res.data.filter((e) => WANT.has(e.provider)) : []
      setEntries(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load-failed')
    }
  }, [])

  useVisibleInterval(() => void refresh(), fast ? 5_000 : 30_000)

  const codex = entries.find((e) => e.provider === 'codex')
  const opencode = entries.find((e) => e.provider === 'opencode-go')
  return { entries, codex, opencode, error, refresh }
}

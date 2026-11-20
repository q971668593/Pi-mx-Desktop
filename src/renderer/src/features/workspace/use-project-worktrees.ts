import { useEffect, useRef, useState } from 'react'
import type { GitWorktreeList } from '@shared/git-worktree'
import { workspacePathKey } from '@shared/workspace-path'
import { ipcClient } from '@renderer/lib/ipc-client'

export function useProjectWorktrees(paths: string[]) {
  const [listings, setListings] = useState<GitWorktreeList[]>([])
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(() => new Set())
  const [revision, setRevision] = useState(0)
  const signature = JSON.stringify([...paths].sort((a, b) => workspacePathKey(a).localeCompare(workspacePathKey(b))))

  useEffect(() => {
    let cancelled = false
    const requested: string[] = JSON.parse(signature)
    setLoading(true)
    void (async () => {
      const covered = new Set<string>()
      const next: GitWorktreeList[] = []
      const failedPaths = new Set<string>()
      const missing = new Set<string>()
      let didFail = false
      for (const path of requested) {
        if (covered.has(workspacePathKey(path))) continue
        try {
          const result: GitWorktreeList = await ipcClient.invoke('desktop.gitWorktrees', { workspaceId: path })
          if (cancelled) return
          if (result.missing) missing.add(workspacePathKey(path))
          if (result.ok === false) {
            didFail = true
            failedPaths.add(workspacePathKey(path))
          }
          if (result.repositoryPath && result.trees?.length) {
            next.push(result)
            for (const tree of result.trees) covered.add(workspacePathKey(tree.path))
          }
        } catch {
          if (cancelled) return
          didFail = true
          failedPaths.add(workspacePathKey(path))
        }
      }
      if (!cancelled) {
        setListings((previous) => [...next, ...previous.filter((listing) =>
          listing.trees.some((tree) => failedPaths.has(workspacePathKey(tree.path)))
          && !next.some((fresh) => workspacePathKey(fresh.repositoryPath) === workspacePathKey(listing.repositoryPath)),
        )])
        setFailed(didFail)
        setMissingPaths(missing)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [signature, revision])

  /**
   * 路径读不到的项目会被从侧栏收起（避免把已删除的检出算成项目），但「读不到」经常是暂时的：
   * 外接盘/网络盘未挂载、WSL 分发版还没启动。以前收起后就再也不重试，用户看到的就是
   * 「项目莫名消失」。这里自动重探几次 + 窗口重新获焦时重探，并保留手动重新检测入口。
   */
  const autoRetryRef = useRef(0)
  useEffect(() => {
    if (missingPaths.size === 0) {
      autoRetryRef.current = 0
      return
    }
    if (autoRetryRef.current >= 3) return
    const delay = 8000 * (autoRetryRef.current + 1)
    const timer = setTimeout(() => {
      autoRetryRef.current += 1
      setRevision((value) => value + 1)
    }, delay)
    return () => clearTimeout(timer)
  }, [missingPaths])

  useEffect(() => {
    if (missingPaths.size === 0) return
    const onFocus = () => {
      autoRetryRef.current = 0
      setRevision((value) => value + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [missingPaths])

  const refresh = () => {
    autoRetryRef.current = 0
    setRevision((value) => value + 1)
  }

  return { listings, missingPaths, failed, loading, refresh }
}

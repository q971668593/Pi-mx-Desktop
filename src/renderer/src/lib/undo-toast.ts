import { toast } from 'sonner'

/**
 * 可撤销的破坏性操作：先执行，再给 5 秒「撤销」。
 *
 * 确认弹窗只留给真正不可逆的动作（删文件、丢弃未提交改动）；能撤回的（删对话、清目标、
 * 移除项目）一律走这里，少一次打断，也给手滑留退路。
 */
export function withUndo(opts: {
  message: string
  undoLabel: string
  onUndo: () => void | Promise<void>
  /** 撤销窗口，默认 5 秒（够看清、又不挡事）。 */
  durationMs?: number
  /** 撤销之后给一句反馈，让用户知道真的回来了。 */
  doneMessage?: string
}): void {
  toast.success(opts.message, {
    duration: opts.durationMs ?? 5000,
    action: {
      label: opts.undoLabel,
      onClick: () => {
        void Promise.resolve()
          .then(opts.onUndo)
          .then(() => {
            if (opts.doneMessage) toast.success(opts.doneMessage)
          })
          .catch(() => toast.error(opts.message))
      },
    },
  })
}

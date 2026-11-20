import i18n from '@renderer/lib/i18n'
import { toast } from 'sonner'
import { respondToExtensionUI } from '@renderer/lib/extension-ui-respond'
import {
  clearExtensionToolRowFlags,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { QuestionnaireAnswer } from './questionnaire-model'

/** 交互请求对应的工具行（行内小卡、挂起提示都挂在它上面）。 */
export function findToolContextForUi(): { toolCallId?: string; toolName?: string; timelineItemId?: string } {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolPhase === 'start' || it.toolPhase === 'update') {
      return {
        toolCallId: it.toolCallId,
        toolName: it.toolName,
        timelineItemId: it.id,
      }
    }
  }
  const suspended = useExtensionUIStore.getState().suspended
  if (suspended?.timelineItemId) {
    return {
      toolCallId: suspended.toolCallId,
      toolName: suspended.toolName,
      timelineItemId: suspended.timelineItemId,
    }
  }
  return {}
}

/** 收起到时间线工具行，Worker 那边继续等（不 respond）。 */
export function suspendActiveDialog(): string | undefined {
  const meta = findToolContextForUi()
  useExtensionUIStore.getState().suspendActive(meta)
  const { timelineItemId } = meta
  if (timelineItemId) {
    useUIStore.getState().updateTimelineItem(timelineItemId, {
      extensionUiSuspended: true,
      toolStatusLine: i18n.t('extension:waitingAnswer'),
    })
  }
  toast.message(i18n.t('extension:suspendedToast'))
  return timelineItemId
}

/** 提交问答答案：清掉工具行标记，再让 Worker 继续。 */
export function answerQuestionnaire(id: string, answers: QuestionnaireAnswer[]): void {
  const tid = findToolContextForUi().timelineItemId
  respondToExtensionUI({ id, result: { cancelled: false, answers } })
  clearExtensionToolRowFlags(tid)
  useExtensionUIStore.getState().clearAfterRespond()
}

/** 明确放弃：通知扩展取消，并把交互工具行收尾，避免一直转圈。 */
export function cancelQuestionnaire(id: string): void {
  const tid = findToolContextForUi().timelineItemId
  respondToExtensionUI({ id, cancelled: true })
  clearExtensionToolRowFlags(tid)
  useExtensionUIStore.getState().clearAfterRespond()
  reconcileStaleInteractiveToolRows(id)
}

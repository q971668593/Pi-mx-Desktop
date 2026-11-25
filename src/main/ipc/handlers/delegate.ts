import { registerHandlerWithSchema } from '../registry'
import { delegateSessionFilesSchema } from '../schemas'
import { resolveDelegateSessionFiles } from '../../delegate-sessions'

/**
 * 子 Agent（acp_delegate）的会话文件解析：
 * 工具结果只带 runId，渲染层拿不到宿主进程的 temp 目录，这里替它补上路径。
 */
export function registerDelegateHandlers(): void {
  registerHandlerWithSchema('ipc:delegate.sessionFiles', delegateSessionFilesSchema, async (request) => ({
    files: resolveDelegateSessionFiles(request.runIds),
  }))
}

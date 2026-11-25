import { invokeHandler } from './ipc/registry'

/** Route through the renderer's validated handlers, using only the worker slot's cwd. */
export async function handleGrowToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string },
  post: (message: Record<string, unknown>) => void,
): Promise<void> {
  const callId = typeof data.callId === 'string' ? data.callId : ''
  if (!callId) return
  const reply = (value: unknown, isError = false) => post({
    type: 'grow-tool-response', callId,
    result: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) },
  })
  try {
    const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args) ? data.args as Record<string, unknown> : {}
    const { action, ...payload } = args
    const channels: Record<string, string> = { get_state: 'ipc:grow:getState', put_questions: 'ipc:grow:putQuestions', begin_plan: 'ipc:grow:beginPlan', finish_plan: 'ipc:grow:finishPlan', get_prd_context: 'ipc:grow-prd:projectContext' }
    if (typeof action !== 'string' || !Object.hasOwn(channels, action)) return reply('Unknown grow_tree action', true)
    // workspaceId is deliberately overwritten; the model never chooses the project.
    const result = await invokeHandler<{ ok: boolean }>(channels[action], { ...payload, workspaceId: slot.cwd })
    reply(result, !result.ok)
  } catch (error) {
    reply(String((error as Error)?.message ?? error), true)
  }
}

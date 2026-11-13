import { app } from 'electron'
import { contentText, type AssistantMessage, type Context } from '@earendil-works/pi-ai'
import { getActiveSdkModule } from './ipc/sdk-session'
import { configStore } from './config-store'

export type PluginModelSelection = { provider: string; modelId: string; thinkingLevel?: import('@shared/model-thinking-levels').ModelThinkingLevel } | null

export function normalizePluginModel(raw: unknown): PluginModelSelection {
  if (!raw || typeof raw !== 'object') return null
  const provider = (raw as { provider?: unknown }).provider
  const modelId = (raw as { modelId?: unknown }).modelId
  if (typeof provider !== 'string' || typeof modelId !== 'string') return null
  const cleanProvider = provider.trim()
  const cleanModel = modelId.trim()
  const level = (raw as { thinkingLevel?: unknown }).thinkingLevel
  const thinkingLevel = typeof level === 'string' && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level) ? level as NonNullable<PluginModelSelection>['thinkingLevel'] : undefined
  return cleanProvider && cleanModel ? { provider: cleanProvider, modelId: cleanModel, ...(thinkingLevel ? { thinkingLevel } : {}) } : null
}

export function assistantText(message: AssistantMessage): string {
  return contentText(message.content).trim()
}

export async function completeWithPluginModel(input: {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}): Promise<{ ok: true; text: string } | { ok: false; error: 'plugin_model_missing' | 'plugin_model_unavailable' | 'plugin_model_failed'; detail?: string }> {
  const selected = normalizePluginModel(configStore.get('pluginModel'))
  if (!selected) return { ok: false, error: 'plugin_model_missing' }
  const sdk = await getActiveSdkModule(app.getPath('userData')) as {
    ModelRuntime?: { create?: (options?: { refreshOnCreate?: boolean }) => Promise<{ getModel: (provider: string, id: string) => unknown; completeSimple: (model: unknown, context: Context, options?: { maxTokens?: number; temperature?: number; reasoning?: Exclude<NonNullable<PluginModelSelection>['thinkingLevel'], 'off'> }) => Promise<AssistantMessage> }> }
  }
  if (typeof sdk.ModelRuntime?.create !== 'function') return { ok: false, error: 'plugin_model_unavailable' }
  const runtime = await sdk.ModelRuntime.create({ refreshOnCreate: false })
  const model = runtime.getModel(selected.provider, selected.modelId)
  if (!model) return { ok: false, error: 'plugin_model_unavailable' }
  const modelLimit = Number((model as { maxTokens?: unknown }).maxTokens)
  const requestedTokens = input.maxTokens ?? 2500
  const context: Context = {
    systemPrompt: input.system,
    messages: [
      { role: 'user', content: [{ type: 'text', text: input.user }], timestamp: Date.now() },
    ],
  }
  const message = await runtime.completeSimple(model, context, {
    maxTokens: Number.isFinite(modelLimit) && modelLimit > 0 ? Math.min(requestedTokens, modelLimit) : requestedTokens,
    temperature: input.temperature ?? 0.2,
    ...(selected.thinkingLevel && selected.thinkingLevel !== 'off' ? { reasoning: selected.thinkingLevel } : {}),
  })
  if (message.stopReason === 'error' || message.errorMessage) {
    return { ok: false, error: 'plugin_model_failed', detail: message.errorMessage || 'model request failed' }
  }
  const text = assistantText(message)
  return text ? { ok: true, text } : { ok: false, error: 'plugin_model_failed', detail: 'empty response' }
}

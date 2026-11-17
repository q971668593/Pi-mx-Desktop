import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload } from '@shared/ipc-contract'
import type { ProviderPreset } from '@renderer/features/settings/model-provider-presets'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'

export const API_OPTS = [
  { v: 'openai-completions', l: 'OpenAI Chat Completions' },
  { v: 'openai-responses', l: 'OpenAI Responses' },
  { v: 'anthropic-messages', l: 'Anthropic Messages' },
  { v: 'google-generative-ai', l: 'Google Generative AI' },
] as const

export { btnDanger, btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

export function cloneConfig(c: PiModelsConfigPayload): PiModelsConfigPayload {
  return JSON.parse(JSON.stringify(c)) as PiModelsConfigPayload
}

export function configEqual(a: PiModelsConfigPayload | null, b: PiModelsConfigPayload | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function maskApiKey(key?: string): string {
  if (!key) return i18n.t('settings:models.notConfigured')
  if (key.startsWith('$')) return key
  if (key.startsWith('!')) return '!command'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-2)}`
}

export function ProviderAvatar({ preset, label }: { preset?: ProviderPreset; label: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm transition-transform duration-motion-fast ease-motion-ease',
        preset?.accentClass ?? 'bg-muted-foreground/40',
      )}
      title={label}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  )
}

/**
 * Entry for a model that is not in the config yet.
 *
 * `reasoning` is a guess from the id, because a provider's `/v1/models` listing carries
 * no capability flags. Match on the model-name part only (after the last `/`), so a
 * vendor prefix like `opendesign/deepseek-…` still matches on `deepseek`.
 *
 * A false negative is the expensive direction: the SDK reads `definition.reasoning ?? false`,
 * so a model left without `reasoning: true` is treated as non-reasoning and every thinking
 * level is clamped to `off`. A false positive only costs an extra toggle in the model entry
 * editor, so the patterns stay generous. Whatever is already written in models.json wins
 * over this guess (see `mergeModelWithRetained`), and the per-model thinking binding pins
 * the level the session actually uses.
 */
export function defaultModelEntry(id: string): LocalModelEntry {
  const name = id.split('/').pop() || id
  const guessReasoning = /(o\d|gpt-5|gpt-6|claude-(opus|sonnet)|deepseek|reasoner|\br1\b|qwq|glm|minimax|gpt-oss)/i.test(name)
  const guessVision = /(vision|gpt-4o|gpt-5|gpt-6|gemini|claude-3|image)/i.test(name)
  return {
    id,
    name: id,
    reasoning: guessReasoning || undefined,
    input: guessVision ? ['text', 'image'] : ['text'],
    ...(guessReasoning ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
  }
}
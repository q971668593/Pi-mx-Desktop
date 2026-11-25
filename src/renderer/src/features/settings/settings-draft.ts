import type { i18n as I18n } from 'i18next'
import { normalizeBackground, type BackgroundSettings } from '@shared/background'
import {
  normalizeAlertSoundPreset,
  normalizeAlertSoundVolume,
  type AlertSoundPreset,
} from '@shared/alert-sound'
import { applyBackground } from '@renderer/lib/theme/background-layer'
import { ipcClient } from '@renderer/lib/ipc-client'
import { applyIconTheme } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AsrConfig } from '@shared/asr-types'
import { normalizeIconTheme, type IconTheme } from '@shared/icon-theme'
import {
  type CustomCssOverride,
  type CustomTheme,
  normalizeCustomCssOverride,
  normalizeCustomTheme,
} from '@shared/custom-theme'
import { injectCustomCssOverride } from '@renderer/lib/theme/inject-custom-css'
import { applyCustomTheme } from '@renderer/lib/theme/inject-theme'
import {
  normalizeCompletionDelivery,
  normalizeCompletionPreviewMode,
  normalizeCompletionTimeoutSeconds,
  normalizeDndUntil,
  type CompletionDeliveryMode,
  type CompletionPreviewMode,
} from '@shared/completion-preview'
import { normalizeTimelineMaxAutoExpandedTools, normalizeTimelineVisibleTurns } from '@shared/timeline-settings'
import {
  normalizeRightPanelOrder,
  normalizeRightPanelPrefs,
  type RightPanelCatalogItem,
  type RightPanelPrefs,
} from '@shared/right-panels'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type LanguageChoice = 'zh' | 'en'

export type AgentRuntimeChoice = { mode: 'host' | 'wsl'; distro: string | null }
export type PluginModelChoice = { provider: string; modelId: string; thinkingLevel?: import('@shared/model-thinking-levels').ModelThinkingLevel } | null

export type SettingsDraft = {
  theme: ThemeChoice
  iconTheme: IconTheme
  customTheme: CustomTheme
  customCssOverride: CustomCssOverride
  background: BackgroundSettings
  language: LanguageChoice
  autoOpenLastProject: boolean
  /** 内置上下文压缩扩展（billion-context，随包携带）开关 */
  builtinBillionContext: boolean
  autoCheckRegistryUpdates: boolean
  includePrereleaseUpdates: boolean
  alertSoundEnabled: boolean
  alertSoundPreset: AlertSoundPreset
  /** 提示音音量百分比：0 = 静音，100 = 设计音量，200 = 加倍 */
  alertSoundVolume: number
  alertNotificationEnabled: boolean
  alertOnExtensionUi: boolean
  alertOnRunIdle: boolean
  alertOnBackgroundRunIdle: boolean
  alertOnRunFailed: boolean
  aiActivityGlowEnabled: boolean
  completionNotificationTimeoutSeconds: number
  completionNotificationPreview: CompletionPreviewMode
  completionNotificationOnlyWhenUnfocused: boolean
  completionNotificationDndUntil: number | null
  completionNotificationDelivery: CompletionDeliveryMode
  maxSessionWorkers: number
  sessionWorkerIdleTimeoutMinutes: number
  timelineMaxAutoExpandedTools: number
  timelineVisibleTurns: number
  extensionOverrides: Record<string, boolean>
  rightPanelCatalog: RightPanelCatalogItem[]
  rightPanelPrefs: RightPanelPrefs
  rightPanelOrder: string[]
  asrConfig: AsrConfig
  agentRuntime: AgentRuntimeChoice
  pluginModel: PluginModelChoice
}

export function normalizePluginModelChoice(raw: unknown): PluginModelChoice {
  if (!raw || typeof raw !== 'object') return null
  const provider = (raw as { provider?: unknown }).provider
  const modelId = (raw as { modelId?: unknown }).modelId
  if (typeof provider !== 'string' || typeof modelId !== 'string') return null
  const cleanProvider = provider.trim()
  const cleanModel = modelId.trim()
  const level = (raw as { thinkingLevel?: unknown }).thinkingLevel
  const thinkingLevel = typeof level === 'string' && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level) ? level as NonNullable<PluginModelChoice>['thinkingLevel'] : undefined
  return cleanProvider && cleanModel ? { provider: cleanProvider, modelId: cleanModel, ...(thinkingLevel ? { thinkingLevel } : {}) } : null
}

function normalizeLanguage(raw: unknown, fallback: LanguageChoice): LanguageChoice {
  const s = String(raw || '').toLowerCase()
  if (s.startsWith('zh')) return 'zh'
  if (s.startsWith('en')) return 'en'
  return fallback
}

function normalizeAsrForSignature(cfg: AsrConfig): AsrConfig {
  const token = cfg.codexAccessToken?.trim()
  return {
    ...cfg,
    codexAccessToken: token || undefined,
    codexAuthFile: cfg.codexAuthFile?.trim() || undefined,
    cliBinaryPath: cfg.cliBinaryPath?.trim() || undefined,
    serverUrl: cfg.serverUrl?.trim() || undefined,
    apiKey: cfg.apiKey?.trim() || undefined,
    codexAccessTokenSet: cfg.codexAccessTokenSet,
    codexAccessTokenPreview: cfg.codexAccessTokenPreview,
    codexAccessTokenPreserved: cfg.codexAccessTokenPreserved,
  }
}

export function asrConfigFromSettingsResponse(raw: AsrConfig): AsrConfig {
  const a = raw || { provider: 'codex-asr-builtin' as const, language: 'auto' as const, timeoutMs: 120000, builtinServePort: 18788 }
  const base = a.provider === 'none' ? { ...a, provider: 'codex-asr-builtin' as const } : a
  return normalizeAsrForSignature({
    ...base,
    codexAccessToken: base.codexAccessToken?.trim() || undefined,
  })
}

export function normalizeAgentRuntime(raw: unknown): AgentRuntimeChoice {
  const r = (raw || {}) as { mode?: unknown; distro?: unknown }
  if (r.mode === 'wsl') {
    const distro = typeof r.distro === 'string' && r.distro.trim() ? r.distro.trim() : null
    return { mode: 'wsl', distro }
  }
  return { mode: 'host', distro: null }
}

export function draftSignature(d: SettingsDraft): string {
  return JSON.stringify({
    theme: d.theme,
    iconTheme: d.iconTheme,
    customTheme: d.customTheme,
    customCssOverride: d.customCssOverride,
    background: d.background,
    language: d.language,
    autoOpenLastProject: d.autoOpenLastProject,
    builtinBillionContext: d.builtinBillionContext,
    autoCheckRegistryUpdates: d.autoCheckRegistryUpdates,
    includePrereleaseUpdates: d.includePrereleaseUpdates,
    alertSoundEnabled: d.alertSoundEnabled,
    alertSoundPreset: d.alertSoundPreset,
    alertSoundVolume: d.alertSoundVolume,
    alertNotificationEnabled: d.alertNotificationEnabled,
    alertOnExtensionUi: d.alertOnExtensionUi,
    alertOnRunIdle: d.alertOnRunIdle,
    alertOnBackgroundRunIdle: d.alertOnBackgroundRunIdle,
    alertOnRunFailed: d.alertOnRunFailed,
    aiActivityGlowEnabled: d.aiActivityGlowEnabled,
    completionNotificationTimeoutSeconds: d.completionNotificationTimeoutSeconds,
    completionNotificationPreview: d.completionNotificationPreview,
    completionNotificationOnlyWhenUnfocused: d.completionNotificationOnlyWhenUnfocused,
    completionNotificationDndUntil: d.completionNotificationDndUntil,
    completionNotificationDelivery: d.completionNotificationDelivery,
    maxSessionWorkers: d.maxSessionWorkers,
    sessionWorkerIdleTimeoutMinutes: d.sessionWorkerIdleTimeoutMinutes,
    timelineMaxAutoExpandedTools: d.timelineMaxAutoExpandedTools,
    timelineVisibleTurns: d.timelineVisibleTurns,
    extensionOverrides: d.extensionOverrides,
    rightPanelPrefs: d.rightPanelPrefs,
    rightPanelOrder: d.rightPanelOrder,
    asrConfig: normalizeAsrForSignature(d.asrConfig),
    agentRuntime: d.agentRuntime,
    pluginModel: d.pluginModel,
  })
}

export async function loadSettingsDraftFromDisk(i18nLanguage: string): Promise<SettingsDraft> {
  const [settingsRes, rpRes] = await Promise.all([
    ipcClient.invoke('settings.get', {}).catch(() => ({ settings: {} })),
    ipcClient.invoke('rightPanels.catalog').catch(() => null),
  ])
  const s = settingsRes?.settings || {}
  const cat = (rpRes?.catalog as RightPanelCatalogItem[]) || []
  const prefs = normalizeRightPanelPrefs(s.rightPanelPrefs ?? rpRes?.prefs, cat)
  const order = normalizeRightPanelOrder(s.rightPanelOrder ?? rpRes?.order, cat)

  return {
    theme: normalizeThemeChoice(s.theme),
    iconTheme: normalizeIconTheme(s.iconTheme),
    customTheme: normalizeCustomTheme(s.customTheme),
    customCssOverride: normalizeCustomCssOverride(s.customCssOverride),
    background: normalizeBackground(s.background),
    language: normalizeLanguage(s.language, normalizeLanguage(i18nLanguage, 'zh')),
    autoOpenLastProject: s.autoOpenLastProject !== false,
    builtinBillionContext: s.builtinBillionContext !== false,
    autoCheckRegistryUpdates: s.autoCheckRegistryUpdates !== false,
    includePrereleaseUpdates: s.includePrereleaseUpdates === true,
    alertSoundEnabled: s.alertSoundEnabled !== false,
    alertSoundPreset: normalizeAlertSoundPreset(s.alertSoundPreset),
    alertSoundVolume: normalizeAlertSoundVolume(s.alertSoundVolume),
    alertNotificationEnabled: s.alertNotificationEnabled !== false,
    alertOnExtensionUi: s.alertOnExtensionUi !== false,
    alertOnRunIdle: s.alertOnRunIdle !== false,
    alertOnBackgroundRunIdle: s.alertOnBackgroundRunIdle !== false,
    alertOnRunFailed: s.alertOnRunFailed !== false,
    aiActivityGlowEnabled: s.aiActivityGlowEnabled !== false,
    completionNotificationTimeoutSeconds: normalizeCompletionTimeoutSeconds(s.completionNotificationTimeoutSeconds),
    completionNotificationPreview: normalizeCompletionPreviewMode(s.completionNotificationPreview),
    completionNotificationOnlyWhenUnfocused: s.completionNotificationOnlyWhenUnfocused !== false,
    completionNotificationDndUntil: normalizeDndUntil(s.completionNotificationDndUntil),
    completionNotificationDelivery: normalizeCompletionDelivery(s.completionNotificationDelivery),
    maxSessionWorkers: normalizeMaxSessionWorkersUi(s.maxSessionWorkers),
    sessionWorkerIdleTimeoutMinutes: normalizeIdleTimeoutMinutesUi(s.sessionWorkerIdleTimeoutMinutes),
    timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(s.timelineMaxAutoExpandedTools),
    timelineVisibleTurns: normalizeTimelineVisibleTurns(s.timelineVisibleTurns),
    extensionOverrides: { ...(s.extensionOverrides || {}) },
    rightPanelCatalog: cat,
    rightPanelPrefs: prefs,
    rightPanelOrder: order,
    asrConfig: asrConfigFromSettingsResponse((s.asrConfig || {}) as AsrConfig),
    agentRuntime: normalizeAgentRuntime(s.agentRuntime),
    pluginModel: normalizePluginModelChoice(s.pluginModel),
  }
}

let appliedThemeChoice: ThemeChoice = 'system'
let themeTransitionTimer: number | null = null

export function applyThemeToDocument(theme: ThemeChoice): void {
  appliedThemeChoice = theme
  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  const nextDark =
    theme === 'dark'
      ? true
      : theme === 'light'
        ? false
        : window.matchMedia('(prefers-color-scheme: dark)').matches
  if (wasDark !== nextDark) {
    root.classList.add('theme-transitioning')
    if (themeTransitionTimer !== null) window.clearTimeout(themeTransitionTimer)
    themeTransitionTimer = window.setTimeout(() => {
      themeTransitionTimer = null
      root.classList.remove('theme-transitioning')
    }, 200)
  }
  root.classList.toggle('dark', nextDark)
}

function normalizeThemeChoice(raw: unknown): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

export function normalizeMaxSessionWorkersUi(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 6
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

export function normalizeIdleTimeoutMinutesUi(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 15
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

/**
 * Load theme from electron-store (settings) and apply to document + ui-store.
 * Source of truth is settings; localStorage (pi-desktop-ui) is only an anti-FOUC cache.
 */
export async function hydrateThemeFromSettings(): Promise<void> {
  const res = await ipcClient.invoke('settings.get', { key: 'theme' }).catch(() => ({ settings: {} }))
  const theme = normalizeThemeChoice(res?.settings?.theme)
  useUIStore.getState().setTheme(theme)
  applyThemeToDocument(theme)
}

/**
 * 自定义主题水合：electron-store 是真源，localStorage 镜像只服务首帧脚本。
 * 缓存与真源不一致时以真源重算覆盖。
 */
export async function hydrateCustomThemeFromSettings(): Promise<void> {
  const res = await ipcClient
    .invoke('settings.get', { key: 'customTheme' })
    .catch(() => ({ settings: {} }))
  applyCustomTheme(normalizeCustomTheme(res?.settings?.customTheme))
}

export async function hydrateCustomCssOverrideFromSettings(): Promise<void> {
  const res = await ipcClient
    .invoke('settings.get', { key: 'customCssOverride' })
    .catch(() => ({ settings: {} }))
  injectCustomCssOverride(normalizeCustomCssOverride(res?.settings?.customCssOverride))
}

/** system 模式下跟随 OS 明暗切换；返回取消订阅 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (appliedThemeChoice === 'system') {
      document.documentElement.classList.toggle('dark', mq.matches)
    }
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** 仅界面预览，不写盘 */
export function previewDraftUi(draft: SettingsDraft, i18n: I18n): void {
  applyThemeToDocument(draft.theme)
  applyIconTheme(draft.iconTheme)
  applyCustomTheme(draft.customTheme)
  injectCustomCssOverride(draft.customCssOverride)
  applyBackground(draft.background)
  if (i18n.language !== draft.language) void i18n.changeLanguage(draft.language)
}

export async function commitSettingsDraft(
  draft: SettingsDraft,
  i18n: I18n,
  baseline?: SettingsDraft | null,
): Promise<AsrConfig> {
  const customThemeValue = draft.customTheme.light || draft.customTheme.dark ? draft.customTheme : null
  const prevCustomThemeValue = baseline
    ? (baseline.customTheme.light || baseline.customTheme.dark ? baseline.customTheme : null)
    : undefined
  const changed = (nextVal: unknown, prevVal: unknown): boolean =>
    !baseline || JSON.stringify(nextVal ?? null) !== JSON.stringify(prevVal ?? null)

  if (changed(draft.theme, baseline?.theme)) {
    await ipcClient.invoke('settings.set', { key: 'theme', value: draft.theme })
  }
  if (changed(draft.iconTheme, baseline?.iconTheme)) {
    await ipcClient.invoke('settings.set', { key: 'iconTheme', value: draft.iconTheme })
  }
  if (changed(customThemeValue, prevCustomThemeValue)) {
    await ipcClient.invoke('settings.set', { key: 'customTheme', value: customThemeValue })
  }
  if (changed(draft.customCssOverride, baseline?.customCssOverride)) {
    await ipcClient.invoke('settings.set', { key: 'customCssOverride', value: draft.customCssOverride })
  }
  if (changed(draft.background, baseline?.background)) {
    await ipcClient.invoke('settings.set', { key: 'background', value: draft.background })
  }
  if (changed(draft.language, baseline?.language)) {
    await ipcClient.invoke('settings.set', { key: 'language', value: draft.language })
  }
  if (changed(draft.autoOpenLastProject, baseline?.autoOpenLastProject)) {
    await ipcClient.invoke('settings.set', { key: 'autoOpenLastProject', value: draft.autoOpenLastProject })
  }
  if (changed(draft.builtinBillionContext, baseline?.builtinBillionContext)) {
    await ipcClient.invoke('settings.set', { key: 'builtinBillionContext', value: draft.builtinBillionContext })
  }
  if (changed(draft.autoCheckRegistryUpdates, baseline?.autoCheckRegistryUpdates)) {
    await ipcClient.invoke('settings.set', { key: 'autoCheckRegistryUpdates', value: draft.autoCheckRegistryUpdates })
  }
  if (changed(draft.includePrereleaseUpdates, baseline?.includePrereleaseUpdates)) {
    await ipcClient.invoke('settings.set', { key: 'includePrereleaseUpdates', value: draft.includePrereleaseUpdates })
  }
  if (changed(draft.alertSoundEnabled, baseline?.alertSoundEnabled)) {
    await ipcClient.invoke('settings.set', { key: 'alertSoundEnabled', value: draft.alertSoundEnabled })
  }
  if (changed(draft.alertSoundPreset, baseline?.alertSoundPreset)) {
    await ipcClient.invoke('settings.set', { key: 'alertSoundPreset', value: draft.alertSoundPreset })
  }
  if (changed(draft.alertSoundVolume, baseline?.alertSoundVolume)) {
    await ipcClient.invoke('settings.set', { key: 'alertSoundVolume', value: draft.alertSoundVolume })
  }
  if (changed(draft.alertNotificationEnabled, baseline?.alertNotificationEnabled)) {
    await ipcClient.invoke('settings.set', { key: 'alertNotificationEnabled', value: draft.alertNotificationEnabled })
  }
  if (changed(draft.alertOnExtensionUi, baseline?.alertOnExtensionUi)) {
    await ipcClient.invoke('settings.set', { key: 'alertOnExtensionUi', value: draft.alertOnExtensionUi })
  }
  if (changed(draft.alertOnRunIdle, baseline?.alertOnRunIdle)) {
    await ipcClient.invoke('settings.set', { key: 'alertOnRunIdle', value: draft.alertOnRunIdle })
  }
  if (changed(draft.alertOnBackgroundRunIdle, baseline?.alertOnBackgroundRunIdle)) {
    await ipcClient.invoke('settings.set', {
      key: 'alertOnBackgroundRunIdle',
      value: draft.alertOnBackgroundRunIdle,
    })
  }
  if (changed(draft.alertOnRunFailed, baseline?.alertOnRunFailed)) {
    await ipcClient.invoke('settings.set', { key: 'alertOnRunFailed', value: draft.alertOnRunFailed })
  }
  if (changed(draft.aiActivityGlowEnabled, baseline?.aiActivityGlowEnabled)) {
    await ipcClient.invoke('settings.set', {
      key: 'aiActivityGlowEnabled',
      value: draft.aiActivityGlowEnabled,
    })
  }
  const normalizedTimeout = normalizeCompletionTimeoutSeconds(draft.completionNotificationTimeoutSeconds)
  const prevTimeout = baseline ? normalizeCompletionTimeoutSeconds(baseline.completionNotificationTimeoutSeconds) : undefined
  if (changed(normalizedTimeout, prevTimeout)) {
    await ipcClient.invoke('settings.set', {
      key: 'completionNotificationTimeoutSeconds',
      value: normalizedTimeout,
    })
  }
  if (changed(draft.completionNotificationPreview, baseline?.completionNotificationPreview)) {
    await ipcClient.invoke('settings.set', {
      key: 'completionNotificationPreview',
      value: draft.completionNotificationPreview,
    })
  }
  if (changed(draft.completionNotificationOnlyWhenUnfocused, baseline?.completionNotificationOnlyWhenUnfocused)) {
    await ipcClient.invoke('settings.set', {
      key: 'completionNotificationOnlyWhenUnfocused',
      value: draft.completionNotificationOnlyWhenUnfocused,
    })
  }
  if (changed(draft.completionNotificationDndUntil, baseline?.completionNotificationDndUntil)) {
    await ipcClient.invoke('settings.set', {
      key: 'completionNotificationDndUntil',
      value: draft.completionNotificationDndUntil,
    })
  }
  if (changed(draft.completionNotificationDelivery, baseline?.completionNotificationDelivery)) {
    await ipcClient.invoke('settings.set', {
      key: 'completionNotificationDelivery',
      value: draft.completionNotificationDelivery,
    })
  }
  const normalizedWorkers = normalizeMaxSessionWorkersUi(draft.maxSessionWorkers)
  const prevWorkers = baseline ? normalizeMaxSessionWorkersUi(baseline.maxSessionWorkers) : undefined
  if (changed(normalizedWorkers, prevWorkers)) {
    await ipcClient.invoke('settings.set', {
      key: 'maxSessionWorkers',
      value: normalizedWorkers,
    })
  }
  const normalizedIdle = normalizeIdleTimeoutMinutesUi(draft.sessionWorkerIdleTimeoutMinutes)
  const prevIdle = baseline ? normalizeIdleTimeoutMinutesUi(baseline.sessionWorkerIdleTimeoutMinutes) : undefined
  if (changed(normalizedIdle, prevIdle)) {
    await ipcClient.invoke('settings.set', {
      key: 'sessionWorkerIdleTimeoutMinutes',
      value: normalizedIdle,
    })
  }
  if (changed(draft.timelineMaxAutoExpandedTools, baseline?.timelineMaxAutoExpandedTools)) {
    await ipcClient.invoke('settings.set', {
      key: 'timelineMaxAutoExpandedTools',
      value: draft.timelineMaxAutoExpandedTools,
    })
  }
  const normalizedVisibleTurns = normalizeTimelineVisibleTurns(draft.timelineVisibleTurns)
  const prevVisibleTurns = baseline ? normalizeTimelineVisibleTurns(baseline.timelineVisibleTurns) : undefined
  if (changed(normalizedVisibleTurns, prevVisibleTurns)) {
    await ipcClient.invoke('settings.set', { key: 'timelineVisibleTurns', value: normalizedVisibleTurns })
  }
  if (changed(draft.extensionOverrides, baseline?.extensionOverrides)) {
    await ipcClient.invoke('settings.set', { key: 'extensionOverrides', value: draft.extensionOverrides })
  }
  if (
    changed(draft.rightPanelPrefs, baseline?.rightPanelPrefs) ||
    changed(draft.rightPanelOrder, baseline?.rightPanelOrder)
  ) {
    await ipcClient.invoke('rightPanels.saveLayout', {
      prefs: draft.rightPanelPrefs,
      order: draft.rightPanelOrder,
    })
  }

  let savedAsr = draft.asrConfig
  if (
    !baseline ||
    JSON.stringify(normalizeAsrForSignature(draft.asrConfig)) !==
      JSON.stringify(normalizeAsrForSignature(baseline.asrConfig))
  ) {
    const asrRes = await ipcClient.invoke('settings.set', { key: 'asrConfig', value: draft.asrConfig })
    savedAsr = asrConfigFromSettingsResponse((asrRes?.value || draft.asrConfig) as AsrConfig)
    draft.asrConfig = savedAsr
  }

  if (changed(draft.agentRuntime, baseline?.agentRuntime)) {
    await ipcClient.invoke('settings.set', { key: 'agentRuntime', value: draft.agentRuntime })
  }
  if (changed(draft.pluginModel, baseline?.pluginModel)) {
    await ipcClient.invoke('settings.set', { key: 'pluginModel', value: draft.pluginModel })
  }

  useUIStore.getState().setTheme(draft.theme)
  applyIconTheme(draft.iconTheme)
  useUIStore.getState().setTimelineMaxAutoExpandedTools(draft.timelineMaxAutoExpandedTools)
  useUIStore.getState().setTimelineVisibleTurns(draft.timelineVisibleTurns)
  applyThemeToDocument(draft.theme)
  applyCustomTheme(draft.customTheme)
  injectCustomCssOverride(draft.customCssOverride)
  applyBackground(draft.background)
  if (i18n.language !== draft.language) await i18n.changeLanguage(draft.language)
  useUIStore.getState().applyRightPanelRuntime(
    draft.rightPanelCatalog,
    draft.rightPanelPrefs,
    draft.rightPanelOrder,
  )
  return savedAsr
}

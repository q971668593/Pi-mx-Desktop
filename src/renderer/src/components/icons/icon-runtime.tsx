import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_ICON_THEME, normalizeIconTheme, type IconTheme } from '@shared/icon-theme'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { AppIconName } from './icon-names'
import type { AppIconComponent, AppIconProps, ThemeIconMap } from './types'
import { phosphorIcons } from './themes/phosphor'

interface IconThemeState {
  iconTheme: IconTheme
  loadedVersion: number
  setIconTheme: (iconTheme: IconTheme) => void
  bumpLoadedVersion: () => void
}

export const useIconThemeStore = create<IconThemeState>((set) => ({
  iconTheme: DEFAULT_ICON_THEME,
  loadedVersion: 0,
  setIconTheme: (iconTheme) => set({ iconTheme }),
  bumpLoadedVersion: () => set((state) => ({ loadedVersion: state.loadedVersion + 1 })),
}))

const THEME_LOADERS: Record<Exclude<IconTheme, 'phosphor'>, () => Promise<ThemeIconMap>> = {
  lucide: () => import('./themes/lucide').then((m) => m.lucideIcons),
  fluent: () => import('./themes/fluent').then((m) => m.fluentIcons),
  hugeicons: () => import('./themes/hugeicons').then((m) => m.hugeiconsIcons),
  iconoir: () => import('./themes/iconoir').then((m) => m.iconoirIcons),
}

const loadedThemes: Partial<Record<IconTheme, ThemeIconMap>> = {
  phosphor: phosphorIcons,
}

const loadingThemes: Partial<Record<IconTheme, Promise<ThemeIconMap>>> = {}

export function isIconThemeLoaded(theme: IconTheme): boolean {
  return !!loadedThemes[theme]
}

export function preloadIconTheme(theme: IconTheme): Promise<ThemeIconMap> {
  const existing = loadedThemes[theme]
  if (existing) return Promise.resolve(existing)
  const inFlight = loadingThemes[theme]
  if (inFlight) return inFlight
  if (theme === 'phosphor') return Promise.resolve(phosphorIcons)
  const pending = THEME_LOADERS[theme]()
    .then((icons) => {
      loadedThemes[theme] = icons
      delete loadingThemes[theme]
      useIconThemeStore.getState().bumpLoadedVersion()
      return icons
    })
    .catch((err) => {
      delete loadingThemes[theme]
      throw err
    })
  loadingThemes[theme] = pending
  return pending
}

export function applyIconTheme(theme: IconTheme): Promise<void> {
  useIconThemeStore.getState().setIconTheme(theme)
  if (!loadedThemes[theme]) {
    return preloadIconTheme(theme).then(() => undefined)
  }
  return Promise.resolve()
}

export async function hydrateIconThemeFromSettings(): Promise<IconTheme> {
  const response = await ipcClient
    .invoke('settings.get', { key: 'iconTheme' })
    .catch(() => ({ settings: {} }))
  const theme = normalizeIconTheme(response?.settings?.iconTheme)
  await preloadIconTheme(theme).catch(() => phosphorIcons)
  await applyIconTheme(theme)
  return theme
}

function glyphProps(
  theme: IconTheme,
  name: AppIconName,
  props: AppIconProps,
  declaredTheme: IconTheme = theme,
): AppIconProps {
  const next: AppIconProps & Record<`data-${string}`, string> = {
    ...props,
    'data-icon-theme': declaredTheme,
  }
  const filledSquare = name === 'square' && (props.strokeWidth === 0 || props.className?.includes('fill-current'))
  if (filledSquare) {
    next['data-icon-filled'] = 'true'
    if (theme === 'phosphor') (next as AppIconProps & { weight?: string }).weight = 'fill'
    if (theme === 'hugeicons' || theme === 'iconoir') {
      next.fill = 'currentColor'
      next.strokeWidth = 0
    }
  }
  if (theme === 'phosphor' && !('weight' in next)) {
    ;(next as AppIconProps & { weight?: string }).weight = 'regular'
  }
  if ((theme === 'hugeicons' || theme === 'iconoir') && props.strokeWidth !== 0) {
    next.strokeWidth = props.strokeWidth ?? (theme === 'iconoir' ? 1.75 : 1.5)
  }
  if (theme === 'fluent') {
    delete next.strokeWidth
  }
  return next
}

export interface ThemedIconProps extends AppIconProps {
  name: AppIconName
  theme: IconTheme
}

export function ThemedIcon({ name, theme, ...props }: ThemedIconProps) {
  useIconThemeStore((state) => state.loadedVersion)
  const themeMap = loadedThemes[theme]

  useEffect(() => {
    if (!themeMap) {
      void preloadIconTheme(theme).catch(() => {})
    }
  }, [theme, themeMap])

  const resolvedTheme = themeMap ? theme : DEFAULT_ICON_THEME
  const Glyph = (themeMap ?? phosphorIcons)[name]
  return <Glyph {...glyphProps(resolvedTheme, name, props, theme)} />
}

export function createAppIcon(name: AppIconName, displayName: string): AppIconComponent {
  function AppIcon(props: AppIconProps) {
    const theme = useIconThemeStore((state) => state.iconTheme)
    return <ThemedIcon {...props} theme={theme} name={name} />
  }
  AppIcon.displayName = displayName
  return AppIcon
}

export function resolveAppIcon(name: AppIconName): AppIconComponent {
  return createAppIcon(name, name)
}

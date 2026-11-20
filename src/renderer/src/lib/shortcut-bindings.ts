const KEY = 'pi-desktop:shortcut-bindings'

export type ShortcutId = 'commandPalette' | 'shortcuts' | 'completionNotification'

export type ShortcutBinding = {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

const DEFAULTS: Record<ShortcutId, ShortcutBinding> = {
  commandPalette: { key: 'k', ctrl: true, meta: true, shift: false, alt: false },
  shortcuts: { key: '/', ctrl: true, meta: true, shift: false, alt: false },
  completionNotification: { key: 'n', ctrl: true, meta: true, shift: true, alt: false },
}

export function defaultShortcutBindings(): Record<ShortcutId, ShortcutBinding> {
  return { ...DEFAULTS }
}

/**
 * 旧版本写进 localStorage 的绑定可能缺字段（或者干脆是个字符串）。
 * 直接透传会让 matchShortcut/formatShortcut 在 `binding.key.toLowerCase()` 上抛错，
 * 而它们跑在全局 keydown 里——一抛就把整条快捷键链路和执行都带下去。
 */
function normalizeBinding(value: unknown, fallback: ShortcutBinding): ShortcutBinding {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ShortcutBinding>
  const bool = (input: unknown, alt: boolean): boolean => (typeof input === 'boolean' ? input : alt)
  return {
    key: typeof raw.key === 'string' && raw.key.trim() ? raw.key : fallback.key,
    ctrl: bool(raw.ctrl, fallback.ctrl),
    meta: bool(raw.meta, fallback.meta),
    shift: bool(raw.shift, fallback.shift),
    alt: bool(raw.alt, fallback.alt),
  }
}

export function readShortcutBindings(): Record<ShortcutId, ShortcutBinding> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Record<ShortcutId, ShortcutBinding>>
    return {
      commandPalette: normalizeBinding(raw.commandPalette, DEFAULTS.commandPalette),
      shortcuts: normalizeBinding(raw.shortcuts, DEFAULTS.shortcuts),
      completionNotification: normalizeBinding(raw.completionNotification, DEFAULTS.completionNotification),
    }
  } catch {
    return defaultShortcutBindings()
  }
}

export function writeShortcutBindings(next: Record<ShortcutId, ShortcutBinding>): void {
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function matchShortcut(event: KeyboardEvent, binding?: ShortcutBinding | null): boolean {
  if (!binding || typeof binding.key !== 'string') return false
  const key = event.key.toLowerCase()
  if (key !== binding.key.toLowerCase()) return false
  if (event.altKey !== binding.alt) return false
  if (event.shiftKey !== binding.shift) return false
  const mod = event.ctrlKey || event.metaKey
  if (binding.ctrl || binding.meta) return mod
  return !mod
}

export function formatShortcut(binding?: ShortcutBinding | null): string {
  if (!binding || typeof binding.key !== 'string') return ''
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const parts: string[] = []
  if (binding.ctrl || binding.meta) parts.push(mac ? '⌘' : 'Ctrl')
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift')
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt')
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join(mac ? '' : '+')
}

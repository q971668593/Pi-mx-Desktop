import {
  normalizeAlertSoundPreset,
  normalizeAlertSoundVolume,
  playAlertSoundTones,
  type AlertSoundPreset,
} from '@shared/alert-sound'

let ctx: AudioContext | null = null

/**
 * Plays a preset in the app window (settings preview). Same tone table as the notification host,
 * and the same volume handling: `volume` is a percent (0–200), undefined = designed level.
 */
export function previewAlertSound(preset: AlertSoundPreset | string, volume?: number): void {
  const normalized = normalizeAlertSoundPreset(preset)
  if (normalized === 'none') return
  const level = normalizeAlertSoundVolume(volume)
  if (level <= 0) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    ctx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    playAlertSoundTones(ctx, normalized, 0, level)
  } catch {
    /* audio unavailable: the setting still saves */
  }
}

import { normalizeAlertSoundPreset, playAlertSoundTones, type AlertSoundPreset } from '@shared/alert-sound'

let ctx: AudioContext | null = null

/** Plays a preset in the app window (settings preview). Same tone table as the notification host. */
export function previewAlertSound(preset: AlertSoundPreset | string): void {
  const normalized = normalizeAlertSoundPreset(preset)
  if (normalized === 'none') return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    ctx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    playAlertSoundTones(ctx, normalized)
  } catch {
    /* audio unavailable: the setting still saves */
  }
}

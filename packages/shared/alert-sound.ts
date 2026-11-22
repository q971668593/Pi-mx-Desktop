/** Alert sounds are synthesised (no audio assets), so they work offline and in the sandboxed host. */

export type AlertSoundPreset = 'chime' | 'drop' | 'double' | 'rise' | 'soft' | 'none'

export const ALERT_SOUND_PRESETS: AlertSoundPreset[] = ['chime', 'drop', 'double', 'rise', 'soft', 'none']

export const DEFAULT_ALERT_SOUND_PRESET: AlertSoundPreset = 'chime'

/** One note: frequency (Hz), start offset and duration (seconds), peak gain, waveform. */
export type AlertSoundTone = {
  f: number
  t: number
  d: number
  g?: number
  w?: 'sine' | 'triangle' | 'square'
}

export const ALERT_SOUND_TONES: Record<Exclude<AlertSoundPreset, 'none'>, AlertSoundTone[]> = {
  /** Two-note bell: clear and short. */
  chime: [
    { f: 1318.5, t: 0, d: 0.34, g: 0.085 },
    { f: 1760, t: 0.085, d: 0.55, g: 0.07 },
  ],
  /** A falling drop. */
  drop: [
    { f: 1180, t: 0, d: 0.1, g: 0.08, w: 'sine' },
    { f: 660, t: 0.055, d: 0.24, g: 0.06, w: 'sine' },
  ],
  /** Two short beeps, easy to notice from another room. */
  double: [
    { f: 880, t: 0, d: 0.1, g: 0.08, w: 'triangle' },
    { f: 1174.7, t: 0.15, d: 0.1, g: 0.08, w: 'triangle' },
  ],
  /** Rising triad. */
  rise: [
    { f: 523.3, t: 0, d: 0.13, g: 0.07, w: 'triangle' },
    { f: 659.3, t: 0.11, d: 0.13, g: 0.07, w: 'triangle' },
    { f: 784, t: 0.22, d: 0.3, g: 0.06, w: 'triangle' },
  ],
  /** One soft tone for quiet rooms. */
  soft: [{ f: 440, t: 0, d: 0.6, g: 0.045, w: 'sine' }],
}

export function normalizeAlertSoundPreset(value: unknown): AlertSoundPreset {
  return typeof value === 'string' && (ALERT_SOUND_PRESETS as string[]).includes(value)
    ? (value as AlertSoundPreset)
    : DEFAULT_ALERT_SOUND_PRESET
}

/** Volume range, in percent. 100 is the designed level; 200 doubles the gain for noisy rooms. */
export const ALERT_SOUND_VOLUME_MIN = 0
export const ALERT_SOUND_VOLUME_MAX = 200
export const ALERT_SOUND_VOLUME_STEP = 5
export const DEFAULT_ALERT_SOUND_VOLUME = 100

/** Baseline multiplier applied at 100% in both playback contexts. */
export const ALERT_SOUND_BASE_GAIN = 2

/**
 * Clamps anything (missing key, null, NaN, "120", -5) into an integer percent in range.
 * Note `Number(null) === 0` and `Number('') === 0`: those are absence, not "silent", so they fall
 * back to the designed level instead of muting the alert.
 */
export function normalizeAlertSoundVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_ALERT_SOUND_VOLUME
  if (n <= ALERT_SOUND_VOLUME_MIN) return ALERT_SOUND_VOLUME_MIN
  if (n >= ALERT_SOUND_VOLUME_MAX) return ALERT_SOUND_VOLUME_MAX
  return Math.round(n)
}

/**
 * Schedules the preset on an AudioContext; returns the total length in seconds (0 = silent).
 * `volume` is a percent of the baseline gain, so 200% doubles the amplitude at 100%.
 * 0% short-circuits before any oscillator is created.
 */
export function playAlertSoundTones(
  ctx: AudioContext,
  preset: AlertSoundPreset,
  when = 0,
  volume: number = DEFAULT_ALERT_SOUND_VOLUME,
): number {
  if (preset === 'none') return 0
  const tones = ALERT_SOUND_TONES[preset]
  if (!tones) return 0
  const factor = (normalizeAlertSoundVolume(volume) / 100) * ALERT_SOUND_BASE_GAIN
  if (factor <= 0) return 0
  const start = ctx.currentTime + when
  let end = 0
  for (const tone of tones) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = tone.w ?? 'sine'
    osc.frequency.value = tone.f
    const t0 = start + tone.t
    const peak = (tone.g ?? 0.08) * factor
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.d)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + tone.d + 0.02)
    end = Math.max(end, tone.t + tone.d)
  }
  return end
}

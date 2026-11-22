import { describe, expect, it } from 'vitest'
import {
  ALERT_SOUND_TONES,
  ALERT_SOUND_VOLUME_MAX,
  ALERT_SOUND_VOLUME_MIN,
  DEFAULT_ALERT_SOUND_VOLUME,
  normalizeAlertSoundVolume,
  playAlertSoundTones,
} from './alert-sound'

/** Minimal AudioContext stand-in that records the gain curve the scheduler writes. */
function fakeCtx() {
  const peaks: number[] = []
  const ctx = {
    currentTime: 10,
    destination: {},
    createOscillator: () => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
    }),
    createGain: () => {
      const gain = {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: (v: number) => {
          if (v > 0.001) peaks.push(v)
        },
      }
      return { gain, connect: () => {} }
    },
  }
  return { ctx: ctx as unknown as AudioContext, peaks }
}

describe('alert sound volume', () => {
  it('defaults to the designed level for anything unusable', () => {
    expect(normalizeAlertSoundVolume(undefined)).toBe(DEFAULT_ALERT_SOUND_VOLUME)
    expect(normalizeAlertSoundVolume(null)).toBe(DEFAULT_ALERT_SOUND_VOLUME)
    expect(normalizeAlertSoundVolume('')).toBe(DEFAULT_ALERT_SOUND_VOLUME)
    expect(normalizeAlertSoundVolume(Number.NaN)).toBe(DEFAULT_ALERT_SOUND_VOLUME)
  })

  it('clamps into 0–200 and rounds to whole percent', () => {
    expect(normalizeAlertSoundVolume(-40)).toBe(ALERT_SOUND_VOLUME_MIN)
    expect(normalizeAlertSoundVolume(0)).toBe(0)
    expect(normalizeAlertSoundVolume(75)).toBe(75)
    expect(normalizeAlertSoundVolume('125')).toBe(125)
    expect(normalizeAlertSoundVolume(132.4)).toBe(132)
    expect(normalizeAlertSoundVolume(9999)).toBe(ALERT_SOUND_VOLUME_MAX)
  })
})

describe('playAlertSoundTones', () => {
  it('doubles the baseline gain and scales every tone peak by the volume percent', () => {
    const { ctx, peaks } = fakeCtx()
    playAlertSoundTones(ctx, 'chime', 0, 100)
    const designed = [...peaks]
    peaks.length = 0
    playAlertSoundTones(ctx, 'chime', 0, 200)
    expect(designed.length).toBeGreaterThan(0)
    expect(designed.length).toBe(peaks.length)
    for (let i = 0; i < designed.length; i += 1) {
      expect(peaks[i]).toBeCloseTo(designed[i] * 2, 6)
    }
    expect(designed[0]).toBeCloseTo((ALERT_SOUND_TONES.chime[0].g ?? 0.08) * 2, 6)
  })

  it('stays silent at 0 % and for the none preset', () => {
    const { ctx, peaks } = fakeCtx()
    expect(playAlertSoundTones(ctx, 'chime', 0, 0)).toBe(0)
    expect(peaks).toHaveLength(0)
    expect(playAlertSoundTones(ctx, 'none', 0, 100)).toBe(0)
  })
})

import { cn } from '@renderer/lib/utils'
import {
  ALERT_SOUND_VOLUME_MAX,
  ALERT_SOUND_VOLUME_MIN,
  ALERT_SOUND_VOLUME_STEP,
  DEFAULT_ALERT_SOUND_VOLUME,
} from '@shared/alert-sound'

type Props = {
  value: number
  label: string
  disabled?: boolean
  /** Called continuously while dragging (visual + persisted draft value). */
  onChange: (value: number) => void
  /** Called once the pointer/keys settle — the place to play a preview. */
  onCommit?: (value: number) => void
}

/**
 * Horizontal alert-volume control. 0 % is silent, 100 % is the designed level, 200 % doubles the
 * gain for noisy rooms. Dragging only updates the draft; the preview fires on release so a long
 * drag does not machine-gun the speakers.
 */
export function AlertVolumeSlider({ value, label, disabled, onChange, onCommit }: Props) {
  const span = ALERT_SOUND_VOLUME_MAX - ALERT_SOUND_VOLUME_MIN
  const filled = ((value - ALERT_SOUND_VOLUME_MIN) / span) * 100
  const midpoint = ((DEFAULT_ALERT_SOUND_VOLUME - ALERT_SOUND_VOLUME_MIN) / span) * 100
  return (
    <div className={cn('flex w-full max-w-[17.5rem] items-start gap-3 sm:w-[17.5rem]', disabled && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={ALERT_SOUND_VOLUME_MIN}
          max={ALERT_SOUND_VOLUME_MAX}
          step={ALERT_SOUND_VOLUME_STEP}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={`${value}%`}
          className="alert-volume-range block w-full"
          style={{ ['--alert-volume-filled' as string]: `${filled}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
          onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        />
        <div className="relative mx-[7px] h-5" aria-hidden="true">
          <span className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 text-[10px] leading-none text-muted-foreground" style={{ left: `${midpoint}%` }}>
            <span className="h-1 w-px bg-current" />
            {DEFAULT_ALERT_SOUND_VOLUME}%
          </span>
        </div>
      </div>
      {/* The notification feedback owns the live region. */}
      <span className="w-[3.1rem] shrink-0 text-right font-mono text-[12px] leading-[22px] text-foreground tabular-nums">
        {value}%
      </span>
    </div>
  )
}

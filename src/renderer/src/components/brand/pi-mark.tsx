import { memo } from 'react'
import { cn } from '@renderer/lib/utils'
import piMxIcon from '@renderer/assets/pi-mx-icon.png'

function PiMarkImpl({ className, size = 16 }: { className?: string; size?: number; inverted?: boolean }) {
  return (
    <img
      src={piMxIcon}
      alt="Pi mx"
      width={size}
      height={size}
      className={cn('shrink-0 rounded-[4px] object-cover', className)}
      draggable={false}
      aria-hidden
    />
  )
}

export const PiMark = memo(PiMarkImpl)

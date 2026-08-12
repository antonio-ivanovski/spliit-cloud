import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type MascotSpeechSide = 'top' | 'bottom'
export type MascotSpeechAlign = 'start' | 'end' | 'center'

const bubbleFill = 'bg-card dark:bg-[hsl(24_9%_20%)]'
const bubbleBorder = 'border-border/80 dark:border-white/18'
const bubbleElevation =
  'shadow-[0_1px_3px_rgba(15,23,42,0.08),0_8px_20px_-6px_rgba(15,23,42,0.18),0_18px_36px_-10px_rgba(15,23,42,0.12)] ring-1 ring-black/10 dark:shadow-[0_6px_14px_rgba(0,0,0,0.55),0_18px_36px_-6px_rgba(0,0,0,0.62),0_0_16px_hsl(var(--primary)/0.14),0_0_0_1px_hsl(var(--primary)/0.32)] dark:ring-1 dark:ring-primary/30'

export function MascotSpeechBubble({
  side,
  align,
  className,
  children,
  'data-testid': testId,
}: {
  side: MascotSpeechSide
  align: MascotSpeechAlign
  className?: string
  children: ReactNode
  'data-testid'?: string
}) {
  const aboveMascot = side === 'top'

  return (
    <div
      data-testid={testId}
      className={cn(
        'pointer-events-auto absolute z-10 w-max max-w-[13.5rem]',
        aboveMascot ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        align === 'start' && 'start-0',
        align === 'end' && 'end-0',
        align === 'center' && 'start-1/2 -translate-x-1/2',
        className,
      )}
    >
      <div
        className={cn(
          'relative rounded-2xl border px-3 py-2 text-start text-xs leading-snug text-foreground',
          bubbleBorder,
          bubbleFill,
          bubbleElevation,
        )}
      >
        {children}
        <span
          data-mascot-speech-tail=""
          aria-hidden="true"
          className={cn(
            'absolute size-2.5 rotate-45',
            bubbleFill,
            aboveMascot
              ? cn('bottom-[-5px] border-e border-b', bubbleBorder)
              : cn('top-[-5px] border-s border-t', bubbleBorder),
            align === 'start' && 'start-7',
            align === 'end' && 'end-7',
            align === 'center' && 'start-1/2 -translate-x-1/2',
          )}
        />
      </div>
    </div>
  )
}

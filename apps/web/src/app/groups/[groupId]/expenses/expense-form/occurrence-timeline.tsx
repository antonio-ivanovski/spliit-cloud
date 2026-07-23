import { cn, formatDateOnly } from '@/lib/utils'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  getOccurrenceScheduleStatus,
  type RecurrenceScheduleEntry,
} from './recurrence-schedule'

export function OccurrenceTimelineNode({
  status,
}: {
  status: 'current' | 'completed' | 'upcoming'
}) {
  return (
    <span
      className={cn(
        'relative z-10 flex size-4 shrink-0 items-center justify-center rounded-full border-2 bg-background',
        status === 'current' && 'border-primary bg-primary',
        status === 'completed' &&
          'border-muted-foreground/70 bg-muted-foreground/70',
        status === 'upcoming' && 'border-muted-foreground/40',
      )}
    >
      {(status === 'current' || status === 'completed') && (
        <Check
          className={cn(
            'size-2.5',
            status === 'current'
              ? 'text-primary-foreground'
              : 'text-background',
          )}
        />
      )}
    </span>
  )
}

export function OccurrenceStatusLabel({
  status,
  currentLabel,
  completedLabel,
  upcomingLabel,
}: {
  status: 'current' | 'completed' | 'upcoming'
  currentLabel: ReactNode
  completedLabel: ReactNode
  upcomingLabel?: ReactNode
}) {
  if (status === 'current') {
    return (
      <span className="mt-0.5 block truncate text-xs font-medium text-primary">
        {currentLabel}
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
        {completedLabel}
      </span>
    )
  }
  if (upcomingLabel) {
    return (
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {upcomingLabel}
      </span>
    )
  }
  return null
}

/** Shared vertical timeline row used by the inline preview and view-all list. */
export function OccurrenceTimelineRow({
  entry,
  index,
  totalVisible,
  hasContinuation,
  currentSequence,
  locale,
  currentLabel,
  completedLabel,
  className,
}: {
  entry: RecurrenceScheduleEntry
  index: number
  totalVisible: number
  hasContinuation?: boolean
  currentSequence: number
  locale: string
  currentLabel: ReactNode
  completedLabel: ReactNode
  className?: string
}) {
  const status = getOccurrenceScheduleStatus(entry, currentSequence)
  const continues = index < totalVisible - 1 || Boolean(hasContinuation)
  return (
    <li
      className={cn(
        'relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] grid-rows-[1.25rem_auto] pb-4',
        className,
      )}
      aria-current={status === 'current' ? 'date' : undefined}
    >
      {index > 0 && (
        <span
          aria-hidden="true"
          className="absolute left-4 top-0 h-7 w-px bg-border"
        />
      )}
      {continues && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-4 top-7 w-px bg-border"
        />
      )}
      <span className="col-start-1 row-start-1 block text-center text-xs tabular-nums text-muted-foreground">
        {entry.sequence}
      </span>
      <span className="col-start-1 row-start-2 mx-auto">
        <OccurrenceTimelineNode status={status} />
      </span>
      <span className="col-start-2 row-start-2 min-w-0 self-start pl-2 text-sm">
        <span className="block truncate font-medium tabular-nums">
          {formatDateOnly(entry.date, locale, { dateStyle: 'medium' })}
        </span>
        <OccurrenceStatusLabel
          status={status}
          currentLabel={currentLabel}
          completedLabel={completedLabel}
        />
      </span>
    </li>
  )
}

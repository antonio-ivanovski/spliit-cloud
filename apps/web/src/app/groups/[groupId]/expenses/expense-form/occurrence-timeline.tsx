import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatDateOnly } from '@/lib/utils'
import { Ellipsis } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  getOccurrenceScheduleStatus,
  type RecurrenceScheduleEntry,
} from './recurrence-schedule'

/** Fixed vertical row height for the virtualized schedule list. */
export const OCCURRENCE_TIMELINE_ROW_HEIGHT = 80

const NODE_COLUMN_CLASS = 'w-10'
const NODE_CENTER_LEFT = 'left-5'

export type OccurrenceTimelineOrientation =
  'vertical' | 'horizontal' | 'responsive'

export type OccurrenceTimelineStatus = 'current' | 'completed' | 'upcoming'

export function OccurrenceTimelineNode({
  status,
  sequence,
  className,
}: {
  status: OccurrenceTimelineStatus
  sequence: number | string
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold tabular-nums leading-none',
        status === 'current' &&
          'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
        status === 'completed' &&
          'border-muted-foreground/60 bg-muted-foreground/60 text-background',
        status === 'upcoming' &&
          'border-muted-foreground/40 bg-background text-muted-foreground',
        className,
      )}
    >
      {sequence}
    </span>
  )
}

export function OccurrenceStatusLabel({
  status,
  currentLabel,
  completedLabel,
  upcomingLabel,
  className,
}: {
  status: OccurrenceTimelineStatus
  currentLabel: ReactNode
  completedLabel: ReactNode
  upcomingLabel?: ReactNode
  className?: string
}) {
  if (status === 'current') {
    return (
      <Badge
        variant="default"
        className={cn(
          'mt-1 px-1.5 py-0 text-[10px] font-semibold leading-4',
          className,
        )}
      >
        {currentLabel}
      </Badge>
    )
  }
  if (status === 'completed') {
    return (
      <Badge
        variant="secondary"
        className={cn('mt-1 px-1.5 py-0 text-[10px] leading-4', className)}
      >
        {completedLabel}
      </Badge>
    )
  }
  if (upcomingLabel) {
    return (
      <Badge
        variant="outline"
        className={cn(
          'mt-1 px-1.5 py-0 text-[10px] leading-4 text-muted-foreground',
          className,
        )}
      >
        {upcomingLabel}
      </Badge>
    )
  }
  return null
}

function TimelineConnectors({
  orientation,
  showTopConnector,
  showBottomConnector,
}: {
  orientation: OccurrenceTimelineOrientation
  showTopConnector?: boolean
  showBottomConnector?: boolean
}) {
  const showVertical = orientation !== 'horizontal'
  const showHorizontal = orientation !== 'vertical'
  const verticalOnly = orientation === 'vertical'
  const horizontalOnly = orientation === 'horizontal'

  return (
    <>
      {showTopConnector && showVertical && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0 h-[calc(50%-0.875rem)] w-px -translate-x-1/2 bg-border',
            NODE_CENTER_LEFT,
            !verticalOnly && 'sm:hidden',
          )}
        />
      )}
      {showBottomConnector && showVertical && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-0 top-[calc(50%+0.875rem)] w-px -translate-x-1/2 bg-border',
            NODE_CENTER_LEFT,
            !verticalOnly && 'sm:hidden',
          )}
        />
      )}
      {showTopConnector && showHorizontal && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-3.5 left-0 h-px w-1/2 -translate-y-1/2 bg-border',
            horizontalOnly ? 'block' : 'hidden sm:block',
          )}
        />
      )}
      {showBottomConnector && showHorizontal && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-3.5 left-1/2 right-0 h-px -translate-y-1/2 bg-border',
            horizontalOnly ? 'block' : 'hidden sm:block',
          )}
        />
      )}
    </>
  )
}

function itemLayoutClass(orientation: OccurrenceTimelineOrientation) {
  if (orientation === 'vertical') {
    return 'grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3'
  }
  if (orientation === 'horizontal') {
    return 'flex flex-1 flex-col items-stretch'
  }
  return cn(
    'grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3',
    'sm:flex sm:flex-1 sm:flex-col sm:items-stretch sm:gap-x-0',
  )
}

function nodeColumnClass(orientation: OccurrenceTimelineOrientation) {
  if (orientation === 'vertical') {
    return cn('relative z-10 flex justify-center', NODE_COLUMN_CLASS)
  }
  if (orientation === 'horizontal') {
    return 'relative z-10 flex h-7 w-full items-center justify-center'
  }
  return cn(
    'relative z-10 flex justify-center',
    NODE_COLUMN_CLASS,
    'sm:h-7 sm:w-full sm:items-center',
  )
}

function contentClass(orientation: OccurrenceTimelineOrientation) {
  if (orientation === 'vertical') {
    return 'min-w-0'
  }
  if (orientation === 'horizontal') {
    return 'mt-2 min-w-0 px-1 text-center'
  }
  return 'min-w-0 sm:mt-2 sm:px-1 sm:text-center'
}

function dateClass(orientation: OccurrenceTimelineOrientation) {
  if (orientation === 'horizontal') {
    return 'block break-words text-sm font-medium tabular-nums'
  }
  if (orientation === 'vertical') {
    return 'block truncate text-sm font-medium tabular-nums'
  }
  return 'block truncate text-sm font-medium tabular-nums sm:whitespace-normal sm:break-words'
}

function statusBadgeClass(orientation: OccurrenceTimelineOrientation) {
  if (orientation === 'horizontal') return 'mx-auto'
  if (orientation === 'vertical') return undefined
  return 'sm:mx-auto'
}

function OccurrenceDateText({
  date,
  locale,
  orientation,
}: {
  date: Date
  locale: string
  orientation: OccurrenceTimelineOrientation
}) {
  const medium = formatDateOnly(date, locale, { dateStyle: 'medium' })
  const short = formatDateOnly(date, locale, { dateStyle: 'short' })

  if (orientation === 'horizontal') {
    return <span className={dateClass(orientation)}>{short}</span>
  }
  if (orientation === 'vertical') {
    return <span className={dateClass(orientation)}>{medium}</span>
  }
  return (
    <>
      <span className={cn(dateClass('vertical'), 'sm:hidden')}>{medium}</span>
      <span className={cn(dateClass('horizontal'), 'hidden sm:block')}>
        {short}
      </span>
    </>
  )
}

export function OccurrenceTimelineItem({
  entry,
  currentSequence,
  locale,
  currentLabel,
  completedLabel,
  upcomingLabel,
  orientation = 'responsive',
  showTopConnector = false,
  showBottomConnector = false,
  className,
  style,
  'aria-posinset': ariaPosInSet,
  'aria-setsize': ariaSetSize,
}: {
  entry: RecurrenceScheduleEntry
  currentSequence: number
  locale: string
  currentLabel: ReactNode
  completedLabel: ReactNode
  upcomingLabel?: ReactNode
  orientation?: OccurrenceTimelineOrientation
  showTopConnector?: boolean
  showBottomConnector?: boolean
  className?: string
  style?: CSSProperties
  'aria-posinset'?: number
  'aria-setsize'?: number
}) {
  const status = getOccurrenceScheduleStatus(entry, currentSequence)

  return (
    <li
      className={cn(
        'relative min-w-0',
        itemLayoutClass(orientation),
        className,
      )}
      style={style}
      aria-current={status === 'current' ? 'date' : undefined}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
    >
      <TimelineConnectors
        orientation={orientation}
        showTopConnector={showTopConnector}
        showBottomConnector={showBottomConnector}
      />
      <span className={nodeColumnClass(orientation)}>
        <OccurrenceTimelineNode status={status} sequence={entry.sequence} />
      </span>
      <span className={contentClass(orientation)}>
        <OccurrenceDateText
          date={entry.date}
          locale={locale}
          orientation={orientation}
        />
        <OccurrenceStatusLabel
          status={status}
          currentLabel={currentLabel}
          completedLabel={completedLabel}
          upcomingLabel={upcomingLabel}
          className={statusBadgeClass(orientation)}
        />
      </span>
    </li>
  )
}

export function OccurrenceTimelineMoreItem({
  label,
  onClick,
  orientation = 'responsive',
  showTopConnector = true,
  className,
}: {
  label: ReactNode
  onClick: () => void
  orientation?: OccurrenceTimelineOrientation
  showTopConnector?: boolean
  className?: string
}) {
  return (
    <li
      className={cn(
        'relative min-w-0',
        itemLayoutClass(orientation),
        className,
      )}
    >
      <TimelineConnectors
        orientation={orientation}
        showTopConnector={showTopConnector}
        showBottomConnector={false}
      />
      <span className={nodeColumnClass(orientation)}>
        <span
          className={cn(
            'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-primary/60 bg-background text-primary',
          )}
        >
          <Ellipsis className="size-3.5" aria-hidden="true" />
        </span>
      </span>
      <span className={cn(contentClass(orientation), 'self-center')}>
        <Button
          type="button"
          variant="link"
          className={cn(
            'h-auto px-0 py-0 text-sm',
            orientation === 'horizontal' && 'w-full justify-center',
            orientation === 'responsive' && 'sm:w-full sm:justify-center',
            orientation === 'vertical' && 'justify-start',
          )}
          onClick={onClick}
        >
          {label}
        </Button>
      </span>
    </li>
  )
}

export function OccurrenceTimeline({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return (
    <ol
      className={cn(
        'flex list-none flex-col gap-0 sm:flex-row sm:items-start sm:gap-0',
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
    </ol>
  )
}

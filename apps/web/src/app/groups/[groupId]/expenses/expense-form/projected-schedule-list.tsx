import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { formatDateOnly } from '@/lib/utils'
import {
  OccurrenceStatusLabel,
  OccurrenceTimelineNode,
} from './occurrence-timeline'
import {
  getOccurrenceScheduleStatus,
  type RecurrenceSchedule,
  type RecurrenceScheduleEntry,
} from './recurrence-schedule'

const DEFAULT_PAGE_SIZE = 100
const ROW_HEIGHT = 72

export type ProjectedScheduleListProps = {
  schedule: RecurrenceSchedule
  locale?: string
  currentLabel?: ReactNode
  completedLabel?: ReactNode
  noEndLabel?: ReactNode
  emptyLabel?: ReactNode
  ariaLabel?: string
  className?: string
  pageSize?: number
}

/**
 * A bounded-DOM vertical timeline schedule viewer. Rows are resolved by
 * index, so opening a very long or indefinite recurrence never allocates
 * the entire series.
 */
export function ProjectedScheduleList({
  schedule,
  locale = 'en-US',
  currentLabel = 'Current occurrence',
  completedLabel = 'Created',
  noEndLabel = 'No end date',
  emptyLabel = 'No occurrences',
  ariaLabel = 'Projected recurrence schedule',
  className,
  pageSize = DEFAULT_PAGE_SIZE,
}: ProjectedScheduleListProps) {
  const scrollRef = useRef<HTMLOListElement>(null)
  const page = Math.max(1, Math.round(pageSize))
  const [loadedCount, setLoadedCount] = useState(() =>
    Math.min(page, schedule.totalCount ?? page),
  )

  // A changed rule/anchor is a new logical list. Reset both the loaded window
  // and scroll position so a prior long-list position cannot leak across it.
  useEffect(() => {
    setLoadedCount(Math.min(page, schedule.totalCount ?? page))
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [
    page,
    schedule.anchor,
    schedule.config,
    schedule.currentSequence,
    schedule.totalCount,
  ])

  const rowCount =
    schedule.totalCount === null
      ? loadedCount + 1 // sentinel row loads another page for indefinite rules
      : Math.min(loadedCount, schedule.totalCount)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  // JSDOM and a freshly opened drawer can report a zero-height viewport before
  // layout has settled. Render a small initial window in that case; the real
  // virtualizer takes over as soon as the viewport is measurable.
  const visibleItems =
    virtualItems.length > 0
      ? virtualItems
      : Array.from({ length: Math.min(rowCount, 8) }, (_, index) => ({
          index,
          start: index * ROW_HEIGHT,
          size: ROW_HEIGHT,
        }))

  useEffect(() => {
    const last = virtualItems.at(-1)?.index
    if (last === undefined || last < loadedCount - 10) return
    setLoadedCount((current) => {
      if (schedule.totalCount !== null) {
        return Math.min(schedule.totalCount, current + page)
      }
      return current + page
    })
  }, [loadedCount, page, schedule.totalCount, virtualItems])

  const entries = useMemo(() => {
    const resolved = new Map<number, RecurrenceScheduleEntry>()
    for (const item of visibleItems) {
      const entry = schedule.getEntryAt(item.index)
      if (entry) resolved.set(item.index, entry)
    }
    return resolved
  }, [schedule, visibleItems])

  if (schedule.totalCount === 0 || rowCount === 0) {
    return (
      <p className={cn('py-3 text-sm text-muted-foreground', className)}>
        {emptyLabel}
      </p>
    )
  }

  return (
    <>
      <ol
        ref={scrollRef}
        className={cn(
          'relative max-h-[min(65vh,32rem)] list-none overflow-y-auto',
          className,
        )}
        aria-label={ariaLabel}
        aria-busy={visibleItems.length === 0}
      >
        <li
          aria-hidden="true"
          className="pointer-events-none"
          style={{ height: virtualizer.getTotalSize() }}
        />
        {visibleItems.map((item) => {
          const entry = entries.get(item.index)
          if (!entry) return null
          const status = getOccurrenceScheduleStatus(
            entry,
            schedule.currentSequence,
          )
          const continues =
            item.index < rowCount - 1 || schedule.totalCount === null
          return (
            <li
              key={`${entry.sequence}-${entry.date.toISOString()}`}
              className="absolute inset-x-0 top-0 grid grid-cols-[2rem_minmax(0,1fr)] grid-rows-[1.25rem_auto] px-1"
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
              aria-current={status === 'current' ? 'date' : undefined}
              aria-posinset={item.index + 1}
              aria-setsize={schedule.totalCount ?? undefined}
            >
              {item.index > 0 && (
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
                  {formatDateOnly(entry.date, locale, {
                    dateStyle: 'medium',
                  })}
                </span>
                <OccurrenceStatusLabel
                  status={status}
                  currentLabel={currentLabel}
                  completedLabel={completedLabel}
                />
              </span>
            </li>
          )
        })}
      </ol>
      {schedule.totalCount === null && (
        <p className="mt-3 rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          {noEndLabel}
        </p>
      )}
    </>
  )
}

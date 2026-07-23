import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import {
  OCCURRENCE_TIMELINE_ROW_HEIGHT,
  OccurrenceTimelineItem,
} from './occurrence-timeline'
import {
  type RecurrenceSchedule,
  type RecurrenceScheduleEntry,
} from './recurrence-schedule'

const DEFAULT_PAGE_SIZE = 100

export type ProjectedScheduleListProps = {
  schedule: RecurrenceSchedule
  locale?: string
  currentLabel?: ReactNode
  completedLabel?: ReactNode
  upcomingLabel?: ReactNode
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
  upcomingLabel = 'Upcoming',
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
    estimateSize: () => OCCURRENCE_TIMELINE_ROW_HEIGHT,
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  // JSDOM and a freshly opened drawer can report a zero-height viewport before
  // layout has settled. Render a small initial window in that case; the real
  // virtualizer takes over as soon as the viewport is measurable.
  const visibleItems =
    virtualItems.length > 0
      ? virtualItems
      : Array.from(
          { length: Math.min(rowCount, 8) },
          (_, index) => ({
            index,
            start: index * OCCURRENCE_TIMELINE_ROW_HEIGHT,
            size: OCCURRENCE_TIMELINE_ROW_HEIGHT,
          }),
        )

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
          'relative max-h-[min(65vh,32rem)] list-none overflow-y-auto px-1',
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
          const continues =
            item.index < rowCount - 1 || schedule.totalCount === null
          return (
            <OccurrenceTimelineItem
              key={`${entry.sequence}-${entry.date.toISOString()}`}
              orientation="vertical"
              entry={entry}
              currentSequence={schedule.currentSequence}
              locale={locale}
              currentLabel={currentLabel}
              completedLabel={completedLabel}
              upcomingLabel={upcomingLabel}
              showTopConnector={item.index > 0}
              showBottomConnector={continues}
              className="absolute inset-x-0 top-0"
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
              aria-posinset={item.index + 1}
              aria-setsize={schedule.totalCount ?? undefined}
            />
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

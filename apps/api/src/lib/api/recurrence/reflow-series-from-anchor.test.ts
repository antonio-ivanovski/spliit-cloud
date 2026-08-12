import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildCatchUpSeedAfterReflow,
  computeNextMaterializationCursor,
  expectedOccurrenceDate,
  isOutsideTermination,
  isScheduleConfigEqual,
} from './reflow-series-from-anchor'

describe('reflow-series-from-anchor', () => {
  afterEach(() => vi.useRealTimers())

  const weekly = {
    frequency: 'WEEKLY' as const,
    interval: 1,
    end: { type: 'INDEFINITE' as const },
  }
  const daily = {
    frequency: 'DAILY' as const,
    interval: 1,
    end: { type: 'INDEFINITE' as const },
  }

  it('detects schedule changes on frequency, interval, and end', () => {
    expect(isScheduleConfigEqual(weekly, weekly)).toBe(true)
    expect(isScheduleConfigEqual(weekly, daily)).toBe(false)
    expect(isScheduleConfigEqual(weekly, { ...weekly, interval: 2 })).toBe(
      false,
    )
    expect(
      isScheduleConfigEqual(weekly, {
        ...weekly,
        end: { type: 'COUNT', count: 5 },
      }),
    ).toBe(false)
  })

  it('computes expected dates from the re-anchored ordinal', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    expect(
      expectedOccurrenceDate(anchor, daily, 3, 3).toISOString().slice(0, 10),
    ).toBe('2026-01-01')
    expect(
      expectedOccurrenceDate(anchor, daily, 3, 5).toISOString().slice(0, 10),
    ).toBe('2026-01-03')
    expect(
      expectedOccurrenceDate(anchor, weekly, 3, 5).toISOString().slice(0, 10),
    ).toBe('2026-01-15')
  })

  it('flags sequences outside COUNT or DATE termination', () => {
    expect(
      isOutsideTermination(
        { ...daily, end: { type: 'COUNT', count: 5 } },
        5,
        new Date('2026-01-05T00:00:00.000Z'),
      ),
    ).toBe(false)
    expect(
      isOutsideTermination(
        { ...daily, end: { type: 'COUNT', count: 5 } },
        6,
        new Date('2026-01-06T00:00:00.000Z'),
      ),
    ).toBe(true)
    expect(
      isOutsideTermination(
        {
          ...daily,
          end: { type: 'DATE', endDate: new Date('2026-01-10T00:00:00.000Z') },
        },
        20,
        new Date('2026-01-10T00:00:00.000Z'),
      ),
    ).toBe(false)
    expect(
      isOutsideTermination(
        {
          ...daily,
          end: { type: 'DATE', endDate: new Date('2026-01-10T00:00:00.000Z') },
        },
        20,
        new Date('2026-01-11T00:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('computes next cursor without skipping past surviving dates', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const { nextOrdinal, nextOccurrenceDate, completed } =
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 3,
        config: daily,
      })
    expect(nextOrdinal).toBe(4)
    expect(nextOccurrenceDate.toISOString().slice(0, 10)).toBe('2026-01-04')
    expect(completed).toBe(false)
  })

  it('seeds catch-up when the next occurrence is already due', () => {
    const anchor = new Date()
    anchor.setUTCDate(anchor.getUTCDate() - 10)
    anchor.setUTCHours(0, 0, 0, 0)
    const next = new Date(anchor)
    next.setUTCDate(next.getUTCDate() + 1)
    const seed = buildCatchUpSeedAfterReflow({
      seriesId: 'series-1',
      anchorDate: anchor,
      nextOccurrenceDate: next,
      completed: false,
      config: daily,
      maxSequence: 1,
      timeZone: 'UTC',
    })
    expect(seed).not.toBeNull()
    expect(seed?.mode).toBe('INITIAL_CREATION')
    expect(seed?.count).toBe(0)
  })

  it('does not seed catch-up for future next dates', () => {
    const anchor = new Date()
    anchor.setUTCDate(anchor.getUTCDate() + 2)
    anchor.setUTCHours(0, 0, 0, 0)
    const next = new Date(anchor)
    next.setUTCDate(next.getUTCDate() + 1)
    expect(
      buildCatchUpSeedAfterReflow({
        seriesId: 'series-1',
        anchorDate: anchor,
        nextOccurrenceDate: next,
        completed: false,
        config: daily,
        maxSequence: 1,
        timeZone: 'UTC',
      }),
    ).toBeNull()
  })

  it('treats two INDEFINITE configs as equal even with different time components', () => {
    const a = {
      frequency: 'WEEKLY' as const,
      interval: 1,
      end: { type: 'INDEFINITE' as const },
    }
    const b = {
      frequency: 'WEEKLY' as const,
      interval: 1,
      end: { type: 'INDEFINITE' as const },
    }
    expect(isScheduleConfigEqual(a, b)).toBe(true)
  })

  it('treats COUNT and DATE terminations as different schedules', () => {
    const countConfig = { ...daily, end: { type: 'COUNT' as const, count: 3 } }
    const dateConfig = {
      ...daily,
      end: {
        type: 'DATE' as const,
        endDate: new Date('2026-01-10T00:00:00.000Z'),
      },
    }
    expect(isScheduleConfigEqual(countConfig, dateConfig)).toBe(false)
  })

  it('clamps MONTHLY month-end occurrences to the last day of the target month', () => {
    const anchor = new Date('2025-01-31T00:00:00.000Z')
    const monthly = { ...daily, frequency: 'MONTHLY' as const }
    expect(
      expectedOccurrenceDate(anchor, monthly, 1, 2).toISOString().slice(0, 10),
    ).toBe('2025-02-28')
    expect(
      expectedOccurrenceDate(anchor, monthly, 1, 3).toISOString().slice(0, 10),
    ).toBe('2025-03-31')
  })

  it('clamps YEARLY leap-day anchors to Feb 28 in non-leap years and Feb 29 in leap years', () => {
    const leapAnchor = new Date('2024-02-29T00:00:00.000Z')
    const yearly = { ...daily, frequency: 'YEARLY' as const }
    expect(
      expectedOccurrenceDate(leapAnchor, yearly, 1, 2)
        .toISOString()
        .slice(0, 10),
    ).toBe('2025-02-28')
    expect(
      expectedOccurrenceDate(leapAnchor, yearly, 1, 5)
        .toISOString()
        .slice(0, 10),
    ).toBe('2028-02-29')
  })

  it('returns the anchor sequence verbatim when anchorSequence=1', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    expect(
      expectedOccurrenceDate(anchor, daily, 1, 1).toISOString().slice(0, 10),
    ).toBe('2026-01-01')
    expect(
      expectedOccurrenceDate(anchor, daily, 1, 4).toISOString().slice(0, 10),
    ).toBe('2026-01-04')
  })

  it('marks the cursor as completed when COUNT termination is reached', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const countConfig = { ...daily, end: { type: 'COUNT' as const, count: 3 } }
    expect(
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 3,
        config: countConfig,
      }).completed,
    ).toBe(true)
    expect(
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 2,
        config: countConfig,
      }).completed,
    ).toBe(false)
  })

  it('marks the cursor as completed when the next occurrence falls past a DATE end', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const monthly = { ...daily, frequency: 'MONTHLY' as const }
    const insideEnd = {
      ...monthly,
      end: {
        type: 'DATE' as const,
        endDate: new Date('2026-06-01T00:00:00.000Z'),
      },
    }
    expect(
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 1,
        config: insideEnd,
      }).completed,
    ).toBe(false)
    const outsideEnd = {
      ...monthly,
      end: {
        type: 'DATE' as const,
        endDate: new Date('2026-01-15T00:00:00.000Z'),
      },
    }
    expect(
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 1,
        config: outsideEnd,
      }).completed,
    ).toBe(true)
  })

  it('never marks an INDEFINITE schedule as completed', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    expect(
      computeNextMaterializationCursor({
        anchorDate: anchor,
        anchorSequence: 1,
        maxSequence: 365,
        config: daily,
      }).completed,
    ).toBe(false)
  })

  it('returns null from buildCatchUpSeedAfterReflow when the cursor is completed', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const next = new Date('2026-01-02T00:00:00.000Z')
    expect(
      buildCatchUpSeedAfterReflow({
        seriesId: 'series-1',
        anchorDate: anchor,
        nextOccurrenceDate: next,
        completed: true,
        config: daily,
        maxSequence: 3,
        timeZone: 'UTC',
      }),
    ).toBeNull()
  })

  it('returns null from buildCatchUpSeedAfterReflow when the next occurrence is past the COUNT limit', () => {
    vi.setSystemTime(new Date('2026-01-20T00:00:00.000Z'))
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const next = new Date('2026-01-10T00:00:00.000Z')
    const countConfig = { ...daily, end: { type: 'COUNT' as const, count: 5 } }
    expect(
      buildCatchUpSeedAfterReflow({
        seriesId: 'series-1',
        anchorDate: anchor,
        nextOccurrenceDate: next,
        completed: false,
        config: countConfig,
        maxSequence: 5,
        timeZone: 'UTC',
      }),
    ).toBeNull()
  })

  it('emits a reflow catch-up seed with mode INITIAL_CREATION and an id ending in :reflow', () => {
    vi.setSystemTime(new Date('2026-01-20T00:00:00.000Z'))
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const next = new Date('2026-01-10T00:00:00.000Z')
    const seed = buildCatchUpSeedAfterReflow({
      seriesId: 'series-reflow',
      anchorDate: anchor,
      nextOccurrenceDate: next,
      completed: false,
      config: daily,
      maxSequence: 1,
      timeZone: 'UTC',
    })
    expect(seed).not.toBeNull()
    expect(seed?.mode).toBe('INITIAL_CREATION')
    expect(seed?.id).toBe('recurring-catchup:series-reflow:2026-01-01:reflow')
    expect(seed?.id.endsWith(':reflow')).toBe(true)
  })

  it('uses the positive-offset ledger calendar day at a UTC date boundary', () => {
    vi.setSystemTime(new Date('2026-01-01T23:30:00.000Z'))
    const seed = buildCatchUpSeedAfterReflow({
      seriesId: 'series-tokyo',
      anchorDate: new Date('2026-01-01T00:00:00.000Z'),
      nextOccurrenceDate: new Date('2026-01-02T00:00:00.000Z'),
      completed: false,
      config: daily,
      maxSequence: 1,
      timeZone: 'Asia/Tokyo',
    })
    expect(seed?.dueThrough).toBe('2026-01-02')
  })

  it('uses the negative-offset ledger calendar day at a UTC date boundary', () => {
    vi.setSystemTime(new Date('2026-01-02T00:30:00.000Z'))
    const seed = buildCatchUpSeedAfterReflow({
      seriesId: 'series-los-angeles',
      anchorDate: new Date('2025-12-31T00:00:00.000Z'),
      nextOccurrenceDate: new Date('2026-01-01T00:00:00.000Z'),
      completed: false,
      config: daily,
      maxSequence: 1,
      timeZone: 'America/Los_Angeles',
    })
    expect(seed?.dueThrough).toBe('2026-01-01')
  })
})

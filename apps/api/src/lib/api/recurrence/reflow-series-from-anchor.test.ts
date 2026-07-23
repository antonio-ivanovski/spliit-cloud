import { describe, expect, it } from 'vitest'
import {
  buildCatchUpSeedAfterReflow,
  computeNextMaterializationCursor,
  expectedOccurrenceDate,
  isOutsideTermination,
  isScheduleConfigEqual,
} from './reflow-series-from-anchor'

describe('reflow-series-from-anchor', () => {
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
      }),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  calculateRecurrenceDate,
  countDueBackfillOccurrences,
  getOccurrenceScheduleStatus,
  getRecurrencePreviewDates,
  getRecurrenceSchedule,
  getRecurrenceScheduleMetadata,
  isScheduleConfigEqual,
  type RecurrenceConfig,
} from './recurrence-schedule'

const config = (
  frequency: RecurrenceConfig['frequency'],
  interval = 1,
): RecurrenceConfig => ({
  frequency,
  interval,
  end: { type: 'INDEFINITE' },
})

describe('recurrence schedule preview', () => {
  it('supports repeat every N days and weeks', () => {
    const anchor = new Date('2026-01-10T12:00:00.000Z')
    expect(
      calculateRecurrenceDate(anchor, config('DAILY', 5), 1).toISOString(),
    ).toContain('2026-01-15')
    expect(
      calculateRecurrenceDate(anchor, config('WEEKLY', 2), 2).toISOString(),
    ).toContain('2026-02-07')
  })

  it('clamps monthly dates without losing the original anchor day', () => {
    const anchor = new Date('2025-01-31T12:00:00.000Z')
    expect(
      calculateRecurrenceDate(anchor, config('MONTHLY'), 1).toISOString(),
    ).toContain('2025-02-28')
    expect(
      calculateRecurrenceDate(anchor, config('MONTHLY'), 2).toISOString(),
    ).toContain('2025-03-31')
  })

  it('supports yearly leap-day recurrence', () => {
    const anchor = new Date('2024-02-29T12:00:00.000Z')
    expect(
      calculateRecurrenceDate(anchor, config('YEARLY'), 1).toISOString(),
    ).toContain('2025-02-28')
    expect(
      calculateRecurrenceDate(anchor, config('YEARLY'), 4).toISOString(),
    ).toContain('2028-02-29')
  })

  it('respects count and inclusive date termination', () => {
    const anchor = new Date('2026-01-01T12:00:00.000Z')
    expect(
      getRecurrencePreviewDates(anchor, {
        ...config('DAILY'),
        end: { type: 'COUNT', count: 3 },
      }).map((date) => date.toISOString().slice(0, 10)),
    ).toEqual(['2026-01-02', '2026-01-03'])
    expect(
      getRecurrencePreviewDates(anchor, {
        ...config('DAILY'),
        end: { type: 'DATE', endDate: new Date('2026-01-03T12:00:00.000Z') },
      }).map((date) => date.toISOString().slice(0, 10)),
    ).toEqual(['2026-01-02', '2026-01-03'])
  })

  it('calculates future dates relative to an edited occurrence', () => {
    const anchor = new Date('2026-02-28T12:00:00.000Z')
    const schedule = getRecurrenceSchedule(anchor, config('MONTHLY'), 2)
    expect(
      schedule.entries
        .slice(0, 3)
        .map(({ date, sequence }) => [
          sequence,
          date.toISOString().slice(0, 10),
        ]),
    ).toEqual([
      [2, '2026-02-28'],
      [3, '2026-03-28'],
      [4, '2026-04-28'],
    ])
  })

  it('marks large finite schedules as bounded summaries', () => {
    const schedule = getRecurrenceSchedule(
      new Date('2026-01-01T12:00:00.000Z'),
      { ...config('DAILY'), end: { type: 'COUNT', count: 101 } },
    )
    expect(schedule.entries).toHaveLength(101)
    expect(schedule.hasMore).toBe(false)
    expect(schedule.remainingCount).toBe(100)

    const larger = getRecurrenceSchedule(new Date('2026-01-01T12:00:00.000Z'), {
      ...config('DAILY'),
      end: { type: 'COUNT', count: 102 },
    })
    expect(larger.hasMore).toBe(true)
    expect(larger.remainingCount).toBe(101)
  })

  it('resolves indexed entries without materializing the schedule', () => {
    const schedule = getRecurrenceScheduleMetadata(
      new Date('2026-01-31T12:00:00.000Z'),
      { ...config('MONTHLY'), end: { type: 'COUNT', count: 1000 } },
      4,
    )
    expect(schedule.entries).toHaveLength(0)
    expect(schedule.totalCount).toBe(997)
    expect(schedule.getEntryAt(0)?.sequence).toBe(4)
    expect(schedule.getEntryAt(1)?.date.toISOString()).toContain('2026-02-28')
    expect(schedule.getEntryAt(996)?.sequence).toBe(1000)
    expect(schedule.getEntryAt(997)).toBeNull()
  })

  it('computes very long finite DATE schedules without an arbitrary sentinel', () => {
    const anchor = new Date('2026-01-01T12:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    const schedule = getRecurrenceScheduleMetadata(anchor, {
      ...config('DAILY'),
      end: {
        type: 'DATE',
        endDate: new Date(anchor.getTime() + 11_000_000 * day),
      },
    })
    expect(schedule.totalCount).toBe(11_000_001)
    expect(schedule.hasMore).toBe(true)
    expect(schedule.getEntryAt(11_000_000)?.date).toBeInstanceOf(Date)
  })

  it('classifies occurrence schedule status relative to today', () => {
    const today = new Date('2026-07-23T00:00:00.000Z')
    expect(
      getOccurrenceScheduleStatus(
        { sequence: 2, date: new Date('2026-07-23T00:00:00.000Z') },
        2,
        today,
      ),
    ).toBe('current')
    expect(
      getOccurrenceScheduleStatus(
        { sequence: 1, date: new Date('2026-07-20T00:00:00.000Z') },
        2,
        today,
      ),
    ).toBe('completed')
    expect(
      getOccurrenceScheduleStatus(
        { sequence: 3, date: new Date('2026-07-30T00:00:00.000Z') },
        2,
        today,
      ),
    ).toBe('upcoming')
  })

  it('detects schedule config changes and due backfill counts', () => {
    expect(isScheduleConfigEqual(config('WEEKLY'), config('DAILY'))).toBe(false)
    expect(isScheduleConfigEqual(config('WEEKLY'), config('WEEKLY'))).toBe(true)
    const anchor = new Date('2026-07-20T00:00:00.000Z')
    const schedule = getRecurrenceSchedule(anchor, config('DAILY'), 1, 20)
    expect(
      countDueBackfillOccurrences(
        schedule,
        new Date('2026-07-23T00:00:00.000Z'),
      ),
    ).toBe(3)
  })
})

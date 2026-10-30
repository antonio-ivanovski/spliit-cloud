import { describe, expect, it } from 'vitest'

import {
  advancePastOverdue,
  personalRecurringCreateSchema,
  personalRecurringUpdateSchema,
  projectPersonalRecurringOccurrences,
  resolvePersonalRecurringCategory,
  toPersonalRecurringSeriesFields,
} from './personal-recurring'
import { dateOnlyInTimeZone } from './timezones'

const tz = (now: Date, timeZone: string) => dateOnlyInTimeZone(now, timeZone)

describe('personal recurring validation', () => {
  it('accepts a basic monthly expense', () => {
    const parsed = personalRecurringCreateSchema.parse({
      frequency: 'MONTHLY',
      interval: 1,
      anchorDate: '2026-10-01',
      end: { type: 'INDEFINITE' },
      kind: 'EXPENSE',
      amount: 1200,
      categoryId: 'groceries',
    })
    expect(parsed.anchorDate).toBe('2026-10-01')
  })

  it('rejects settlement and income-category misuse', () => {
    expect(() =>
      personalRecurringCreateSchema.parse({
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: '2026-10-01',
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'settlement',
      }),
    ).toThrow()
    expect(() =>
      personalRecurringCreateSchema.parse({
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: '2026-10-01',
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'income',
      }),
    ).toThrow()
    expect(() =>
      personalRecurringCreateSchema.parse({
        frequency: 'MONTHLY',
        interval: 0,
        anchorDate: '2026-10-01',
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      }),
    ).toThrow()
    expect(() =>
      personalRecurringCreateSchema.parse({
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: '2026-13-01',
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      }),
    ).toThrow()
  })

  it('rejects an end date before the anchor', () => {
    expect(() =>
      personalRecurringCreateSchema.parse({
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: '2026-10-10',
        end: { type: 'DATE', endDate: '2026-10-01' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      }),
    ).toThrow()
  })

  it('maps general to income for income rows', () => {
    expect(resolvePersonalRecurringCategory('INCOME', 'general')).toBe('income')
    expect(() =>
      resolvePersonalRecurringCategory('EXPENSE', 'settlement'),
    ).toThrow()
  })

  it('validates COUNT against created occurrences', () => {
    // Shrinking to exactly the created count completes the series; only a
    // limit below the created count is invalid.
    expect(
      toPersonalRecurringSeriesFields(
        { type: 'COUNT', count: 2 },
        '2026-10-01',
        2,
      ),
    ).toMatchObject({ occurrenceLimit: 2 })
    expect(() =>
      toPersonalRecurringSeriesFields(
        { type: 'COUNT', count: 1 },
        '2026-10-01',
        2,
      ),
    ).toThrow()
    expect(
      toPersonalRecurringSeriesFields(
        { type: 'COUNT', count: 3 },
        '2026-10-01',
        2,
      ),
    ).toMatchObject({ occurrenceLimit: 3 })
  })

  it('rejects schedule fields on update', () => {
    // Frequency/interval/anchor are immutable after creation; the update
    // schema only carries template/end fields so extra keys fail.
    expect(
      personalRecurringUpdateSchema.safeParse({
        frequency: 'MONTHLY',
        amount: 100,
      }).success,
    ).toBe(false)
  })
})

describe('personal recurring projection', () => {
  const base = {
    anchorDate: '2026-01-31',
    frequency: 'MONTHLY' as const,
    interval: 1,
    endType: 'INDEFINITE' as const,
    occurrenceLimit: null,
    endDate: null,
    nextOccurrenceOrdinal: 1,
    timeZone: 'UTC',
    occurrencesCreated: 0,
  }

  it('projects from the cursor with clamped February dates', () => {
    const out = projectPersonalRecurringOccurrences({
      series: base,
      now: new Date('2026-01-15T12:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 3,
    })
    expect(out.map((o) => o.dateIso)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
    expect(out.map((o) => o.sequence)).toEqual([1, 2, 3])
  })

  it('marks past occurrences overdue in the series timezone', () => {
    const out = projectPersonalRecurringOccurrences({
      series: { ...base, anchorDate: '2026-10-01' },
      now: new Date('2026-10-20T12:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 3,
    })
    expect(out[0]?.overdue).toBe(true)
    // Future occurrences are not overdue.
    expect(out[2]?.overdue).toBe(false)
  })

  it('respects COUNT and DATE bounds and from/to windows', () => {
    const counted = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2026-10-01',
        endType: 'COUNT' as const,
        occurrenceLimit: 2,
        nextOccurrenceOrdinal: 2,
        occurrencesCreated: 1,
      },
      now: new Date('2026-10-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 10,
    })
    expect(counted).toHaveLength(1)
    expect(counted[0]?.sequence).toBe(2)

    // Skipped slots do not consume COUNT budget: ordinal past the limit still
    // projects while created rows remain.
    const skippedStillProjects = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2026-10-01',
        frequency: 'DAILY' as const,
        endType: 'COUNT' as const,
        occurrenceLimit: 2,
        nextOccurrenceOrdinal: 5,
        occurrencesCreated: 0,
      },
      now: new Date('2026-10-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 10,
    })
    expect(skippedStillProjects.map((o) => o.sequence)).toEqual([5, 6])

    // Completed COUNT projects nothing.
    const completed = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2026-10-01',
        endType: 'COUNT' as const,
        occurrenceLimit: 2,
        nextOccurrenceOrdinal: 3,
        occurrencesCreated: 2,
      },
      now: new Date('2026-10-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 10,
    })
    expect(completed).toHaveLength(0)

    const dated = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2026-10-01',
        frequency: 'DAILY' as const,
        endType: 'DATE' as const,
        endDate: '2026-10-02',
        nextOccurrenceOrdinal: 1,
      },
      now: new Date('2026-10-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 10,
    })
    expect(dated.map((o) => o.dateIso)).toEqual(['2026-10-01', '2026-10-02'])

    const windowed = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2026-10-01',
        frequency: 'DAILY' as const,
      },
      from: '2026-10-03',
      to: '2026-10-04',
      now: new Date('2026-10-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 10,
    })
    expect(windowed.map((o) => o.dateIso)).toEqual(['2026-10-03', '2026-10-04'])
  })

  it('handles leap-day anchors', () => {
    const out = projectPersonalRecurringOccurrences({
      series: {
        ...base,
        anchorDate: '2024-02-29',
        frequency: 'YEARLY' as const,
        nextOccurrenceOrdinal: 1,
      },
      now: new Date('2024-01-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 2,
    })
    expect(out.map((o) => o.dateIso)).toEqual(['2024-02-29', '2025-02-28'])
  })

  it('clamps the projection limit', () => {
    expect(() =>
      projectPersonalRecurringOccurrences({
        series: base,
        now: new Date('2026-01-01T00:00:00.000Z'),
        dateOnlyInTimeZone: tz,
        limit: 367,
      }),
    ).toThrow()
  })
})

describe('advancePastOverdue', () => {
  it('skips overdue daily occurrences without mutating inputs', () => {
    const input = {
      anchorDate: '2026-10-01',
      frequency: 'DAILY' as const,
      interval: 1,
      nextOccurrenceOrdinal: 1,
      timeZone: 'UTC',
      today: '2026-10-05',
    }
    const result = advancePastOverdue(input)
    expect(result).toMatchObject({
      nextOccurrenceOrdinal: 5,
      skipped: 4,
    })
    expect(result.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      '2026-10-05',
    )
    expect(input.nextOccurrenceOrdinal).toBe(1)
  })

  it('keeps future cursors in place', () => {
    const result = advancePastOverdue({
      anchorDate: '2026-10-10',
      frequency: 'DAILY' as const,
      interval: 1,
      nextOccurrenceOrdinal: 1,
      timeZone: 'UTC',
      today: '2026-10-05',
    })
    expect(result).toMatchObject({ nextOccurrenceOrdinal: 1, skipped: 0 })
  })

  it('respects timezone boundaries', () => {
    // 2026-10-05 01:00 UTC is still Oct 4 in New York.
    const now = new Date('2026-10-05T01:00:00.000Z')
    const todayNy = dateOnlyInTimeZone(now, 'America/New_York')
    expect(todayNy.toISOString().slice(0, 10)).toBe('2026-10-04')
    const result = advancePastOverdue({
      anchorDate: '2026-10-01',
      frequency: 'DAILY' as const,
      interval: 1,
      nextOccurrenceOrdinal: 1,
      timeZone: 'America/New_York',
      today: todayNy,
    })
    expect(result.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      '2026-10-04',
    )
    expect(result.nextOccurrenceOrdinal).toBe(4)
  })

  it('fast-forwards a far-future from on daily series', () => {
    const out = projectPersonalRecurringOccurrences({
      series: {
        anchorDate: '2026-01-01',
        frequency: 'DAILY' as const,
        interval: 1,
        endType: 'INDEFINITE' as const,
        occurrenceLimit: null,
        endDate: null,
        nextOccurrenceOrdinal: 1,
        timeZone: 'UTC',
        occurrencesCreated: 0,
      },
      from: '2031-01-01',
      now: new Date('2026-01-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 3,
    })
    expect(out.map((o) => o.dateIso)).toEqual([
      '2031-01-01',
      '2031-01-02',
      '2031-01-03',
    ])
  })

  it('fast-forwards a far-future from on weekly series', () => {
    const out = projectPersonalRecurringOccurrences({
      series: {
        anchorDate: '2026-01-01',
        frequency: 'WEEKLY' as const,
        interval: 2,
        endType: 'INDEFINITE' as const,
        occurrenceLimit: null,
        endDate: null,
        nextOccurrenceOrdinal: 1,
        timeZone: 'UTC',
        occurrencesCreated: 0,
      },
      from: '2031-01-01',
      now: new Date('2026-01-01T00:00:00.000Z'),
      dateOnlyInTimeZone: tz,
      limit: 2,
    })
    expect(out).toHaveLength(2)
    expect(out[0]!.date.getTime()).toBeGreaterThanOrEqual(
      new Date('2031-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('fast-forwards a decade-overdue daily cursor to today', () => {
    const result = advancePastOverdue({
      anchorDate: '2016-01-01',
      frequency: 'DAILY' as const,
      interval: 1,
      nextOccurrenceOrdinal: 1,
      timeZone: 'UTC',
      today: '2026-01-01',
    })
    expect(result.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      '2026-01-01',
    )
    expect(result.nextOccurrenceOrdinal).toBeGreaterThan(3000)
    expect(result.skipped).toBe(result.nextOccurrenceOrdinal - 1)
  })

  it('ignores COUNT ordinals when advancing overdue slots', () => {
    const result = advancePastOverdue({
      anchorDate: '2026-10-01',
      frequency: 'DAILY' as const,
      interval: 1,
      nextOccurrenceOrdinal: 1,
      timeZone: 'UTC',
      today: '2026-10-05',
      endType: 'COUNT',
      occurrenceLimit: 2,
    })
    expect(result.nextOccurrenceOrdinal).toBe(5)
    expect(result.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      '2026-10-05',
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildRecurringSummaryContent,
  formatRecurrenceRule,
  formatRecurrenceRuleBrief,
} from './expense-notification-content'

describe('formatRecurrenceRule', () => {
  it('renders DAILY interval 1 with no termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'DAILY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every day')
  })

  it('renders WEEKLY interval 1 with no termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'WEEKLY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every week')
  })

  it('renders MONTHLY interval 1 with no termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'MONTHLY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every month')
  })

  it('renders YEARLY interval 1 with no termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'YEARLY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every year')
  })

  it('renders DAILY interval 2 with plural unit', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'DAILY',
        interval: 2,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every 2 days')
  })

  it('renders MONTHLY interval 3 with COUNT termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'MONTHLY',
        interval: 3,
        endType: 'COUNT',
        occurrenceLimit: 12,
        endDate: null,
      }),
    ).toBe('Every 3 months, 12 total')
  })

  it('renders YEARLY interval 2 with DATE termination', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'YEARLY',
        interval: 2,
        endType: 'DATE',
        occurrenceLimit: null,
        endDate: '2026-12-31',
      }),
    ).toBe('Every 2 years, until 2026-12-31')
  })

  it('omits termination when endType is COUNT but occurrenceLimit is null', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'MONTHLY',
        interval: 1,
        endType: 'COUNT',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every month')
  })

  it('omits termination when endType is DATE but endDate is null', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'WEEKLY',
        interval: 1,
        endType: 'DATE',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every week')
  })

  it('falls back to lowercased frequency for unknown values', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'BIWEEKLY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every biweekly')
  })

  it('handles unknown frequency with interval > 1', () => {
    expect(
      formatRecurrenceRule({
        seriesId: 's-1',
        frequency: 'BIWEEKLY',
        interval: 2,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      }),
    ).toBe('Every 2 biweekly')
  })
})

describe('formatRecurrenceRuleBrief', () => {
  it('returns cadence only without termination (COUNT)', () => {
    expect(
      formatRecurrenceRuleBrief({ frequency: 'MONTHLY', interval: 1 }),
    ).toBe('Every month')
  })

  it('returns cadence only without termination for interval > 1', () => {
    expect(
      formatRecurrenceRuleBrief({ frequency: 'WEEKLY', interval: 2 }),
    ).toBe('Every 2 weeks')
  })

  it('handles unknown frequency with sensible fallback', () => {
    expect(
      formatRecurrenceRuleBrief({ frequency: 'CUSTOM', interval: 1 }),
    ).toBe('Every custom')
  })
})

describe('buildRecurringSummaryContent', () => {
  const baseParams = {
    actorName: 'Alice',
    displayName: 'Test Group',
    count: 3,
    title: 'Lunch',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
  }

  it('renders create copy with cadence and termination', () => {
    const content = buildRecurringSummaryContent({
      ...baseParams,
      operation: 'create',
      recurrenceMeta: {
        seriesId: 's-1',
        frequency: 'MONTHLY',
        interval: 2,
        endType: 'COUNT',
        occurrenceLimit: 12,
        endDate: null,
      },
    })
    expect(content.subject).toContain('3 recurring expenses caught up')
    expect(content.body).toContain(
      'Alice created 3 recurring expenses "Lunch" (Every 2 months, 12 total)',
    )
    expect(content.body).toContain('Test Group')
    expect(content.body).toContain('2026-07-01')
    expect(content.body).toContain('2026-07-03')
  })

  it('renders update copy with stopped suffix when recurrence also stopped', () => {
    const content = buildRecurringSummaryContent({
      ...baseParams,
      operation: 'update',
      stopped: true,
      recurrenceMeta: {
        seriesId: 's-1',
        frequency: 'WEEKLY',
        interval: 1,
        endType: 'NEVER',
        occurrenceLimit: null,
        endDate: null,
      },
    })
    expect(content.body).toContain(' and stopped the recurrence.')
  })

  it('omits recurrence description when recurrenceMeta is absent', () => {
    const content = buildRecurringSummaryContent({
      ...baseParams,
      operation: 'delete',
    })
    expect(content.body).not.toContain('(')
  })

  it('switches noun between expense and expenses by count', () => {
    expect(
      buildRecurringSummaryContent({
        ...baseParams,
        count: 1,
        operation: 'create',
      }).body,
    ).toContain('1 recurring expense ')
    expect(
      buildRecurringSummaryContent({
        ...baseParams,
        count: 4,
        operation: 'update',
      }).body,
    ).toContain('4 recurring expenses ')
  })
})

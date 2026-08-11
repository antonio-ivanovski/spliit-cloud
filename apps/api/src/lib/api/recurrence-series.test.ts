import { describe, expect, it, vi } from 'vitest'

import {
  buildRecurringTemplate,
  getExpenseRecurrence,
  initialSeriesCompleted,
  recurrenceJobStartAfter,
} from './recurrence-series'

describe('recurrence-series API helpers', () => {
  it('maps legacy rules to an interval-one series', () => {
    expect(getExpenseRecurrence({ recurrenceRule: 'WEEKLY' })).toEqual({
      frequency: 'WEEKLY',
      interval: 1,
      end: { type: 'INDEFINITE' },
    })
  })

  it('rejects an end date before the anchor', () => {
    expect(() =>
      getExpenseRecurrence(
        {
          recurrence: {
            frequency: 'DAILY',
            interval: 1,
            end: { type: 'DATE', endDate: '2025-01-01' },
          },
        },
        new Date('2025-01-02T00:00:00Z'),
      ),
    ).toThrow(/must not precede/)
  })

  it('keeps source currency units in the generated template', () => {
    const template = buildRecurringTemplate({
      expense: {
        title: 'Dinner',
        category: 'general',
        amount: 1200,
        isReimbursement: false,
        notes: undefined,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: 'p1', shares: 1200 }],
        splitMode: 'EVENLY',
        paidFor: [{ participant: 'p1', shares: 1 }],
      },
      conversion: {
        ledgerAmountMinor: 1320,
        originalAmount: 1200,
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        conversionSource: 'EXCHANGE',
      },
    })
    expect(template.amount).toBe(1200)
    expect(template.conversionSource).toBe('EXCHANGE')
  })

  it('holds today jobs until 15:00 UTC but runs past dates immediately', () => {
    vi.setSystemTime(new Date('2026-07-22T00:02:00.000Z'))
    expect(
      recurrenceJobStartAfter(new Date('2026-07-22T00:00:00.000Z')),
    ).toEqual(new Date('2026-07-22T15:00:00.000Z'))
    expect(
      recurrenceJobStartAfter(new Date('2026-07-21T00:00:00.000Z')),
    ).toBeUndefined()
    vi.useRealTimers()
  })

  it('schedules 15:00 local time across daylight-saving changes', () => {
    const now = new Date('2026-03-01T00:00:00.000Z')
    expect(
      recurrenceJobStartAfter(new Date('2026-03-07T00:00:00.000Z'), {
        timeZone: 'America/New_York',
        now,
      }),
    ).toEqual(new Date('2026-03-07T20:00:00.000Z'))
    expect(
      recurrenceJobStartAfter(new Date('2026-03-09T00:00:00.000Z'), {
        timeZone: 'America/New_York',
        now,
      }),
    ).toEqual(new Date('2026-03-09T19:00:00.000Z'))
  })

  it('completes when a date end falls before the second occurrence', () => {
    expect(
      initialSeriesCompleted(
        {
          endType: 'DATE',
          occurrenceLimit: null,
          endDate: new Date('2026-06-01'),
        },
        new Date('2026-01-01'),
        new Date('2027-01-01'),
      ),
    ).toBe(true)
  })
})

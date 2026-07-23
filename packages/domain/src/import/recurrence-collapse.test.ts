import { describe, expect, it } from 'vitest'
import {
  collapseExpenseFromNormalized,
  fingerprintLegacyRecurringExpense,
  firstRecurrenceDateAfterToday,
  planLegacyRecurringImport,
  summarizeLegacyRecurringImport,
  type LegacyRecurringCollapseExpense,
} from './recurrence-collapse'

function expense(
  overrides: Partial<LegacyRecurringCollapseExpense> & {
    title?: string
    expenseDate?: string
    recurrenceRule?: LegacyRecurringCollapseExpense['recurrenceRule']
    amount?: number
  } = {},
): LegacyRecurringCollapseExpense {
  return {
    title: overrides.title ?? 'Spotify Monthly',
    expenseDate: overrides.expenseDate ?? '2025-06-19',
    amount: overrides.amount ?? 1000,
    recurrenceRule: overrides.recurrenceRule ?? 'MONTHLY',
    splitMode: overrides.splitMode ?? 'EVENLY',
    isReimbursement: overrides.isReimbursement ?? false,
    paidBy: overrides.paidBy ?? [{ id: 'p1', shares: 1000 }],
    paidFor: overrides.paidFor ?? [
      { id: 'p1', shares: 1 },
      { id: 'p2', shares: 1 },
    ],
    originalCurrency: overrides.originalCurrency ?? null,
    conversionRate: overrides.conversionRate ?? null,
  }
}

describe('fingerprintLegacyRecurringExpense', () => {
  it('returns null for NONE', () => {
    expect(
      fingerprintLegacyRecurringExpense(expense({ recurrenceRule: 'NONE' })),
    ).toBeNull()
  })

  it('matches identical schedules and differs on amount', () => {
    const a = fingerprintLegacyRecurringExpense(expense())
    const b = fingerprintLegacyRecurringExpense(
      expense({ expenseDate: '2025-07-19' }),
    )
    const c = fingerprintLegacyRecurringExpense(expense({ amount: 2000 }))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('planLegacyRecurringImport', () => {
  const today = new Date('2026-07-23T12:00:00.000Z')

  it('plans a single recurring row', () => {
    const expenses = [expense({ expenseDate: '2026-06-01' })]
    const plan = planLegacyRecurringImport(expenses, today)
    expect(plan.series).toHaveLength(1)
    expect(plan.membership).toEqual([
      {
        expenseIndex: 0,
        seriesKey: plan.series[0]!.seriesKey,
        sequence: 1,
        isSeriesAnchor: true,
      },
    ])
    expect(plan.series[0]!.occurrenceCount).toBe(1)
    expect(plan.series[0]!.nextOccurrenceDate.toISOString().slice(0, 10)).toBe(
      '2026-08-01',
    )
  })

  it('collapses three matching monthly rows into one series', () => {
    const expenses = [
      expense({ expenseDate: '2025-05-19' }),
      expense({ expenseDate: '2025-06-19' }),
      expense({ expenseDate: '2025-07-19' }),
    ]
    const plan = planLegacyRecurringImport(expenses, today)
    expect(plan.series).toHaveLength(1)
    expect(plan.series[0]!.occurrenceCount).toBe(3)
    expect(plan.series[0]!.anchorIndex).toBe(2)
    expect(
      plan.membership.map((row) => ({
        expenseIndex: row.expenseIndex,
        sequence: row.sequence,
        isSeriesAnchor: row.isSeriesAnchor,
      })),
    ).toEqual([
      { expenseIndex: 0, sequence: 1, isSeriesAnchor: false },
      { expenseIndex: 1, sequence: 2, isSeriesAnchor: false },
      { expenseIndex: 2, sequence: 3, isSeriesAnchor: true },
    ])
    expect(summarizeLegacyRecurringImport(expenses)).toEqual([
      { title: 'Spotify Monthly', recurrenceRule: 'MONTHLY' },
    ])
  })

  it('keeps different amounts as separate series', () => {
    const expenses = [
      expense({ title: 'Rent', amount: 1000, expenseDate: '2026-01-01' }),
      expense({ title: 'Rent', amount: 1200, expenseDate: '2026-02-01' }),
    ]
    const plan = planLegacyRecurringImport(expenses, today)
    expect(plan.series).toHaveLength(2)
    expect(summarizeLegacyRecurringImport(expenses)).toEqual([
      { title: 'Rent', recurrenceRule: 'MONTHLY' },
      { title: 'Rent', recurrenceRule: 'MONTHLY' },
    ])
  })

  it('ignores NONE rows', () => {
    const expenses = [
      expense({ recurrenceRule: 'NONE' }),
      expense({ title: 'Gym', recurrenceRule: 'WEEKLY', expenseDate: '2026-07-01' }),
    ]
    const plan = planLegacyRecurringImport(expenses, today)
    expect(plan.series).toHaveLength(1)
    expect(plan.series[0]!.title).toBe('Gym')
    expect(plan.membership).toHaveLength(1)
  })
})

describe('firstRecurrenceDateAfterToday', () => {
  it('advances past overdue dates', () => {
    const next = firstRecurrenceDateAfterToday(
      'MONTHLY',
      '2026-06-01',
      new Date('2026-07-23T00:00:00.000Z'),
    )
    expect(next.toISOString().slice(0, 10)).toBe('2026-08-01')
  })
})

describe('collapseExpenseFromNormalized', () => {
  it('maps paidBySourceId when paidBy is absent', () => {
    const collapsed = collapseExpenseFromNormalized({
      title: 'Netflix',
      expenseDate: '2026-06-01',
      amount: 500,
      recurrenceRule: 'MONTHLY',
      splitMode: 'EVENLY',
      isReimbursement: false,
      paidBySourceId: 'p1',
      paidFor: [{ sourceId: 'p1', shares: 1 }],
    })
    expect(collapsed.paidBy).toEqual([{ id: 'p1', shares: 500 }])
  })
})

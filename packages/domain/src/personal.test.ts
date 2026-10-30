import { describe, expect, it } from 'vitest'

import {
  calculatePersonalBudgetUsage,
  decodePersonalEntryCursor,
  encodePersonalEntryCursor,
  getPersonalBudgetStatus,
  getPersonalMonthBounds,
  getPreviousPersonalMonthBounds,
  normalizePersonalBudgetCategories,
  personalBudgetMatchesCategory,
  personalMonthInputSchema,
  personalTransactionCreateSchema,
  pickOverallPersonalBudget,
  resolvePersonalInclusion,
} from './personal'

const TZ = 'Europe/Vienna'

function inclusion(
  overrides: Partial<Parameters<typeof resolvePersonalInclusion>[0]> = {},
) {
  return resolvePersonalInclusion({
    masterEnabled: true,
    rule: { included: true, includeFrom: null },
    override: null,
    expense: { categoryId: 'groceries', date: '2026-10-10T10:00:00.000Z' },
    profileTimeZone: TZ,
    share: 3200,
    ...overrides,
  })
}

describe('resolvePersonalInclusion', () => {
  it('includes an opted-in group expense at the holder share', () => {
    expect(inclusion()).toMatchObject({
      included: true,
      categoryId: 'groceries',
    })
  })

  it('is gated by the master switch even when the group is opted in', () => {
    expect(inclusion({ masterEnabled: false }).included).toBe(false)
  })

  it('requires the group rule when there is no per-expense override', () => {
    expect(
      inclusion({ rule: { included: false, includeFrom: null } }).included,
    ).toBe(false)
  })

  it('lets a per-expense INCLUDE pin a single expense from an off group', () => {
    expect(
      inclusion({
        rule: { included: false, includeFrom: null },
        override: { state: 'INCLUDE', categoryId: null },
      }).included,
    ).toBe(true)
  })

  it('lets a per-expense EXCLUDE win over an included group', () => {
    expect(
      inclusion({ override: { state: 'EXCLUDE', categoryId: null } }).included,
    ).toBe(false)
  })

  it('uses the personal category override', () => {
    expect(
      inclusion({ override: { state: null, categoryId: 'dining-out' } })
        .categoryId,
    ).toBe('dining-out')
  })

  it('never includes settlements', () => {
    expect(
      inclusion({ expense: { categoryId: 'settlement', date: new Date() } })
        .included,
    ).toBe(false)
  })

  it('never includes a zero or absent share', () => {
    expect(inclusion({ share: 0 }).included).toBe(false)
  })

  it('respects the includeFrom date', () => {
    expect(
      inclusion({
        rule: { included: true, includeFrom: '2026-10-01' },
        expense: { categoryId: 'groceries', date: '2026-09-30T12:00:00.000Z' },
      }).included,
    ).toBe(false)
    expect(
      inclusion({
        rule: { included: true, includeFrom: '2026-10-01' },
        expense: { categoryId: 'groceries', date: '2026-10-01T12:00:00.000Z' },
      }).included,
    ).toBe(true)
  })

  it('does not shift a calendar includeFrom date in negative offsets', () => {
    expect(
      inclusion({
        profileTimeZone: 'America/New_York',
        rule: { included: true, includeFrom: '2026-10-15' },
        expense: { categoryId: 'groceries', date: '2026-10-15T02:00:00.000Z' },
      }).included,
    ).toBe(false)
    expect(
      inclusion({
        profileTimeZone: 'America/New_York',
        rule: { included: true, includeFrom: '2026-10-15' },
        expense: { categoryId: 'groceries', date: '2026-10-15T12:00:00.000Z' },
      }).included,
    ).toBe(true)
  })

  it('resolves the calendar date in the profile time zone', () => {
    const result = inclusion({
      expense: { categoryId: 'groceries', date: '2026-10-31T23:30:00.000Z' },
    })
    expect(result.date.toISOString().slice(0, 10)).toBe('2026-11-01')
  })
})

describe('personal input schemas', () => {
  it('rejects impossible months instead of throwing in the date pipeline', () => {
    expect(
      personalMonthInputSchema.safeParse({ month: '2026-13' }).success,
    ).toBe(false)
    expect(
      personalMonthInputSchema.safeParse({ month: '2026-00' }).success,
    ).toBe(false)
    expect(
      personalMonthInputSchema.safeParse({ month: '2026-12' }).success,
    ).toBe(true)
  })

  it('rejects impossible calendar dates', () => {
    expect(
      personalTransactionCreateSchema.safeParse({
        kind: 'EXPENSE',
        amount: 100,
        date: '2026-02-31',
        categoryId: 'general',
      }).success,
    ).toBe(false)
  })
})

describe('personal month bounds', () => {
  it('returns UTC calendar bounds for the requested month', () => {
    const bounds = getPersonalMonthBounds('2026-10', TZ)
    expect(bounds.start.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(bounds.end.toISOString().slice(0, 10)).toBe('2026-10-31')
    expect(bounds.days).toBe(31)
  })

  it('handles February in a leap year', () => {
    const bounds = getPersonalMonthBounds('2028-02', TZ)
    expect(bounds.days).toBe(29)
  })

  it('computes the previous month', () => {
    const bounds = getPersonalMonthBounds('2026-01', TZ)
    const previous = getPreviousPersonalMonthBounds(bounds)
    expect(previous.start.toISOString().slice(0, 10)).toBe('2025-12-01')
    expect(previous.end.toISOString().slice(0, 10)).toBe('2025-12-31')
  })
})

describe('personal budgets', () => {
  const bounds = getPersonalMonthBounds('2026-10', TZ)
  const entries = [
    {
      kind: 'EXPENSE' as const,
      categoryId: 'groceries',
      amount: 4_120,
      date: '2026-10-02',
    },
    {
      kind: 'EXPENSE' as const,
      categoryId: 'dining-out',
      amount: 1_800,
      date: '2026-10-03',
    },
    {
      kind: 'INCOME' as const,
      categoryId: 'income',
      amount: 300_000,
      date: '2026-10-01',
    },
    {
      kind: 'EXPENSE' as const,
      categoryId: 'groceries',
      amount: 500,
      date: '2026-11-01',
    },
  ]

  it('expands a parent category selection', () => {
    expect(normalizePersonalBudgetCategories(['food-and-drink'])).toEqual([
      'food-and-drink',
    ])
    expect(
      personalBudgetMatchesCategory(
        { categoryScope: 'SELECTED', categoryIds: ['food-and-drink'] },
        'groceries',
      ),
    ).toBe(true)
  })

  it('sums expenses in the month and selected scope, ignoring income', () => {
    const budget = { categoryScope: 'ALL' as const, categoryIds: [] }
    expect(calculatePersonalBudgetUsage(budget, entries, bounds)).toBe(5_920)
  })

  it('filters by an exact category', () => {
    const budget = {
      categoryScope: 'SELECTED' as const,
      categoryIds: ['groceries'],
    }
    expect(calculatePersonalBudgetUsage(budget, entries, bounds)).toBe(4_120)
  })

  it('expands a parent category selection', () => {
    const budget = {
      categoryScope: 'SELECTED' as const,
      categoryIds: ['food-and-drink'],
    }
    expect(calculatePersonalBudgetUsage(budget, entries, bounds)).toBe(5_920)
  })

  it('reports remaining and over-budget status', () => {
    const budget = {
      amount: 5_000,
      categoryScope: 'ALL' as const,
      categoryIds: [],
    }
    const status = getPersonalBudgetStatus(budget, entries, bounds)
    expect(status.spent).toBe(5_920)
    expect(status.remaining).toBe(-920)
    expect(status.over).toBe(true)
    expect(status.state).toBe('OVER')
  })

  it('picks an ALL budget over category budgets for the hero', () => {
    const all = { categoryScope: 'ALL' as const, amount: 100_000 }
    const food = { categoryScope: 'SELECTED' as const, amount: 40_000 }
    expect(pickOverallPersonalBudget([food, all])).toBe(all)
    expect(pickOverallPersonalBudget([food])).toBeNull()
  })
})

describe('personal entry cursor', () => {
  it('round-trips', () => {
    const cursor = { date: '2026-10-12', id: 'abc-123' }
    expect(
      decodePersonalEntryCursor(encodePersonalEntryCursor(cursor)),
    ).toEqual(cursor)
  })

  it('rejects malformed cursors', () => {
    expect(decodePersonalEntryCursor('not-a-cursor')).toBeNull()
    expect(decodePersonalEntryCursor(undefined)).toBeNull()
  })
})

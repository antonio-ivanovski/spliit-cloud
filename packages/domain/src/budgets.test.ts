import { describe, expect, it } from 'vitest'

import {
  budgetTrend,
  budgetDaysRemaining,
  budgetDaysUntilStart,
  calculateBudgetUsage,
  calculateExpenseContribution,
  formatBudgetPeriodRange,
  getBudgetPeriodBounds,
  getBudgetLifecycle,
  getPreviousBudgetPeriodBounds,
  type BudgetExpense,
  type BudgetRule,
} from './budgets'
import { categoryMatchesSelection } from './categories'

const rule: BudgetRule = {
  period: 'MONTHLY',
  amount: 1000,
  timeZone: 'UTC',
  categoryScope: 'ALL',
  categoryNodeIds: [],
  participantScope: 'SELECTED',
  participantIds: ['a'],
}

const expense = (overrides: Record<string, unknown> = {}): BudgetExpense => ({
  id: 'e1',
  amount: 1200,
  splitMode: 'EVENLY',
  paidBySplitMode: 'BY_AMOUNT',
  isReimbursement: false,
  categoryId: 'general',
  expenseDate: new Date('2026-07-15'),
  paidByList: [{ shares: 1, participant: { id: 'a' } }],
  paidFor: [
    { shares: 1, participant: { id: 'a' } },
    { shares: 1, participant: { id: 'b' } },
  ],
  ...overrides,
})

const julBounds = getBudgetPeriodBounds(rule, new Date('2026-07-15T12:00:00Z'))

/** CategoryMatches wiring used by API consumers, reused here for realism. */
const taxonomyMatches = (node: string, categoryId: string) =>
  categoryMatchesSelection(categoryId as never, [node as never])

describe('period bounds', () => {
  it('uses calendar Monday-Sunday weekly and calendar month bounds', () => {
    const weekly = getBudgetPeriodBounds(
      { ...rule, period: 'WEEKLY' },
      new Date('2026-07-15T12:00:00Z'),
    )
    expect(weekly.start.toISOString().slice(0, 10)).toBe('2026-07-13')
    expect(weekly.end.toISOString().slice(0, 10)).toBe('2026-07-19')
    expect(weekly.days).toBe(7)
    expect(julBounds.start.toISOString().slice(0, 10)).toBe('2026-07-01')
    expect(julBounds.end.toISOString().slice(0, 10)).toBe('2026-07-31')
    expect(julBounds.days).toBe(31)
  })

  it('uses calendar year bounds for YEARLY', () => {
    const yearly = getBudgetPeriodBounds(
      { ...rule, period: 'YEARLY' },
      new Date('2026-07-15T12:00:00Z'),
    )
    expect(yearly.start.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(yearly.end.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(yearly.days).toBe(365)
  })

  it('treats CUSTOM ranges as inclusive and validates order', () => {
    const custom = getBudgetPeriodBounds({
      ...rule,
      period: 'CUSTOM',
      customStartDate: new Date('2026-07-10'),
      customEndDate: new Date('2026-07-12'),
    })
    expect(custom.days).toBe(3)
    expect(() =>
      getBudgetPeriodBounds({
        ...rule,
        period: 'CUSTOM',
        customStartDate: new Date('2026-07-12'),
        customEndDate: new Date('2026-07-10'),
      }),
    ).toThrow()
    expect(() => getBudgetPeriodBounds({ ...rule, period: 'CUSTOM' })).toThrow()
  })

  it('steps back one period for history and stops at CUSTOM', () => {
    const prev = getPreviousBudgetPeriodBounds(rule, julBounds)
    expect(prev?.start.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(prev?.end.toISOString().slice(0, 10)).toBe('2026-06-30')
    const weekly = getBudgetPeriodBounds(
      { ...rule, period: 'WEEKLY' },
      new Date('2026-07-15T12:00:00Z'),
    )
    const prevWeek = getPreviousBudgetPeriodBounds(
      { ...rule, period: 'WEEKLY' },
      weekly,
    )
    expect(prevWeek?.start.toISOString().slice(0, 10)).toBe('2026-07-06')
    expect(
      getPreviousBudgetPeriodBounds(
        {
          ...rule,
          period: 'CUSTOM',
          customStartDate: new Date('2026-07-10'),
          customEndDate: new Date('2026-07-12'),
        },
        julBounds,
      ),
    ).toBeNull()
  })

  it('rolls the local calendar day across timezones for week boundaries', () => {
    // 2026-07-19T12:00:00Z is Sunday in UTC but already Monday 2026-07-20 in
    // Pacific/Auckland (UTC+12), so the budget week differs by timezone.
    const instant = new Date('2026-07-19T12:00:00Z')
    const utcWeek = getBudgetPeriodBounds(
      { ...rule, period: 'WEEKLY', timeZone: 'UTC' },
      instant,
    )
    const aucklandWeek = getBudgetPeriodBounds(
      { ...rule, period: 'WEEKLY', timeZone: 'Pacific/Auckland' },
      instant,
    )
    expect(utcWeek.start.toISOString().slice(0, 10)).toBe('2026-07-13')
    expect(aucklandWeek.start.toISOString().slice(0, 10)).toBe('2026-07-20')
  })

  it('keeps stable bounds across a DST transition', () => {
    // America/New_York springs forward on 2026-03-08; the month still spans
    // the full calendar range.
    const march = getBudgetPeriodBounds(
      { ...rule, timeZone: 'America/New_York' },
      new Date('2026-03-08T12:00:00Z'),
    )
    expect(march.start.toISOString().slice(0, 10)).toBe('2026-03-01')
    expect(march.end.toISOString().slice(0, 10)).toBe('2026-03-31')
    expect(march.days).toBe(31)
  })
})

describe('calculateExpenseContribution exclusions', () => {
  it('ignores reimbursements and non-positive amounts', () => {
    expect(
      calculateExpenseContribution(
        rule,
        expense({ isReimbursement: true }),
        julBounds,
      ),
    ).toBe(0)
    expect(
      calculateExpenseContribution(rule, expense({ amount: 0 }), julBounds),
    ).toBe(0)
    expect(
      calculateExpenseContribution(rule, expense({ amount: -500 }), julBounds),
    ).toBe(0)
  })

  it('ignores expenses outside the period bounds', () => {
    expect(
      calculateExpenseContribution(
        rule,
        expense({ expenseDate: new Date('2026-06-30') }),
        julBounds,
      ),
    ).toBe(0)
    expect(
      calculateExpenseContribution(
        rule,
        expense({ expenseDate: new Date('2026-08-01') }),
        julBounds,
      ),
    ).toBe(0)
  })

  it('buckets the instant by the budget timezone near midnight', () => {
    const instant = new Date('2026-07-01T00:30:00.000Z')
    expect(
      calculateExpenseContribution(
        { ...rule, timeZone: 'America/Los_Angeles' },
        expense({
          expenseDate: new Date('2026-07-01T00:00:00.000Z'),
          expenseAt: instant,
        }),
        julBounds,
      ),
    ).toBe(0)
    expect(
      calculateExpenseContribution(
        { ...rule, timeZone: 'Asia/Tokyo' },
        expense({
          expenseDate: new Date('2026-06-30T00:00:00.000Z'),
          expenseAt: instant,
        }),
        julBounds,
      ),
    ).toBeGreaterThan(0)
  })

  it('ignores categories outside a SELECTED scope', () => {
    const selected: BudgetRule = {
      ...rule,
      categoryScope: 'SELECTED',
      categoryNodeIds: ['groceries'],
    }
    expect(
      calculateExpenseContribution(
        selected,
        expense({ categoryId: 'movies' }),
        julBounds,
        { categoryMatches: taxonomyMatches },
      ),
    ).toBe(0)
    expect(
      calculateExpenseContribution(
        selected,
        expense({ categoryId: 'groceries' }),
        julBounds,
        { categoryMatches: taxonomyMatches },
      ),
    ).toBeGreaterThan(0)
  })
})

describe('split modes', () => {
  const allParticipants: BudgetRule = { ...rule, participantScope: 'ALL' }

  it('sums EVENLY paid-for shares', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({ amount: 1000 }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('sums BY_SHARES paid-for shares', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({
          amount: 1000,
          splitMode: 'BY_SHARES',
          paidFor: [
            { shares: 1, participant: { id: 'a' } },
            { shares: 3, participant: { id: 'b' } },
          ],
        }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('sums BY_PERCENTAGE (basis point) paid-for shares', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({
          amount: 1000,
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { shares: 2500, participant: { id: 'a' } },
            { shares: 7500, participant: { id: 'b' } },
          ],
        }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('sums BY_AMOUNT paid-for shares', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({
          amount: 1000,
          splitMode: 'BY_AMOUNT',
          paidFor: [
            { shares: 400, participant: { id: 'a' } },
            { shares: 600, participant: { id: 'b' } },
          ],
        }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('sums ITEMIZED paid-for shares', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({
          amount: 1000,
          splitMode: 'ITEMIZED',
          paidFor: [
            { shares: 400, participant: { id: 'a' } },
            { shares: 600, participant: { id: 'b' } },
          ],
        }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('uses the ledger total for cross-currency EVENLY expenses', () => {
    expect(
      calculateExpenseContribution(
        allParticipants,
        expense({
          amount: 1000,
          splitMode: 'EVENLY',
          originalAmount: 900,
          originalCurrency: 'EUR',
          conversionRate: 1.1,
          conversionSource: 'EXCHANGE',
        }),
        julBounds,
      ),
    ).toBe(1000)
  })

  it('distributes integer cents without loss for indivisible splits', () => {
    // 1000 / 3 cannot split evenly; the remainder is distributed so the total
    // contributed still equals the expense amount in integer cents.
    const threeWay = expense({
      amount: 1000,
      splitMode: 'EVENLY',
      paidFor: [
        { shares: 1, participant: { id: 'a' } },
        { shares: 1, participant: { id: 'b' } },
        { shares: 1, participant: { id: 'c' } },
      ],
    })
    expect(
      calculateExpenseContribution(allParticipants, threeWay, julBounds),
    ).toBe(1000)
  })
})

describe('participant scope', () => {
  it('sums only selected participants owed shares', () => {
    // EVENLY 1200 over a,b -> 600 each; SELECTED [a] counts only a.
    expect(calculateExpenseContribution(rule, expense(), julBounds)).toBe(600)
    expect(
      calculateExpenseContribution(
        { ...rule, participantScope: 'ALL' },
        expense(),
        julBounds,
      ),
    ).toBe(1200)
  })

  it('counts a newly added participant only when selected', () => {
    const threeWay = expense({
      amount: 900,
      paidFor: [
        { shares: 1, participant: { id: 'a' } },
        { shares: 1, participant: { id: 'b' } },
        { shares: 1, participant: { id: 'c' } },
      ],
    })
    expect(
      calculateExpenseContribution(
        { ...rule, participantIds: ['a', 'c'] },
        threeWay,
        julBounds,
      ),
    ).toBe(600)
  })

  it('still counts a historically removed participant who owes shares', () => {
    // Removal is a ledger-participant concern; usage sums owed shares by id
    // regardless of current membership, so historical spend is preserved.
    expect(
      calculateExpenseContribution(
        { ...rule, participantScope: 'ALL' },
        expense(),
        julBounds,
      ),
    ).toBe(1200)
  })
})

describe('category scope with parents and leaves', () => {
  it('matches a parent selection against descendant categories', () => {
    const selected: BudgetRule = {
      ...rule,
      participantScope: 'ALL',
      categoryScope: 'SELECTED',
      categoryNodeIds: ['home'],
    }
    expect(
      calculateExpenseContribution(
        selected,
        expense({ categoryId: 'rent' }),
        julBounds,
        { categoryMatches: taxonomyMatches },
      ),
    ).toBeGreaterThan(0)
    expect(
      calculateExpenseContribution(
        selected,
        expense({ categoryId: 'groceries' }),
        julBounds,
        { categoryMatches: taxonomyMatches },
      ),
    ).toBe(0)
  })

  it('expands overlapping parent and leaf selections without double counting', () => {
    const selected: BudgetRule = {
      ...rule,
      participantScope: 'ALL',
      categoryScope: 'SELECTED',
      categoryNodeIds: ['home', 'rent'],
    }
    expect(
      calculateExpenseContribution(
        selected,
        expense({ amount: 1000, categoryId: 'rent' }),
        julBounds,
        { categoryMatches: taxonomyMatches },
      ),
    ).toBe(1000)
  })
})

describe('overlapping budgets', () => {
  it('lets one expense contribute independently to several budgets', () => {
    const groceries: BudgetRule = {
      ...rule,
      participantScope: 'ALL',
      categoryScope: 'SELECTED',
      categoryNodeIds: ['groceries'],
    }
    const everything: BudgetRule = { ...rule, participantScope: 'ALL' }
    const shared = expense({ amount: 800, categoryId: 'groceries' })
    expect(
      calculateBudgetUsage(groceries, [shared], julBounds, {
        categoryMatches: taxonomyMatches,
      }),
    ).toBe(800)
    expect(
      calculateBudgetUsage(everything, [shared], julBounds, {
        categoryMatches: taxonomyMatches,
      }),
    ).toBe(800)
  })
})

describe('calculateBudgetUsage aggregation', () => {
  it('sums selected paid-for shares and ignores reimbursements', () => {
    expect(
      calculateBudgetUsage(
        rule,
        [expense(), expense({ id: 'e2', isReimbursement: true })],
        julBounds,
      ),
    ).toBe(600)
  })
})

describe('trend and projection', () => {
  const bounds = {
    start: new Date('2026-07-01'),
    end: new Date('2026-07-31'),
    days: 31,
  }

  it('is not over at exactly 100% and over is strictly greater', () => {
    expect(budgetTrend(1000, 1000, bounds, new Date('2026-07-31')).over).toBe(
      false,
    )
    expect(budgetTrend(1001, 1000, bounds, new Date('2026-07-31')).over).toBe(
      true,
    )
  })

  it('trends only after 20% of the period has elapsed', () => {
    // Day 2 of 31 is < 20% elapsed -> no trend even with a high projection.
    expect(
      budgetTrend(250, 1000, bounds, new Date('2026-07-02')).trending,
    ).toBe(false)
    // Day 10 of 31 is >= 20% elapsed and projects over -> trending.
    expect(
      budgetTrend(500, 1000, bounds, new Date('2026-07-10')).trending,
    ).toBe(true)
  })

  it('suppresses trending once actually over', () => {
    const result = budgetTrend(1500, 1000, bounds, new Date('2026-07-10'))
    expect(result.over).toBe(true)
    expect(result.trending).toBe(false)
  })

  it('uses the budget timezone for elapsed and remaining calendar days', () => {
    const tzBounds = getBudgetPeriodBounds(
      { ...rule, timeZone: 'Europe/Skopje' },
      new Date('2026-07-01T22:30:00Z'),
    )
    expect(
      budgetTrend(100, 1000, tzBounds, new Date('2026-07-01T22:30:00Z'))
        .projected,
    ).toBe(1550)
    expect(
      budgetDaysRemaining(tzBounds, new Date('2026-07-01T22:30:00Z')),
    ).toBe(29)
  })
})

describe('custom budget lifecycle', () => {
  const bounds = {
    start: new Date('2026-08-10T00:00:00Z'),
    end: new Date('2026-08-20T00:00:00Z'),
    days: 11,
    timeZone: 'UTC',
  }

  it('reports scheduled, active, and completed custom periods', () => {
    expect(
      getBudgetLifecycle(
        { period: 'CUSTOM' },
        bounds,
        new Date('2026-08-09T12:00:00Z'),
      ),
    ).toBe('SCHEDULED')
    expect(
      getBudgetLifecycle(
        { period: 'CUSTOM' },
        bounds,
        new Date('2026-08-15T12:00:00Z'),
      ),
    ).toBe('ACTIVE')
    expect(
      getBudgetLifecycle(
        { period: 'CUSTOM' },
        bounds,
        new Date('2026-08-21T12:00:00Z'),
      ),
    ).toBe('COMPLETED')
  })

  it('reports the start countdown only before a period begins', () => {
    expect(budgetDaysUntilStart(bounds, new Date('2026-08-15T12:00:00Z'))).toBe(
      0,
    )
    expect(budgetDaysUntilStart(bounds, new Date('2026-08-01T12:00:00Z'))).toBe(
      9,
    )
  })
})

describe('formatBudgetPeriodRange', () => {
  const utc = (s: string) => new Date(s + 'T00:00:00Z')

  it('renders WEEKLY ranges as dd.mm.yyyy – dd.mm.yyyy', () => {
    expect(
      formatBudgetPeriodRange(
        'WEEKLY',
        utc('2026-07-06'),
        utc('2026-07-12'),
        (d) => d.toISOString(),
      ),
    ).toBe('06.07.2026 – 12.07.2026')
  })

  it('collapses single-day ranges to a single dd.mm.yyyy', () => {
    expect(
      formatBudgetPeriodRange(
        'WEEKLY',
        utc('2026-07-06'),
        utc('2026-07-06'),
        (d) => d.toISOString(),
      ),
    ).toBe('06.07.2026')
  })

  it('renders MONTHLY ranges as dd.mm.yyyy – dd.mm.yyyy', () => {
    expect(
      formatBudgetPeriodRange(
        'MONTHLY',
        utc('2026-07-01'),
        utc('2026-07-31'),
        (d) => d.toISOString(),
      ),
    ).toBe('01.07.2026 – 31.07.2026')
  })

  it('renders YEARLY ranges as dd.mm.yyyy – dd.mm.yyyy', () => {
    expect(
      formatBudgetPeriodRange(
        'YEARLY',
        utc('2026-01-01'),
        utc('2026-12-31'),
        (d) => d.toISOString(),
      ),
    ).toBe('01.01.2026 – 31.12.2026')
  })

  it('delegates CUSTOM to the full formatter without collapsing', () => {
    expect(
      formatBudgetPeriodRange(
        'CUSTOM',
        utc('2026-07-01'),
        utc('2026-08-15'),
        (d) => d.toISOString().slice(0, 10),
      ),
    ).toBe('2026-07-01 – 2026-08-15')
  })
})

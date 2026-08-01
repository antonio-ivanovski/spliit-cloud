import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({
  planBudgetAlertDeliveries: vi.fn(),
}))

vi.mock('../notifications/budget-planner', () => ({
  planBudgetAlertDeliveries: mocks.planBudgetAlertDeliveries,
}))

import { evaluateBudgets } from './evaluate'

const now = new Date()
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

beforeEach(() => {
  mocks.planBudgetAlertDeliveries.mockReset()
  mocks.planBudgetAlertDeliveries.mockResolvedValue([])
})

function budgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bgt-1',
    groupId: 'grp-1',
    ledgerId: 'ledger-1',
    name: 'Groceries',
    amount: 1000,
    period: 'MONTHLY',
    timeZone: 'UTC',
    customStartDate: null,
    customEndDate: null,
    categoryScope: 'ALL',
    categoryNodeIds: [],
    participantScope: 'ALL',
    participantIds: [],
    notifyTrending: true,
    notifyOver: true,
    archived: false,
    createdByAccountId: 'acct-self',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function overBudgetData(overrides: Record<string, unknown> = {}) {
  return {
    ledger: [{ id: 'ledger-1', currency: '$', currencyCode: 'USD' }],
    group: [
      {
        id: 'grp-1',
        name: 'Test',
        ledgerId: 'ledger-1',
        archived: false,
        groupType: 'GROUP',
      },
    ],
    ledgerParticipant: [
      {
        id: 'lp-a',
        ledgerId: 'ledger-1',
        groupMemberId: null,
        kind: 'ACCOUNT_MEMBER',
        displayName: null,
        removedAt: null,
      },
    ],
    expense: [
      {
        id: 'exp-1',
        ledgerId: 'ledger-1',
        expenseDate: thisMonth,
        title: 'Market',
        categoryId: 'groceries',
        amount: 1500,
        paidBySplitMode: 'BY_AMOUNT',
        isReimbursement: false,
        splitMode: 'EVENLY',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    expensePaidBy: [
      { expenseId: 'exp-1', ledgerParticipantId: 'lp-a', shares: 1500 },
    ],
    expensePaidFor: [
      { expenseId: 'exp-1', ledgerParticipantId: 'lp-a', shares: 1 },
    ],
    groupBudget: [budgetRow(overrides)],
  }
}

describe('evaluateBudgets', () => {
  it('plans delivery the first time a budget goes over', async () => {
    usePrismaMemoryStore(overBudgetData())
    const results = await evaluateBudgets('grp-1', null)
    expect(results).toHaveLength(1)
    expect(results[0]?.over).toBe(true)
    expect(mocks.planBudgetAlertDeliveries).toHaveBeenCalledTimes(1)
    expect(
      mocks.planBudgetAlertDeliveries.mock.calls[0]?.[0]?.budget.alertType,
    ).toBe('OVER')
  })

  it('delivers at most once per budget period', async () => {
    usePrismaMemoryStore(overBudgetData())
    // Simulate a concurrent evaluator having already claimed this period's
    // alert: the unique (budgetId, periodStart, alertType) constraint makes
    // createMany({ skipDuplicates: true }) insert nothing, so count is 0 and
    // this run must bail without planning a duplicate delivery. (prisma-mock
    // cannot emulate ON CONFLICT DO NOTHING, so the no-op is stubbed.)
    prismaMock.groupBudgetAlert.createMany.mockResolvedValue({ count: 0 })
    await evaluateBudgets('grp-1', null)
    expect(mocks.planBudgetAlertDeliveries).not.toHaveBeenCalled()
  })

  it('skips delivery when the over-budget toggle is disabled', async () => {
    usePrismaMemoryStore(overBudgetData({ notifyOver: false }))
    await evaluateBudgets('grp-1', null)
    expect(mocks.planBudgetAlertDeliveries).not.toHaveBeenCalled()
  })

  it('does not evaluate archived budgets', async () => {
    usePrismaMemoryStore(overBudgetData({ archived: true }))
    const results = await evaluateBudgets('grp-1', null)
    expect(results).toHaveLength(0)
    expect(mocks.planBudgetAlertDeliveries).not.toHaveBeenCalled()
  })

  it('marks the alert delivered after planning', async () => {
    usePrismaMemoryStore(overBudgetData())
    await evaluateBudgets('grp-1', null)
    expect(prismaMock.groupBudgetAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          budgetId: 'bgt-1',
          alertType: 'OVER',
        }),
        data: expect.objectContaining({
          deliveredAt: expect.any(Date),
        }),
      }),
    )
  })

  it('does not alert on a future expense inside a custom period', async () => {
    const now = new Date()
    const future = new Date(now.getTime() + 86400000)
    const data = overBudgetData({
      period: 'CUSTOM',
      customStartDate: new Date(now.getTime() - 86400000),
      customEndDate: new Date(now.getTime() + 2 * 86400000),
    })
    data.expense[0]!.expenseDate = future
    usePrismaMemoryStore(data)

    const results = await evaluateBudgets('grp-1', null)

    expect(results[0]?.used).toBe(0)
    expect(mocks.planBudgetAlertDeliveries).not.toHaveBeenCalled()
  })

  it('does not send trending after an over alert already exists', async () => {
    const now = new Date()
    const data = overBudgetData({
      amount: 2000,
      period: 'CUSTOM',
      customStartDate: new Date(now.getTime() - 10 * 86400000),
      customEndDate: new Date(now.getTime() + 10 * 86400000),
    })
    data.expense[0]!.expenseDate = new Date(now.getTime() - 86400000)
    usePrismaMemoryStore(data)
    prismaMock.groupBudgetAlert.findUnique.mockResolvedValue({
      id: 'prior-over',
    } as never)

    await evaluateBudgets('grp-1', null)

    expect(mocks.planBudgetAlertDeliveries).not.toHaveBeenCalled()
    expect(prismaMock.groupBudgetAlert.createMany).not.toHaveBeenCalled()
  })
})

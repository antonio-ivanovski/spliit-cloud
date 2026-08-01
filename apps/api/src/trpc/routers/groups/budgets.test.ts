import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { usePrismaMemoryStore } from '../../../test/prisma-memory-store'
import { groupsRouter } from './index'

function makeCaller(authUserId: string) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

const now = new Date()
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
const lastMonth = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
)

type SeedOptions = {
  role?: 'ADMIN' | 'MEMBER'
  archived?: boolean
  groupType?: 'GROUP' | 'FRIEND'
  memberStatus?: 'ACTIVE' | 'LEFT'
}

function baseData(options: SeedOptions = {}) {
  const role = options.role ?? 'ADMIN'
  return {
    ledger: [{ id: 'ledger-1', currency: '$', currencyCode: 'USD' }],
    group: [
      {
        id: 'grp-1',
        name: 'Test',
        ledgerId: 'ledger-1',
        archived: options.archived ?? false,
        groupType: options.groupType ?? 'GROUP',
      },
    ],
    groupMember: [
      {
        id: 'gm-self',
        groupId: 'grp-1',
        accountId: 'acct-self',
        role,
        status: options.memberStatus ?? 'ACTIVE',
      },
    ],
  }
}

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

/**
 * An EVENLY-split expense paid by lp-a for lp-a and lp-b, returned as the three
 * top-level tables prisma-mock resolves relations from.
 */
function evenExpense(
  id: string,
  amount: number,
  expenseDate: Date,
  categoryId = 'groceries',
) {
  return {
    expense: [
      {
        id,
        ledgerId: 'ledger-1',
        expenseDate,
        title: 'Market',
        categoryId,
        amount,
        paidBySplitMode: 'BY_AMOUNT',
        isReimbursement: false,
        splitMode: 'EVENLY',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    expensePaidBy: [
      { expenseId: id, ledgerParticipantId: 'lp-a', shares: amount },
    ],
    expensePaidFor: [
      { expenseId: id, ledgerParticipantId: 'lp-a', shares: 1 },
      { expenseId: id, ledgerParticipantId: 'lp-b', shares: 1 },
    ],
  }
}

const participants = {
  ledgerParticipant: [
    {
      id: 'lp-a',
      ledgerId: 'ledger-1',
      groupMemberId: 'gm-self',
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      removedAt: null,
    },
    {
      id: 'lp-b',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      removedAt: null,
    },
  ],
}

describe('groupsRouter.budgets authorization', () => {
  it('lets an ADMIN create a budget and snapshots the account timezone', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      accountPreference: [
        { id: 'pref-1', accountId: 'acct-self', timeZone: 'Europe/Paris' },
      ],
    })
    const result = await makeCaller('acct-self').budgets.create({
      groupId: 'grp-1',
      name: 'Groceries',
      amount: 1000,
      periodType: 'MONTHLY',
    })
    expect(result.budget.timeZone).toBe('Europe/Paris')
    expect(result.budget.name).toBe('Groceries')
    expect(result.budget.summary.trendStatus).toBe('ON_TRACK')
  })

  it('falls back to UTC when the account has no timezone', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    const result = await makeCaller('acct-self').budgets.create({
      groupId: 'grp-1',
      name: 'Groceries',
      amount: 1000,
      periodType: 'MONTHLY',
    })
    expect(result.budget.timeZone).toBe('UTC')
  })

  it('lets an ADMIN create a budget in a friend ledger', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN', groupType: 'FRIEND' }),
      accountPreference: [
        { id: 'pref-1', accountId: 'acct-self', timeZone: 'UTC' },
      ],
    })
    const result = await makeCaller('acct-self').budgets.create({
      groupId: 'grp-1',
      name: 'Shared',
      amount: 500,
      periodType: 'MONTHLY',
    })
    expect(result.budget.name).toBe('Shared')
  })

  it('allows a MEMBER caller to create a budget', async () => {
    usePrismaMemoryStore(baseData({ role: 'MEMBER' }))
    const result = await makeCaller('acct-self').budgets.create({
      groupId: 'grp-1',
      name: 'Groceries',
      amount: 1000,
      periodType: 'MONTHLY',
    })
    expect(result.budget.permissions.canEdit).toBe(true)
  })

  it('rejects mutations on an archived group but still allows reads', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN', archived: true }),
      groupBudget: [budgetRow()],
    })
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Groceries',
        amount: 1000,
        periodType: 'MONTHLY',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const list = await makeCaller('acct-self').budgets.list({
      groupId: 'grp-1',
      includeArchived: true,
    })
    expect(list.budgets).toHaveLength(1)
  })

  it('rejects a non-active member with FORBIDDEN', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN', memberStatus: 'LEFT' }))
    await expect(
      makeCaller('acct-self').budgets.list({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('groupsRouter.budgets validation', () => {
  it('rejects CUSTOM without start and end dates', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Trip',
        amount: 1000,
        periodType: 'CUSTOM',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects CUSTOM with start after end', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Trip',
        amount: 1000,
        periodType: 'CUSTOM',
        customStart: new Date('2026-07-20'),
        customEnd: new Date('2026-07-10'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects an unknown category node in SELECTED scope', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Groceries',
        amount: 1000,
        periodType: 'MONTHLY',
        categoryScope: 'SELECTED',
        categoryNodeIds: ['not-a-node'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects SELECTED categories when none are supplied', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Groceries',
        amount: 1000,
        periodType: 'MONTHLY',
        categoryScope: 'SELECTED',
        categoryNodeIds: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('stores canonical, deduplicated category ids', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    const result = await makeCaller('acct-self').budgets.create({
      groupId: 'grp-1',
      name: 'Home',
      amount: 1000,
      periodType: 'MONTHLY',
      categoryScope: 'SELECTED',
      categoryNodeIds: ['group:home', 'home', 'rent'],
    })
    expect(result.budget.categoryNodeIds).toEqual(['home', 'rent'])
  })

  it('rejects SELECTED participants when none are supplied', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Groceries',
        amount: 1000,
        periodType: 'MONTHLY',
        participantScope: 'SELECTED',
        participantIds: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects an unknown participant in SELECTED scope', async () => {
    usePrismaMemoryStore({ ...baseData({ role: 'ADMIN' }), ...participants })
    await expect(
      makeCaller('acct-self').budgets.create({
        groupId: 'grp-1',
        name: 'Groceries',
        amount: 1000,
        periodType: 'MONTHLY',
        participantScope: 'SELECTED',
        participantIds: ['lp-missing'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('groupsRouter.budgets read model', () => {
  it('computes used, matching expenses, and prior-period history', async () => {
    const expNow = evenExpense('exp-now', 600, thisMonth)
    const expPrev = evenExpense('exp-prev', 400, lastMonth)
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      ...participants,
      groupBudget: [budgetRow({ amount: 1000 })],
      expense: [...expNow.expense, ...expPrev.expense],
      expensePaidBy: [...expNow.expensePaidBy, ...expPrev.expensePaidBy],
      expensePaidFor: [...expNow.expensePaidFor, ...expPrev.expensePaidFor],
    })
    const result = await makeCaller('acct-self').budgets.get({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
    })
    // EVENLY 600 over lp-a,lp-b -> 300 each; ALL participants -> 600 used.
    expect(result.budget.summary.used).toBe(600)
    expect(result.budget.summary.matchingExpenses).toHaveLength(1)
    expect(result.budget.summary.matchingExpenses[0]?.contribution).toBe(600)
    expect(result.budget.summary.history.length).toBeGreaterThan(0)
    expect(result.budget.summary.history[0]?.used).toBe(400)
  })

  it('excludes future-dated expenses from `used` and surfaces them as committed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'))
    const expPast = evenExpense(
      'exp-past',
      600,
      new Date('2026-07-05T00:00:00Z'),
    )
    const expFuture = evenExpense(
      'exp-future',
      400,
      new Date('2026-07-25T00:00:00Z'),
    )
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      ...participants,
      groupBudget: [budgetRow({ amount: 1000 })],
      expense: [...expPast.expense, ...expFuture.expense],
      expensePaidBy: [...expPast.expensePaidBy, ...expFuture.expensePaidBy],
      expensePaidFor: [...expPast.expensePaidFor, ...expFuture.expensePaidFor],
    })
    const result = await makeCaller('acct-self').budgets.get({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
    })
    expect(result.budget.summary.used).toBe(600)
    expect(result.budget.summary.committed).toBe(400)
    expect(result.budget.summary.matchingExpenses).toHaveLength(1)
    expect(result.budget.summary.matchingExpenses[0]?.id).toBe('exp-past')
    expect(result.budget.summary.upcomingExpenses).toHaveLength(1)
    expect(result.budget.summary.upcomingExpenses[0]?.id).toBe('exp-future')
    expect(result.budget.summary.upcomingExpenses[0]?.contribution).toBe(400)
    vi.useRealTimers()
  })

  it('caps returned expense rows while keeping totals complete', async () => {
    const many = Array.from({ length: 55 }, (_, index) =>
      evenExpense(
        `exp-${index}`,
        1,
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      ),
    )
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      ...participants,
      groupBudget: [budgetRow({ amount: 1000 })],
      expense: many.flatMap((entry) => entry.expense),
      expensePaidBy: many.flatMap((entry) => entry.expensePaidBy),
      expensePaidFor: many.flatMap((entry) => entry.expensePaidFor),
    })
    const result = await makeCaller('acct-self').budgets.get({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
    })
    expect(result.budget.summary.used).toBe(55)
    expect(result.budget.summary.matchingExpenses).toHaveLength(50)
    expect(result.budget.summary.matchingExpensesTotal).toBe(55)
    expect(result.budget.summary.daily).toHaveLength(1)
  })

  it('respects a SELECTED participant scope in usage', async () => {
    const expNow = evenExpense('exp-now', 600, thisMonth)
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      ...participants,
      groupBudget: [
        budgetRow({
          amount: 1000,
          participantScope: 'SELECTED',
          participantIds: ['lp-a'],
        }),
      ],
      expense: expNow.expense,
      expensePaidBy: expNow.expensePaidBy,
      expensePaidFor: expNow.expensePaidFor,
    })
    const result = await makeCaller('acct-self').budgets.get({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
    })
    // Only lp-a's 300 share counts.
    expect(result.budget.summary.used).toBe(300)
  })

  it('returns NOT_FOUND for an unknown budget', async () => {
    usePrismaMemoryStore(baseData({ role: 'ADMIN' }))
    await expect(
      makeCaller('acct-self').budgets.get({
        groupId: 'grp-1',
        budgetId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('hides archived budgets from list unless requested', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      groupBudget: [
        budgetRow({ id: 'bgt-active' }),
        budgetRow({ id: 'bgt-archived', archived: true }),
      ],
    })
    const active = await makeCaller('acct-self').budgets.list({
      groupId: 'grp-1',
    })
    expect(active.budgets.map((b) => b.id)).toEqual(['bgt-active'])
    const all = await makeCaller('acct-self').budgets.list({
      groupId: 'grp-1',
      includeArchived: true,
    })
    expect(all.budgets).toHaveLength(2)
  })
})

describe('groupsRouter.budgets lifecycle', () => {
  it('updates a budget and recalculates the current period', async () => {
    const expNow = evenExpense('exp-now', 600, thisMonth)
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      ...participants,
      groupBudget: [budgetRow({ amount: 1000 })],
      expense: expNow.expense,
      expensePaidBy: expNow.expensePaidBy,
      expensePaidFor: expNow.expensePaidFor,
    })
    const result = await makeCaller('acct-self').budgets.update({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
      name: 'Renamed',
      amount: 500,
      periodType: 'MONTHLY',
    })
    expect(result.budget.name).toBe('Renamed')
    expect(result.budget.amount).toBe(500)
    // 600 used against a 500 limit is over budget.
    expect(result.budget.summary.trendStatus).toBe('OVER')
  })

  it('allows a MEMBER to update their own budget', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'MEMBER' }),
      groupBudget: [budgetRow()],
    })
    const result = await makeCaller('acct-self').budgets.update({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
      name: 'Renamed',
      amount: 500,
      periodType: 'MONTHLY',
    })
    expect(result.budget.name).toBe('Renamed')
  })

  it('rejects update of another member budget', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'MEMBER' }),
      groupBudget: [budgetRow({ createdByAccountId: 'acct-other' })],
    })
    await expect(
      makeCaller('acct-self').budgets.update({
        groupId: 'grp-1',
        budgetId: 'bgt-1',
        name: 'Renamed',
        amount: 500,
        periodType: 'MONTHLY',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('archives and unarchives a budget', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      groupBudget: [budgetRow()],
    })
    const archived = await makeCaller('acct-self').budgets.archive({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
      archived: true,
    })
    expect(archived).toEqual({ archived: true })
    const unarchived = await makeCaller('acct-self').budgets.archive({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
      archived: false,
    })
    expect(unarchived).toEqual({ archived: false })
  })

  it('deletes a budget', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      groupBudget: [budgetRow()],
    })
    const result = await makeCaller('acct-self').budgets.delete({
      groupId: 'grp-1',
      budgetId: 'bgt-1',
    })
    expect(result).toEqual({ deleted: true })
  })

  it('returns NOT_FOUND when archiving a budget from another group', async () => {
    usePrismaMemoryStore({
      ...baseData({ role: 'ADMIN' }),
      groupBudget: [budgetRow({ groupId: 'grp-other' })],
    })
    await expect(
      makeCaller('acct-self').budgets.archive({
        groupId: 'grp-1',
        budgetId: 'bgt-1',
        archived: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

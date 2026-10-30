import { beforeEach, describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock, resetPrisma } from '../../test/state'
import { PersonalInclusionService, runPersonalSyncResult } from './inclusion'

const ACCOUNT = 'acct-sync-perf'
const GROUP = 'grp-sync-perf'

function expenseRow(id: string, overrides: Record<string, unknown> = {}) {
  const date = new Date('2026-08-10T12:00:00.000Z')
  return {
    id,
    ledgerId: 'ledger-1',
    createdByAccountId: null,
    expenseDate: date,
    expenseTimeZone: 'UTC',
    title: 'Dinner',
    categoryId: 'dining-out',
    amount: 1000,
    paidBySplitMode: 'BY_AMOUNT',
    splitMode: 'EVENLY',
    version: 1,
    ledger: {
      currency: '$',
      currencyCode: 'USD',
      group: { id: GROUP, name: 'Trip' },
    },
    paidFor: [
      {
        shares: 1,
        ledgerParticipantId: 'lp-1',
        ledgerParticipant: {
          groupMember: { account: { id: ACCOUNT } },
        },
      },
    ],
    ...overrides,
  }
}

function existingRow(overrides: Record<string, unknown> = {}) {
  const date = new Date('2026-08-10T00:00:00.000Z')
  return {
    id: 'ptx-1',
    sourceDetachedAt: null,
    kind: 'EXPENSE',
    amount: 1000,
    currencyCode: 'USD',
    originalAmount: 1000,
    originalCurrency: 'USD',
    conversionRate: null,
    conversionSource: null,
    date,
    categoryId: 'dining-out',
    title: 'Dinner',
    sourceGroupId: GROUP,
    sourceGroupName: 'Trip',
    sourceExpenseId: 'exp-1',
    ...overrides,
  }
}

beforeEach(() => {
  resetPrisma()
  prismaMock.groupMember.findFirst.mockResolvedValue({ id: 'gm-1' } as never)
  prismaMock.personalProfile.findUnique.mockResolvedValue({
    accountId: ACCOUNT,
    currencyCode: 'USD',
    timeZone: 'UTC',
    sharedEnabled: true,
  } as never)
  prismaMock.personalGroupRule.findUnique.mockResolvedValue({
    included: true,
    includeFrom: null,
  } as never)
  prismaMock.personalExpenseOverride.findMany.mockResolvedValue([] as never)
  prismaMock.personalExpenseOverride.findUnique.mockResolvedValue(null as never)
  prismaMock.personalTransaction.updateMany.mockResolvedValue({
    count: 0,
  } as never)
  prismaMock.personalTransaction.deleteMany.mockResolvedValue({
    count: 0,
  } as never)
  prismaMock.personalTransaction.findUnique.mockResolvedValue(null as never)
  prismaMock.personalTransaction.findMany.mockResolvedValue([] as never)
  prismaMock.personalTransaction.update.mockResolvedValue({} as never)
  prismaMock.personalTransaction.create.mockResolvedValue({} as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
  prismaMock.expense.findUnique.mockResolvedValue(null as never)
})

describe('personal sync compare-before-write', () => {
  it('skips the update when nothing changed', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      expenseRow('exp-1'),
    ] as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      { ...existingRow(), sourceExpenseId: 'exp-1' },
    ] as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('updates when amount, category, or group name changed', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { ...expenseRow('exp-1'), amount: 2000, title: 'Dinner updated' },
    ] as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      { ...existingRow(), sourceExpenseId: 'exp-1' },
    ] as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 2000,
          title: 'Dinner updated',
          version: { increment: 1 },
        }),
      }),
    )
  })

  it('updates when only the category changed', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { ...expenseRow('exp-1'), categoryId: 'groceries' },
    ] as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      { ...existingRow(), sourceExpenseId: 'exp-1' },
    ] as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: 'groceries',
          version: { increment: 1 },
        }),
      }),
    )
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('updates when the group was renamed', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      expenseRow('exp-1', {
        ledger: {
          currency: '$',
          currencyCode: 'USD',
          group: { id: GROUP, name: 'Trip Renamed' },
        },
      }),
    ] as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      { ...existingRow(), sourceExpenseId: 'exp-1' },
    ] as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceGroupName: 'Trip Renamed',
          version: { increment: 1 },
        }),
      }),
    )
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('leaves frozen rows untouched', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { ...expenseRow('exp-1'), amount: 9999 },
    ] as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      {
        ...existingRow(),
        sourceExpenseId: 'exp-1',
        sourceDetachedAt: new Date('2026-08-11T00:00:00.000Z'),
      },
    ] as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.deleteMany).not.toHaveBeenCalled()
  })

  it('bounds queries for a group with N linked rows', async () => {
    const count = 10
    const expenses = Array.from({ length: count }, (_, i) =>
      expenseRow(`exp-${i}`),
    )
    prismaMock.expense.findMany.mockResolvedValue(expenses as never)
    prismaMock.personalTransaction.findMany.mockResolvedValue(
      expenses.map((e, i) => ({
        ...existingRow({ id: `ptx-${i}` }),
        sourceExpenseId: e.id,
        // Match the computed date (profile zone midnight) so all are no-ops.
        date: new Date('2026-08-10T00:00:00.000Z'),
      })) as never,
    )

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    // One paged expense load, one overrides page, one existing page. The old
    // per-expense reload path (expense.findUnique) is never hit.
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalExpenseOverride.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalTransaction.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.expense.findUnique).not.toHaveBeenCalled()
    // No-op reconcile writes nothing.
    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })
})

describe('rule-off pinned rows converge to single-expense semantics', () => {
  const pinnedInGroup = [
    {
      expenseId: 'exp-1',
      expense: { ledger: { group: { id: GROUP } } },
    },
  ]

  beforeEach(() => {
    prismaMock.personalGroupRule.findUnique.mockResolvedValue({
      included: false,
      includeFrom: null,
    } as never)
    prismaMock.personalExpenseOverride.findMany.mockResolvedValue(
      pinnedInGroup as never,
    )
    prismaMock.personalExpenseOverride.findUnique.mockResolvedValue({
      state: 'INCLUDE',
      categoryId: null,
    } as never)
  })

  it('refreshes a model-included pinned row on rule-off amount change', async () => {
    prismaMock.expense.findUnique.mockResolvedValue(
      expenseRow('exp-1', { amount: 2000, title: 'Dinner updated' }) as never,
    )
    prismaMock.personalTransaction.findUnique.mockResolvedValue({
      ...existingRow(),
      sourceExpenseId: 'exp-1',
    } as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    // The pinned row is excluded from the blanket delete and refreshed.
    expect(prismaMock.personalTransaction.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceGroupId: GROUP,
          sourceExpenseId: { notIn: ['exp-1'] },
        }),
      }),
    )
    expect(prismaMock.personalTransaction.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 2000,
          title: 'Dinner updated',
          version: { increment: 1 },
        }),
      }),
    )
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('deletes a pinned row when the master switch is off', async () => {
    prismaMock.personalProfile.findUnique.mockResolvedValue({
      accountId: ACCOUNT,
      currencyCode: 'USD',
      timeZone: 'UTC',
      sharedEnabled: false,
    } as never)
    prismaMock.expense.findUnique.mockResolvedValue(
      expenseRow('exp-1') as never,
    )
    prismaMock.personalTransaction.findUnique.mockResolvedValue({
      ...existingRow(),
      sourceExpenseId: 'exp-1',
    } as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: ACCOUNT,
          sourceExpenseId: 'exp-1',
          sourceDetachedAt: null,
        }),
      }),
    )
    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('deletes a pinned settlement row', async () => {
    prismaMock.expense.findUnique.mockResolvedValue(
      expenseRow('exp-1', { categoryId: 'settlement' }) as never,
    )
    prismaMock.personalTransaction.findUnique.mockResolvedValue({
      ...existingRow(),
      sourceExpenseId: 'exp-1',
    } as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: ACCOUNT,
          sourceExpenseId: 'exp-1',
          sourceDetachedAt: null,
        }),
      }),
    )
    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('leaves detached pinned rows frozen', async () => {
    prismaMock.expense.findUnique.mockResolvedValue(
      expenseRow('exp-1', { amount: 2000 }) as never,
    )
    prismaMock.personalTransaction.findUnique.mockResolvedValue({
      ...existingRow(),
      sourceExpenseId: 'exp-1',
      sourceDetachedAt: new Date('2026-08-11T00:00:00.000Z'),
    } as never)

    await runPersonalSyncResult(
      PersonalInclusionService.use((s) => s.syncGroup(ACCOUNT, GROUP)),
    )

    expect(prismaMock.personalTransaction.update).not.toHaveBeenCalled()
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })
})

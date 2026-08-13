import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prisma$QueryRaw, prismaMock } from '../../../test/state'
import { groupExpenseListCardSelect } from '../selects/expense-list'
import {
  getGroupBalanceExpenses,
  getGroupExpenses,
  getGroupExpensesParticipants,
} from './queries'

describe('getGroupExpensesParticipants', () => {
  it('returns distinct top-level payers and beneficiaries without loading expenses', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expensePaidBy.findMany.mockResolvedValue([
      { ledgerParticipantId: 'alice' },
      { ledgerParticipantId: 'bob' },
    ] as never)
    prismaMock.expensePaidFor.findMany.mockResolvedValue([
      { ledgerParticipantId: 'bob' },
      { ledgerParticipantId: 'carol' },
    ] as never)

    await expect(getGroupExpensesParticipants('group-1')).resolves.toEqual([
      'alice',
      'bob',
      'carol',
    ])
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
    expect(prismaMock.expensePaidBy.findMany).toHaveBeenCalledWith({
      where: { expense: { ledgerId: 'ledger-1' } },
      select: { ledgerParticipantId: true },
      distinct: ['ledgerParticipantId'],
    })
    expect(prismaMock.expensePaidFor.findMany).toHaveBeenCalledWith({
      where: { expense: { ledgerId: 'ledger-1' } },
      select: { ledgerParticipantId: true },
      distinct: ['ledgerParticipantId'],
    })
  })

  it('returns an empty list when the group has no ledger', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null)

    await expect(getGroupExpensesParticipants('group-1')).resolves.toEqual([])
    expect(prismaMock.expensePaidBy.findMany).not.toHaveBeenCalled()
    expect(prismaMock.expensePaidFor.findMany).not.toHaveBeenCalled()
  })
})

describe('getGroupExpenses', () => {
  it('returns card rows without item shares or recurrence configuration', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    const participant = {
      id: 'alice',
      displayName: 'Alice',
      removedAt: null,
      groupMember: null,
      invitations: [],
    }
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'expense-1',
        title: 'Dinner',
        amount: 2400,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        expenseDate: new Date('2026-07-01T00:00:00.000Z'),
        categoryId: 'general',
        splitMode: 'ITEMIZED',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        recurrenceSequence: 2,
        paidByList: [{ shares: 2400, ledgerParticipant: participant }],
        paidFor: [{ shares: 2400, ledgerParticipant: participant }],
        recurringSeries: { id: 'series-1', status: 'ACTIVE' },
        items: [{ id: 'item-1', title: 'Pizza', amount: 2400 }],
        _count: { documents: 1 },
      },
    ] as never)

    const expenses = await getGroupExpenses('group-1')

    expect(prismaMock.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: groupExpenseListCardSelect }),
    )
    expect(expenses[0]?.items).toEqual([
      { id: 'item-1', title: 'Pizza', amount: 2400 },
    ])
    expect(expenses[0]).not.toHaveProperty('itemizedRemainder')
    expect(expenses[0]).not.toHaveProperty('recurrence')
    expect(expenses[0]).not.toHaveProperty('recurringSeries')
    expect(expenses[0]).toMatchObject({
      recurringSeriesId: 'series-1',
      recurringSeriesStatus: 'ACTIVE',
      documentCount: 1,
    })
    expect(groupExpenseListCardSelect.items.select).toEqual({
      id: true,
      title: true,
      amount: true,
    })
  })

  it('skips group lookups when a ledger id is supplied', async () => {
    prismaMock.expense.findMany.mockResolvedValue([])

    await getGroupExpenses('group-1', { ledgerId: 'ledger-known' })
    await getGroupBalanceExpenses('group-1', 'ledger-known')

    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.expense.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { ledgerId: 'ledger-known' } }),
    )
    expect(prismaMock.expense.findMany).toHaveBeenNthCalledWith(2, {
      where: { ledgerId: 'ledger-known' },
      select: expect.any(Object),
    })
  })

  it('ors title contains, trigram ids, and alias-expanded categories', async () => {
    prismaMock.expense.findMany.mockResolvedValue([])
    prisma$QueryRaw.mockResolvedValue([{ id: 'exp-fuzzy' }])

    await getGroupExpenses('group-1', {
      ledgerId: 'ledger-known',
      filter: 'uber',
      locale: 'en-US',
    })

    expect(prisma$QueryRaw).toHaveBeenCalled()
    expect(prismaMock.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ledgerId: 'ledger-known',
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { title: { contains: 'uber', mode: 'insensitive' } },
                { id: { in: ['exp-fuzzy'] } },
                { categoryId: { in: ['taxi'] } },
              ]),
            }),
          ],
        }),
      }),
    )
  })
})

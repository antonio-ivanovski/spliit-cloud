import { describe, expect, it } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  getCurrencyMigrationPreview,
  migrateGroupCurrency,
} from './currency-migration'

function stubGroup() {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    ledgerId: 'ledger-1',
    archived: false,
    ledger: { currency: '$', currencyCode: 'USD' },
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([
    {
      id: 'expense-1',
      expenseDate: new Date('2026-01-02T00:00:00.000Z'),
      amount: 1100,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionSource: 'CUSTOM',
    },
  ] as never)
}

describe('currency migration API logic', () => {
  it('reports unsupported effective original currencies before rate choices', async () => {
    stubGroup()
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'expense-unsupported',
        expenseDate: new Date('2026-01-02T00:00:00.000Z'),
        amount: 100,
        originalAmount: 100,
        originalCurrency: 'ZZZ',
        conversionSource: 'CUSTOM',
      },
    ] as never)

    const result = await getCurrencyMigrationPreview({
      groupId: 'group-1',
      destinationCurrencyCode: 'GBP',
    })

    expect(result.eligible).toBe(false)
    expect(result.unsupportedCurrencies).toEqual([
      { code: 'ZZZ', expenseIds: ['expense-unsupported'] },
    ])
  })

  it('reprices directly from the effective original currency and leaves split tables alone', async () => {
    stubGroup()
    prismaMock.groupMember.findUnique.mockResolvedValue({
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'activity-1',
      time: new Date(),
    } as never)

    await migrateGroupCurrency(
      {
        groupId: 'group-1',
        destinationCurrencyCode: 'GBP',
        pairChoices: {
          'EUR|GBP': { type: 'fixedCustom', rate: 1.2 },
        },
      },
      { accountId: 'account-1' },
    )

    expect(prismaMock.ledger.update).toHaveBeenCalledWith({
      where: { id: 'ledger-1' },
      data: { currencyCode: 'GBP', currency: '£' },
    })
    expect(prismaMock.expense.update).toHaveBeenCalledWith({
      where: { id: 'expense-1' },
      data: {
        amount: 1200,
        originalAmount: 1000,
        originalCurrency: 'EUR',
        conversionRate: 1.2,
        conversionSource: 'CUSTOM',
      },
    })
    expect(prismaMock.expensePaidBy.update).not.toHaveBeenCalled()
    expect(prismaMock.expensePaidFor.update).not.toHaveBeenCalled()
    expect(prismaMock.expenseItem.update).not.toHaveBeenCalled()
  })
})

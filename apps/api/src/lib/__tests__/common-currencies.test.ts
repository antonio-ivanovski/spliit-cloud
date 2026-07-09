// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { getGroupCommonCurrencies } from '../api'

describe('getGroupCommonCurrencies', () => {
  const groupId = 'grp-common-ccy'
  const ledgerId = 'ledger-common-ccy'
  const today = new Date('2026-07-09T12:00:00.000Z')

  beforeEach(() => {
    prismaMock.group.findUnique.mockReset()
    prismaMock.expense.findMany.mockReset()
  })

  it('returns empty when group is missing', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null)
    await expect(getGroupCommonCurrencies(groupId)).resolves.toEqual([])
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })

  it('loads only originalCurrency + expenseDate within lookback', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId,
      ledger: { currencyCode: 'USD' },
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([
      { originalCurrency: 'EUR', expenseDate: new Date('2026-07-01') },
      { originalCurrency: null, expenseDate: new Date('2026-07-02') },
      { originalCurrency: 'GBP', expenseDate: new Date('2026-07-03') },
    ] as never)

    // Freeze "today" for lookback calculation via Date.now is not used;
    // commonCurrencyLookbackDate uses `new Date()` — mock timers.
    vi.useFakeTimers()
    vi.setSystemTime(today)
    try {
      const result = await getGroupCommonCurrencies(groupId)
      expect(result).toEqual(['GBP', 'EUR'])

      expect(prismaMock.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ledgerId,
            expenseDate: { gte: expect.any(Date) },
          },
          select: {
            originalCurrency: true,
            expenseDate: true,
          },
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('excludes group currency and unsupported codes from recommendations', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId,
      ledger: { currencyCode: 'USD' },
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([
      { originalCurrency: 'USD', expenseDate: new Date('2026-07-01') },
      { originalCurrency: null, expenseDate: new Date('2026-07-01') },
      { originalCurrency: 'XXX', expenseDate: new Date('2026-07-01') },
      { originalCurrency: 'EUR', expenseDate: new Date('2026-07-01') },
    ] as never)

    vi.useFakeTimers()
    vi.setSystemTime(today)
    try {
      await expect(getGroupCommonCurrencies(groupId)).resolves.toEqual(['EUR'])
    } finally {
      vi.useRealTimers()
    }
  })
})

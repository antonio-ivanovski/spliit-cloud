import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invalidateExpenseDependencies } from '../expense-mutation-hooks'

const invalidations = {
  list: vi.fn(async () => undefined),
  get: vi.fn(async () => undefined),
  series: vi.fn(async () => undefined),
  commonCurrencies: vi.fn(async () => undefined),
  activities: vi.fn(async () => undefined),
  balances: vi.fn(async () => undefined),
  overview: vi.fn(async () => undefined),
  accountGroups: vi.fn(async () => undefined),
}

const utils = {
  groups: {
    expenses: {
      list: { invalidate: invalidations.list },
      get: { invalidate: invalidations.get },
      series: { invalidate: invalidations.series },
      commonCurrencies: { invalidate: invalidations.commonCurrencies },
    },
    activities: { list: { invalidate: invalidations.activities } },
    balances: { list: { invalidate: invalidations.balances } },
  },
  overview: { get: { invalidate: invalidations.overview } },
  account: { groups: { invalidate: invalidations.accountGroups } },
} as never

describe('invalidateExpenseDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates balances, overview, and account.groups for financial mutations', async () => {
    await invalidateExpenseDependencies(utils, 'invite-token', {
      groupId: 'group-1',
      expenseId: 'expense-1',
    })

    expect(invalidations.list).toHaveBeenCalledWith({
      groupId: 'group-1',
      linkInviteToken: 'invite-token',
    })
    expect(invalidations.get).toHaveBeenCalledWith({
      groupId: 'group-1',
      expenseId: 'expense-1',
      linkInviteToken: 'invite-token',
    })
    expect(invalidations.balances).toHaveBeenCalledWith({ groupId: 'group-1' })
    expect(invalidations.overview).toHaveBeenCalledTimes(1)
    // Currency converter ranks against account.groups with a 60s staleTime;
    // financial mutations must bust it so the converter sees the new total.
    expect(invalidations.accountGroups).toHaveBeenCalledTimes(1)
  })

  it('skips balances, overview, and account.groups for non-financial mutations', async () => {
    await invalidateExpenseDependencies(utils, undefined, {
      groupId: 'group-1',
      financial: false,
    })

    expect(invalidations.list).toHaveBeenCalledWith({
      groupId: 'group-1',
      linkInviteToken: undefined,
    })
    expect(invalidations.get).not.toHaveBeenCalled()
    expect(invalidations.balances).not.toHaveBeenCalled()
    expect(invalidations.overview).not.toHaveBeenCalled()
    expect(invalidations.accountGroups).not.toHaveBeenCalled()
  })
})

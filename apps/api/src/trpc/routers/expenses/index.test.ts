import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { composeGlobalPersonFilters, globalExpensesRouter } from './index'

describe('global expense person filters', () => {
  it('keeps paid-by and paid-for clauses as independent AND branches', () => {
    const result = composeGlobalPersonFilters(
      [{ kind: 'account', id: 'acct-alice' }],
      'any',
      [{ kind: 'account', id: 'acct-bob' }],
      'any',
    )

    expect(result?.AND).toHaveLength(2)
    expect(result?.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ paidByList: { some: expect.any(Object) } }] },
        { OR: [{ paidFor: { some: expect.any(Object) } }] },
      ]),
    )
  })

  it('omits the person predicate when neither side is selected', () => {
    expect(composeGlobalPersonFilters(undefined, 'any', undefined, 'any')).toBe(
      undefined,
    )
  })
})

describe('global expense list guards', () => {
  it('rejects amount filtering without exactly one currency', async () => {
    const caller = globalExpensesRouter.createCaller({
      auth: {
        session: { id: 'sess-1' },
        user: { id: 'acct-1' },
      },
    } as never)

    await expect(caller.list({ minAmount: 100 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('requires authentication before reading global expenses', async () => {
    const caller = globalExpensesRouter.createCaller({ auth: null } as never)

    await expect(caller.list({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

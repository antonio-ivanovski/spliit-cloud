import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { composeGlobalPersonFilters, globalExpensesRouter } from './index'

function makeCaller() {
  return globalExpensesRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: { id: 'acct-1' },
    },
  } as never)
}

function mockGlobalGroups(
  groups: Array<{ id: string; archived: boolean; hidden: boolean }>,
) {
  prismaMock.groupMember.findMany.mockResolvedValue(
    groups.map((group) => ({
      group: {
        id: group.id,
        name: `Group ${group.id}`,
        archived: group.archived,
        groupType: 'GROUP',
        ledger: {
          id: `ledger-${group.id}`,
          currency: '$',
          currencyCode: 'USD',
          _count: { participants: 2 },
        },
        members: [],
      },
    })) as never,
  )
  prismaMock.accountGroupPreference.findMany.mockResolvedValue(
    groups.map((group) => ({ groupId: group.id, hidden: group.hidden })),
  )
  prismaMock.expense.findMany.mockResolvedValue([])
}

function listedLedgerIds() {
  const where = prismaMock.expense.findMany.mock.calls[0]?.[0]?.where as {
    ledgerId?: { in?: string[] }
  }
  return where?.ledgerId?.in ?? null
}

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

describe('global expense list group scope', () => {
  const groups = [
    { id: 'g-active', archived: false, hidden: false },
    { id: 'g-archived', archived: true, hidden: false },
    { id: 'g-hidden', archived: false, hidden: true },
  ]

  it('excludes archived and hidden groups by default', async () => {
    mockGlobalGroups(groups)

    const result = await makeCaller().list({})

    expect(result.expenses).toEqual([])
    expect(listedLedgerIds()).toEqual(['ledger-g-active'])
  })

  it('includes archived groups when includeArchived is true', async () => {
    mockGlobalGroups(groups)

    await makeCaller().list({ includeArchived: true })

    expect(listedLedgerIds()).toEqual(['ledger-g-active', 'ledger-g-archived'])
  })

  it('still excludes hidden groups when includeArchived is true', async () => {
    mockGlobalGroups(groups)

    await makeCaller().list({ includeArchived: true })

    expect(listedLedgerIds()).not.toContain('ledger-g-hidden')
  })

  it('searches exactly the explicitly selected groups', async () => {
    mockGlobalGroups(groups)

    await makeCaller().list({
      groupIds: ['g-archived', 'g-hidden'],
      includeArchived: false,
    })

    expect(listedLedgerIds()).toEqual(['ledger-g-archived', 'ledger-g-hidden'])
  })

  it('returns nothing for groups outside the membership', async () => {
    mockGlobalGroups(groups)

    const result = await makeCaller().list({ groupIds: ['g-unknown'] })

    expect(result).toEqual({ expenses: [], hasMore: false, nextCursor: null })
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })
})

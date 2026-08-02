import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../../test/mocks'
import { prismaMock } from '../../../../test/state'

const getGroupBalanceExpensesMock = vi.hoisted(() => vi.fn())

vi.mock('../../../../lib/api/expenses/queries', () => ({
  getGroupBalanceExpenses: getGroupBalanceExpensesMock,
}))

import { groupsRouter } from '../index'

function makeCaller() {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: 'acct-self',
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

describe('groups.balances.list participant labels', () => {
  beforeEach(() => {
    getGroupBalanceExpensesMock.mockResolvedValue([
      {
        id: 'expense-1',
        amount: 1000,
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [{ ledgerParticipantId: 'lp-pending', shares: 1 }],
        paidFor: [{ ledgerParticipantId: 'lp-pending', shares: 1 }],
        items: [],
        itemizedRemainder: null,
      },
    ])
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      archived: false,
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'member-1',
      groupId: 'grp-1',
      accountId: 'acct-self',
      status: 'ACTIVE',
      ledgerParticipant: null,
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-pending',
        displayName: 'raw-ledger-id',
        removedAt: null,
        groupMember: null,
        invitations: [
          {
            email: 'invitee@example.com',
            temporaryName: 'Alex from the trip',
          },
        ],
      },
    ] as never)
  })

  it('returns a pending invitation temporary name instead of its id', async () => {
    const result = await makeCaller().balances.list({ groupId: 'grp-1' })

    expect(result.participants).toEqual([
      { id: 'lp-pending', name: 'Alex from the trip', removed: false },
    ])
    expect(prismaMock.ledgerParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          invitations: expect.objectContaining({
            where: { status: 'PENDING' },
          }),
        }),
      }),
    )
  })

  it('returns subgroup and individual settlement projections from the server', async () => {
    getGroupBalanceExpensesMock.mockResolvedValue([
      {
        id: 'expense-a',
        amount: 100,
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [{ ledgerParticipantId: 'lp-alice', shares: 1 }],
        paidFor: [{ ledgerParticipantId: 'lp-bob', shares: 1 }],
        items: [],
        itemizedRemainder: null,
      },
      {
        id: 'expense-b',
        amount: 100,
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [{ ledgerParticipantId: 'lp-carol', shares: 1 }],
        paidFor: [{ ledgerParticipantId: 'lp-dave', shares: 1 }],
        items: [],
        itemizedRemainder: null,
      },
    ])
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      archived: false,
      subgroupsEnabled: true,
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-alice',
        displayName: 'Alice',
        removedAt: null,
        groupMember: null,
        invitations: [],
      },
      {
        id: 'lp-bob',
        displayName: 'Bob',
        removedAt: null,
        groupMember: null,
        invitations: [],
      },
      {
        id: 'lp-carol',
        displayName: 'Carol',
        removedAt: null,
        groupMember: null,
        invitations: [],
      },
      {
        id: 'lp-dave',
        displayName: 'Dave',
        removedAt: null,
        groupMember: null,
        invitations: [],
      },
    ] as never)
    prismaMock.subgroup.findMany.mockResolvedValue([
      {
        id: 'couple-a',
        name: 'Couple A',
        members: [
          { ledgerParticipantId: 'lp-alice' },
          { ledgerParticipantId: 'lp-bob' },
        ],
      },
      {
        id: 'couple-b',
        name: 'Couple B',
        members: [
          { ledgerParticipantId: 'lp-carol' },
          { ledgerParticipantId: 'lp-dave' },
        ],
      },
    ] as never)

    const result = await makeCaller().balances.list({ groupId: 'grp-1' })

    expect(result.settlement.individual).toEqual({
      policy: 'within-subgroups',
      reimbursements: [
        { from: 'lp-bob', to: 'lp-alice', amount: 100 },
        { from: 'lp-dave', to: 'lp-carol', amount: 100 },
      ],
    })
    expect(result.reimbursements).toEqual(
      result.settlement.individual.reimbursements,
    )
    expect(result.settlement.subgroup.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'subgroup',
          id: 'couple-a',
          memberIds: ['lp-alice', 'lp-bob'],
          total: 0,
        }),
        expect.objectContaining({
          kind: 'subgroup',
          id: 'couple-b',
          memberIds: ['lp-carol', 'lp-dave'],
          total: 0,
        }),
      ]),
    )
    expect(result.settlement.subgroup.legs).toEqual([])
  })
})

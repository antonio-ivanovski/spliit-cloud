import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../../test/mocks'
import { prismaMock } from '../../../../test/state'
import { overviewRouter } from '../index'

function membership(
  id: string,
  groupType: 'GROUP' | 'FRIEND' = 'GROUP',
  archived = false,
) {
  return {
    ledgerParticipant: { id: `me-${id}` },
    group: {
      id,
      name: id,
      groupType,
      archived,
      ledger: { id: `ledger-${id}`, currency: '€', currencyCode: 'EUR' },
    },
  }
}
function participant(id: string, accountId = 'viewer', name = 'Me') {
  return {
    id: `${accountId}-${id}`,
    ledgerId: `ledger-${id}`,
    displayName: name,
    invitations: [],
    groupMember: { account: { id: accountId, name } },
  }
}
const caller = () =>
  overviewRouter.createCaller({
    auth: {
      session: { id: 'session' },
      user: {
        id: 'viewer',
        email: 'viewer@example.com',
        emailVerified: true,
        name: 'Me',
      },
    },
  } as never)

describe('overview statistics API', () => {
  beforeEach(() => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      membership('regular'),
      membership('friend', 'FRIEND'),
      membership('archived', 'GROUP', true),
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      participant('regular'),
      participant('friend'),
      participant('friend', 'alex', 'Alex'),
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([])
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([])
  })

  it('bootstraps the same default stats without another expense read and includes people with no activity', async () => {
    const base = membership('regular')
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        ...base,
        role: 'MEMBER',
        group: {
          ...base.group,
          information: null,
          emoji: null,
          color: null,
          friendPairKey: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          _count: { members: 2 },
          members: [
            { account: { id: 'viewer', name: 'Me', image: null } },
            { account: { id: 'alex', name: 'Alex', image: null } },
          ],
        },
      },
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      participant('regular'),
      participant('regular', 'alex', 'Alex'),
    ] as never)
    const result = await caller().get({ timeZone: 'UTC' })
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1)
    expect(result.activity?.people).toContainEqual({
      accountId: 'alex',
      name: 'Alex',
    })
    expect(result.activity).toEqual(
      await caller().stats.get({ timeZone: 'UTC' }),
    )
    expect(result.groups[0].financialSummary.netBalance).toBe(0)
  })

  it('includes archived history by default and keeps ledger-type and visibility filters independent', async () => {
    const result = await caller().stats.get({})
    expect(result.groups.map((group) => group.groupId)).toEqual([
      'regular',
      'friend',
      'archived',
    ])
    expect(
      result.groups.find((group) => group.groupId === 'friend')?.name,
    ).toBe('Alex')
    expect(
      (await caller().stats.get({ scope: 'FRIENDS' })).groups.map(
        (group) => group.groupId,
      ),
    ).toEqual(['friend'])
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([
      { groupId: 'regular' },
    ] as never)
    expect(
      (
        await caller().stats.get({
          scope: 'GROUPS',
          includeArchived: false,
          includeHidden: false,
        })
      ).groups,
    ).toEqual([])
  })

  it('rejects a group outside active memberships, even when mixed with an authorized selection', async () => {
    await expect(
      caller().stats.get({ groupIds: ['regular', 'someone-elses-group'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a person outside the selected shared ledgers', async () => {
    await expect(
      caller().stats.get({
        person: { kind: 'ACCOUNT', accountId: 'private-account' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('maps a person across ledgers by account ID rather than by name', async () => {
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      participant('regular', 'alex', 'Alex'),
      participant('friend', 'alex', 'Alex'),
      participant('archived', 'other-alex', 'Alex'),
    ] as never)
    const row = (id: string, participantId: string) => ({
      id,
      ledgerId: `ledger-${id}`,
      amount: 1000,
      createdAt: new Date(),
      expenseDate: new Date(),
      expenseTimeZone: 'UTC',
      categoryId: 'general',
      splitMode: 'EVENLY',
      paidBySplitMode: 'BY_AMOUNT',
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      paidByList: [{ ledgerParticipantId: participantId, shares: 1000 }],
      paidFor: [{ ledgerParticipantId: participantId, shares: 1 }],
      items: [],
      itemizedRemainder: null,
    })
    prismaMock.expense.findMany.mockResolvedValue([
      row('regular', 'alex-regular'),
      row('friend', 'alex-friend'),
      row('archived', 'other-alex-archived'),
    ] as never)
    const result = await caller().stats.get({
      person: { kind: 'ACCOUNT', accountId: 'alex' },
      period: 'ALL_TIME',
    })
    expect(result.currencies[0]).toMatchObject({
      expenses: 2000,
      ledgerCount: 2,
      transactionCount: 2,
    })
    expect(result.people).toHaveLength(2)
  })

  it.each([
    { period: 'CUSTOM' as const },
    {
      period: 'CUSTOM' as const,
      customRange: { from: '2026-10-09', to: '2026-10-08' },
    },
    { timeZone: 'invalid-zone' },
    {
      period: 'CUSTOM' as const,
      customRange: { from: '2026-02-30', to: '2026-03-01' },
    },
  ])(
    'rejects invalid dates and ranges at the API boundary: %j',
    async (input) => {
      await expect(caller().stats.get(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    },
  )

  it('returns empty statistics with a usable current range for an account with no memberships', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-08T23:30:00Z'))
      prismaMock.groupMember.findMany.mockResolvedValue([])
      const result = await caller().stats.get({ timeZone: 'Europe/Rome' })
      expect(result.range).toEqual({ from: '2026-10-01', to: '2026-10-09' })
      expect(result.currencies).toEqual([])
      expect(result.coverage).toEqual({
        eligibleLedgerCount: 0,
        unavailableLedgerCount: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

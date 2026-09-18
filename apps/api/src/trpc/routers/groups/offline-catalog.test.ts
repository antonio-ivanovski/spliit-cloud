import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { offlineTxOptions } from '../../../lib/api/offline'
import { prisma$Transaction, prismaMock } from '../../../test/state'
import { authState } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { groupsRouter } from './index'

function makeCaller(accountId: string) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
    resHeaders: new Headers(),
  } as never)
}

function mockMembershipRow(args: {
  groupId: string
  role?: 'ADMIN' | 'MEMBER'
  ledgerId: string
  name: string
  archived?: boolean
  groupType?: 'GROUP' | 'FRIEND'
  currency?: string
  currencyCode?: string | null
  memberCount?: number
  participantCount?: number
  createdAt?: Date
  peerAccountId?: string
  peerName?: string
}) {
  const createdAt = args.createdAt ?? new Date('2026-01-01T00:00:00Z')
  const members =
    args.groupType === 'FRIEND'
      ? [
          {
            account: {
              id: 'acct-self',
              name: 'Alice',
              image: null,
            },
          },
          {
            account: {
              id: args.peerAccountId ?? 'acct-peer',
              name: args.peerName ?? 'Bob',
              image: null,
            },
          },
        ]
      : [
          {
            account: { id: 'acct-self', name: 'Alice', image: null },
          },
        ]
  return {
    groupId: args.groupId,
    role: args.role ?? 'MEMBER',
    ledgerParticipant: { id: `lp-self-${args.groupId}` },
    group: {
      id: args.groupId,
      name: args.name,
      information: null,
      archived: args.archived ?? false,
      createdAt,
      groupType: args.groupType ?? 'GROUP',
      friendPairKey: null,
      ledger: {
        id: args.ledgerId,
        currency: args.currency ?? '$',
        currencyCode: args.currencyCode ?? 'USD',
        _count: { participants: args.participantCount ?? 2 },
      },
      _count: { members: args.memberCount ?? 2 },
      members,
    },
  }
}

describe('groups.offlineCatalog', () => {
  it('rejects unauthenticated callers with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })
    await expect(
      groupsRouter.createCaller({ auth: ctx.auth } as never).offlineCatalog(),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns an empty catalog without querying expenses', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)

    const result = await makeCaller('acct-self').offlineCatalog()

    expect(result).toEqual({
      schemaVersion: 1,
      accountId: 'acct-self',
      capturedAt: expect.any(Date),
      groups: [],
    })
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
    expect(prisma$Transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'RepeatableRead',
        timeout: 30_000,
      }),
    )
    expect(offlineTxOptions).toMatchObject({
      isolationLevel: 'RepeatableRead',
      timeout: 30_000,
    })
  })

  it('includes archived, hidden, and FRIEND groups with stable ordering and MEMBER access', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      mockMembershipRow({
        groupId: 'grp-b',
        ledgerId: 'ledger-b',
        name: 'Bravo',
        archived: true,
        createdAt: new Date('2026-02-01T00:00:00Z'),
      }),
      mockMembershipRow({
        groupId: 'grp-a',
        ledgerId: 'ledger-a',
        name: 'Alpha',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      mockMembershipRow({
        groupId: 'grp-friend',
        ledgerId: 'ledger-friend',
        name: '',
        groupType: 'FRIEND',
        peerName: 'Zoe Friend',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      }),
    ] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([
      { groupId: 'grp-a', starred: false, hidden: true },
      { groupId: 'grp-b', starred: true, hidden: false },
    ] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)

    const result = await makeCaller('acct-self').offlineCatalog()

    expect(result.groups.map((g) => g.overview.id)).toEqual([
      'grp-a',
      'grp-b',
      'grp-friend',
    ])
    for (const entry of result.groups) {
      expect(entry.overview.access).toBe('MEMBER')
      expect(entry.overview.viewKey).toBeNull()
      expect(entry.overview.lastOpenedAt).toBeNull()
      expect(entry.overview).not.toHaveProperty('viewKey', 'secret')
    }
    const archived = result.groups.find(
      (g) => g.overview.id === 'grp-b',
    )!.overview
    expect(archived.archived).toBe(true)
    expect(archived.financialSummary.state).toBe('NO_EXPENSES')

    const hidden = result.groups.find((g) => g.overview.id === 'grp-a')!
    expect(hidden.overview.preference.hidden).toBe(true)
    expect(hidden.global.hidden).toBe(true)

    const friend = result.groups.find((g) => g.overview.id === 'grp-friend')!
    expect(friend.overview.groupType).toBe('FRIEND')
    expect(friend.overview.displayName).toBe('Zoe Friend')
    expect(friend.global.displayName).toBe('Zoe Friend')
    expect(friend.global.groupType).toBe('FRIEND')

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('viewKey":"secret')
    expect(serialized).not.toContain('linkInviteToken')
    expect(serialized).not.toContain('tokenHash')
  })

  it('live-computes financial summaries from expenses', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      mockMembershipRow({
        groupId: 'grp-1',
        ledgerId: 'ledger-1',
        name: 'Trip',
      }),
    ] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([] as never)
    prismaMock.expense.findMany.mockResolvedValue([
      {
        ledgerId: 'ledger-1',
        amount: 1000,
        createdAt: new Date('2026-06-04T00:00:00Z'),
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [{ ledgerParticipantId: 'lp-self-grp-1', shares: 1000 }],
        paidFor: [
          { ledgerParticipantId: 'lp-self-grp-1', shares: 1 },
          { ledgerParticipantId: 'lp-other', shares: 1 },
        ],
        items: [],
        itemizedRemainder: null,
      },
    ] as never)

    const result = await makeCaller('acct-self').offlineCatalog()

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].overview.financialSummary).toMatchObject({
      expenseCount: 1,
      state: 'OWED_TO_YOU',
    })
    expect(
      result.groups[0].overview.financialSummary.latestExpenseCreatedAt,
    ).toBe('2026-06-04T00:00:00.000Z')
  })

  it('sets private/no-store Cache-Control', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)

    const resHeaders = new Headers()
    const caller = groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-1' },
        user: {
          id: 'acct-self',
          email: 'alice@example.com',
          emailVerified: true,
          name: 'Alice',
        },
      },
      resHeaders,
    } as never)

    await caller.offlineCatalog()

    expect(resHeaders.get('Cache-Control')).toBe('private, no-store')
  })
})

import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
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
  } as never)
}

function fullLedgerParticipant(id: string, memberId: string, ledgerId: string) {
  return {
    id,
    ledgerId,
    groupMemberId: memberId,
    kind: 'ACCOUNT_MEMBER',
    displayName: null,
    removedAt: null,
  }
}

describe('offline parity with live endpoints', () => {
  it('matches list, detail, and balances for the first 500 newest', async () => {
    const groupId = 'grp-1'
    const ledgerId = 'ledger-1'
    const accountId = 'acct-self'

    const docWithUrl = {
      id: 'doc-1',
      url: 'https://s3.example.com/private/doc-1',
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
      width: 800,
      height: 600,
    }

    const expenseRow = {
      id: 'exp-1',
      ledgerId,
      createdByAccountId: accountId,
      title: 'Dinner',
      amount: 1000,
      createdAt: new Date('2026-06-02T00:00:00Z'),
      expenseDate: new Date('2026-06-02T00:00:00Z'),
      expenseTimeZone: 'UTC',
      categoryId: 'general',
      splitMode: 'EVENLY',
      paidBySplitMode: 'BY_AMOUNT',
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      version: 3,
      notes: 'notes here',
      recurrenceSequence: null,
      recurringSeriesId: null,
      fileImportSource: null,
      paidByList: [
        {
          ledgerParticipantId: 'lp-self',
          shares: 1000,
          ledgerParticipant: {
            id: 'lp-self',
            displayName: null,
            removedAt: null,
            groupMember: {
              account: { id: accountId, name: 'Alice', image: null },
            },
            invitations: [],
          },
        },
      ],
      paidFor: [
        {
          ledgerParticipantId: 'lp-self',
          shares: 1,
          ledgerParticipant: {
            id: 'lp-self',
            displayName: null,
            removedAt: null,
            groupMember: {
              account: { id: accountId, name: 'Alice', image: null },
            },
            invitations: [],
          },
        },
        {
          ledgerParticipantId: 'lp-other',
          shares: 1,
          ledgerParticipant: {
            id: 'lp-other',
            displayName: null,
            removedAt: null,
            groupMember: {
              account: { id: 'acct-other', name: 'Bob', image: null },
            },
            invitations: [],
          },
        },
      ],
      items: [],
      itemizedRemainder: null,
      documents: [docWithUrl],
      recurringSeries: null,
      _count: { documents: 1 },
    }

    const member = {
      id: 'gm-self',
      groupId,
      accountId,
      role: 'MEMBER',
      status: 'ACTIVE',
      ledgerParticipant: { id: 'lp-self' },
    }
    const groupRow = {
      id: groupId,
      ledgerId,
      archived: false,
      subgroupsEnabled: false,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
    }
    const fullGroup = {
      id: groupId,
      name: 'Trip',
      information: null,
      archived: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      groupType: 'GROUP',
      ledgerId,
      friendPairKey: null,
      ledger: {
        id: ledgerId,
        currency: '$',
        currencyCode: 'USD',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      members: [
        {
          id: 'gm-self',
          createdAt: new Date(),
          updatedAt: new Date(),
          groupId,
          accountId,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date(),
          leftAt: null,
          account: { id: accountId, name: 'Alice', image: null },
          ledgerParticipant: fullLedgerParticipant(
            'lp-self',
            'gm-self',
            ledgerId,
          ),
        },
        {
          id: 'gm-other',
          createdAt: new Date(),
          updatedAt: new Date(),
          groupId,
          accountId: 'acct-other',
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date(),
          leftAt: null,
          account: { id: 'acct-other', name: 'Bob', image: null },
          ledgerParticipant: fullLedgerParticipant(
            'lp-other',
            'gm-other',
            ledgerId,
          ),
        },
      ],
      invitations: [],
    }

    prismaMock.groupMember.findUnique.mockResolvedValue(member as never)
    prismaMock.group.findUnique.mockImplementation(async (q: unknown) => {
      const qq = q as { include?: { members?: unknown } }
      if (qq.include?.members) return fullGroup as never
      return groupRow as never
    })
    prismaMock.groupInvitation.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
    prismaMock.ledgerParticipant.findMany.mockImplementation(
      async (q: unknown) => {
        const qq = q as { where?: { kind?: unknown } }
        if (qq.where?.kind) return [] as never
        return [
          {
            id: 'lp-self',
            displayName: null,
            removedAt: null,
            groupMember: {
              account: { id: accountId, name: 'Alice', image: null },
            },
            invitations: [],
          },
          {
            id: 'lp-other',
            displayName: null,
            removedAt: null,
            groupMember: {
              account: { id: 'acct-other', name: 'Bob', image: null },
            },
            invitations: [],
          },
        ] as never
      },
    )
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        groupId,
        role: 'MEMBER',
        ledgerParticipant: { id: 'lp-self' },
        group: {
          id: groupId,
          name: 'Trip',
          information: null,
          archived: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          groupType: 'GROUP',
          friendPairKey: null,
          ledger: {
            id: ledgerId,
            currency: '$',
            currencyCode: 'USD',
            _count: { participants: 2 },
          },
          _count: { members: 2 },
          members: [
            { account: { id: accountId, name: 'Alice', image: null } },
            { account: { id: 'acct-other', name: 'Bob', image: null } },
          ],
        },
      },
    ] as never)
    prismaMock.expense.count.mockResolvedValue(1 as never)
    prismaMock.subgroup.findMany.mockResolvedValue([] as never)
    prismaMock.expense.findMany.mockImplementation(async (q: unknown) => {
      const qq = q as {
        where?: { recurringSeriesId?: string; ledgerId?: unknown }
        select?: Record<string, unknown>
        orderBy?: unknown
      }
      if (qq.where?.recurringSeriesId) return [] as never
      if (qq.select && 'ledgerId' in qq.select && !('id' in qq.select)) {
        return [
          {
            ledgerId,
            amount: 1000,
            createdAt: new Date('2026-06-02T00:00:00Z'),
            splitMode: 'EVENLY',
            paidBySplitMode: 'BY_AMOUNT',
            originalAmount: null,
            originalCurrency: null,
            conversionRate: null,
            conversionSource: null,
            paidByList: [{ ledgerParticipantId: 'lp-self', shares: 1000 }],
            paidFor: [
              { ledgerParticipantId: 'lp-self', shares: 1 },
              { ledgerParticipantId: 'lp-other', shares: 1 },
            ],
            items: [],
            itemizedRemainder: null,
          },
        ] as never
      }
      if (qq.select && 'version' in qq.select) return [expenseRow] as never
      if (qq.orderBy) return [expenseRow] as never
      return [
        {
          id: 'exp-1',
          ledgerId,
          amount: 1000,
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          originalAmount: null,
          originalCurrency: null,
          conversionRate: null,
          conversionSource: null,
          paidByList: [{ ledgerParticipantId: 'lp-self', shares: 1000 }],
          paidFor: [
            { ledgerParticipantId: 'lp-self', shares: 1 },
            { ledgerParticipantId: 'lp-other', shares: 1 },
          ],
          items: [],
          itemizedRemainder: null,
        },
      ] as never
    })
    prismaMock.expense.findFirst.mockImplementation(async (q: unknown) => {
      const qq = q as {
        where?: { id?: string; recurringSeriesId?: string }
        select?: Record<string, unknown>
      }
      if (qq.where?.recurringSeriesId) return null as never
      if (qq.select?.id && !qq.where?.id) return null as never
      return {
        ...expenseRow,
        paidByList: [
          {
            ledgerParticipantId: 'lp-self',
            shares: 1000,
            ledgerParticipant: { id: 'lp-self' },
          },
        ],
        paidFor: [
          { ledgerParticipantId: 'lp-self', shares: 1 },
          { ledgerParticipantId: 'lp-other', shares: 1 },
        ],
        documents: [docWithUrl],
        recurringSeries: null,
        fileImportSource: null,
        items: [],
        itemizedRemainder: null,
      } as never
    })

    const caller = makeCaller(accountId)
    const snapshot = await caller.offlineSnapshot({ groupId })
    expect(snapshot.expenses).toHaveLength(1)
    expect(snapshot.totalCount).toBe(1)
    expect(snapshot.downloadedCount).toBe(1)
    expect(snapshot.hasMore).toBe(false)

    const liveList = await caller.expenses.list({ groupId, limit: 10 })
    expect(liveList.expenses).toHaveLength(1)
    expect(liveList.expenses[0].id).toBe(snapshot.expenses[0].list.id)
    expect(liveList.expenses[0].title).toBe(snapshot.expenses[0].list.title)
    expect(liveList.expenses[0].amount).toBe(snapshot.expenses[0].list.amount)
    expect(liveList.expenses[0].documentCount).toBe(
      snapshot.expenses[0].list.documentCount,
    )

    const liveDetail = await caller.expenses.get({
      groupId,
      expenseId: 'exp-1',
    })
    expect(liveDetail.expense.id).toBe(snapshot.expenses[0].detail.id)
    expect(liveDetail.expense.version).toBe(snapshot.expenses[0].detail.version)
    expect(liveDetail.expense.documents).toHaveLength(1)
    expect(snapshot.expenses[0].detail.documents).toHaveLength(1)
    expect(snapshot.expenses[0].detail.documents[0]).not.toHaveProperty('url')
    expect(liveDetail.expense.documents[0]).toHaveProperty('url')

    const liveBalances = await caller.balances.list({ groupId })
    expect(liveBalances.balances).toEqual(snapshot.balances.balances)
    expect(liveBalances.suggestedSettlements).toEqual(
      snapshot.balances.suggestedSettlements,
    )
  })
})

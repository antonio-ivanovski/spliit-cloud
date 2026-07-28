import { describe, expect, it } from 'vitest'

import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import { exportGroupJson } from './export-json'

function makeRequest(): Request {
  return new Request('http://localhost/groups/abc/expenses/export/json', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

describe('exportGroupJson', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    authState.session = null

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthenticated')
    // Critical: even though the request was unauthenticated, the route MUST NOT
    // look up the group or its members.
    expect(prismaMock.groupMember.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not an active member of the group', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Forbidden')
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })

  it('returns 403 when the membership status is not ACTIVE', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      role: 'MEMBER',
      status: 'REMOVED',
    })

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(403)
  })

  it('returns the export payload for an active member', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Trip to Paris',
      information: null,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-1' },
        },
      ],
    })
    prismaMock.expense.findMany.mockResolvedValue([])
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-1',
        groupMember: { account: { name: 'Alice' } },
        invitations: [],
      },
    ] as never)

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="Spliit Cloud Export - \d{4}-\d{2}-\d{2}\.json"$/,
    )
    const body = await response.json()
    expect(body).toMatchObject({
      id: 'grp-1',
      name: 'Trip to Paris',
      currency: '$',
      currencyCode: 'USD',
      participants: [{ id: 'lp-1', name: 'Alice' }],
      expenses: [],
    })
    expect(prismaMock.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ledgerId: 'ledger-1' } }),
    )
  })

  it('includes ledger participants referenced by expenses even when they are not active members', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Trip to Paris',
      information: null,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-1' },
        },
      ],
    })
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'exp-1',
        createdAt: new Date('2024-06-01T00:00:00Z'),
        expenseDate: new Date('2024-06-01T00:00:00Z'),
        title: 'Dinner',
        categoryId: 'groceries',
        amount: 3000,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          {
            ledgerParticipant: {
              id: 'lp-1',
              groupMember: { account: { name: 'Alice' } },
              invitations: [],
            },
            shares: 3000,
          },
        ],
        paidFor: [
          { ledgerParticipantId: 'lp-1', shares: 1 },
          { ledgerParticipantId: 'lp-pending', shares: 1 },
        ],
        isReimbursement: false,
        splitMode: 'EVENLY',
        recurrenceRule: 'NONE',
      },
    ])
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-1',
        groupMember: { account: { name: 'Alice' } },
        invitations: [],
      },
      {
        id: 'lp-pending',
        groupMember: null,
        invitations: [{ email: 'bob@example.com' }],
      },
    ] as never)

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(200)
    expect(prismaMock.ledgerParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ledgerId: 'ledger-1',
          id: { in: ['lp-1', 'lp-pending'] },
        },
      }),
    )
    const body = await response.json()
    expect(body.participants).toEqual([
      { id: 'lp-1', name: 'Alice' },
      { id: 'lp-pending', name: 'bob@example.com' },
    ])
  })

  it('returns 404 when the group does not exist', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    // Member lookup succeeds (we allow the check), but the group is gone.
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    prismaMock.group.findUnique.mockResolvedValue(null)

    const response = await exportGroupJson(makeRequest(), 'grp-1')

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Invalid group ID')
  })

  it('cross-currency JSON: amount is ledger, originalAmount original, paidByList original currency', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Euro Trip',
      information: null,
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '€', currencyCode: 'EUR' },
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-1' },
        },
      ],
    })
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'exp-1',
        createdAt: new Date('2024-06-01T00:00:00Z'),
        expenseDate: new Date('2024-06-01T00:00:00Z'),
        title: 'USD Dinner',
        categoryId: 'dining-out',
        amount: 9200,
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          {
            ledgerParticipant: {
              id: 'lp-1',
              groupMember: { account: { name: 'Alice' } },
              invitations: [],
            },
            shares: 10000,
          },
        ],
        paidFor: [{ ledgerParticipantId: 'lp-1', shares: 9200 }],
        isReimbursement: false,
        splitMode: 'BY_AMOUNT',
        recurrenceRule: 'NONE',
        recurrenceSequence: 4,
        recurringSeries: {
          id: 'series-1',
          frequency: 'MONTHLY',
          interval: 2,
          endType: 'COUNT',
          occurrenceLimit: 8,
          endDate: null,
          status: 'CANCELLED',
          anchorDate: new Date('2024-01-31T00:00:00Z'),
          anchorSequence: 3,
          nextOccurrenceDate: new Date('2024-05-31T00:00:00Z'),
          nextOccurrenceOrdinal: 3,
          template: {
            title: 'Current template',
            categoryId: 'dining-out',
            amount: 10000,
            originalAmount: 10000,
            originalCurrency: 'USD',
            conversionRate: 0.92,
            conversionSource: 'CUSTOM',
            paidBySplitMode: 'BY_AMOUNT',
            paidByList: [{ ledgerParticipantId: 'lp-1', shares: 10000 }],
            paidFor: [{ ledgerParticipantId: 'lp-1', shares: 10000 }],
            splitMode: 'BY_AMOUNT',
            isReimbursement: false,
            notes: 'future template',
            items: [],
            itemizedRemainder: null,
          },
        },
        items: [],
        itemizedRemainder: null,
      },
    ])
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-1',
        groupMember: { account: { name: 'Alice' } },
        invitations: [],
      },
    ] as never)

    const response = await exportGroupJson(makeRequest(), 'grp-1')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.currencyCode).toBe('EUR')
    expect(body.expenses).toHaveLength(1)
    const exp = body.expenses[0]
    expect(exp.amount).toBe(9200)
    expect(exp.originalAmount).toBe(10000)
    expect(exp.originalCurrency).toBe('USD')
    expect(exp.paidByList[0].shares).toBe(10000)
    expect(exp.paidFor[0].shares).toBe(9200)
    expect(exp.paidById).toBe('lp-1')
    expect(exp.recurrenceRule).toBe('NONE')
    expect(exp.recurrence).toBeUndefined()
    expect(exp.recurringSeriesId).toBeUndefined()
  })
})

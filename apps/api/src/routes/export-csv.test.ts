import { describe, expect, it } from 'vitest'
import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import { exportGroupCsv } from './export-csv'

function makeRequest(): Request {
  return new Request('http://localhost/groups/abc/expenses/export/csv', {
    headers: new Headers({ cookie: 'spliit.session=test-token' }),
  })
}

describe('exportGroupCsv', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    authState.session = null

    const response = await exportGroupCsv(makeRequest(), 'grp-1')

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthenticated')
    expect(prismaMock.groupMember.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the group', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    const response = await exportGroupCsv(makeRequest(), 'grp-1')

    expect(response.status).toBe(403)
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })

  it('returns the CSV for an active member', async () => {
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
      role: 'OWNER',
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
          role: 'OWNER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-1', name: 'Alice' },
        },
        {
          id: 'gm-2',
          groupId: 'grp-1',
          accountId: 'acct-2',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-2', name: 'Bob' },
        },
      ],
    })
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'exp-1',
        expenseDate: new Date('2024-06-01T00:00:00Z'),
        title: 'Dinner',
        categoryId: 'groceries',
        amount: 3000,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidById: 'lp-1',
        paidFor: [
          { ledgerParticipantId: 'lp-1', shares: 1 },
          { ledgerParticipantId: 'lp-2', shares: 1 },
        ],
        isReimbursement: false,
        splitMode: 'EVENLY',
        recurrenceRule: 'NONE',
      },
    ])

    const response = await exportGroupCsv(makeRequest(), 'grp-1')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="Spliit Cloud Export - Trip to Paris - \d{4}-\d{2}-\d{2}\.csv"$/,
    )

    // The route prepends a UTF-8 BOM (EF BB BF) to the CSV body so that
    // Excel can detect the encoding. We check the raw bytes because
    // `Response.text()` may strip the BOM in some runtimes.
    const buf = new Uint8Array(await response.arrayBuffer())
    expect(buf[0]).toBe(0xef)
    expect(buf[1]).toBe(0xbb)
    expect(buf[2]).toBe(0xbf)
    const decoder = new TextDecoder('utf-8')
    const text = decoder.decode(buf.slice(3))
    expect(text).toContain('Alice')
    expect(text).toContain('Bob')
    expect(text).toContain('Dinner')
  })

  it('returns 404 when the active member belongs to a group that no longer exists', async () => {
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
      role: 'OWNER',
      status: 'ACTIVE',
    })
    prismaMock.group.findUnique.mockResolvedValue(null)

    const response = await exportGroupCsv(makeRequest(), 'grp-1')

    expect(response.status).toBe(404)
  })
})

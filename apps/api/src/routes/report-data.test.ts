import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../test/mocks'
import { prismaMock } from '../test/state'

const authMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/auth/session', () => ({
  getAuthFromRequest: authMock,
}))

import { reportGroupData } from './report-data'

const labels = {
  title: 'Expense report',
  generatedOnLabel: 'Generated on',
  periodLabel: 'Selected period',
  balanceAsOfLabel: 'Balance as of',
  totalSpentLabel: 'Total spent',
  expensesCountLabel: 'Expenses',
  participantsCountLabel: 'Participants',
  participantsSectionLabel: 'Participant summary',
  settlementsSectionLabel: 'Suggested settlements',
  reimbursementsSectionLabel: 'Recorded reimbursements',
  expensesSectionLabel: 'Expense details',
  amountColumnLabel: 'Amount',
  participantColumnLabel: 'Participant',
  paidColumnLabel: 'Paid',
  shareColumnLabel: 'Share',
  balanceColumnLabel: 'Balance',
  dateColumnLabel: 'Date',
  fromColumnLabel: 'From',
  toColumnLabel: 'To',
  expenseColumnLabel: 'Expense',
  categoryColumnLabel: 'Category',
  splitLabel: 'Split',
  noExpensesLabel: 'No expenses in the selected period.',
  noParticipantsLabel: 'No participants.',
  noSettlementsLabel: 'Everything is settled.',
  noReimbursementsLabel: 'No reimbursements recorded.',
  originalAmountLabel: 'Original amount',
  categoryNames: { food: 'Food' },
}

const authenticated = {
  session: { id: 'sess-1' },
  user: {
    id: 'acct-1',
    email: 'alice@example.com',
    emailVerified: true,
    name: 'Alice',
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/groups/grp-1/expenses/report-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  from: '2026-07-01',
  to: '2026-07-31',
  locale: 'en-US',
  labels,
}

beforeEach(() => {
  authMock.mockReset()
  authMock.mockResolvedValue(authenticated)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    status: 'ACTIVE',
  } as never)
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    name: 'Trip to Lisbon',
    ledgerId: 'ledger-1',
    members: [],
    ledger: { id: 'ledger-1', currency: '€', currencyCode: 'EUR' },
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([
    {
      id: 'e1',
      ledgerId: 'ledger-1',
      amount: 3000,
      createdAt: new Date('2026-07-10T09:00:00.000Z'),
      expenseDate: new Date('2026-07-10T00:00:00.000Z'),
      categoryId: 'food',
      isReimbursement: false,
      title: 'Dinner',
      splitMode: 'EVENLY',
      paidBySplitMode: 'EVENLY',
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      paidByList: [{ ledgerParticipantId: 'alice', shares: 3000 }],
      paidFor: [
        { ledgerParticipantId: 'alice', shares: 1 },
        { ledgerParticipantId: 'bob', shares: 1 },
      ],
      items: [],
      itemizedRemainder: null,
    },
  ] as never)
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([
    {
      id: 'alice',
      displayName: null,
      removedAt: null,
      groupMember: { account: { id: 'acct-1', name: 'Alice', image: null } },
      invitations: [],
    },
    {
      id: 'bob',
      displayName: null,
      removedAt: null,
      groupMember: { account: { id: 'acct-2', name: 'Bob', image: null } },
      invitations: [],
    },
  ] as never)
})

describe('reportGroupData', () => {
  it('requires an authenticated active group member', async () => {
    authMock.mockResolvedValue(null)
    expect(
      (await reportGroupData(makeRequest(validBody), 'grp-1')).status,
    ).toBe(401)

    authMock.mockResolvedValue(authenticated)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)
    expect(
      (await reportGroupData(makeRequest(validBody), 'grp-1')).status,
    ).toBe(403)
  })

  it('validates the report body and date range', async () => {
    expect(
      (await reportGroupData(makeRequest({ from: '2026-07-01' }), 'grp-1'))
        .status,
    ).toBe(400)

    expect(
      (
        await reportGroupData(
          makeRequest({ ...validBody, from: '2026-08-01' }),
          'grp-1',
        )
      ).status,
    ).toBe(400)
  })

  it('returns a localized report view without rendering a PDF', async () => {
    const response = await reportGroupData(makeRequest(validBody), 'grp-1')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')

    const body = await response.json()
    expect(body.groupName).toBe('Trip to Lisbon')
    expect(body.metrics.total).toBe('€30.00')
    expect(body.expenses).toHaveLength(1)
    expect(body.expenses[0].payers).toEqual([
      { id: 'alice', name: 'Alice', amount: '€30.00' },
    ])
    expect(body.expenses[0].shares).toEqual([
      { id: 'alice', name: 'Alice', amount: '€15.00' },
      { id: 'bob', name: 'Bob', amount: '€15.00' },
    ])
  })

  it('returns a zero-state view for an empty group', async () => {
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)

    const response = await reportGroupData(makeRequest(validBody), 'grp-1')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.metrics.total).toBe('€0.00')
    expect(body.expenses).toEqual([])
    expect(body.participants).toEqual([])
  })
})

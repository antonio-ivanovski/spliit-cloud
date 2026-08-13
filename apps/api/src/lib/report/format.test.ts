import { afterEach, describe, expect, it } from 'vitest'

import { formatExpenseReport } from './format'
import type { ReportLabels } from './labels'
import { buildExpenseReport } from './model'

const labels: ReportLabels = {
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
  noExpensesLabel: 'No expenses',
  noParticipantsLabel: 'No participants',
  noSettlementsLabel: 'Settled',
  noReimbursementsLabel: 'No reimbursements',
  originalAmountLabel: 'Original amount',
  categoryNames: { food: 'Food' },
}

describe('formatExpenseReport', () => {
  const previousTz = process.env.TZ

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })

  it('keeps UTC date-only calendar days when the host is west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles'

    const model = buildExpenseReport({
      groupName: 'Trip',
      currencyCode: 'EUR',
      currencySymbol: '€',
      currencyDecimalDigits: 2,
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-31T00:00:00.000Z'),
      participants: [{ id: 'alice', name: 'Alice', removed: false }],
      rows: [
        {
          id: 'e1',
          amount: 1000,
          expenseDate: new Date('2026-07-01T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          categoryId: 'food',
          title: 'Dinner',
          splitMode: 'EVENLY',
          paidBySplitMode: 'EVENLY',
          originalAmount: null,
          originalCurrency: null,
          conversionRate: null,
          conversionSource: null,
          paidByList: [{ ledgerParticipantId: 'alice', shares: 1000 }],
          paidFor: [{ ledgerParticipantId: 'alice', shares: 1 }],
          items: [],
          itemizedRemainder: null,
        },
      ],
    })

    const view = formatExpenseReport(model, 'en-US', labels)
    expect(view.periodRange).toBe('Jul 1, 2026 – Jul 31, 2026')
    expect(view.asOfDate).toBe('Jul 31, 2026')
    expect(view.expenses[0].date).toBe('Jul 1, 2026')
  })
})

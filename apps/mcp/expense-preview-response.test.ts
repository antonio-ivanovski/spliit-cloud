import { describe, expect, it } from 'vitest'

import { createExpensePreviewResult } from './expense-preview-response'

const preview = {
  group: {
    id: 'group-1',
    name: 'Portugal',
    currency: '$',
    currencyCode: 'USD',
    decimalDigits: 2,
  },
  expenseCurrency: {
    code: 'USD',
    symbol: '$',
    decimalDigits: 2,
  },
  title: 'Dinner',
  amountMinor: 5000,
  amount: '50',
  date: '2026-07-29',
  category: 'dining-out',
  notes: null,
  paidBy: [{ participantId: 'alice', name: 'Alice', shares: 5000 }],
  split: {
    mode: 'EVENLY' as const,
    participants: [
      { participantId: 'alice', name: 'Alice', shares: 1 },
      { participantId: 'bob', name: 'Bob', shares: 1 },
    ],
  },
  items: [],
  remainder: null,
  conversion: null,
  defaults: [],
}

describe('createExpensePreviewResult', () => {
  it('keeps the confirmation token in widget-only metadata', () => {
    const confirmationToken = 'encrypted-confirmation-token'
    const result = createExpensePreviewResult({
      preview,
      confirmationToken,
      webUrl: 'https://spliit.example',
    })

    expect(result.structuredContent).toEqual({
      preview,
      expenseUrlBase: 'https://spliit.example/groups/group-1/expenses',
    })
    expect(result._meta).toEqual({ confirmationToken })
    expect(JSON.stringify(result.content)).not.toContain(confirmationToken)
    expect(JSON.stringify(result.structuredContent)).not.toContain(
      confirmationToken,
    )
  })
})

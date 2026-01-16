import { expenseFormSchema } from './schemas'

describe('expenseFormSchema', () => {
  it('validates required fields', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 0,
      amount: 1000,
      originalAmount: undefined,
      originalCurrency: '',
      conversionRate: undefined,
      paidBy: 'p0',
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      notes: undefined,
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(true)
  })

  it('fails when title is missing', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      category: 0,
      amount: 1000,
      originalCurrency: '',
      paidBy: 'p0',
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
  })
})

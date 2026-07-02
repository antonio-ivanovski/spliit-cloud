import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { documentsDiffer } from './documents.differ'

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    expenseDate: new Date('2026-01-01T00:00:00.000Z'),
    title: 'Dinner',
    category: 'general',
    amount: 4500,
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    paidFor: [
      { participant: 'lp-alice', shares: 1 },
      { participant: 'lp-bob', shares: 1 },
    ],
    isMultiPayer: false,
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as Expense
}

const doc1 = { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }
const doc2 = { id: 'doc-2', url: 'https://x/b.png', width: 1, height: 1 }

describe('documentsDiffer', () => {
  it('check returns false for identical documents', () => {
    expect(
      documentsDiffer.check(
        makeExpense({ documents: [] }),
        makeExpense({ documents: [] }),
      ),
    ).toBe(false)
  })

  it('check returns true when document is added', () => {
    expect(
      documentsDiffer.check(
        makeExpense({ documents: [doc1] }),
        makeExpense({ documents: [doc1, doc2] }),
      ),
    ).toBe(true)
  })

  it('check returns true when document is removed', () => {
    expect(
      documentsDiffer.check(
        makeExpense({ documents: [doc1] }),
        makeExpense({ documents: [] }),
      ),
    ).toBe(true)
  })

  it('check returns false for reordered documents', () => {
    expect(
      documentsDiffer.check(
        makeExpense({ documents: [doc1, doc2] }),
        makeExpense({ documents: [doc2, doc1] }),
      ),
    ).toBe(false)
  })

  it('diff returns null for identical documents', () => {
    expect(
      documentsDiffer.diff(
        makeExpense({ documents: [] }),
        makeExpense({ documents: [] }),
        {} as any,
      ),
    ).toBeNull()
  })

  it('diff shows attachment count with singular label', () => {
    const result = documentsDiffer.diff(
      makeExpense({ documents: [doc1] }),
      makeExpense({ documents: [doc1, doc2] }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'documents',
      before: '1 attachment',
      after: '2 attachments',
    })
  })

  it('diff shows null for zero documents', () => {
    const result = documentsDiffer.diff(
      makeExpense({ documents: [doc1] }),
      makeExpense({ documents: [] }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'documents',
      before: '1 attachment',
      after: null,
    })
  })

  it('field is "documents"', () => {
    expect(documentsDiffer.field).toBe('documents')
  })
})

import type { Expense, ExpenseApiItem } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { itemsDiffer } from './items.differ'

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

function item(overrides: Partial<ExpenseApiItem> = {}): ExpenseApiItem {
  return {
    id: undefined,
    title: 'Pizza',
    unitPrice: 1500,
    quantity: 1,
    amount: 1500,
    splitMode: 'EVENLY',
    paidFor: [{ participant: 'lp-alice', shares: 1 }],
    ...overrides,
  } as ExpenseApiItem
}

describe('itemsDiffer', () => {
  it('check returns false for identical items (both empty)', () => {
    expect(itemsDiffer.check(makeExpense(), makeExpense())).toBe(false)
  })

  it('check returns true when items are added', () => {
    expect(
      itemsDiffer.check(
        makeExpense({ items: [] }),
        makeExpense({ items: [item({ id: 'i-1' })] }),
      ),
    ).toBe(true)
  })

  it('check returns true when items are removed', () => {
    expect(
      itemsDiffer.check(
        makeExpense({ items: [item({ id: 'i-1' })] }),
        makeExpense({ items: [] }),
      ),
    ).toBe(true)
  })

  it('check returns true when item paid-for changes', () => {
    const a = makeExpense({
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
    })
    const b = makeExpense({
      items: [
        item({
          id: 'i-1',
          paidFor: [
            { participant: 'lp-alice', shares: 1 },
            { participant: 'lp-bob', shares: 1 },
          ],
        }),
      ],
    })
    expect(itemsDiffer.check(a, b)).toBe(true)
  })

  it('check returns true when item title changes', () => {
    expect(
      itemsDiffer.check(
        makeExpense({ items: [item({ id: 'i-1', title: 'Old' })] }),
        makeExpense({ items: [item({ id: 'i-1', title: 'New' })] }),
      ),
    ).toBe(true)
  })

  it('check returns false for reordered items (order-independent)', () => {
    const a = makeExpense({ items: [item({ id: 'i-1' }), item({ id: 'i-2' })] })
    const b = makeExpense({ items: [item({ id: 'i-2' }), item({ id: 'i-1' })] })
    expect(itemsDiffer.check(a, b)).toBe(false)
  })

  it('check returns false when paidFor inside items is reordered (false-positive suppression)', () => {
    const a = makeExpense({
      items: [
        item({
          id: 'i-1',
          paidFor: [
            { participant: 'lp-alice', shares: 1 },
            { participant: 'lp-bob', shares: 1 },
          ],
        }),
      ],
    })
    const b = makeExpense({
      items: [
        item({
          id: 'i-1',
          paidFor: [
            { participant: 'lp-bob', shares: 1 },
            { participant: 'lp-alice', shares: 1 },
          ],
        }),
      ],
    })
    expect(itemsDiffer.check(a, b)).toBe(false)
  })

  it('diff returns null for identical items', () => {
    expect(itemsDiffer.diff(makeExpense(), makeExpense(), {} as any)).toBeNull()
  })

  it('diff shows item counts (0 → 2)', () => {
    const result = itemsDiffer.diff(
      makeExpense(),
      makeExpense({ items: [item({ id: 'i-1' }), item({ id: 'i-2' })] }),
      {} as any,
    )
    expect(result).toEqual({ field: 'items', before: null, after: '2' })
  })

  it('diff shows item counts (2 → 0)', () => {
    const result = itemsDiffer.diff(
      makeExpense({ items: [item({ id: 'i-1' }), item({ id: 'i-2' })] }),
      makeExpense(),
      {} as any,
    )
    expect(result).toEqual({ field: 'items', before: '2', after: null })
  })

  it('field is "items"', () => {
    expect(itemsDiffer.field).toBe('items')
  })
})

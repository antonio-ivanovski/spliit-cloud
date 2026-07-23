import type { Expense, ExpenseApiItem } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { itemsDiffer } from './items.differ'
import type { ChangeContext } from './types'

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

const ctx: ChangeContext = {
  getParticipantName: (id) => id,
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${(c / 100).toFixed(2)}`,
  ledgerCurrencyCode: 'EUR',
}

describe('itemsDiffer', () => {
  describe('check', () => {
    it('returns false for identical items (both empty)', () => {
      expect(itemsDiffer.check(makeExpense(), makeExpense())).toBe(false)
    })

    it('returns true when items are added', () => {
      expect(
        itemsDiffer.check(
          makeExpense({ items: [] }),
          makeExpense({ items: [item({ id: 'i-1' })] }),
        ),
      ).toBe(true)
    })

    it('returns true when items are removed', () => {
      expect(
        itemsDiffer.check(
          makeExpense({ items: [item({ id: 'i-1' })] }),
          makeExpense({ items: [] }),
        ),
      ).toBe(true)
    })

    it('returns true when item title changes', () => {
      expect(
        itemsDiffer.check(
          makeExpense({ items: [item({ id: 'i-1', title: 'Old' })] }),
          makeExpense({ items: [item({ id: 'i-1', title: 'New' })] }),
        ),
      ).toBe(true)
    })

    it('returns true when item quantity changes', () => {
      expect(
        itemsDiffer.check(
          makeExpense({ items: [item({ id: 'i-1', quantity: 1 })] }),
          makeExpense({ items: [item({ id: 'i-1', quantity: 2 })] }),
        ),
      ).toBe(true)
    })

    it('returns true when item unitPrice changes', () => {
      expect(
        itemsDiffer.check(
          makeExpense({ items: [item({ id: 'i-1', unitPrice: 1000 })] }),
          makeExpense({ items: [item({ id: 'i-1', unitPrice: 1200 })] }),
        ),
      ).toBe(true)
    })

    it('returns true when item paidFor changes', () => {
      const a = makeExpense({
        items: [
          item({
            id: 'i-1',
            paidFor: [{ participant: 'lp-alice', shares: 1 }],
          }),
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

    it('returns false for reordered items (order-independent)', () => {
      const a = makeExpense({
        items: [item({ id: 'i-1' }), item({ id: 'i-2' })],
      })
      const b = makeExpense({
        items: [item({ id: 'i-2' }), item({ id: 'i-1' })],
      })
      expect(itemsDiffer.check(a, b)).toBe(false)
    })

    it('returns false when paidFor inside items is reordered (false-positive suppression)', () => {
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

    it('returns false when splitMode changes but other fields are equal and paidFor empty', () => {
      const a = makeExpense({
        items: [item({ id: 'i-1', splitMode: 'EVENLY', paidFor: [] })],
      })
      const b = makeExpense({
        items: [item({ id: 'i-1', splitMode: 'BY_SHARES', paidFor: [] })],
      })
      expect(itemsDiffer.check(a, b)).toBe(true)
    })
  })

  describe('diff', () => {
    it('returns null for identical items', () => {
      expect(itemsDiffer.diff(makeExpense(), makeExpense(), ctx)).toBeNull()
    })

    it('returns null for identical id-less items', () => {
      const items = [
        item({ title: 'Pizza' }),
        item({ title: 'Pizza', unitPrice: 500, amount: 500 }),
      ]

      expect(
        itemsDiffer.diff(
          makeExpense({ items }),
          makeExpense({ items: [...items].reverse() }),
          ctx,
        ),
      ).toBeNull()
    })

    it('reports only the changed id-less item', () => {
      const unchangedWater = item({
        title: 'Water',
        unitPrice: 500,
        amount: 500,
      })
      const unchangedTip = item({ title: 'Tip', unitPrice: 300, amount: 300 })
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            unchangedWater,
            item({ title: 'Pizza', unitPrice: 1400, amount: 1400 }),
            unchangedTip,
          ],
        }),
        makeExpense({
          items: [
            unchangedTip,
            item({ title: 'Pizza', unitPrice: 1600, amount: 1600 }),
            unchangedWater,
          ],
        }),
        ctx,
      )

      expect(result).toEqual({
        field: 'items',
        before:
          '+ Pizza 1 × EUR 16.00 = EUR 16.00\n' +
          '- Pizza 1 × EUR 14.00 = EUR 14.00',
        after: null,
      })
    })

    it('continues to pair id-bearing items as modified', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [item({ id: 'i-1', unitPrice: 1400, amount: 1400 })],
        }),
        makeExpense({
          items: [item({ id: 'i-1', unitPrice: 1600, amount: 1600 })],
        }),
        ctx,
      )

      expect(result).toEqual({
        field: 'items',
        before:
          'Pizza 1 × EUR 14.00 = EUR 14.00 → Pizza 1 × EUR 16.00 = EUR 16.00',
        after: null,
      })
    })

    it('reports mixed id-less additions and removals', () => {
      const water = item({ title: 'Water', unitPrice: 500, amount: 500 })
      const result = itemsDiffer.diff(
        makeExpense({ items: [water, item({ ...water })] }),
        makeExpense({
          items: [water, item({ title: 'Milk', unitPrice: 400, amount: 400 })],
        }),
        ctx,
      )

      expect(result).toEqual({
        field: 'items',
        before:
          '+ Milk 1 × EUR 4.00 = EUR 4.00\n' +
          '- Water 1 × EUR 5.00 = EUR 5.00',
        after: null,
      })
    })

    it('emits "+ added" line when an item is added', () => {
      const result = itemsDiffer.diff(
        makeExpense({ items: [] }),
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Tip',
              quantity: 1,
              unitPrice: 1000,
              amount: 1000,
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before: '+ Tip 1 × EUR 10.00 = EUR 10.00',
        after: null,
      })
    })

    it('emits "- removed" line when an item is removed', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Water',
              quantity: 1,
              unitPrice: 500,
              amount: 500,
            }),
          ],
        }),
        makeExpense({ items: [] }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before: '- Water 1 × EUR 5.00 = EUR 5.00',
        after: null,
      })
    })

    it('emits "before → after" line when an item is modified', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Pizza',
              quantity: 2,
              unitPrice: 1400,
              amount: 2800,
            }),
          ],
        }),
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Pizza',
              quantity: 2,
              unitPrice: 1500,
              amount: 3000,
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before:
          'Pizza 2 × EUR 14.00 = EUR 28.00 → Pizza 2 × EUR 15.00 = EUR 30.00',
        after: null,
      })
    })

    it('shows full before/after when item name and price both change', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Beer',
              quantity: 2,
              unitPrice: 1000,
              amount: 2000,
            }),
          ],
        }),
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Radler',
              quantity: 2,
              unitPrice: 900,
              amount: 1800,
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before:
          'Beer 2 × EUR 10.00 = EUR 20.00 → Radler 2 × EUR 9.00 = EUR 18.00',
        after: null,
      })
    })

    it('emits split-only line when only paidFor changes', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Pizza',
              quantity: 2,
              unitPrice: 1400,
              amount: 2800,
              paidFor: [{ participant: 'lp-alice', shares: 1 }],
            }),
          ],
        }),
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Pizza',
              quantity: 2,
              unitPrice: 1400,
              amount: 2800,
              paidFor: [
                { participant: 'lp-alice', shares: 1 },
                { participant: 'lp-bob', shares: 1 },
              ],
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before: 'Pizza (split updated)',
        after: null,
      })
    })

    it('combines modified, added, and removed lines separated by \\n', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Beer',
              quantity: 2,
              unitPrice: 1000,
              amount: 2000,
            }),
            item({
              id: 'i-2',
              title: 'Water',
              quantity: 1,
              unitPrice: 500,
              amount: 500,
            }),
          ],
        }),
        makeExpense({
          items: [
            item({
              id: 'i-1',
              title: 'Beer',
              quantity: 3,
              unitPrice: 1000,
              amount: 3000,
            }),
            item({
              id: 'i-3',
              title: 'Tip',
              quantity: 1,
              unitPrice: 1000,
              amount: 1000,
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before:
          'Beer 2 × EUR 10.00 = EUR 20.00 → Beer 3 × EUR 10.00 = EUR 30.00\n' +
          '+ Tip 1 × EUR 10.00 = EUR 10.00\n' +
          '- Water 1 × EUR 5.00 = EUR 5.00',
        after: null,
      })
    })

    it('treats an item with no id as added', () => {
      const result = itemsDiffer.diff(
        makeExpense({ items: [] }),
        makeExpense({
          items: [
            item({
              id: undefined,
              title: 'New',
              quantity: 1,
              unitPrice: 1000,
              amount: 1000,
            }),
          ],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before: '+ New 1 × EUR 10.00 = EUR 10.00',
        after: null,
      })
    })

    it('uses expense originalCurrency for formatting when set', () => {
      const result = itemsDiffer.diff(
        makeExpense({
          originalCurrency: 'USD',
          originalAmount: 1000,
          amount: 1000,
          items: [
            item({
              id: 'i-1',
              title: 'Chips',
              quantity: 1,
              unitPrice: 500,
              amount: 500,
            }),
          ],
        }),
        makeExpense({
          originalCurrency: 'USD',
          originalAmount: 1000,
          amount: 1000,
          items: [],
        }),
        ctx,
      )
      expect(result).toEqual({
        field: 'items',
        before: '- Chips 1 × USD 5.00 = USD 5.00',
        after: null,
      })
    })

    it('field is "items"', () => {
      expect(itemsDiffer.field).toBe('items')
    })
  })
})

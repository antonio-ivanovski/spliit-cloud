import { describe, expect, it } from 'vitest'

import type { Expense, ExpenseApiItem } from '@spliit/domain'

import { amountDiffer } from './amount.differ'
import { categoryDiffer } from './category.differ'
import { compositeExpenseDiffer } from './composite.differ'
import { dateDiffer } from './date.differ'
import { documentsDiffer } from './documents.differ'
import { itemsDiffer } from './items.differ'
import { notesDiffer } from './notes.differ'
import { getAffectedParticipantIds } from './participant-collector'
import { payersDiffer } from './payers.differ'
import { recurrenceDiffer } from './recurrence.differ'
import { splitDiffer } from './split.differ'
import { titleDiffer } from './title.differ'
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
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as Expense
}

const ctx: ChangeContext = {
  getParticipantName: (id) => {
    const m: Record<string, string> = {
      'lp-alice': 'Alice',
      'lp-bob': 'Bob',
      'lp-carol': 'Carol',
    }
    return m[id] ?? id
  },
  getCategoryName: (id) => {
    const m: Record<string, string> = {
      general: 'General',
      groceries: 'Groceries',
    }
    return m[id] ?? id
  },
  formatCurrencyCents: (c, cur) => {
    const code = cur ?? 'EUR'
    return `${code} ${(c / 100).toFixed(2)}`
  },
  ledgerCurrencyCode: 'EUR',
}

function fullDiffer() {
  return compositeExpenseDiffer([
    titleDiffer,
    amountDiffer,
    dateDiffer,
    categoryDiffer,
    notesDiffer,
    recurrenceDiffer,
    payersDiffer,
    splitDiffer,
    itemsDiffer,
    documentsDiffer,
  ])
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

describe('compositeExpenseDiffer', () => {
  describe('changedFields', () => {
    it('returns null when nothing changed', () => {
      const composite = fullDiffer()
      expect(composite.changedFields(makeExpense(), makeExpense())).toBeNull()
    })

    it('returns all field names that differ', () => {
      const composite = fullDiffer()
      const result = composite.changedFields(
        makeExpense({ title: 'Old', amount: 1000, notes: 'prev' }),
        makeExpense({ title: 'New', amount: 2000, notes: 'new' }),
      )
      expect(result).toEqual(
        expect.arrayContaining(['title', 'amount', 'notes']),
      )
      expect(result).not.toContain('split')
    })

    it('returns fields in registration order', () => {
      const composite = compositeExpenseDiffer([titleDiffer, amountDiffer])
      expect(
        composite.changedFields(
          makeExpense({ title: 'A', amount: 100 }),
          makeExpense({ title: 'B', amount: 200 }),
        ),
      ).toEqual(['title', 'amount'])
    })

    it('works with a subset of differs', () => {
      const composite = compositeExpenseDiffer([titleDiffer, amountDiffer])
      const result = composite.changedFields(
        makeExpense({ title: 'X', amount: 100, recurrenceRule: 'NONE' }),
        makeExpense({ title: 'Y', amount: 200, recurrenceRule: 'WEEKLY' }),
      )
      // Recurrence is not registered, so only title+amount appear.
      expect(result).toEqual(['title', 'amount'])
    })
  })

  describe('changeSummary', () => {
    it('returns null when nothing changed', () => {
      expect(
        fullDiffer().changeSummary(makeExpense(), makeExpense(), ctx),
      ).toBeNull()
    })

    it('returns all diff emissions for changed fields', () => {
      const result = fullDiffer().changeSummary(
        makeExpense({ title: 'Old', amount: 1200, category: 'general' }),
        makeExpense({ title: 'New', amount: 1500, category: 'groceries' }),
        ctx,
      )
      expect(result).not.toBeNull()
      expect(result!.length).toBe(3)
      expect(result!.find((d) => d.field === 'title')).toEqual({
        field: 'title',
        before: 'Old',
        after: 'New',
      })
      expect(result!.find((d) => d.field === 'amount')).toEqual({
        field: 'amount',
        before: 'EUR 12.00',
        after: 'EUR 15.00',
      })
      expect(result!.find((d) => d.field === 'category')).toEqual({
        field: 'category',
        before: 'General',
        after: 'Groceries',
      })
    })

    it('BY_AMOUNT payer noise: amount changes, payers do not flag', () => {
      const result = fullDiffer().changeSummary(
        makeExpense({
          amount: 4500,
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
        makeExpense({
          amount: 5000,
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: 'lp-alice', shares: 5000 }],
        }),
        ctx,
      )
      expect(result).not.toBeNull()
      const fields = result!.map((d) => d.field)
      expect(fields).toContain('amount')
      expect(fields).not.toContain('payers')
    })

    it('changeSummary returns null when no field actually changed', () => {
      const result = fullDiffer().changeSummary(
        makeExpense(),
        makeExpense(),
        ctx,
      )
      expect(result).toBeNull()
    })
  })

  describe('getDiffers', () => {
    it('returns configured differs', () => {
      const composite = compositeExpenseDiffer([titleDiffer])
      expect(composite.getDiffers()).toHaveLength(1)
      expect(composite.getDiffers()[0]).toBe(titleDiffer)
    })
  })
})

describe('getAffectedParticipantIds', () => {
  it('returns every payer and split participant from a single expense (create case)', () => {
    const expense = makeExpense({
      paidByList: [
        { participant: 'lp-alice', shares: 3000 },
        { participant: 'lp-bob', shares: 1500 },
      ],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
        { participant: 'lp-carol', shares: 1 },
      ],
    })
    expect(getAffectedParticipantIds({ newExpense: expense })).toEqual(
      new Set(['lp-alice', 'lp-bob', 'lp-carol']),
    )
  })

  it('unions old and new participant ids (update case)', () => {
    const old = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const upd = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-carol', shares: 1 },
      ],
    })
    expect(
      getAffectedParticipantIds({ oldExpense: old, newExpense: upd }),
    ).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol']))
  })

  it('tolerates undefined oldExpense (create)', () => {
    const ids = getAffectedParticipantIds({ newExpense: makeExpense() })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('tolerates undefined newExpense (delete)', () => {
    const ids = getAffectedParticipantIds({ oldExpense: makeExpense() })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('collects from items and itemized remainder', () => {
    const old = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
    })
    const upd = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
        item({
          id: 'i-2',
          paidFor: [
            { participant: 'lp-bob', shares: 1 },
            { participant: 'lp-carol', shares: 1 },
          ],
        }),
      ],
      itemizedRemainder: {
        splitMode: 'EVENLY',
        paidFor: [{ participant: 'lp-dave', shares: 1 }],
      },
    })
    expect(
      getAffectedParticipantIds({ oldExpense: old, newExpense: upd }),
    ).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol', 'lp-dave']))
  })
})

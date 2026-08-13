import { describe, expect, it } from 'vitest'

import type { Expense } from '@spliit/domain'

import { notesDiffer } from './notes.differ'
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
  getParticipantName: (id) => id,
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
  ledgerCurrencyCode: 'EUR',
}

describe('notesDiffer', () => {
  describe('check', () => {
    it('returns false when both have no notes (undefined)', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: undefined }),
          makeExpense({ notes: undefined }),
        ),
      ).toBe(false)
    })

    it('returns false when both have no notes (null vs undefined)', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: undefined }),
          makeExpense({ notes: null as unknown as undefined }),
        ),
      ).toBe(false)
    })

    it('returns true when notes added', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: undefined }),
          makeExpense({ notes: 'hello' }),
        ),
      ).toBe(true)
    })

    it('returns true when notes removed', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: 'old' }),
          makeExpense({ notes: undefined }),
        ),
      ).toBe(true)
    })

    it('returns true when notes content changed (both present)', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: 'v1' }),
          makeExpense({ notes: 'v2' }),
        ),
      ).toBe(true)
    })

    it('returns false when old is null and new is empty string', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: null as unknown as undefined }),
          makeExpense({ notes: '' }),
        ),
      ).toBe(false)
    })

    it('returns false when old is undefined and new is whitespace', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: undefined }),
          makeExpense({ notes: '   \n\t ' }),
        ),
      ).toBe(false)
    })

    it('returns false when old is whitespace and new is null', () => {
      expect(
        notesDiffer.check(
          makeExpense({ notes: '   ' }),
          makeExpense({ notes: null as unknown as undefined }),
        ),
      ).toBe(false)
    })
  })

  describe('diff', () => {
    it('returns null when notes are identical', () => {
      expect(
        notesDiffer.diff(
          makeExpense({ notes: undefined }),
          makeExpense({ notes: undefined }),
          ctx,
        ),
      ).toBeNull()
    })

    it('returns "Added" when notes were added', () => {
      const result = notesDiffer.diff(
        makeExpense({ notes: undefined }),
        makeExpense({ notes: 'important' }),
        ctx,
      )
      expect(result).toEqual({ field: 'notes', before: null, after: 'Added' })
    })

    it('returns "Removed" when notes were removed', () => {
      const result = notesDiffer.diff(
        makeExpense({ notes: 'old note' }),
        makeExpense({ notes: undefined }),
        ctx,
      )
      expect(result).toEqual({ field: 'notes', before: 'Removed', after: null })
    })

    it('returns "Present"/"Present" when content changed (no text leaked)', () => {
      const result = notesDiffer.diff(
        makeExpense({ notes: 'version 1' }),
        makeExpense({ notes: 'version 2' }),
        ctx,
      )
      expect(result).toEqual({
        field: 'notes',
        before: 'Present',
        after: 'Present',
      })
    })
  })

  it('field is "notes"', () => {
    expect(notesDiffer.field).toBe('notes')
  })
})

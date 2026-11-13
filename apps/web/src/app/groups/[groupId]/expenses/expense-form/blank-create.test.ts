import { describe, expect, it } from 'vitest'

import type { CreateExpenseSearch } from '@/router/schemas'

import { isBlankCreateEntry, type BlankCreateEntryArgs } from './blank-create'

const baseEntry: BlankCreateEntryArgs = {
  isCreate: true,
  hasSourceExpense: false,
  hasDraftExpense: false,
  isCopy: false,
  hasRestoredDraft: false,
  searchParams: {},
}

const prefilledSearchCases: Array<[string, CreateExpenseSearch]> = [
  ['title', { title: 'Dinner' }],
  ['amount', { amount: '2500' }],
  ['date', { date: '2026-01-01' }],
  ['category', { categoryId: 'food-and-drink' }],
  ['currency', { originalCurrency: 'EUR' }],
  ['items', { items: '[]' }],
  ['payer', { payer: 'lp-1' }],
  ['participants', { participants: 'lp-1,lp-2' }],
  ['copy source', { fromExpenseId: 'expense-1' }],
  ['settlement', { settlement: 'yes' }],
  ['reimbursement', { reimbursement: 'yes' }],
  ['settlement legs', { settlements: '[]', from: 'lp-1', to: 'lp-2' }],
  ['receipt image', { imageUrl: 'https://example.com/receipt.jpg' }],
  ['share origin', { fromShare: '1' }],
]

const nonBlankContextCases: Array<[string, Partial<BlankCreateEntryArgs>]> = [
  ['edit form', { isCreate: false }],
  ['copy flow', { isCopy: true }],
  ['source expense', { hasSourceExpense: true }],
  ['import draft', { hasDraftExpense: true }],
  ['restored draft', { hasRestoredDraft: true }],
]

describe('isBlankCreateEntry', () => {
  it('accepts a fresh create with no search params', () => {
    expect(isBlankCreateEntry(baseEntry)).toBe(true)
    expect(isBlankCreateEntry({ ...baseEntry, searchParams: undefined })).toBe(
      true,
    )
  })

  it('accepts access and navigation search params', () => {
    expect(
      isBlankCreateEntry({
        ...baseEntry,
        searchParams: {
          invite: 'invite-token',
          viewKey: 'view-key',
          invitation: 'invitation-token',
          invitationAction: 'accept',
          returnTo: '/expenses',
        },
      }),
    ).toBe(true)
  })

  it('ignores empty search values', () => {
    expect(
      isBlankCreateEntry({
        ...baseEntry,
        searchParams: { title: '', amount: '', originalCurrency: '' },
      }),
    ).toBe(true)
  })

  it.each(prefilledSearchCases)(
    'rejects a prefilled create: %s',
    (_label, searchParams) => {
      expect(isBlankCreateEntry({ ...baseEntry, searchParams })).toBe(false)
    },
  )

  it.each(nonBlankContextCases)(
    'rejects a non-blank context: %s',
    (_label, override) => {
      expect(isBlankCreateEntry({ ...baseEntry, ...override })).toBe(false)
    },
  )
})

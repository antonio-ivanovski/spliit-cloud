import { describe, expect, it } from 'vitest'

import { duplicateBadgeLabel } from './duplicate-badge'
import { buildPersonalDrafts } from './personal-import-model'

function mappedRow(overrides: Record<string, unknown> = {}) {
  return {
    rowId: 'row-1',
    rowNumber: 2,
    source: { baseFingerprint: 'b', originFingerprint: 'o' },
    title: 'Market',
    expenseDate: '2026-10-01',
    expenseTimeMinutes: 720,
    amount: -1250,
    currency: 'USD',
    category: 'general',
    categorySource: null,
    notes: null,
    externalId: null,
    sourceAccount: null,
    issues: [],
    warning: null,
    error: null,
    ...overrides,
  } as never
}

describe('personal import drafts', () => {
  it('builds expense drafts from negative amounts', () => {
    const drafts = buildPersonalDrafts([mappedRow()], {
      negativeIs: 'expense',
      fallbackTitle: 'Imported',
    })
    expect(drafts[0]).toMatchObject({
      kind: 'EXPENSE',
      amount: 1250,
      currency: 'USD',
      selected: true,
    })
  })

  it('labels shared duplicates distinctly', () => {
    const t = (key: string) => key
    expect(
      duplicateBadgeLabel(
        [
          {
            key: 'EXACT_IMPORT:1',
            kind: 'EXACT_IMPORT',
            transactionId: '1',
            sourceRowId: null,
            title: null,
            date: null,
            amount: null,
            currency: null,
            source: 'PERSONAL',
          },
        ],
        t,
      ),
    ).toBe('import.duplicateExact')
    expect(
      duplicateBadgeLabel(
        [
          {
            key: 'EXISTING_TRANSACTION:2',
            kind: 'EXISTING_TRANSACTION',
            transactionId: '2',
            sourceRowId: null,
            title: null,
            date: null,
            amount: null,
            currency: null,
            source: 'GROUP',
          },
        ],
        t,
      ),
    ).toBe('import.duplicateShared')
  })
})

import {
  buildPersonalImportEntry,
  type PersonalImportNegativeIs,
} from '@spliit/domain'
import type { DelimitedMappedRow } from '@spliit/domain/import'

import type { PersonalImportRequestRow } from '../api'

export type PersonalDraftRow = {
  mapped: DelimitedMappedRow
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  currency: string
  date: string
  title: string
  categoryId: string
  note: string | null
  error: string | null
  selected: boolean
  approvedDuplicateKeys: string[]
}

export function buildPersonalDrafts(
  mappedRows: DelimitedMappedRow[],
  options: {
    negativeIs: PersonalImportNegativeIs
    fallbackTitle: string
  },
): PersonalDraftRow[] {
  return mappedRows.map((mapped) => {
    const built = buildPersonalImportEntry(mapped, {
      negativeIs: options.negativeIs,
    })
    if (!built.entry) {
      return {
        mapped,
        kind: 'EXPENSE' as const,
        amount: 0,
        currency: (mapped.currency ?? '').toUpperCase(),
        date: mapped.expenseDate,
        title: mapped.title || options.fallbackTitle,
        categoryId: mapped.category,
        note: mapped.notes ?? null,
        error: built.error ?? 'INVALID_AMOUNT',
        selected: false,
        approvedDuplicateKeys: [],
      }
    }
    return {
      mapped,
      kind: built.entry.kind,
      amount: built.entry.amount,
      currency: built.entry.currency,
      date: built.entry.date,
      title: built.entry.title || options.fallbackTitle,
      categoryId: built.entry.categoryId,
      note: built.entry.note,
      error: null,
      selected: true,
      approvedDuplicateKeys: [],
    }
  })
}

export function toPersonalImportRequestRow(
  row: PersonalDraftRow,
): PersonalImportRequestRow {
  return {
    rowId: row.mapped.rowId,
    rowNumber: row.mapped.rowNumber,
    source: row.mapped.source,
    externalId: row.mapped.externalId,
    sourceAccount: row.mapped.sourceAccount,
    entry: {
      kind: row.kind,
      amount: row.amount,
      currencyCode: row.currency || undefined,
      date: row.date,
      categoryId: row.categoryId,
      title: row.title,
      note: row.note,
    },
    approvedDuplicateKeys: row.approvedDuplicateKeys,
  }
}

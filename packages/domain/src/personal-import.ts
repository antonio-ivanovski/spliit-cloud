import type { DelimitedMappedRow } from './import/generic-csv'

/**
 * Personal bank-CSV row builder (target-specific, no participants).
 *
 * The generic delimited pipeline produces signed `amount` minor units and a
 * category guess. Personal rows store positive amounts with an explicit kind,
 * so this module infers kind from the sign with an import-level `negativeIs`
 * switch (bank debit/credit conventions differ) and normalizes the income
 * category. Pure, no Effect, no provider knowledge.
 */

export type PersonalImportNegativeIs = 'expense' | 'income'

export type PersonalImportBuiltEntry = {
  kind: 'EXPENSE' | 'INCOME'
  /** Positive minor units. */
  amount: number
  currency: string
  date: string
  title: string
  categoryId: string
  note: string | null
}

export function resolvePersonalImportKind(
  signedAmount: number,
  negativeIs: PersonalImportNegativeIs,
): 'EXPENSE' | 'INCOME' {
  if (signedAmount < 0) return negativeIs === 'expense' ? 'EXPENSE' : 'INCOME'
  return negativeIs === 'expense' ? 'INCOME' : 'EXPENSE'
}

export function buildPersonalImportEntry(
  row: Pick<
    DelimitedMappedRow,
    'amount' | 'currency' | 'expenseDate' | 'title' | 'category' | 'notes'
  >,
  options: { negativeIs: PersonalImportNegativeIs },
): { entry: PersonalImportBuiltEntry | null; error: string | null } {
  const signed = row.amount ?? 0
  if (!Number.isInteger(signed) || signed === 0) {
    return { entry: null, error: 'INVALID_AMOUNT' }
  }
  if (row.category === 'settlement') {
    return { entry: null, error: 'SETTLEMENT_NOT_ALLOWED' }
  }
  const kind = resolvePersonalImportKind(signed, options.negativeIs)
  let categoryId = row.category ?? 'general'
  if (kind === 'INCOME') {
    if (categoryId === 'general') categoryId = 'income'
  } else if (categoryId === 'income') {
    categoryId = 'general'
  }
  return {
    entry: {
      kind,
      amount: Math.abs(signed),
      currency: (row.currency ?? '').toUpperCase(),
      date: row.expenseDate,
      title: (row.title ?? '').trim(),
      categoryId,
      note: row.notes?.trim() ? row.notes.trim() : null,
    },
    error: null,
  }
}

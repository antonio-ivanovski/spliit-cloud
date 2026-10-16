/**
 * Cospend project CSV section headers.
 *
 * Cospend exports one CSV per project with five fixed-layout sections (members,
 * bills, categories, payment modes, optionally currencies). The headers are an
 * exact wire contract (lowercase, no localization), so matching is positional
 * via `isExactHeaderRow`, not a label set.
 */

import { isExactHeaderRow } from './header-map'

export const COSPEND_MEMBER_HEADER = ['name', 'weight', 'active', 'color']

export const COSPEND_BILL_HEADER = [
  'what',
  'amount',
  'date',
  'timestamp',
  'payer_name',
  'payer_weight',
  'payer_active',
  'owers',
  'repeat',
  'repeatfreq',
  'repeatallactive',
  'repeatuntil',
  'categoryid',
  'paymentmode',
  'paymentmodeid',
  'comment',
  'deleted',
]

export const COSPEND_CATEGORY_HEADER = [
  'categoryname',
  'categoryid',
  'icon',
  'color',
]

export const COSPEND_PAYMENTMODE_HEADER = [
  'paymentmodename',
  'paymentmodeid',
  'icon',
  'color',
]

export const COSPEND_CURRENCY_HEADER = ['currencyname', 'exchange_rate']

/** Exact ordered match against a Cospend section header row. */
export function isCospendHeader(
  row: readonly (string | undefined)[] | undefined,
  expected: readonly string[],
): boolean {
  return isExactHeaderRow(row, expected)
}

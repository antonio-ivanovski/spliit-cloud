/**
 * Legacy spliit.app CSV layout.
 *
 * The immutable legacy export has fixed base columns (`Date, Description,
 * Category, Currency, Cost, Original cost, Original currency, Conversion rate`)
 * followed by either a `Conversion source` column or directly the `Is
 * Settlement` / legacy `Is Reimbursement` alias and `Split mode`, then one
 * column per participant. This is not the Spliit Cloud export format. Current
 * Cloud recurrence columns are rejected — they are a different transport format
 * and must not become part of this importer's public schema.
 */

import { isExactHeaderRow, normalizeHeaderLabel } from './header-map'

export const SPLIIT_CSV_BASE_COLUMNS = [
  'Date',
  'Description',
  'Category',
  'Currency',
  'Cost',
  'Original cost',
  'Original currency',
  'Conversion rate',
] as const

export type SpliitCsvLayout = {
  /** Column index of `Is Settlement` or the legacy `Is Reimbursement` alias. */
  isReimbursement: number
  splitMode: number
  participantStart: number
}

export function isSpliitSettlementCsvHeader(
  value: string | undefined,
): boolean {
  return value === 'Is Settlement' || value === 'Is Reimbursement'
}

/**
 * Accept the legacy spliit.app CSV layout (with the historical optional
 * Conversion source column). Returns the column layout, or null when the header
 * is not a Spliit export.
 */
export function detectSpliitCsvLayout(
  header: readonly (string | undefined)[],
): SpliitCsvLayout | null {
  if (!isExactHeaderRow(header, SPLIIT_CSV_BASE_COLUMNS)) return null

  let isReimbursement: number
  let splitMode: number
  if (
    header[8] === 'Conversion source' &&
    isSpliitSettlementCsvHeader(header[9]) &&
    header[10] === 'Split mode'
  ) {
    isReimbursement = 9
    splitMode = 10
  } else if (
    isSpliitSettlementCsvHeader(header[8]) &&
    header[9] === 'Split mode'
  ) {
    isReimbursement = 8
    splitMode = 9
  } else {
    return null
  }

  if (
    header.some((column) =>
      /^Recurrence(?: |$)/i.test(normalizeHeaderLabel(column)),
    )
  ) {
    return null
  }

  return {
    isReimbursement,
    splitMode,
    participantStart: splitMode + 1,
  }
}

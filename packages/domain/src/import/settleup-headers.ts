/**
 * Settle Up CSV export headers.
 *
 * Settle Up exports one group history as CSV. The layout is the real, observed
 * export shape (see `ad-settle-up.csv` / `gr-settle-up.csv` fixtures):
 *
 * - `Who paid` — the member who advanced the money (single cell).
 * - `Amount` + `Currency` — row total in major units (e.g. `76839` MKD).
 * - `For whom` / `Split amounts` — `;`-separated member names and their aligned
 *   per-member owed amounts (same order, same length).
 * - `Purpose` — free-text title (may be empty; falls back to a payer → receivers
 *   label).
 * - `Category` (emoji or custom name, often blank), `Date & time` + `Timezone`,
 *   `Exchange rate` (row currency → group currency, `1 row major = rate group
 *   majors`), `Converted amount` (row total in the group currency), `Type`
 *   (`expense` vs `transfer`), `Receipt` (not imported).
 *
 * Discriminator: `Who paid` + `For whom` + `Split amounts` + `Purpose`.
 * Splitwise's net-balance shape has neither a payer nor a purpose column, and
 * Tricount/Sesterce layouts use `Paid by <Name>` / `Paid for <Name>` prefixed
 * columns instead of the `For whom` / `Split amounts` pair. Files without both
 * `Who paid` and `For whom` are not Settle Up exports.
 */

import { defineCoreLabels, findCoreIndex } from './header-map'

const CORE_LABELS = {
  purpose: ['Purpose', 'Objet', 'Zweck'],
  amount: ['Amount', 'Montant', 'Betrag', 'Coût', 'Cost', 'Total'],
  currency: ['Currency', 'Devise', 'Währung'],
  forWhom: ['For whom', 'Pour qui', 'Für wen'],
  splitAmounts: ['Split amounts', 'Montants partagés', 'Geteilte Beträge'],
  whoPaid: ['Who paid', 'Qui a payé', 'Qui', 'Wer hat bezahlt'],
  category: ['Category', 'Catégorie', 'Kategorie'],
  dateTime: ['Date & time', 'Date et heure', 'Date', 'Datum & Uhrzeit'],
  timezone: ['Timezone', 'Fuseau horaire', 'Zeitzone'],
  exchangeRate: ['Exchange rate', 'Taux de change', 'Wechselkurs'],
  convertedAmount: [
    'Converted amount',
    'Montant converti',
    'Umgewandelter Betrag',
  ],
  type: ['Type'],
  receipt: ['Receipt', 'Reçu', 'Beleg'],
} as const

type CoreKey = keyof typeof CORE_LABELS

const LABEL_SETS = defineCoreLabels(CORE_LABELS)

function findSettleUpCoreIndex(
  header: readonly (string | undefined)[],
  key: CoreKey,
): number {
  return findCoreIndex(header, LABEL_SETS, key)
}

export type SettleUpHeaderMap = {
  purposeIdx: number
  amountIdx: number
  currencyIdx: number
  forWhomIdx: number
  splitAmountsIdx: number
  /** `Who paid` column. Always present (part of the format discriminator). */
  paidByIdx: number
  categoryIdx: number
  dateTimeIdx: number
  exchangeRateIdx: number
  convertedAmountIdx: number
  typeIdx: number
}

/**
 * Map a Settle Up header row to column indexes. Returns null when the row is
 * not a Settle Up export (missing `Who paid` or `For whom`).
 */
export function mapSettleUpHeader(
  header: readonly (string | undefined)[],
): SettleUpHeaderMap | null {
  const purposeIdx = findSettleUpCoreIndex(header, 'purpose')
  const amountIdx = findSettleUpCoreIndex(header, 'amount')
  const currencyIdx = findSettleUpCoreIndex(header, 'currency')
  const forWhomIdx = findSettleUpCoreIndex(header, 'forWhom')
  const splitAmountsIdx = findSettleUpCoreIndex(header, 'splitAmounts')
  const paidByIdx = findSettleUpCoreIndex(header, 'whoPaid')
  const categoryIdx = findSettleUpCoreIndex(header, 'category')
  const dateTimeIdx = findSettleUpCoreIndex(header, 'dateTime')
  const exchangeRateIdx = findSettleUpCoreIndex(header, 'exchangeRate')
  const convertedAmountIdx = findSettleUpCoreIndex(header, 'convertedAmount')
  const typeIdx = findSettleUpCoreIndex(header, 'type')

  if (paidByIdx === -1) return null
  if (forWhomIdx === -1) return null
  if (amountIdx === -1) return null
  if (currencyIdx === -1) return null

  return {
    purposeIdx,
    amountIdx,
    currencyIdx,
    forWhomIdx,
    splitAmountsIdx,
    paidByIdx,
    categoryIdx,
    dateTimeIdx,
    exchangeRateIdx,
    convertedAmountIdx,
    typeIdx,
  }
}

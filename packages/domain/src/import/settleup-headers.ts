/**
 * Settle Up CSV export headers.
 *
 * Settle Up exports one group history as CSV. The layout is the real, observed
 * export shape (see `ad-settle-up.csv` / `gr-settle-up.csv` fixtures):
 *
 * - `Who paid` — the member who advanced the money (single cell).
 * - `Amount` — row total in `Currency` major units (e.g. `76839` MKD).
 * - `Currency` — ISO code of the row amount.
 * - `For whom` — `;`-separated member names sharing the cost.
 * - `Split amounts` — `;`-separated per-member owed amounts aligned with `For
 *   whom` (same order, same length).
 * - `Purpose` — free-text title (may be empty).
 * - `Category` — emoji or custom name (often a single space when unset).
 * - `Date & time` + `Timezone`, `Exchange rate`, `Converted amount` (row total in
 *   the group currency), `Type` (`expense` vs `transfer`), `Receipt`.
 *
 * Discriminator: `Who paid` + `For whom` + `Split amounts` + `Purpose`.
 * Splitwise's net-balance shape has neither a payer nor a purpose column, and
 * Tricount/Sesterce layouts use `Paid by <Name>` / `Paid for <Name>` prefixed
 * columns instead of the `For whom` / `Split amounts` pair. Files without both
 * `Who paid` and `For whom` are not Settle Up exports.
 */

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

function normalizeHeaderLabel(value: string | undefined): string {
  return (value ?? '').trim().normalize('NFC')
}

const LABEL_SETS = Object.fromEntries(
  Object.entries(CORE_LABELS).map(([key, labels]) => [
    key,
    new Set(labels.map((label) => normalizeHeaderLabel(label))),
  ]),
) as { [K in CoreKey]: Set<string> }

function findCoreIndex(
  header: readonly (string | undefined)[],
  key: CoreKey,
): number {
  return header.findIndex((cell) =>
    LABEL_SETS[key].has(normalizeHeaderLabel(cell)),
  )
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
  const purposeIdx = findCoreIndex(header, 'purpose')
  const amountIdx = findCoreIndex(header, 'amount')
  const currencyIdx = findCoreIndex(header, 'currency')
  const forWhomIdx = findCoreIndex(header, 'forWhom')
  const splitAmountsIdx = findCoreIndex(header, 'splitAmounts')
  const paidByIdx = findCoreIndex(header, 'whoPaid')
  const categoryIdx = findCoreIndex(header, 'category')
  const dateTimeIdx = findCoreIndex(header, 'dateTime')
  const exchangeRateIdx = findCoreIndex(header, 'exchangeRate')
  const convertedAmountIdx = findCoreIndex(header, 'convertedAmount')
  const typeIdx = findCoreIndex(header, 'type')

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

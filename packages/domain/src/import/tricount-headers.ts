/**
 * Tricount GDPR CSV export headers.
 *
 * Tricount removed in-app CSV export; the GDPR dump requested via support
 * carries per-expense rows with a fixed core (`Title, Amount, Currency,
 * Exchange rate, Amount in default currency (<CODE>), Transaction type,
 * Category, Paid by, Date & time`) plus one `Paid by <Name>` / `Impacted to
 * <Name>` column pair per participant. A trailing `tricount <name> - Exported
 * on …` footer row names the group, so one dump can hold several groups.
 *
 * The same `Paid by X` / `Paid for X` shape is used by Sesterce exports (see
 * https://sesterce.io/docs/import/), which the parser also accepts.
 */

import {
  defineCoreLabels,
  definePrefixMatcher,
  isCoreLabel,
  normalizeHeaderLabel,
} from './header-map'

const CORE_LABELS = {
  title: ['Title', 'Titre', 'Titel', 'Título', 'Titolo'],
  amount: ['Amount', 'Montant', 'Betrag', 'Importe', 'Importo'],
  currency: ['Currency', 'Devise', 'Währung', 'Moneda', 'Valuta'],
  exchangeRate: ['Exchange rate', 'Taux de change', 'Wechselkurs'],
  amountDefault: ['Amount in default currency', 'Montant en devise par défaut'],
  transactionType: ['Transaction type', 'Type de transaction'],
  category: ['Category', 'Catégorie', 'Kategorie', 'Categoría', 'Categoria'],
  paidBy: ['Paid by', 'Payé par', 'Gezahlt von', 'Pagado por', 'Pagato da'],
  dateTime: ['Date & time', 'Date et heure', 'Datum & Uhrzeit', 'Fecha y hora'],
  // Sesterce-compatible variant headers.
  date: ['Date'],
  description: ['Description'],
  whoPaid: ['Who paid'],
  cost: ['Cost', 'Total'],
} as const

type CoreKey = keyof typeof CORE_LABELS

const LABEL_SETS = defineCoreLabels(CORE_LABELS)

function isTricountCoreLabel(key: CoreKey, value: string): boolean {
  if (isCoreLabel(LABEL_SETS, key, value)) return true
  // `Amount in default currency (EUR)` — prefix match on the base label.
  if (key === 'amountDefault') {
    return LABEL_SETS.amountDefault.has(
      normalizeHeaderLabel(value).replace(/\s*\([^)]*\)\s*$/, ''),
    )
  }
  return false
}

function isCoreLabelAny(value: string): boolean {
  return (Object.keys(LABEL_SETS) as CoreKey[]).some((key) =>
    isTricountCoreLabel(key, value),
  )
}

const PAID_BY_MATCHER = definePrefixMatcher([
  'Paid by ',
  'Payé par ',
  'Gezahlt von ',
])
const IMPACTED_MATCHER = definePrefixMatcher([
  'Impacted to ',
  'Impacté à ',
  'Paid for ',
  'Payé pour ',
])

/** Participant name from a `Paid by <Name>` column, or null. */
export function paidByColumnName(value: string): string | null {
  return PAID_BY_MATCHER.match(value)
}

/** Participant name from an `Impacted to <Name>` column, or null. */
export function impactedColumnName(value: string): string | null {
  return IMPACTED_MATCHER.match(value)
}

export type TricountHeaderMap = {
  titleIdx: number
  amountIdx: number
  currencyIdx: number
  exchangeRateIdx: number
  amountDefaultIdx: number
  transactionTypeIdx: number
  categoryIdx: number
  paidByIdx: number
  dateIdx: number
  /** Member columns: name → { paidIdx, impactedIdx }. */
  members: Map<string, { paidIdx: number; impactedIdx: number }>
  defaultCurrencyCode: string | null
}

function findTricountCoreIndex(
  header: readonly (string | undefined)[],
  key: CoreKey,
): number {
  return header.findIndex((cell) => isTricountCoreLabel(key, cell ?? ''))
}

/**
 * Map a Tricount/Sesterce header row to column indexes. Returns null when the
 * row is not a Tricount export. Accepts both the GDPR shape (Title/Amount/ Paid
 * by/Date & time + `Impacted to <Name>`) and the Sesterce shape
 * (Date/Title/Cost/Who paid/Currency/Category + `Paid for <Name>`).
 */
export function mapTricountHeader(
  header: readonly (string | undefined)[],
): TricountHeaderMap | null {
  const cells = header.map((cell) => cell ?? '')
  let titleIdx = findTricountCoreIndex(cells, 'title')
  if (titleIdx === -1) titleIdx = findTricountCoreIndex(cells, 'description')
  let amountIdx = findTricountCoreIndex(cells, 'amount')
  if (amountIdx === -1) amountIdx = findTricountCoreIndex(cells, 'cost')
  let paidByIdx = findTricountCoreIndex(cells, 'paidBy')
  if (paidByIdx === -1) paidByIdx = findTricountCoreIndex(cells, 'whoPaid')
  let dateIdx = findTricountCoreIndex(cells, 'dateTime')
  if (dateIdx === -1) dateIdx = findTricountCoreIndex(cells, 'date')
  const currencyIdx = findTricountCoreIndex(cells, 'currency')
  const exchangeRateIdx = findTricountCoreIndex(cells, 'exchangeRate')
  const amountDefaultIdx = findTricountCoreIndex(cells, 'amountDefault')
  const transactionTypeIdx = findTricountCoreIndex(cells, 'transactionType')
  const categoryIdx = findTricountCoreIndex(cells, 'category')

  // Minimum viable row: a title, a currency, and either a `Paid by`/`Who
  // paid` column or per-member `Paid by <Name>` columns (Sesterce shape
  // carries no total and no single payer column). The amount may live in a
  // `Cost`/`Amount` column or spread across member columns.
  if (titleIdx === -1) return null
  if (currencyIdx === -1 && amountDefaultIdx === -1) return null

  const members = new Map<string, { paidIdx: number; impactedIdx: number }>()
  const register = (
    name: string,
    kind: 'paidIdx' | 'impactedIdx',
    idx: number,
  ) => {
    const entry = members.get(name) ?? { paidIdx: -1, impactedIdx: -1 }
    entry[kind] = idx
    members.set(name, entry)
  }
  for (let i = 0; i < cells.length; i++) {
    if (isCoreLabelAny(cells[i]!)) continue
    const paidName = paidByColumnName(cells[i]!)
    if (paidName) {
      register(paidName, 'paidIdx', i)
      continue
    }
    const impactedName = impactedColumnName(cells[i]!)
    if (impactedName) register(impactedName, 'impactedIdx', i)
  }

  if (members.size === 0 && paidByIdx === -1) return null

  let defaultCurrencyCode: string | null = null
  if (amountDefaultIdx !== -1) {
    const match = normalizeHeaderLabel(cells[amountDefaultIdx]).match(
      /\(([^)]+)\)\s*$/,
    )
    if (match) defaultCurrencyCode = match[1]!.trim().toUpperCase()
  }

  return {
    titleIdx,
    amountIdx,
    currencyIdx,
    exchangeRateIdx,
    amountDefaultIdx,
    transactionTypeIdx,
    categoryIdx,
    paidByIdx,
    dateIdx,
    members,
    defaultCurrencyCode,
  }
}

/** Footer row `tricount <name> - Exported on …` → group name, or null. */
export function parseGroupFooter(
  row: readonly (string | undefined)[],
): string | null {
  const first = normalizeHeaderLabel(row[0])
  const match = first.match(/^tricount\s+(.+?)\s+-\s+Exported on\s+/i)
  return match ? match[1]!.trim() : null
}

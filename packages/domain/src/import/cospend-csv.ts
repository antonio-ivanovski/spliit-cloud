import { Effect, Schema } from 'effect'

import { SETTLEMENT_CATEGORY_ID } from '../categories'
import { getCurrency } from '../currency'
import { amountAsMinorUnitsByCode } from '../utils'
import { cospendCategoryToId } from './cospend-categories'
import {
  COSPEND_BILL_HEADER,
  COSPEND_CATEGORY_HEADER,
  COSPEND_CURRENCY_HEADER,
  COSPEND_MEMBER_HEADER,
  COSPEND_PAYMENTMODE_HEADER,
  isCospendHeader,
} from './cospend-headers'
import { buildWeightedExpense } from './expense-builder'
import { createMemberRegistry } from './member-registry'
import { recurrenceToLegacyRule } from './recurrence'
import {
  isBlankRow,
  parseCsvText,
  parseIsoDatePrefix,
  toNumberOrNull,
} from './table'
import { ImportError } from './types'
import type { NormalizedSource, RecurrenceConfig } from './types'

/**
 * Base currency assumed when the Cospend export carries no currencies section.
 * Cospend only writes the currencies block when a project has additional
 * currencies; the base currency is otherwise implicit. EUR is the default for
 * the (predominantly European) Cospend user base and can be corrected in the
 * destination step.
 */
const DEFAULT_CURRENCY = 'EUR'

/**
 * Cospend `repeat` codes mapped to a Spliit frequency. `repeatfreq` multiplies
 * the base interval for the day/week/month/year codes, but upstream ignores it
 * for `b` (biweekly is always 14 days) and `s` (semi-monthly hops between the
 * 1st and the 15th regardless of frequency). `s` has no Spliit equivalent and
 * is approximated as monthly (see `parseCospendRepeat`).
 */
const REPEAT_BASE: Record<
  string,
  {
    frequency: RecurrenceConfig['frequency']
    baseInterval: number
    /** Whether upstream multiplies the base interval by `repeatfreq`. */
    usesRepeatFreq: boolean
  }
> = {
  d: { frequency: 'DAILY', baseInterval: 1, usesRepeatFreq: true },
  w: { frequency: 'WEEKLY', baseInterval: 1, usesRepeatFreq: true },
  b: { frequency: 'WEEKLY', baseInterval: 2, usesRepeatFreq: false },
  s: { frequency: 'MONTHLY', baseInterval: 1, usesRepeatFreq: false },
  m: { frequency: 'MONTHLY', baseInterval: 1, usesRepeatFreq: true },
  y: { frequency: 'YEARLY', baseInterval: 1, usesRepeatFreq: true },
}

const MEMBER_HEADER = COSPEND_MEMBER_HEADER
const BILL_HEADER = COSPEND_BILL_HEADER
const CATEGORY_HEADER = COSPEND_CATEGORY_HEADER
const PAYMENTMODE_HEADER = COSPEND_PAYMENTMODE_HEADER
const CURRENCY_HEADER = COSPEND_CURRENCY_HEADER

/** Decoded, trimmed view of one raw bill row for the fixed bill layout. */
const CospendBillRowSchema = Schema.Struct({
  what: Schema.Trim,
  amount: Schema.optional(Schema.NumberFromString),
  date: Schema.Trim,
  timestamp: Schema.Trim,
  payerName: Schema.Trim,
  owers: Schema.Trim,
  repeat: Schema.Trim,
  repeatFreq: Schema.optional(Schema.NumberFromString),
  repeatUntil: Schema.Trim,
  categoryId: Schema.Trim,
  comment: Schema.Trim,
  deleted: Schema.Trim,
})

function isHeader(
  row: string[] | undefined,
  header: readonly string[],
): boolean {
  return isCospendHeader(row, header)
}

function isBlank(row: string[]): boolean {
  return isBlankRow(row)
}

/** Build a RecurrenceConfig from Cospend repeat metadata, or null if none. */
function parseCospendRepeat(
  repeat: string,
  repeatFreq: number,
  repeatUntil: string,
): RecurrenceConfig | null {
  const base = REPEAT_BASE[repeat]
  if (!base) return null
  const multiplier =
    base.usesRepeatFreq && Number.isFinite(repeatFreq) && repeatFreq > 0
      ? Math.floor(repeatFreq)
      : 1
  const interval = Math.min(99, Math.max(1, base.baseInterval * multiplier))
  const until = repeatUntil.trim()
  const end: RecurrenceConfig['end'] = /^\d{4}-\d{2}-\d{2}$/.test(until)
    ? { type: 'DATE', endDate: new Date(`${until}T00:00:00.000Z`) }
    : { type: 'INDEFINITE' }
  return { frequency: base.frequency, interval, end }
}

/**
 * Effective ower weight: upstream treats a stored weight of 0 as 1 at balance
 * time, so mirror that here instead of dividing by zero.
 */
function effectiveWeight(weight: number | undefined): number {
  return weight !== undefined && Number.isFinite(weight) && weight > 0
    ? weight
    : 1
}

/**
 * Parse Cospend project rows (already CSV-decoded) into a normalized source.
 * Thin `parseCospendCsv` wraps this with `parseCsvText`.
 *
 * Cospend exports one CSV per project with five sections (members, bills,
 * categories, payment modes, and optionally currencies) separated by blank
 * lines. The project name is not in the file body — only the filename slug — so
 * the group name defaults here and is refined from the filename upstream.
 */
export const parseCospendTable = Effect.fnUntraced(function* (
  rows: string[][],
): Effect.fn.Return<NormalizedSource, ImportError> {
  // ── Locate section headers ────────────────────────────────────────────
  let membersStart = -1
  let billsStart = -1
  let categoriesStart = -1
  let currenciesStart = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (membersStart === -1 && isHeader(row, MEMBER_HEADER)) membersStart = i
    else if (billsStart === -1 && isHeader(row, BILL_HEADER)) billsStart = i
    else if (categoriesStart === -1 && isHeader(row, CATEGORY_HEADER))
      categoriesStart = i
    else if (currenciesStart === -1 && isHeader(row, CURRENCY_HEADER))
      currenciesStart = i
  }

  if (membersStart === -1 || billsStart === -1) {
    return yield* new ImportError({
      message:
        'CSV is not a Cospend project export (missing members or bills section)',
    })
  }

  // ── Members ───────────────────────────────────────────────────────────
  // Cospend member names are case-sensitive upstream: keep exact-case keys
  // so `Alex` and `alex` stay separate members.
  const registry = createMemberRegistry('cospend-member', {
    caseSensitive: true,
  })
  const nameToWeight = new Map<string, number>()
  for (let r = membersStart + 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlank(row)) continue
    if (
      isHeader(row, BILL_HEADER) ||
      isHeader(row, CATEGORY_HEADER) ||
      isHeader(row, PAYMENTMODE_HEADER) ||
      isHeader(row, CURRENCY_HEADER)
    ) {
      break
    }
    const name = (row[0] ?? '').trim()
    if (!name) continue
    const weight = toNumberOrNull(row[1]) ?? 1
    registry.register(name)
    nameToWeight.set(name, weight)
  }
  const participants = registry.all()
  const sourceIdToWeight = new Map<string, number>()
  for (const p of participants) {
    sourceIdToWeight.set(p.sourceId, nameToWeight.get(p.sourceName) ?? 1)
  }
  if (participants.length === 0) {
    return yield* new ImportError({
      message: 'Cospend export has no members',
    })
  }

  // ── Categories (name → id) ────────────────────────────────────────────
  const categoryIdToName = new Map<string, string>()
  if (categoriesStart !== -1) {
    for (let r = categoriesStart + 1; r < rows.length; r++) {
      const row = rows[r]
      if (isBlank(row)) continue
      if (isHeader(row, CURRENCY_HEADER) || isHeader(row, PAYMENTMODE_HEADER))
        break
      const name = (row[0] ?? '').trim()
      const id = (row[1] ?? '').trim()
      if (name && id) categoryIdToName.set(id, name)
    }
  }

  // ── Currencies (main currency = row with exchange_rate 1) ─────────────
  // Upstream defines the main currency as the row with exchange_rate == 1,
  // regardless of position (it writes it first, but the importer does not
  // assume that). Scan every row so a reordered section still resolves.
  let baseCurrency = DEFAULT_CURRENCY
  if (currenciesStart !== -1) {
    let firstNamed: string | null = null
    let foundMain = false
    for (let r = currenciesStart + 1; r < rows.length; r++) {
      const row = rows[r]
      if (isBlank(row)) continue
      if (
        isHeader(row, MEMBER_HEADER) ||
        isHeader(row, BILL_HEADER) ||
        isHeader(row, CATEGORY_HEADER) ||
        isHeader(row, PAYMENTMODE_HEADER)
      ) {
        break
      }
      const code = (row[0] ?? '').trim().toUpperCase()
      const rate = toNumberOrNull(row[1])
      if (code && firstNamed === null) firstNamed = code
      if (rate === 1) {
        foundMain = true
        // Upstream always writes the main currency first with exchange_rate
        // = 1. If the project had no custom currency name set, this row is
        // ("", 1): keep DEFAULT_CURRENCY (upstream would set an empty name,
        // which Spliit cannot use for conversions) rather than falling
        // through to an additional currency with exchange_rate != 1.
        if (code) baseCurrency = code
        break
      }
    }
    if (!foundMain && firstNamed) baseCurrency = firstNamed
  }
  const currencyCode = baseCurrency
  const currency = getCurrency(currencyCode) ?? {
    code: currencyCode,
    symbol: currencyCode,
    rounding: 0,
    decimal_digits: 2,
  }

  // ── Bills ─────────────────────────────────────────────────────────────
  // Terminate on any section header instead of assuming the export order
  // (members → bills → categories → payment modes → currencies), so
  // reordered or legacy files still parse like upstream's importer does.
  const expenses: NormalizedSource['expenses'] = []
  for (let r = billsStart + 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlank(row)) continue
    if (
      isHeader(row, MEMBER_HEADER) ||
      isHeader(row, BILL_HEADER) ||
      isHeader(row, CATEGORY_HEADER) ||
      isHeader(row, PAYMENTMODE_HEADER) ||
      isHeader(row, CURRENCY_HEADER)
    ) {
      break
    }
    const decoded = yield* Schema.decodeUnknownEffect(CospendBillRowSchema)({
      what: row[0] ?? '',
      // Blank amount means "not a bill row" (skip below); a present but
      // non-numeric amount is malformed and fails the parse.
      amount: (row[1] ?? '').trim() === '' ? undefined : row[1],
      date: row[2] ?? '',
      timestamp: row[3] ?? '',
      payerName: row[4] ?? '',
      owers: row[7] ?? '',
      repeat: row[8] ?? '',
      repeatFreq: (row[9] ?? '').trim() === '' ? undefined : row[9],
      repeatUntil: row[11] ?? '',
      categoryId: row[12] ?? '',
      comment: row[15] ?? '',
      deleted: row[16] ?? '',
    }).pipe(
      Effect.mapError(
        () =>
          new ImportError({
            message: `Row ${r + 1} is not a valid Cospend bill row`,
            code: 'CSV_INVALID_EXPENSE_ROW',
            params: { row: r + 1 },
          }),
      ),
    )
    const what = decoded.what
    const amount = decoded.amount ?? null
    // Garbage numerics skip the bill (legacy behavior); only structurally
    // undecodable rows fail above.
    if (amount !== null && !Number.isFinite(amount)) continue
    const repeatFreq = decoded.repeatFreq ?? 1
    // `repeatallactive` intentionally does not expand the ower set: the
    // exported owers describe who owed the historical bill, and upstream only
    // consults the flag when materializing *future* repetitions (all active
    // members then). Rewriting history to all-active would charge members who
    // never owed; future Spliit occurrences stay frozen to this ower set.
    const categoryId = decoded.categoryId
    const comment = decoded.comment
    const deleted = decoded.deleted

    // Upstream prefers `timestamp` and falls back to `date`; the export
    // always carries both, but timestamp-only files are valid upstream.
    // The timestamp is UTC seconds; the server-local `date` column wins when
    // present so day boundaries match the export.
    let expenseDate: string | null = null
    const datePrefix = parseIsoDatePrefix(decoded.date)
    if (datePrefix) {
      expenseDate = datePrefix
    } else if (/^\d+$/.test(decoded.timestamp.trim())) {
      const ts = Number(decoded.timestamp.trim())
      if (Number.isFinite(ts)) {
        expenseDate = new Date(ts * 1000).toISOString().slice(0, 10)
      }
    }
    if (!what || amount === null || !expenseDate) continue
    if (deleted === '1') continue

    const payerSourceId = registry.idOf(decoded.payerName)
    if (!payerSourceId) continue

    // Every ower must resolve to a known member. A partial match (e.g. a
    // member name containing a comma, which upstream's own comma-joined
    // `owers` column cannot round-trip) would silently rewrite the split, so
    // skip the bill instead of emitting a truncated one. Duplicate names
    // merge by summing weights.
    const owerNames = decoded.owers
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (owerNames.length === 0) continue
    const owersBySourceId = new Map<string, number>()
    let unknownOwer = false
    for (const n of owerNames) {
      const sourceId = registry.idOf(n)
      if (!sourceId) {
        unknownOwer = true
        break
      }
      owersBySourceId.set(
        sourceId,
        (owersBySourceId.get(sourceId) ?? 0) +
          effectiveWeight(sourceIdToWeight.get(sourceId)),
      )
    }
    if (unknownOwer || owersBySourceId.size === 0) continue
    const owers = [...owersBySourceId.entries()].map(([sourceId, weight]) => ({
      sourceId,
      weight,
    }))

    const amountCents = amountAsMinorUnitsByCode(amount, currency.code)

    // Weight-proportional split straight from the member weights (upstream
    // balances: amount / totalWeight * weight). Equal weights are an even
    // split regardless of divisibility; unequal weights become a BY_SHARES
    // ratio. Re-guessing the mode from rounded cents (like the Splitwise
    // flow does) would misclassify both: an indivisible even split has GCD 1
    // and a 1:2 split of 42.50 rounds to cents with GCD 1 as well.
    const weights = new Map<string, number>()
    for (const o of owers) weights.set(o.sourceId, o.weight)
    const built = buildWeightedExpense({
      amountCents,
      weights,
      payerId: payerSourceId,
    })
    const splitMode = built.splitMode
    const paidFor = built.paidFor
    if (paidFor.length === 0) continue

    const recurrence = parseCospendRepeat(
      decoded.repeat,
      repeatFreq,
      decoded.repeatUntil,
    )
    const recurrenceRule = recurrenceToLegacyRule(recurrence)

    let notes: string | null = null
    if (comment) {
      try {
        notes = decodeURIComponent(comment.replace(/\+/g, ' '))
      } catch {
        notes = comment
      }
    }

    const categoryName = categoryId
      ? (categoryIdToName.get(categoryId) ?? null)
      : null
    const category =
      categoryId === '-11'
        ? SETTLEMENT_CATEGORY_ID
        : cospendCategoryToId(categoryName)

    expenses.push({
      title: what,
      expenseDate,
      category,
      amountCurrency: currency.code,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBySourceId: payerSourceId,
      paidBy: [{ sourceId: payerSourceId, shares: amountCents }],
      paidFor,
      splitMode,
      recurrenceRule,
      recurrence,
      notes,
    })
  }

  if (expenses.length === 0) {
    return yield* new ImportError({
      message: 'Cospend export had no parseable bills',
    })
  }

  return {
    provider: 'COSPEND',
    exportVersion: null,
    sourceGroupId: 'cospend-csv-import',
    sourceUrl: null,
    name: 'Imported from Cospend',
    information: null,
    currency: currency.code,
    currencyCode: currency.code,
    participants,
    expenses,
    documentSource: 'NONE',
  }
})

export const parseCospendCsv = Effect.fn('parseCospendCsv')(function* (
  input: string,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const rows = yield* parseCsvText(input)
  return yield* parseCospendTable(rows)
})

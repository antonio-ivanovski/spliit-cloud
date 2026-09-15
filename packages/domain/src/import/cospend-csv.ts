import Papa from 'papaparse'

import { SETTLEMENT_CATEGORY_ID } from '../categories'
import { getCurrency } from '../currency'
import { distributeRemainder } from '../remainder-distribution'
import { SHARE_SCALE } from '../shares'
import { calculateExactShares } from '../totals'
import { amountAsMinorUnitsByCode } from '../utils'
import { cospendCategoryToId } from './cospend-categories'
import { recurrenceToLegacyRule } from './recurrence'
import { gcdOf } from './split-guess'
import type {
  ImportParseResult,
  NormalizedSource,
  RecurrenceConfig,
} from './types'

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

/**
 * Cap on the largest normalized share weight, mirroring the `BY_SHARES` guesser
 * convention: ratios above it are treated as coincidental round numbers rather
 * than human-intended shares, and fall back to exact cents (`BY_AMOUNT`).
 */
const MAX_SHARE_WEIGHT = 25

const MEMBER_HEADER = ['name', 'weight', 'active', 'color']
const BILL_HEADER = [
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
const CATEGORY_HEADER = ['categoryname', 'categoryid', 'icon', 'color']
const PAYMENTMODE_HEADER = ['paymentmodename', 'paymentmodeid', 'icon', 'color']
const CURRENCY_HEADER = ['currencyname', 'exchange_rate']

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

function isHeader(
  row: string[] | undefined,
  header: readonly string[],
): boolean {
  if (!row) return false
  if (row.length < header.length) return false
  return header.every((cell, i) => (row[i] ?? '').trim() === cell)
}

function isBlank(row: string[]): boolean {
  return row.every((c) => (c ?? '').trim() === '')
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
 * Parse a Cospend project CSV export into a normalized import source.
 *
 * Cospend exports one CSV per project with five sections (members, bills,
 * categories, payment modes, and optionally currencies) separated by blank
 * lines. The project name is not in the file body — only the filename slug — so
 * the group name defaults here and is refined from the filename upstream.
 */
export function tryParseCospendCsv(input: string): ImportParseResult {
  const cleaned = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const parsed = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    header: false,
  })

  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: `CSV could not be parsed: ${parsed.errors[0]?.message ?? 'unknown error'}`,
    }
  }

  const rows = parsed.data

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
    return {
      ok: false,
      error:
        'CSV is not a Cospend project export (missing members or bills section)',
    }
  }

  // ── Members ───────────────────────────────────────────────────────────
  const participants: NormalizedSource['participants'] = []
  const nameToSourceId = new Map<string, string>()
  const nameToWeight = new Map<string, number>()
  for (let r = membersStart + 1; r < rows.length; r++) {
    const row = rows[r]
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
    const sourceId = `cospend-member-${participants.length}`
    nameToSourceId.set(name, sourceId)
    nameToWeight.set(name, weight)
    participants.push({ sourceId, sourceName: name })
  }
  if (participants.length === 0) {
    return { ok: false, error: 'Cospend export has no members' }
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
    const row = rows[r]
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
    const what = (row[0] ?? '').trim()
    const amount = toNumberOrNull(row[1])
    const dateRaw = (row[2] ?? '').trim()
    const timestampRaw = (row[3] ?? '').trim()
    const payerName = (row[4] ?? '').trim()
    const owersRaw = (row[7] ?? '').trim()
    const repeat = (row[8] ?? '').trim()
    const repeatFreq = toNumberOrNull(row[9]) ?? 1
    const repeatUntil = (row[11] ?? '').trim()
    // `repeatallactive` intentionally does not expand the ower set: the
    // exported owers describe who owed the historical bill, and upstream only
    // consults the flag when materializing *future* repetitions (all active
    // members then). Rewriting history to all-active would charge members who
    // never owed; future Spliit occurrences stay frozen to this ower set.
    const categoryId = (row[12] ?? '').trim()
    const comment = (row[15] ?? '').trim()
    const deleted = (row[16] ?? '').trim()

    // Upstream prefers `timestamp` and falls back to `date`; the export
    // always carries both, but timestamp-only files are valid upstream.
    // The timestamp is UTC seconds; the server-local `date` column wins when
    // present so day boundaries match the export.
    let expenseDate: string | null = null
    if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) {
      expenseDate = dateRaw.slice(0, 10)
    } else if (/^\d+$/.test(timestampRaw)) {
      const ts = Number(timestampRaw)
      if (Number.isFinite(ts)) {
        expenseDate = new Date(ts * 1000).toISOString().slice(0, 10)
      }
    }
    if (!what || amount === null || !expenseDate) continue
    if (deleted === '1') continue

    const payerSourceId = nameToSourceId.get(payerName)
    if (!payerSourceId) continue

    // Every ower must resolve to a known member. A partial match (e.g. a
    // member name containing a comma, which upstream's own comma-joined
    // `owers` column cannot round-trip) would silently rewrite the split, so
    // skip the bill instead of emitting a truncated one. Duplicate names
    // merge by summing weights.
    const owerNames = owersRaw
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (owerNames.length === 0) continue
    const owersBySourceId = new Map<string, number>()
    let unknownOwer = false
    for (const n of owerNames) {
      const sourceId = nameToSourceId.get(n)
      if (!sourceId) {
        unknownOwer = true
        break
      }
      owersBySourceId.set(
        sourceId,
        (owersBySourceId.get(sourceId) ?? 0) +
          effectiveWeight(nameToWeight.get(n)),
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
    const weights = owers.map((o) => o.weight)
    const allEqualWeights = weights.every((w) => w === weights[0])
    let splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_AMOUNT'
    let paidFor: Array<{ sourceId: string; shares: number }>
    if (allEqualWeights) {
      const exact = calculateExactShares({
        amount: amountCents,
        splitMode: 'EVENLY',
        participants: owers.map((o) => ({ id: o.sourceId, shares: 1 })),
      })
      const fixed = distributeRemainder(exact, amountCents)
      paidFor = owers
        .map((o) => ({ sourceId: o.sourceId, shares: fixed[o.sourceId] ?? 0 }))
        .filter((p) => p.shares > 0)
      splitMode = 'EVENLY'
    } else {
      // Scale weights to integers, reduce by GCD, store in fixed units
      // (100 = 1 displayed share). Ratios with an implausibly large
      // normalized weight fall back to exact cents.
      const scaledWeights = weights.map((w) => Math.max(1, Math.round(w * 100)))
      const divisor = gcdOf(scaledWeights)
      const normalized = scaledWeights.map((s) => (s / divisor) * SHARE_SCALE)
      const maxWeight = Math.max(...normalized) / SHARE_SCALE
      if (maxWeight <= MAX_SHARE_WEIGHT) {
        paidFor = owers.map((o, i) => ({
          sourceId: o.sourceId,
          shares: normalized[i]!,
        }))
        splitMode = 'BY_SHARES'
      } else {
        const exact = calculateExactShares({
          amount: amountCents,
          splitMode: 'BY_SHARES',
          participants: owers.map((o, i) => ({
            id: o.sourceId,
            shares: scaledWeights[i],
          })),
        })
        const fixed = distributeRemainder(exact, amountCents, {
          payerId: payerSourceId,
        })
        paidFor = owers
          .map((o) => ({
            sourceId: o.sourceId,
            shares: fixed[o.sourceId] ?? 0,
          }))
          .filter((p) => p.shares > 0)
        splitMode = 'BY_AMOUNT'
      }
    }
    if (paidFor.length === 0) continue

    const recurrence = parseCospendRepeat(repeat, repeatFreq, repeatUntil)
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
    return { ok: false, error: 'Cospend export had no parseable bills' }
  }

  return {
    ok: true,
    source: {
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
    },
  }
}

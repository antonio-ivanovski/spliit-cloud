import { Effect, Schema } from 'effect'

import { SETTLEMENT_CATEGORY_ID } from '../categories'
import { getCurrency } from '../currency'
import { amountAsMinorUnitsByCode } from '../utils'
import { buildNetExpense } from './expense-builder'
import { createMemberRegistry } from './member-registry'
import { splitwiseCategoryToId } from './splitwise-categories'
import {
  isSplitwiseHeader,
  isSplitwiseTotalBalanceLabel,
} from './splitwise-headers'
import {
  dominantCurrency,
  FALLBACK_CURRENCY,
  isBlankRow,
  parseCsvText,
  parseIsoDatePrefix,
  toNumberOrNull,
} from './table'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

const PARTICIPANT_START_INDEX = 5

/** Decoded, trimmed view of one raw CSV row for a known header layout. */
const SplitwiseRowSchema = Schema.Struct({
  date: Schema.Trim,
  title: Schema.Trim,
  category: Schema.Trim,
  // Cost stays unknown: blank means "not an expense row" (skip below) and
  // garbage numerics skip the row too — only structurally undecodable rows
  // fail the parse. (Effect's NumberFromString accepts NaN as a success, so
  // the finiteness guard below is the load-bearing check, not the schema.)
  cost: Schema.Unknown,
  currency: Schema.Trim,
})

export const parseSplitwiseTable = Effect.fnUntraced(function* (
  rows: string[][],
): Effect.fn.Return<NormalizedSource, ImportError> {
  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (isSplitwiseHeader(rows[i])) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) {
    return yield* new ImportError({
      message: 'CSV header is not a Splitwise export',
      code: 'CSV_NOT_SPLITWISE_EXPORT',
      params: {},
    })
  }
  const header = rows[headerRowIdx]!

  const registry = createMemberRegistry('splitwise-participant')
  for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
    const name = (header[i] ?? '').trim()
    if (!name) continue
    registry.register(name)
  }
  const participants = registry.all()
  if (participants.length === 0) {
    return yield* new ImportError({
      message: 'CSV is missing participant columns',
      code: 'CSV_MISSING_PARTICIPANT_COLUMNS',
      params: {},
    })
  }

  const expenses: NormalizedSource['expenses'] = []
  const currencyCounts = new Map<string, number>()
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlankRow(row)) continue
    const decoded = yield* Schema.decodeUnknownEffect(SplitwiseRowSchema)({
      date: row[0] ?? '',
      title: row[1] ?? '',
      category: row[2] ?? '',
      cost: row[3],
      currency: row[4] ?? '',
    }).pipe(
      Effect.mapError(
        () =>
          new ImportError({
            message: `Row ${r + 1} is not a valid Splitwise expense row`,
            code: 'CSV_INVALID_EXPENSE_ROW',
            params: { row: r + 1 },
          }),
      ),
    )
    const date = decoded.date
    const title = decoded.title
    const category = decoded.category
    // Blank cost means "not an expense row"; garbage numerics skip the row
    // (pinned by "skips rows with unparseable Cost"). Only structurally
    // undecodable rows fail above.
    const cost =
      typeof decoded.cost === 'string' ? toNumberOrNull(decoded.cost) : null
    const currencyCode = decoded.currency.toUpperCase()
    if (!parseIsoDatePrefix(date)) continue
    if (!title) continue
    if (cost === null) continue
    if (currencyCode.length !== 3) continue
    if (isSplitwiseTotalBalanceLabel(title)) continue

    currencyCounts.set(
      currencyCode,
      (currencyCounts.get(currencyCode) ?? 0) + 1,
    )

    const isSettlement =
      category.toLowerCase() === 'payment' || /^.+ paid .+ /.test(title)

    // Per Splitwise convention each cell is `Paid - Owe`.
    let payerSourceId: string | null = null
    let maxRaw = -Infinity
    const entries: Array<{ sourceId: string; raw: number }> = []
    for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
      const name = (header[i] ?? '').trim()
      if (!name) continue
      const raw = toNumberOrNull(row[i])
      if (raw === null) continue
      const sourceId = registry.idOf(name)
      if (sourceId === undefined) continue
      if (raw !== 0) {
        entries.push({ sourceId, raw })
      }
      if (raw > maxRaw) {
        maxRaw = raw
        payerSourceId = sourceId
      }
    }
    if (entries.length === 0 || maxRaw <= 0 || !payerSourceId) continue

    const currency = getCurrency(currencyCode) ?? {
      ...FALLBACK_CURRENCY,
      code: currencyCode,
      symbol: currencyCode,
    }
    const amountCents = amountAsMinorUnitsByCode(cost, currencyCode)

    // Signed-net shape: each cell is `Paid - Owe`; negatives are consumed
    // shares, the payer absorbs the positive residual (their own share plus
    // any multi-payer residual) and advances the full amount.
    const netMajors = new Map<string, number>()
    for (const e of entries) {
      netMajors.set(e.sourceId, (netMajors.get(e.sourceId) ?? 0) + e.raw)
    }
    const built = buildNetExpense({
      amountCents,
      currency,
      netMajors,
      payerId: payerSourceId,
    })
    if (built.paidFor.length === 0) continue
    const { paidBy, paidFor, splitMode } = built
    const resolvedPaidFor = paidFor

    expenses.push({
      title,
      expenseDate: date.slice(0, 10),
      category: isSettlement
        ? SETTLEMENT_CATEGORY_ID
        : splitwiseCategoryToId(category),
      amountCurrency: currencyCode,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBySourceId: payerSourceId,
      paidBy,
      paidFor: resolvedPaidFor,
      splitMode,
      recurrenceRule: 'NONE',
      notes: null,
    })
  }

  if (expenses.length === 0) {
    return yield* new ImportError({
      message: 'CSV had no parseable expenses',
      code: 'CSV_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  const mostCommonCurrency = dominantCurrency(currencyCounts)

  return {
    provider: 'SPLITWISE',
    exportVersion: null,
    sourceGroupId: 'splitwise-csv-import',
    sourceUrl: null,
    name: 'Imported from Splitwise',
    information: null,
    currency: mostCommonCurrency || '',
    currencyCode: mostCommonCurrency || null,
    participants,
    expenses,
    documentSource: 'NONE',
  }
})

export const parseSplitwiseCsv = Effect.fn('parseSplitwiseCsv')(function* (
  input: string,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const rows = yield* parseCsvText(input)
  return yield* parseSplitwiseTable(rows)
})

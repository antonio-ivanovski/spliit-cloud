import { Effect, Schema } from 'effect'

import { DEFAULT_CATEGORIES, SETTLEMENT_CATEGORY_ID } from '../categories'
import { getCurrency } from '../currency'
import { amountAsMinorUnitsByCode } from '../utils'
import { normalizePaidForByAmount } from './batch'
import { buildNetExpense, buildSettlement } from './expense-builder'
import { createMemberRegistry } from './member-registry'
import { detectSpliitCsvLayout } from './spliit-headers'
import {
  recoverSpliitOriginalAmount,
  shouldRecoverSpliitOriginal,
} from './spliit-original-amount'
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

/**
 * Column indices for the immutable legacy spliit.app CSV export. See
 * {@link detectSpliitCsvLayout} for the wire contract.
 */

/** Decoded, trimmed view of one raw CSV row for the fixed legacy layout. */
const SpliitCsvRowSchema = Schema.Struct({
  date: Schema.Trim,
  title: Schema.Trim,
  category: Schema.Trim,
  currency: Schema.Trim,
  // Cost stays lenient: unparseable amounts skip the row (pinned by the
  // "skips rows with unparseable amounts" fixture), they never fail the file.
  cost: Schema.Unknown,
  originalCurrency: Schema.Trim,
  conversionRate: Schema.Unknown,
  isReimbursement: Schema.Trim,
})

export const parseSpliitTable = Effect.fnUntraced(function* (
  rows: string[][],
): Effect.fn.Return<NormalizedSource, ImportError> {
  const header = rows[0]!
  const layout = detectSpliitCsvLayout(header)
  if (!layout) {
    return yield* new ImportError({
      message: 'CSV header is not a Spliit export',
      code: 'CSV_NOT_SPLIIT_EXPORT',
      params: {},
    })
  }

  const participantHeaders = header
    .slice(layout.participantStart)
    .map((h: string) => h.trim())
    .filter((h: string) => h.length > 0)

  if (participantHeaders.length === 0) {
    return yield* new ImportError({
      message: 'CSV is missing participant columns',
      code: 'CSV_MISSING_PARTICIPANT_COLUMNS',
      params: {},
    })
  }

  const registry = createMemberRegistry('csv-participant')
  for (const name of participantHeaders) registry.register(name)
  const participants = registry.all()

  const expenses: NormalizedSource['expenses'] = []
  const currencyCounts = new Map<string, number>()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlankRow(row)) continue
    const decoded = yield* Schema.decodeUnknownEffect(SpliitCsvRowSchema)({
      date: row[0] ?? '',
      title: row[1] ?? '',
      category: row[2] ?? '',
      currency: row[3] ?? '',
      cost: row[4],
      originalCurrency: row[6] ?? '',
      conversionRate: row[7],
      isReimbursement: row[layout.isReimbursement] ?? '',
    }).pipe(
      Effect.mapError(
        () =>
          new ImportError({
            message: `Row ${r + 1} is not a valid Spliit expense row`,
            code: 'CSV_INVALID_EXPENSE_ROW',
            params: { row: r + 1 },
          }),
      ),
    )
    const date = decoded.date
    const title = decoded.title
    const category = decoded.category
    const rowCurrency = decoded.currency.toUpperCase()
    const costMajor =
      typeof decoded.cost === 'string' ? toNumberOrNull(decoded.cost) : null
    const isReimbursement = decoded.isReimbursement.toLowerCase() === 'yes'

    if (!parseIsoDatePrefix(date)) continue
    if (title.length === 0) continue
    if (costMajor === null) continue
    const currencyCode = rowCurrency.length === 3 ? rowCurrency : ''
    const currency = getCurrency(currencyCode) ?? FALLBACK_CURRENCY
    const amountCents = amountAsMinorUnitsByCode(costMajor, currencyCode)

    if (rowCurrency.length === 3) {
      currencyCounts.set(
        rowCurrency,
        (currencyCounts.get(rowCurrency) ?? 0) + 1,
      )
    }

    type Entry = { sourceId: string; raw: number }
    const entries: Entry[] = []
    let paidBySourceId: string | null = null
    let firstZeroSourceId: string | null = null
    for (let i = layout.participantStart; i < header.length; i++) {
      const name = (header[i] ?? '').trim()
      if (!name) continue
      const raw = toNumberOrNull(row[i])
      if (raw === null) continue
      const sourceId = registry.idOf(name)
      if (sourceId === undefined) continue
      if (raw > 0 && !paidBySourceId) {
        paidBySourceId = sourceId
      } else if (raw === 0 && !firstZeroSourceId) {
        firstZeroSourceId = sourceId
      }
      if (raw !== 0) {
        entries.push({ sourceId, raw })
      }
    }
    if (!paidBySourceId) paidBySourceId = firstZeroSourceId
    if (!paidBySourceId) continue

    let paidFor: Array<{ sourceId: string; shares: number }>
    let splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_AMOUNT' | 'BY_PERCENTAGE'
    let paidBySourceIdResolved = paidBySourceId

    if (isReimbursement) {
      // Spliit encodes the receiver as the negative-value participant.
      // If the receiver isn't explicit (old-style), pick the first
      // non-payer participant so paidFor has a single entry.
      const receiver = entries.find((e) => e.raw < 0)
      if (receiver) {
        const payer = entries.find((e) => e.raw > 0)
        if (payer) paidBySourceIdResolved = payer.sourceId
        const settlement = buildSettlement({
          payerId: paidBySourceIdResolved,
          receiverId: receiver.sourceId,
          amountCents,
        })
        paidBySourceIdResolved = settlement.paidBySourceId
        paidFor = settlement.paidFor
        splitMode = settlement.splitMode
      } else {
        const other = entries.find((e) => e.sourceId !== paidBySourceId)
        const receiverId = other ? other.sourceId : paidBySourceId
        const settlement = buildSettlement({
          payerId: paidBySourceId,
          receiverId,
          amountCents,
        })
        paidFor = settlement.paidFor
        splitMode = settlement.splitMode
      }
    } else {
      // Participant cells are NET balances (paidBy − paidFor) from export-csv.
      // Debtors owe −net; the even-split remainder across positive nets covers
      // the payer's own share (genuine exports are single-payer, so at most one
      // net is positive and the remainder lands on the payer exactly).
      // Hand-forged multi-positive rows split the remainder evenly instead —
      // underdetermined either way, matching the splitwise sibling shape.
      const netMajors = new Map<string, number>()
      for (const e of entries) {
        netMajors.set(e.sourceId, (netMajors.get(e.sourceId) ?? 0) + e.raw)
      }
      const built = buildNetExpense({
        amountCents,
        currency,
        netMajors,
        payerId: paidBySourceId,
      })
      paidBySourceIdResolved = built.paidBySourceId
      paidFor = built.paidFor
      splitMode = built.splitMode
    }

    if (paidFor.length === 0) continue

    // Cost is the source-group ledger total (reliable). Original cost is not
    // trusted — recover expense amount from ledger ÷ rate (upstream #513).
    // Once per parse only; no caching.
    const originalCurrencyRaw = decoded.originalCurrency
    const conversionRate =
      typeof decoded.conversionRate === 'string'
        ? toNumberOrNull(decoded.conversionRate)
        : null
    const shouldRecover = shouldRecoverSpliitOriginal({
      originalCurrency:
        originalCurrencyRaw.length === 3 ? originalCurrencyRaw : null,
      conversionRate,
    })
    const expenseAmount = shouldRecover
      ? recoverSpliitOriginalAmount(amountCents, conversionRate!, {
          originalCurrency: originalCurrencyRaw,
          ledgerCurrency: currencyCode || null,
        })
      : amountCents
    const expenseCurrency = shouldRecover
      ? originalCurrencyRaw
      : rowCurrency.length === 3
        ? rowCurrency
        : null
    // The paidFor/splitMode above are computed against the ledger amount.
    // When the row carries a recoverable original amount (upstream #513),
    // reuse the generic normalizer directly against the recovered total so
    // shares sum to what the expense stores. Reimbursements/settlements
    // keep the full amount on the single receiver.
    let resolvedPaidFor = paidFor
    if (shouldRecover && !isReimbursement && expenseAmount !== amountCents) {
      resolvedPaidFor = normalizePaidForByAmount(
        paidFor.map((p) => ({ participant: p.sourceId, shares: p.shares })),
        expenseAmount,
      ).map((p) => ({ sourceId: p.participant, shares: p.shares }))
      if (resolvedPaidFor.length === 0) {
        resolvedPaidFor = [
          { sourceId: paidBySourceIdResolved, shares: expenseAmount },
        ]
      }
    }
    expenses.push({
      title,
      expenseDate: date.slice(0, 10),
      category:
        isReimbursement || categoryToId(category) === SETTLEMENT_CATEGORY_ID
          ? SETTLEMENT_CATEGORY_ID
          : categoryToId(category),
      amountCurrency: expenseCurrency,
      amount: expenseAmount,
      originalAmount: shouldRecover ? expenseAmount : null,
      originalCurrency: shouldRecover ? originalCurrencyRaw : null,
      conversionRate: shouldRecover ? conversionRate : null,
      paidBySourceId: paidBySourceIdResolved,
      paidBy: [
        {
          sourceId: paidBySourceIdResolved,
          shares: expenseAmount,
        },
      ],
      paidFor: resolvedPaidFor,
      splitMode,
      recurrenceRule: 'NONE',
      recurrence: null,
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

  const mostCommonCurrency = dominantCurrency(currencyCounts) || null

  const currency = mostCommonCurrency
    ? (getCurrency(mostCommonCurrency)?.symbol ?? mostCommonCurrency)
    : ''

  return {
    provider: 'SPLIIT',
    exportVersion: null,
    sourceGroupId: 'csv-import',
    sourceUrl: null,
    name: 'Imported from CSV',
    information: null,
    currency,
    currencyCode: mostCommonCurrency,
    participants,
    expenses,
    documentSource: 'NONE',
  }
})

export const parseSpliitCsv = Effect.fn('parseSpliitCsv')(function* (
  input: string,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const rows = yield* parseCsvText(input)
  return yield* parseSpliitTable(rows)
})

function categoryToId(name: string): string {
  if (!name) return 'general'
  const key = name.toLowerCase()
  const match = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === key)
  return match?.id ?? 'general'
}

/**
 * Settle Up CSV parser — Effect-native importer.
 *
 * Parses the per-group CSV history export into a {@link NormalizedSource}. The
 * layout is the real, observed export shape (see `ad-settle-up.csv` /
 * `gr-settle-up.csv` fixtures):
 *
 * - `Who paid` — the member who advanced the money.
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
 * Exports are UTF-16LE with a BOM (decoded before parsing; BE tolerated). The
 * parser accepts any unicode text (BOM optional) and sniffs the field delimiter
 * like the Tricount parser, so semicolon-locale files still parse — the `For
 * whom` / `Split amounts` lists always split on `;`.
 *
 * Amount semantics mirror the sibling parsers: normalize to a positive cost in
 * the row currency, keep `conversionRate` from the historical `Exchange rate`,
 * and let the wizard convert at confirm time. Transfer rows become settlements
 * (single payer → single receiver). Only rows whose total is denominated in the
 * export's dominant currency are imported, so one group lands in one currency.
 *
 * Participants are registered in first-appearance order: every `Who paid` name
 * first, then `For whom` names the payer row introduces. Names match
 * case-insensitively (`Alice` and `ALICE` are one participant).
 */

import { Effect, Schema } from 'effect'

import { getCurrency } from '../currency'
import { amountAsMinorUnitsByCode } from '../utils'
import { buildOwedExpense, buildSettlement } from './expense-builder'
import { createMemberRegistry } from './member-registry'
import {
  looksLikeSettlementTitle,
  settleUpCategoryToId,
} from './settleup-categories'
import { mapSettleUpHeader } from './settleup-headers'
import {
  decodeBytesText,
  dominantCurrency,
  FALLBACK_CURRENCY,
  isBlankRow,
  parseCsvText,
  parseDatePrefix,
  stripBom,
  toNumberOrNull,
} from './table'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

/** Decoded, trimmed view of one raw CSV row for a known header layout. */
const SettleUpRowSchema = Schema.Struct({
  purpose: Schema.Trim,
  amount: Schema.NumberFromString,
  currency: Schema.Trim,
  forWhom: Schema.Trim,
  splitAmounts: Schema.Trim,
  category: Schema.Trim,
  paidBy: Schema.Trim,
  dateTime: Schema.Trim,
  exchangeRate: Schema.optional(Schema.NumberFromString),
  type: Schema.Trim,
})

/**
 * Decode upload/attachment bytes (or text) to a JS string. Thin alias over the
 * shared kit helper, kept because the existing test import path and the web
 * source step reference the Settle Up name.
 */
export function decodeSettleUpText(input: string | Uint8Array): string | null {
  return decodeBytesText(input)
}

function splitList(value: string): string[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Parse Settle Up rows (already CSV-decoded) into a normalized source. Thin
 * `parseSettleUpCsv` wraps this with bytes/text decoding.
 */
export const parseSettleUpTable = Effect.fnUntraced(function* (
  rows: string[][],
): Effect.fn.Return<NormalizedSource, ImportError> {
  let headerRowIdx = -1
  let headerMap: ReturnType<typeof mapSettleUpHeader> = null
  for (let i = 0; i < rows.length; i++) {
    const map = mapSettleUpHeader(rows[i]!)
    if (map) {
      headerRowIdx = i
      headerMap = map
      break
    }
  }
  if (headerRowIdx === -1 || !headerMap) {
    return yield* new ImportError({
      message: 'CSV header is not a Settle Up export',
      code: 'CSV_NOT_SETTLEUP_EXPORT',
      params: {},
    })
  }
  const map = headerMap

  const registry = createMemberRegistry('settleup-participant')
  const registerMember = registry.register

  type PendingRow = {
    rowNumber: number
    purpose: string
    amount: number
    currencyCode: string
    payerName: string
    receivers: Array<{ name: string; owed: number }>
    category: string
    datePrefix: string
    exchangeRate: number | undefined
    type: string
  }
  const pending: PendingRow[] = []
  const currencyCounts = new Map<string, number>()

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlankRow(row)) continue
    // A repeated header row (concatenated exports) restarts nothing — the
    // header shape is stable, so skip it.
    if (mapSettleUpHeader(row)) continue

    const raw: Record<string, string | undefined> = {
      purpose: map.purposeIdx !== -1 ? row[map.purposeIdx] : '',
      amount: map.amountIdx !== -1 ? row[map.amountIdx] : '',
      currency: map.currencyIdx !== -1 ? row[map.currencyIdx] : '',
      forWhom: row[map.forWhomIdx],
      splitAmounts:
        map.splitAmountsIdx !== -1 ? row[map.splitAmountsIdx] : undefined,
      category: map.categoryIdx !== -1 ? row[map.categoryIdx] : '',
      paidBy: row[map.paidByIdx],
      dateTime: map.dateTimeIdx !== -1 ? row[map.dateTimeIdx] : '',
      exchangeRate:
        map.exchangeRateIdx !== -1 ? row[map.exchangeRateIdx] : undefined,
      type: map.typeIdx !== -1 ? row[map.typeIdx] : '',
    }

    const decoded = yield* Schema.decodeUnknownEffect(SettleUpRowSchema)(
      raw,
    ).pipe(
      Effect.mapError(
        () =>
          new ImportError({
            message: `Row ${r + 1} is not a valid Settle Up expense row`,
            code: 'CSV_INVALID_EXPENSE_ROW',
            params: { row: r + 1 },
          }),
      ),
    )
    if (decoded.paidBy === '') continue

    const datePrefix = parseDatePrefix(decoded.dateTime)
    if (!datePrefix) continue
    const currencyCode = decoded.currency.toUpperCase()
    if (currencyCode.length !== 3) continue
    if (!Number.isFinite(decoded.amount)) continue

    // Pair `For whom` names with aligned `Split amounts` entries by
    // position. Missing amounts pair with zero (registration only); extra
    // amounts with no name are dropped. Receivers with no positive share
    // never reach paidFor.
    const names = splitList(decoded.forWhom)
    if (names.length === 0) continue
    const amountParts = splitList(decoded.splitAmounts)
    const receivers = names.map((name, i) => ({
      name,
      owed: Math.abs(toNumberOrNull(amountParts[i]) ?? 0),
    }))

    pending.push({
      rowNumber: r + 1,
      purpose: decoded.purpose,
      amount: decoded.amount,
      currencyCode,
      payerName: decoded.paidBy,
      receivers,
      category: decoded.category,
      datePrefix,
      exchangeRate: decoded.exchangeRate,
      type: decoded.type,
    })
    currencyCounts.set(
      currencyCode,
      (currencyCounts.get(currencyCode) ?? 0) + 1,
    )
  }

  if (pending.length === 0) {
    return yield* new ImportError({
      message: 'CSV had no parseable expenses',
      code: 'CSV_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  const dominantCode = dominantCurrency(currencyCounts)

  // Single-currency group: skip rows not denominated in the dominant
  // currency (their `Converted amount` is informational only).
  const rowsToImport = pending.filter(
    (row) => row.currencyCode === dominantCode,
  )
  if (rowsToImport.length === 0) {
    return yield* new ImportError({
      message: 'CSV had no parseable expenses',
      code: 'CSV_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  const currency = getCurrency(dominantCode) ?? {
    ...FALLBACK_CURRENCY,
    code: dominantCode,
    symbol: dominantCode,
  }

  const expenses: NormalizedSource['expenses'] = []
  for (const row of rowsToImport) {
    const payerSourceId = registerMember(row.payerName)
    for (const receiver of row.receivers) registerMember(receiver.name)

    // Sign convention: expenses positive, incomes negative. Normalize to
    // a positive cost; the income category marks the row.
    const isIncome = row.amount < 0
    const isTransfer =
      row.type.trim() !== '' &&
      settleUpCategoryToId('', row.type) === 'settlement'
    const title =
      row.purpose !== ''
        ? row.purpose
        : (() => {
            const others = row.receivers
              .map((x) => x.name)
              .filter(
                (name) => name.toLowerCase() !== row.payerName.toLowerCase(),
              )
            const listed = others.length > 0 ? others : [row.payerName]
            return `${row.payerName} → ${listed.join(', ')}`
          })()
    const isSettlement =
      isTransfer || (!isIncome && looksLikeSettlementTitle(title))
    const cost = Math.abs(row.amount)
    const amountCents = amountAsMinorUnitsByCode(cost, dominantCode)

    if (isSettlement) {
      // Settlement: payer → single receiver (largest owed entry that is
      // not the payer, else the largest owed entry).
      let receiverName: string | null = null
      let receiverOwed = 0
      for (const receiver of row.receivers) {
        if (
          receiver.name.toLowerCase() !== row.payerName.toLowerCase() &&
          receiver.owed > receiverOwed
        ) {
          receiverName = receiver.name
          receiverOwed = receiver.owed
        }
      }
      if (!receiverName) {
        for (const receiver of row.receivers) {
          if (receiver.owed > receiverOwed) {
            receiverName = receiver.name
            receiverOwed = receiver.owed
          }
        }
      }
      if (!receiverName) continue
      const settlement = buildSettlement({
        payerId: payerSourceId,
        receiverId: registerMember(receiverName),
        amountCents,
      })
      expenses.push({
        title,
        expenseDate: row.datePrefix,
        category: 'settlement',
        amountCurrency: dominantCode,
        amount: amountCents,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        ...settlement,
        recurrenceRule: 'NONE',
        notes: null,
      })
      continue
    }

    const owedMajors = new Map<string, number>()
    for (const receiver of row.receivers) {
      if (receiver.owed > 0) {
        owedMajors.set(registerMember(receiver.name), receiver.owed)
      }
    }
    // Payer side: the `Who paid` member advanced the whole total.
    const built = buildOwedExpense({
      amountCents,
      currency,
      owedMajors,
      advancedMajors: new Map([[payerSourceId, cost]]),
      payerId: payerSourceId,
    })

    const exchangeRate =
      row.exchangeRate !== undefined &&
      Number.isFinite(row.exchangeRate) &&
      row.exchangeRate !== 0
        ? Math.abs(row.exchangeRate)
        : null

    expenses.push({
      title,
      expenseDate: row.datePrefix,
      category: isIncome
        ? 'income'
        : settleUpCategoryToId(row.category, row.type),
      amountCurrency: dominantCode,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      // Historical row rate preserved for auditing; the wizard converts
      // against Frankfurter at confirm time.
      conversionRate: exchangeRate,
      ...built,
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

  return {
    provider: 'SETTLEUP',
    exportVersion: null,
    sourceGroupId: 'settleup-csv-import',
    sourceUrl: null,
    name: 'Imported from Settle Up',
    information: null,
    currency: dominantCode,
    currencyCode: dominantCode,
    participants: registry.all(),
    expenses,
    documentSource: 'NONE',
  }
})

export const parseSettleUpCsv = Effect.fn('parseSettleUpCsv')(function* (
  input: string | Uint8Array,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const text = decodeSettleUpText(input)
  if (text === null) {
    return yield* new ImportError({
      message: 'File is not decodable text',
      code: 'CSV_NOT_DECODABLE_TEXT',
      params: {},
    })
  }
  // Sniff like the Tricount parser so a semicolon-locale file still parses.
  // Note: `For whom`/`Split amounts` lists always split on `;`.
  const firstLine = stripBom(text).split('\n', 1)[0] ?? ''
  const delimiter =
    firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  const rows = yield* parseCsvText(text, { delimiter, skipEmptyLines: false })
  return yield* parseSettleUpTable(rows)
})

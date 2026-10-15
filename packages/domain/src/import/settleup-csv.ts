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
import Papa from 'papaparse'

import { getCurrency } from '../currency'
import type { Currency } from '../currency'
import { distributeRemainder } from '../remainder-distribution'
import {
  calculateExactShares,
  serializePaidBy,
  serializePaidFor,
} from '../totals'
import { amountAsMinorUnitsByCode } from '../utils'
import {
  looksLikeSettlementTitle,
  settleUpCategoryToId,
} from './settleup-categories'
import { mapSettleUpHeader } from './settleup-headers'
import { guessSplitMode } from './split-guess'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

const FALLBACK_CURRENCY: Currency = {
  code: '',
  symbol: '',
  rounding: 0,
  decimal_digits: 2,
}

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

function blankCell(value: string | undefined): boolean {
  return (value ?? '').trim() === ''
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => blankCell(cell))
}

/**
 * Decode upload/attachment bytes (or text) to a JS string. Real Settle Up
 * exports are UTF-16LE with a BOM; tolerate BE, BOM-less UTF-16, and plain
 * UTF-8/ASCII (a lone `�` means it was not actually UTF-16). Returns null when
 * the payload cannot be decoded as text.
 */
export function decodeSettleUpText(input: string | Uint8Array): string | null {
  if (typeof input === 'string') {
    return stripUnicodeBom(input)
  }
  const bytes = input
  if (bytes.length === 0) return null
  const hasLeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const hasBeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  // NUL every other byte is the UTF-16 signature without a BOM.
  let nulEven = 0
  let nulOdd = 0
  const sample = Math.min(bytes.length, 64)
  for (let i = 0; i < sample; i++) {
    if (bytes[i] === 0) {
      if (i % 2 === 0) nulEven++
      else nulOdd++
    }
  }
  const looksLe = hasLeBom || (!hasBeBom && nulOdd > nulEven && nulOdd > 0)
  const looksBe = hasBeBom || (!hasLeBom && nulEven > nulOdd && nulEven > 0)
  try {
    if (looksLe) {
      const text = new TextDecoder('utf-16le').decode(bytes)
      if (!text.includes('�')) return stripUnicodeBom(text)
    } else if (looksBe) {
      const text = new TextDecoder('utf-16be').decode(bytes)
      if (!text.includes('�')) return stripUnicodeBom(text)
    }
    if (hasLeBom || hasBeBom) return null
    return stripUnicodeBom(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    )
  } catch {
    return null
  }
}

function stripUnicodeBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function splitList(value: string): string[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

/**
 * Settle Up timestamps are `YYYY-MM-DD HH:mm:ss` plus a separate `Timezone`
 * column. Returns the `YYYY-MM-DD` prefix or null when unparseable.
 */
function parseDatePrefix(value: string): string | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? null
}

export const parseSettleUpCsv = Effect.fnUntraced(function* (
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
  const firstLine = stripUnicodeBom(text).split('\n', 1)[0] ?? ''
  const delimiter =
    firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    header: false,
    delimiter,
  })
  if (parsed.errors.length > 0) {
    const detail = parsed.errors[0]?.message ?? 'unknown error'
    return yield* new ImportError({
      message: `CSV could not be parsed: ${detail}`,
      code: 'CSV_PARSE_FAILED',
      params: { detail },
    })
  }
  const rows = parsed.data
  if (rows.length < 2) {
    return yield* new ImportError({
      message: 'CSV has no data rows',
      code: 'CSV_NO_DATA_ROWS',
      params: {},
    })
  }

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

  const participants: NormalizedSource['participants'] = []
  const nameToSourceId = new Map<string, string>()
  const registerMember = (name: string): string => {
    const existing = nameToSourceId.get(name.toLowerCase())
    if (existing) return existing
    const sourceId = `settleup-participant-${participants.length}`
    nameToSourceId.set(name.toLowerCase(), sourceId)
    participants.push({ sourceId, sourceName: name })
    return sourceId
  }

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

  let dominantCurrency = ''
  let maxCount = 0
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count
      dominantCurrency = code
    }
  }

  // Single-currency group: skip rows not denominated in the dominant
  // currency (their `Converted amount` is informational only).
  const rowsToImport = pending.filter(
    (row) => row.currencyCode === dominantCurrency,
  )
  if (rowsToImport.length === 0) {
    return yield* new ImportError({
      message: 'CSV had no parseable expenses',
      code: 'CSV_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  const currency = getCurrency(dominantCurrency) ?? {
    ...FALLBACK_CURRENCY,
    code: dominantCurrency,
    symbol: dominantCurrency,
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
    const amountCents = amountAsMinorUnitsByCode(cost, dominantCurrency)

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
      expenses.push({
        title,
        expenseDate: row.datePrefix,
        category: 'settlement',
        amountCurrency: dominantCurrency,
        amount: amountCents,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidBySourceId: payerSourceId,
        paidBy: [{ sourceId: payerSourceId, shares: amountCents }],
        paidFor: [
          { sourceId: registerMember(receiverName), shares: amountCents },
        ],
        splitMode: 'EVENLY',
        recurrenceRule: 'NONE',
        notes: null,
      })
      continue
    }

    const paidForSerialized = serializePaidFor({
      splitMode: 'BY_AMOUNT',
      amount: amountCents,
      currency,
      paidFor: row.receivers
        .filter((receiver) => receiver.owed > 0)
        .map((receiver) => ({
          participant: { id: registerMember(receiver.name) },
          shares: receiver.owed,
        })),
    })
    const paidForCents = new Map<string, number>()
    for (const entry of paidForSerialized) {
      if (entry.shares > 0) {
        paidForCents.set(
          entry.participant.id,
          (paidForCents.get(entry.participant.id) ?? 0) + entry.shares,
        )
      }
    }
    // Remainder from rounding (e.g. 8.33 × 12 = 99.96 vs 100) goes
    // through the domain remainder distributor (pinned to the payer).
    const owedTotal = [...paidForCents.values()].reduce((sum, v) => sum + v, 0)
    const remainder = amountCents - owedTotal
    if (remainder !== 0) {
      const exact = calculateExactShares({
        amount: Math.abs(remainder),
        splitMode: 'EVENLY',
        participants: [{ id: payerSourceId, shares: 1 }],
      })
      const fixed = distributeRemainder(exact, Math.abs(remainder))
      const extra = fixed[payerSourceId] ?? 0
      if (extra > 0) {
        paidForCents.set(
          payerSourceId,
          (paidForCents.get(payerSourceId) ?? 0) +
            (remainder > 0 ? extra : -extra),
        )
      }
    }
    const paidFor = [...paidForCents.entries()]
      .filter(([, shares]) => shares > 0)
      .map(([sourceId, shares]) => ({ sourceId, shares }))
    if (paidFor.length === 0) {
      paidFor.push({ sourceId: payerSourceId, shares: amountCents })
    }

    // Payer side: the `Who paid` member advanced the whole total.
    const paidBySerialized = serializePaidBy({
      paidBySplitMode: 'BY_AMOUNT',
      amount: amountCents,
      inputCurrency: currency,
      paidByList: [{ participant: { id: payerSourceId }, shares: cost }],
    })
    const paidByExact = calculateExactShares({
      amount: amountCents,
      splitMode: 'BY_AMOUNT',
      participants: paidBySerialized.map((p) => ({
        id: p.participant.id,
        shares: p.shares,
      })),
    })
    const paidByFixed = distributeRemainder(paidByExact, amountCents, {
      payerId: payerSourceId,
    })
    const paidBy = Object.entries(paidByFixed).map(([sourceId, shares]) => ({
      sourceId,
      shares,
    }))

    const involvedCount = new Set([
      ...paidBy.map((p) => p.sourceId),
      ...paidFor.map((p) => p.sourceId),
    ]).size
    const { splitMode, paidFor: resolvedPaidFor } = guessSplitMode(
      paidFor,
      amountCents,
      { involvedParticipantCount: involvedCount },
    )

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
      amountCurrency: dominantCurrency,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      // Historical row rate preserved for auditing; the wizard converts
      // against Frankfurter at confirm time.
      conversionRate: exchangeRate,
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

  return {
    provider: 'SETTLEUP',
    exportVersion: null,
    sourceGroupId: 'settleup-csv-import',
    sourceUrl: null,
    name: 'Imported from Settle Up',
    information: null,
    currency: dominantCurrency,
    currencyCode: dominantCurrency,
    participants,
    expenses,
    documentSource: 'NONE',
  }
})

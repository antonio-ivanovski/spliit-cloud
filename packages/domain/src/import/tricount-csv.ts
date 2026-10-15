/**
 * Tricount GDPR CSV parser — Effect-native reference implementation.
 *
 * Parses the multi-group GDPR dump (one `tricount <name> - Exported on …`
 * footer per group) into one {@link NormalizedSource} per group. Amount
 * semantics follow the exporter contract (`marcomc/tricount-exporter`):
 *
 * - `Total` is signed (expenses negative, incomes positive); parsed via absolute
 *   value with the sign recovered from `Transaction Type`.
 * - Per-member `Share <Name>` is the base-currency share; `Paid by <Name>` is the
 *   amount advanced. `Allocation Type` (`AMOUNT`/`RATIO`) + `Share Ratio`
 *   describe the split intent but the parser uses the concrete shares (same as
 *   the Sesterce shape: `Paid by X` advanced, `Paid for X` owed).
 * - `BALANCE` rows are settlements (single payer → single receiver).
 * - `INCOME` rows negate the owed side.
 *
 * The parser never converts currencies: each expense keeps its row-native
 * `amount`/`Currency` and the exporter's historical `Exchange Rate` as
 * `conversionRate`, so the existing Frankfurter-backed `currencyConversion`
 * wizard step handles destination conversion at confirm time (same contract as
 * the Splitwise parser).
 *
 * Reference patterns for future refactors: `Effect.fnUntraced` entry point,
 * `Schema`-decoded row model, `Predicate`-based guards, single `ImportError`
 * failure channel with stable `code`s preserved verbatim into
 * {@link ImportParseResult}.
 */

import { Effect, Predicate, Schema } from 'effect'
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
import { guessSplitMode } from './split-guess'
import {
  tricountLooksLikeSettlementTitle,
  tricountCategoryToId,
} from './tricount-categories'
import {
  mapTricountHeader,
  parseGroupFooter,
  type TricountHeaderMap,
} from './tricount-headers'
import { ImportError } from './types'
import type { NormalizedSource } from './types'

const FALLBACK_CURRENCY: Currency = {
  code: '',
  symbol: '',
  rounding: 0,
  decimal_digits: 2,
}

/** Decoded, trimmed view of one raw CSV row for a known header layout. */
const TricountRowSchema = Schema.Struct({
  title: Schema.Trim,
  amount: Schema.NumberFromString,
  currency: Schema.Trim,
  exchangeRate: Schema.optional(Schema.NumberFromString),
  amountDefault: Schema.optional(Schema.NumberFromString),
  transactionType: Schema.Trim,
  category: Schema.Trim,
  customCategory: Schema.Trim,
  paidBy: Schema.optional(Schema.Trim),
  date: Schema.Trim,
})

function blankCell(value: string | undefined): boolean {
  return (value ?? '').trim() === ''
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => blankCell(cell))
}

/**
 * Tricount dates are `YYYY-MM-DD HH:mm:SS` (exporter writes
 * `%Y-%m-%d`/`%H:%M:%S`); Sesterce rows are `YYYYMMDD`, `YYYY-MM-DD` or
 * `YYYY/MM/DD`. Returns the `YYYY-MM-DD` prefix or null when unparseable.
 */
function parseDatePrefix(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]!
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const slashed = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})/)
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`
  return null
}

/**
 * Single expense-column amount for `Paid by`/bare-name layouts (Method 2/3):
 * positive = advanced/owed depending on the column kind.
 */
function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

type MemberColumn = { name: string; paidIdx: number; impactedIdx: number }

type Section = {
  map: TricountHeaderMap
  memberColumns: MemberColumn[]
  headerRowIdx: number
  /** Footer group name seen while scanning this section, if any. */
  footerName: string | null
  footerRowIdx: number
}

const findSections = Effect.fnUntraced(function* (
  rows: string[][],
): Effect.fn.Return<Section[], ImportError> {
  const sections: Section[] = []
  let pendingFooter: string | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (isBlankRow(row)) continue
    const footer = parseGroupFooter(row)
    if (footer) {
      if (sections.length > 0) {
        const current = sections[sections.length - 1]!
        if (current.footerName === null) {
          current.footerName = footer
          current.footerRowIdx = i
          continue
        }
      }
      pendingFooter = footer
      continue
    }
    const map = mapTricountHeader(row)
    if (!map) continue
    const memberColumns: MemberColumn[] = [...map.members.entries()].map(
      ([name, cols]) => ({ name, ...cols }),
    )
    sections.push({
      map,
      memberColumns,
      headerRowIdx: i,
      footerName: pendingFooter,
      footerRowIdx: -1,
    })
    pendingFooter = null
  }
  if (sections.length === 0) {
    return yield* new ImportError({
      message: 'CSV header is not a Tricount export',
      code: 'CSV_NOT_TRICOUNT_EXPORT',
      params: {},
    })
  }
  return sections
})

type ParsedSection = {
  source: NormalizedSource
  currencyCounts: Map<string, number>
}

const parseSection = Effect.fnUntraced(function* (
  rows: string[][],
  section: Section,
  groupIndex: number,
): Effect.fn.Return<ParsedSection, ImportError> {
  const { map } = section
  const limit = section.footerRowIdx !== -1 ? section.footerRowIdx : rows.length

  const participants: NormalizedSource['participants'] = []
  const nameToSourceId = new Map<string, string>()
  const registerMember = (name: string): string => {
    const existing = nameToSourceId.get(name.toLowerCase())
    if (existing) return existing
    const sourceId = `tricount-participant-${groupIndex}-${participants.length}`
    nameToSourceId.set(name.toLowerCase(), sourceId)
    participants.push({ sourceId, sourceName: name })
    return sourceId
  }
  for (const col of section.memberColumns) registerMember(col.name)

  const expenses: NormalizedSource['expenses'] = []
  const currencyCounts = new Map<string, number>()

  for (let r = section.headerRowIdx + 1; r < limit; r++) {
    const row = rows[r]!
    if (isBlankRow(row)) continue
    if (parseGroupFooter(row)) continue
    // A new header row starts the next section; stop here.
    if (mapTricountHeader(row)) break

    const raw: Record<string, string | undefined> = {
      title: row[map.titleIdx],
      // Sesterce-shape rows carry no total column: the total is the sum of
      // the `Paid by <Name>` member columns (exactly one is non-zero).
      amount:
        map.amountIdx !== -1
          ? row[map.amountIdx]
          : String(
              section.memberColumns.reduce(
                (sum, col) =>
                  col.paidIdx !== -1
                    ? sum + Math.abs(toNumberOrNull(row[col.paidIdx]) ?? 0)
                    : sum,
                0,
              ),
            ),
      currency:
        map.currencyIdx !== -1
          ? row[map.currencyIdx]
          : (map.defaultCurrencyCode ?? undefined),
      exchangeRate:
        map.exchangeRateIdx !== -1 ? row[map.exchangeRateIdx] : undefined,
      amountDefault:
        map.amountDefaultIdx !== -1 ? row[map.amountDefaultIdx] : undefined,
      transactionType:
        map.transactionTypeIdx !== -1 ? row[map.transactionTypeIdx] : '',
      category: map.categoryIdx !== -1 ? row[map.categoryIdx] : '',
      customCategory: undefined,
      paidBy: row[map.paidByIdx],
      date: map.dateIdx !== -1 ? row[map.dateIdx] : '',
    }
    // Human-readable exporter splits category into Category/Custom Category
    // adjacent columns; the GDPR core header only names one.
    if (map.categoryIdx !== -1) {
      const maybeCustom = (row[map.categoryIdx + 1] ?? '').trim()
      const categoryCell = (row[map.categoryIdx] ?? '').trim()
      if (
        maybeCustom !== '' &&
        categoryCell !== '' &&
        categoryCell !== maybeCustom
      ) {
        // Only treat as custom when the neighbor is not another known core
        // column (avoids swallowing e.g. `Transaction Type`).
        raw.customCategory = maybeCustom
      }
    }

    const decoded = yield* Schema.decodeUnknownEffect(TricountRowSchema)(
      raw,
    ).pipe(
      Effect.mapError(
        () =>
          new ImportError({
            message: `Row ${r + 1} is not a valid Tricount expense row`,
            code: 'CSV_INVALID_EXPENSE_ROW',
            params: { row: r + 1 },
          }),
      ),
    )
    if (decoded.title === '') continue

    const datePrefix = parseDatePrefix(decoded.date)
    if (!datePrefix) continue
    const currencyCode = decoded.currency.toUpperCase()
    if (!Predicate.isString(currencyCode) || currencyCode.length !== 3) continue
    if (!Number.isFinite(decoded.amount) || decoded.amount === 0) continue

    // Sign convention: expenses negative, incomes positive (exporter
    // multiplies by -1 on write). Normalize to a positive cost.
    const typeUpper = decoded.transactionType.trim().toUpperCase()
    const isIncome = typeUpper === 'INCOME'
    const isBalance =
      typeUpper === 'BALANCE' || tricountLooksLikeSettlementTitle(decoded.title)
    const cost = Math.abs(decoded.amount)

    currencyCounts.set(
      currencyCode,
      (currencyCounts.get(currencyCode) ?? 0) + 1,
    )

    const currency = getCurrency(currencyCode) ?? {
      ...FALLBACK_CURRENCY,
      code: currencyCode,
      symbol: currencyCode,
    }
    const amountCents = amountAsMinorUnitsByCode(cost, currencyCode)

    // Payer: explicit `Paid by` column, else the member with the largest
    // `Paid by <Name>` advance (Sesterce shape carries no payer column).
    const payerName =
      map.paidByIdx !== -1
        ? (decoded.paidBy ?? '')
        : (() => {
            let best: string | null = null
            let bestValue = 0
            for (const col of section.memberColumns) {
              if (col.paidIdx === -1) continue
              const value = Math.abs(toNumberOrNull(row[col.paidIdx]) ?? 0)
              if (value > bestValue) {
                bestValue = value
                best = col.name
              }
            }
            return best ?? ''
          })()
    if (payerName === '') continue
    const payerSourceId = registerMember(payerName)
    for (const col of section.memberColumns) registerMember(col.name)

    // ── Shares ────────────────────────────────────────────────────
    // `Paid by <Name>` (advanced) + `Impacted to`/`Paid for <Name>` (owed).
    const advanced = new Map<string, number>()
    const owed = new Map<string, number>()
    for (const col of section.memberColumns) {
      const sourceId = nameToSourceId.get(col.name.toLowerCase())!
      if (col.paidIdx !== -1) {
        const value = toNumberOrNull(row[col.paidIdx])
        if (value !== null && value !== 0) {
          advanced.set(sourceId, Math.abs(value))
        }
      }
      if (col.impactedIdx !== -1) {
        const value = toNumberOrNull(row[col.impactedIdx])
        if (value !== null && value !== 0) {
          owed.set(sourceId, Math.abs(value))
        }
      }
    }

    if (isBalance) {
      // Settlement: payer → single receiver (the one owed entry that is not
      // the payer, else the largest owed entry).
      let receiverId: string | null = null
      let receiverShares = 0
      for (const [sourceId, share] of owed) {
        if (sourceId !== payerSourceId && share > receiverShares) {
          receiverId = sourceId
          receiverShares = share
        }
      }
      if (!receiverId) {
        for (const [sourceId, share] of owed) {
          if (share > receiverShares) {
            receiverId = sourceId
            receiverShares = share
          }
        }
      }
      if (!receiverId) continue
      expenses.push({
        title: decoded.title,
        expenseDate: datePrefix,
        category: 'settlement',
        amountCurrency: currencyCode,
        amount: amountCents,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        paidBySourceId: payerSourceId,
        paidBy: [{ sourceId: payerSourceId, shares: amountCents }],
        paidFor: [{ sourceId: receiverId, shares: amountCents }],
        splitMode: 'EVENLY',
        recurrenceRule: 'NONE',
        notes: null,
      })
      continue
    }

    // Owed side: per-member shares in major units → minor via domain core.
    const owedEntries = [...owed.entries()]
      .filter(([, share]) => share > 0)
      .map(([sourceId, share]) => ({
        participant: { id: sourceId },
        shares: isIncome ? -share : share,
      }))
    const incomeOwed = isIncome
      ? owedEntries.map((entry) => ({
          ...entry,
          shares: Math.abs(entry.shares),
        }))
      : owedEntries
    const paidForSerialized = serializePaidFor({
      splitMode: 'BY_AMOUNT',
      amount: amountCents,
      currency,
      paidFor: incomeOwed,
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
    // Remainder from rounding or from members with no owed entry (e.g. a
    // payer covering extra) goes through the domain remainder distributor.
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

    // Payer side: advanced amounts in major units → minor via domain core,
    // residual pinned to the payer.
    const advancedEntries = [...advanced.entries()]
      .filter(([, share]) => share > 0)
      .map(([sourceId, share]) => ({
        participant: { id: sourceId },
        shares: share,
      }))
    const paidByMajor =
      advancedEntries.length > 0
        ? advancedEntries
        : [{ participant: { id: payerSourceId }, shares: cost }]
    const paidBySerialized = serializePaidBy({
      paidBySplitMode: 'BY_AMOUNT',
      amount: amountCents,
      inputCurrency: currency,
      paidByList: paidByMajor,
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
      decoded.exchangeRate !== undefined &&
      Number.isFinite(decoded.exchangeRate) &&
      decoded.exchangeRate !== 0
        ? Math.abs(decoded.exchangeRate)
        : null

    expenses.push({
      title: decoded.title,
      expenseDate: datePrefix,
      category: tricountCategoryToId(
        decoded.category,
        decoded.customCategory,
        decoded.transactionType,
      ),
      amountCurrency: currencyCode,
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

  if (participants.length === 0) {
    return yield* new ImportError({
      message: 'CSV is missing participant columns',
      code: 'CSV_MISSING_PARTICIPANT_COLUMNS',
      params: {},
    })
  }
  if (expenses.length === 0) {
    return yield* new ImportError({
      message: 'CSV had no parseable expenses',
      code: 'CSV_NO_PARSEABLE_EXPENSES',
      params: {},
    })
  }

  let mostCommonCurrency = ''
  let maxCount = 0
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count
      mostCommonCurrency = code
    }
  }

  const groupName = section.footerName ?? `Imported Tricount ${groupIndex + 1}`
  return {
    source: {
      provider: 'TRICOUNT',
      exportVersion: null,
      sourceGroupId: `tricount-csv-import-${groupIndex}`,
      sourceUrl: null,
      name: groupName,
      information: null,
      currency: mostCommonCurrency || '',
      currencyCode: mostCommonCurrency || null,
      participants,
      expenses,
      documentSource: 'NONE',
    },
    currencyCounts,
  }
})

/**
 * Parse a Tricount GDPR CSV dump into one normalized source per group.
 *
 * Multi-group: rows between consecutive `tricount <name> - Exported on …`
 * footers (or header rows) form one group each. Returns the list of groups;
 * callers route multi-group results through the account-queue picker and
 * single-group results straight into the wizard.
 */
export const parseTricountCsv = Effect.fnUntraced(function* (
  input: string,
): Effect.fn.Return<NormalizedSource[], ImportError> {
  const cleaned = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  // GDPR dumps and the human-readable exporter use `;`; Sesterce uses `,`.
  // Sniff the first line: the delimiter producing more cells wins.
  const firstLine = cleaned.split('\n', 1)[0] ?? ''
  const delimiter =
    firstLine.split(';').length >= firstLine.split(',').length ? ';' : ','
  const parsed = Papa.parse<string[]>(cleaned, {
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
  const sections = yield* findSections(rows)
  const sources: NormalizedSource[] = []
  for (let i = 0; i < sections.length; i++) {
    const { source } = yield* parseSection(rows, sections[i]!, i)
    // Drop duplicate member columns that only differ by prefix kind
    // (`Paid by X` + `Impacted to X` register X once via registerMember).
    sources.push(source)
  }
  return sources
})

/**
 * Single-group variant for the `FileParser` provider seam (which resolves one
 * source). Multi-group dumps fail here with a dedicated code so the UI can
 * route to the queue picker instead.
 */
export const parseTricountCsvSingle = Effect.fnUntraced(function* (
  input: string,
): Effect.fn.Return<NormalizedSource, ImportError> {
  const sources = yield* parseTricountCsv(input)
  if (sources.length > 1) {
    return yield* new ImportError({
      message: `CSV contains ${sources.length} Tricount groups; select groups to import`,
      code: 'CSV_MULTIPLE_GROUPS',
      params: { count: sources.length },
    })
  }
  return sources[0]!
})

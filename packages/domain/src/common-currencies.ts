import { getCurrency, type SupportedCurrencyCode } from './currency'

/** Half-life (days) for recency-weighted common-currency scoring. */
export const COMMON_CURRENCY_HALF_LIFE_DAYS = 90

/** Max ranked recommendations returned (group currency is pinned separately). */
export const COMMON_CURRENCY_LIMIT = 5

/**
 * Look back this many days when loading expense currency history.
 * Beyond ~2 half-lives weights are tiny; beyond this window they are
 * negligible for ranking while keeping the DB scan bounded.
 */
export const COMMON_CURRENCY_LOOKBACK_DAYS = 730

export type ExpenseCurrencyHistoryRow = {
  /** ISO code when converted; null means same as group ledger currency. */
  originalCurrency: string | null
  expenseDate: Date
}

/**
 * Effective expense currency: original when present, otherwise the group
 * ledger currency. Returns null when neither is a usable code.
 */
export function effectiveExpenseCurrency(
  originalCurrency: string | null | undefined,
  groupCurrency: string | null | undefined,
): string | null {
  const code = originalCurrency ?? groupCurrency ?? null
  if (!code) return null
  return code
}

/** True when `code` is a supported ISO currency the selector can pick. */
export function isSupportedCurrencyCode(
  code: string,
): code is SupportedCurrencyCode {
  return getCurrency(code) !== undefined
}

function utcDateOnlyMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Age in whole UTC days from expenseDate to today. Future dates clamp to 0
 * so they score as "today" rather than negative age.
 */
export function currencyRecencyAgeDays(
  expenseDate: Date,
  today: Date = new Date(),
): number {
  const todayMs = utcDateOnlyMs(today)
  const expenseMs = utcDateOnlyMs(expenseDate)
  const ageDays = Math.floor((todayMs - expenseMs) / 86_400_000)
  return ageDays < 0 ? 0 : ageDays
}

/** Exponential recency weight with a 90-day half-life: `2^(-ageDays / 90)`. */
export function currencyRecencyWeight(
  ageDays: number,
  halfLifeDays: number = COMMON_CURRENCY_HALF_LIFE_DAYS,
): number {
  return 2 ** (-ageDays / halfLifeDays)
}

type Aggregate = {
  score: number
  count: number
  latestDateMs: number
}

/**
 * Rank currencies previously used by a group (excluding the pinned group
 * currency). Sort: weighted score ↓, raw count ↓, most recent date ↓, code ↑.
 * Returns up to `limit` supported ISO codes.
 */
export function rankCommonCurrencies(
  rows: ReadonlyArray<ExpenseCurrencyHistoryRow>,
  options: {
    groupCurrency: string | null | undefined
    today?: Date
    limit?: number
  },
): string[] {
  const today = options.today ?? new Date()
  const limit = options.limit ?? COMMON_CURRENCY_LIMIT
  const groupCurrency = options.groupCurrency ?? null
  const byCode = new Map<string, Aggregate>()

  for (const row of rows) {
    const code = effectiveExpenseCurrency(row.originalCurrency, groupCurrency)
    if (!code) continue
    if (groupCurrency && code === groupCurrency) continue
    if (!isSupportedCurrencyCode(code)) continue

    const ageDays = currencyRecencyAgeDays(row.expenseDate, today)
    const weight = currencyRecencyWeight(ageDays)
    const dateMs = utcDateOnlyMs(row.expenseDate)
    const existing = byCode.get(code)
    if (existing) {
      existing.score += weight
      existing.count += 1
      if (dateMs > existing.latestDateMs) existing.latestDateMs = dateMs
    } else {
      byCode.set(code, { score: weight, count: 1, latestDateMs: dateMs })
    }
  }

  return [...byCode.entries()]
    .sort(([codeA, a], [codeB, b]) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.count !== a.count) return b.count - a.count
      if (b.latestDateMs !== a.latestDateMs)
        return b.latestDateMs - a.latestDateMs
      return codeA.localeCompare(codeB)
    })
    .slice(0, limit)
    .map(([code]) => code)
}

/** UTC calendar date `lookbackDays` before `today` (for DB range filters). */
export function commonCurrencyLookbackDate(
  today: Date = new Date(),
  lookbackDays: number = COMMON_CURRENCY_LOOKBACK_DAYS,
): Date {
  const ms = utcDateOnlyMs(today) - lookbackDays * 86_400_000
  return new Date(ms)
}

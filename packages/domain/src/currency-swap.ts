import type { ConversionSource } from './conversion'
import { convertMinorUnitsByRate } from './utils'

export type SwapRateMode =
  | { type: 'historic' }
  | { type: 'custom'; rate: number }

export type SwapPairMode =
  | { mode: 'perDate' }
  | { mode: 'fixed'; date: string; override?: number }

/** Keyed by `BASE|TARGET` (upper-cased). Absent pair = perDate default. */
export type SwapRateModes = Record<string, SwapPairMode>

export function swapPairKey(base: string, target: string) {
  return `${base.toUpperCase()}|${target.toUpperCase()}`
}

export function pairModeFor(
  modes: SwapRateModes | undefined,
  base: string,
  target: string,
): SwapPairMode {
  return modes?.[swapPairKey(base, target)] ?? { mode: 'perDate' }
}

export type SwapRateKeyItem = {
  date: string
  base: string
  target: string
}

export function makeSwapRateKey(date: string, base: string, target: string) {
  return `${date}|${base.toUpperCase()}|${target.toUpperCase()}`
}

export type SwapExpenseInput = {
  id: string
  expenseDate: string
  amount: number
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | null
  conversionSource?: ConversionSource | null
}

export type SwapRowKind = 'simple' | 'cleared' | 'fresh' | 'bridged'

type ClassifiedSwapExpense =
  | { lane: 'simple'; base: string }
  | { lane: 'cleared' }
  | { lane: 'fresh'; base: string }
  | { lane: 'bridged'; base: string }

/**
 * Single routing rule for a swap O -> N. All three consumers (pair cards,
 * rate-key planning, row planning) switch on this so they can never disagree:
 *
 * - Missing currency/source -> `simple` on O|N
 * - Original equals target -> `cleared` (no pair, no rate)
 * - EXCHANGE source -> `fresh` on C|N
 * - Any other stored conversion (CUSTOM/EXACT) -> `bridged` on O|N
 */
function classifySwapExpense(
  expense: Pick<SwapExpenseInput, 'originalCurrency' | 'conversionSource'>,
  oldUpper: string,
  newUpper: string,
): ClassifiedSwapExpense {
  const C = expense.originalCurrency?.toUpperCase() ?? null
  const source = expense.conversionSource ?? null
  if (!C || !source) return { lane: 'simple', base: oldUpper }
  if (C === newUpper) return { lane: 'cleared' }
  if (source === 'EXCHANGE') return { lane: 'fresh', base: C }
  return { lane: 'bridged', base: oldUpper }
}

/** Positive rates only; null/zero/negative/NaN all resolve to "no rate". */
function usableRate(rate: number | null | undefined): number | null {
  return rate != null && rate > 0 ? rate : null
}

/**
 * The conversion pair base for one expense in a swap O -> N, using the same
 * routing rule as the pair cards, rate-key planning and row planning. Returns
 * null for `cleared` rows, which belong to no pair. Lets the preview scope a
 * retry to a single pair without re-resolving every rate.
 */
export function swapPairBaseForExpense(
  expense: Pick<SwapExpenseInput, 'originalCurrency' | 'conversionSource'>,
  oldCode: string,
  newCode: string,
): string | null {
  const lane = classifySwapExpense(
    expense,
    oldCode.toUpperCase(),
    newCode.toUpperCase(),
  )
  if (lane.lane === 'cleared') return null
  return lane.base
}

/** EXACT conversions lose their exactness through a bridge -> CUSTOM. */
function bridgedSource(
  source: ConversionSource | null,
): ConversionSource | null {
  return source === 'EXACT' ? 'CUSTOM' : source
}

export type PlannedSwapRow = {
  id: string
  kind: SwapRowKind
  oldAmount: number
  newAmount: number
  newOriginalAmount: number | null
  newOriginalCurrency: string | null
  newConversionRate: number | null
  newConversionSource: ConversionSource | null
  rateUsed: number | null
  rateDate: string | null
  warning?: string
}

function isoDateOf(expenseDate: string): string {
  return expenseDate.slice(0, 10)
}

export type SwapPairInfo = {
  base: string
  target: string
  dates: string[]
  expenseCount: number
}

/**
 * Distinct conversion pairs in a swap O -> N, for the per-pair rate cards.
 *
 * - O|N when any simple or bridged (CUSTOM/EXACT) row exists
 * - C|N for every third currency with EXCHANGE rows (C != N) Cleared rows (C ==
 *   N) need no pair.
 */
export function computeSwapPairs(
  expenses: SwapExpenseInput[],
  oldCode: string,
  newCode: string,
): SwapPairInfo[] {
  const O = oldCode.toUpperCase()
  const N = newCode.toUpperCase()
  if (!O || !N || O === N) return []
  const byPair = new Map<
    string,
    { base: string; dates: Set<string>; ids: Set<string> }
  >()
  const touch = (base: string, date: string, id: string) => {
    const key = swapPairKey(base, N)
    let entry = byPair.get(key)
    if (!entry) {
      entry = { base: base.toUpperCase(), dates: new Set(), ids: new Set() }
      byPair.set(key, entry)
    }
    entry.dates.add(date)
    entry.ids.add(id)
  }
  for (const e of expenses) {
    const date = isoDateOf(e.expenseDate)
    const classified = classifySwapExpense(e, O, N)
    if (classified.lane === 'cleared') continue
    touch(classified.base, date, e.id)
  }
  return [...byPair.values()].map((entry) => ({
    base: entry.base,
    target: N,
    dates: [...entry.dates].sort(),
    expenseCount: entry.ids.size,
  }))
}

type ResolvedPairRate = {
  rate: number | null
  rateDate: string
  fromOverride: boolean
}

function resolvePairRate(
  pairMode: SwapPairMode,
  expenseDate: string,
  base: string,
  target: string,
  ratesByKey: Record<string, number>,
): ResolvedPairRate {
  if (pairMode.mode === 'fixed') {
    if (pairMode.override != null && pairMode.override > 0) {
      return {
        rate: pairMode.override,
        rateDate: pairMode.date,
        fromOverride: true,
      }
    }
    const rate =
      ratesByKey[makeSwapRateKey(pairMode.date, base, target)] ?? null
    return { rate, rateDate: pairMode.date, fromOverride: false }
  }
  const rate = ratesByKey[makeSwapRateKey(expenseDate, base, target)] ?? null
  return { rate, rateDate: expenseDate, fromOverride: false }
}

/**
 * Compute the unique provider lookups needed for a swap O -> N.
 *
 * - PerDate pairs: one key per expense date
 * - Fixed pairs with an override: none (user-typed rate)
 * - Fixed pairs without an override: the single chosen-date key
 */
export function computeSwapRateKeys(
  expenses: SwapExpenseInput[],
  oldCode: string,
  newCode: string,
  modes?: SwapRateModes,
): SwapRateKeyItem[] {
  const O = oldCode.toUpperCase()
  const N = newCode.toUpperCase()
  if (!O || !N || O === N) return []
  const seen = new Set<string>()
  const items: SwapRateKeyItem[] = []
  const push = (date: string, base: string, target: string) => {
    const key = makeSwapRateKey(date, base, target)
    if (seen.has(key)) return
    seen.add(key)
    items.push({ date, base: base.toUpperCase(), target: target.toUpperCase() })
  }
  const pushPair = (base: string, expenseDate: string) => {
    const pairMode = pairModeFor(modes, base, N)
    if (pairMode.mode === 'fixed') {
      if (pairMode.override != null && pairMode.override > 0) return
      push(pairMode.date, base, N)
      return
    }
    push(expenseDate, base, N)
  }
  for (const e of expenses) {
    const date = isoDateOf(e.expenseDate)
    const classified = classifySwapExpense(e, O, N)
    if (classified.lane === 'cleared') continue
    pushPair(classified.base, date)
  }
  return items
}

export function planSwapRows(
  expenses: SwapExpenseInput[],
  oldCode: string,
  newCode: string,
  modes: SwapRateModes | undefined,
  ratesByKey: Record<string, number>,
): PlannedSwapRow[] {
  const O = oldCode.toUpperCase()
  const N = newCode.toUpperCase()
  return expenses.map((e) => {
    const date = isoDateOf(e.expenseDate)
    const C = e.originalCurrency?.toUpperCase() ?? null
    const source = e.conversionSource ?? null
    const rOld = e.conversionRate == null ? null : Number(e.conversionRate)
    const lane = classifySwapExpense(e, O, N)

    if (lane.lane === 'simple') {
      const resolved = resolvePairRate(
        pairModeFor(modes, O, N),
        date,
        O,
        N,
        ratesByKey,
      )
      const rate = usableRate(resolved.rate)
      if (rate == null) {
        return {
          id: e.id,
          kind: 'simple' as const,
          oldAmount: e.amount,
          newAmount: e.amount,
          newOriginalAmount: null,
          newOriginalCurrency: null,
          newConversionRate: null,
          newConversionSource: null,
          rateUsed: null,
          rateDate: resolved.rateDate,
          warning: 'missing-rate',
        }
      }
      return {
        id: e.id,
        kind: 'simple' as const,
        oldAmount: e.amount,
        newAmount: convertMinorUnitsByRate(e.amount, rate, O, N),
        newOriginalAmount: null,
        newOriginalCurrency: null,
        newConversionRate: null,
        newConversionSource: null,
        rateUsed: rate,
        rateDate: resolved.rateDate,
      }
    }

    if (lane.lane === 'cleared') {
      return {
        id: e.id,
        kind: 'cleared' as const,
        oldAmount: e.amount,
        newAmount: e.originalAmount ?? e.amount,
        newOriginalAmount: null,
        newOriginalCurrency: null,
        newConversionRate: null,
        newConversionSource: null,
        rateUsed: null,
        rateDate: date,
      }
    }

    if (lane.lane === 'fresh') {
      const base = lane.base
      const resolved = resolvePairRate(
        pairModeFor(modes, base, N),
        date,
        base,
        N,
        ratesByKey,
      )
      const rate = usableRate(resolved.rate)
      if (rate == null) {
        return {
          id: e.id,
          kind: 'fresh' as const,
          oldAmount: e.amount,
          newAmount: e.amount,
          newOriginalAmount: e.originalAmount ?? null,
          newOriginalCurrency: e.originalCurrency ?? null,
          newConversionRate: rOld,
          newConversionSource: source,
          rateUsed: null,
          rateDate: resolved.rateDate,
          warning: 'missing-rate',
        }
      }
      return {
        id: e.id,
        kind: 'fresh' as const,
        oldAmount: e.amount,
        newAmount: convertMinorUnitsByRate(
          e.originalAmount ?? e.amount,
          rate,
          base,
          N,
        ),
        newOriginalAmount: e.originalAmount ?? null,
        newOriginalCurrency: e.originalCurrency ?? null,
        newConversionRate: rate,
        newConversionSource: 'EXCHANGE' as const,
        rateUsed: rate,
        rateDate: resolved.rateDate,
      }
    }

    const resolved = resolvePairRate(
      pairModeFor(modes, O, N),
      date,
      O,
      N,
      ratesByKey,
    )
    const bridgeRate = usableRate(resolved.rate)
    if (bridgeRate == null) {
      return {
        id: e.id,
        kind: 'bridged' as const,
        oldAmount: e.amount,
        newAmount: e.amount,
        newOriginalAmount: e.originalAmount ?? null,
        newOriginalCurrency: e.originalCurrency ?? null,
        newConversionRate: rOld,
        newConversionSource: bridgedSource(source),
        rateUsed: null,
        rateDate: resolved.rateDate,
        warning: 'missing-rate',
      }
    }
    const effectiveRate =
      rOld != null && Number.isFinite(rOld) && rOld > 0
        ? rOld * bridgeRate
        : bridgeRate
    const newSource: ConversionSource | null = bridgedSource(source)
    return {
      id: e.id,
      kind: 'bridged' as const,
      oldAmount: e.amount,
      newAmount: convertMinorUnitsByRate(
        e.originalAmount ?? e.amount,
        effectiveRate,
        C,
        N,
      ),
      newOriginalAmount: e.originalAmount ?? null,
      newOriginalCurrency: e.originalCurrency ?? null,
      newConversionRate: effectiveRate,
      newConversionSource: newSource,
      rateUsed: bridgeRate,
      rateDate: resolved.rateDate,
      warning: source === 'EXACT' ? 'exact-to-custom' : undefined,
    }
  })
}

/** Back-compat shim: global historic/custom expressed as per-pair modes. */
export function legacyModeToPairModes(
  mode: SwapRateMode,
  oldCode: string,
  newCode: string,
  expenses: SwapExpenseInput[],
): SwapRateModes {
  if (mode.type === 'historic') return {}
  const modes: SwapRateModes = {}
  for (const pair of computeSwapPairs(expenses, oldCode, newCode)) {
    modes[swapPairKey(pair.base, pair.target)] = {
      mode: 'fixed',
      date:
        pair.dates[pair.dates.length - 1] ??
        new Date().toISOString().slice(0, 10),
      override: mode.rate,
    }
  }
  return modes
}

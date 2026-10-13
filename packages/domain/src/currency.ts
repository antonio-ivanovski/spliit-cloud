import { Schema } from 'effect'

import currencies from './currencies.json' with { type: 'json' }

/**
 * Canonical currency record. Locale-specific display (name) is resolved by the
 * web app via i18n; the domain stays free of translation concerns.
 */
export type Currency = {
  code: string
  symbol: string
  aliases?: ReadonlyArray<string>
  rounding: number
  decimal_digits: number
  /**
   * Max absolute item/total gap in minor units that still counts as rounding
   * (per-line tax rounding, cash-step settlement) rather than a real mismatch.
   * Researched per currency against circulating denominations and cash-rounding
   * rules (e.g. USD 51, JPY 1, BHD 3, CHF 3); absent entries fall back to the
   * digit-based default in `roundingGapMinor`.
   */
  rounding_gap_minor?: number
  /**
   * Crypto assets (BTC, ETH, ...) vs fiat ISO currencies. Crypto assets trade
   * 24/7 and are quoted by the crypto rate provider instead of Frankfurter.
   */
  crypto?: boolean
  /**
   * Optional override for ordered bridge currencies when no direct crypto rate
   * exists. Absent entries use `DEFAULT_INTERMEDIARY_CURRENCIES` (`EUR`,
   * `USD`).
   */
  intermediaries?: ReadonlyArray<string>
  /**
   * Scale alias: one unit of this code equals `aliasScale` units of `aliasOf`
   * (e.g. 1 SAT = 1e-8 BTC). Rate lookups resolve through the parent code.
   */
  aliasOf?: string
  aliasScale?: number
  /**
   * Statutory fixed conversion for a withdrawn currency (e.g. BGN → EUR). The
   * code keeps market quotes before `effectiveFrom`; from that date on the
   * provider publishes no quotes and conversions resolve through `anchor` at
   * `unitsPerAnchor`. Absent for live currencies.
   */
  fixedConversion?: FixedConversion
}

/**
 * Machine-readable cause of a statutory fixed conversion, so UI can explain the
 * rate instead of attributing it to a market provider. `euro-adoption` is a
 * changeover into the euro; `redenomination` is same-currency re-basing (e.g.
 * TRY 2005, RON 2005); `replacement` is succession by a new code; `withdrawn`
 * is the generic fallback for any other withdrawal.
 */
export type FixedConversionReason =
  | 'euro-adoption'
  | 'redenomination'
  | 'replacement'
  | 'withdrawn'

export type FixedConversion = {
  /** Live successor code this code converts into at a fixed rate. */
  anchor: string
  /** Units of this code per 1 unit of `anchor` (e.g. 1.95583 BGN per EUR). */
  unitsPerAnchor: number
  /**
   * First date with no market quotes (`YYYY-MM-DD`); provider data ends the day
   * before. Comparisons are lexicographic (ISO dates).
   */
  effectiveFrom: string
  /** Why the code was withdrawn. */
  reason: FixedConversionReason
  /**
   * Per-currency reference for the withdrawal (e.g. the central bank's
   * changeover page). The FX provider metadata stays generic — a single
   * provider URL can never describe every withdrawal.
   */
  referenceUrl?: string
}

/** Default bridge order when composing rates through an intermediary. */
export const DEFAULT_INTERMEDIARY_CURRENCIES = ['EUR', 'USD'] as const

/**
 * Effect Schema for the statutory fixed-conversion table. Validates the shape
 * of `fixedConversion` rows in `currencies.json`: a live anchor, a positive
 * rate, an ISO withdrawal date, and a reason from the supported taxonomy.
 */
export const FixedConversionSchema = Schema.Struct({
  anchor: Schema.String,
  unitsPerAnchor: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
  effectiveFrom: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  ),
  reason: Schema.Literals([
    'euro-adoption',
    'redenomination',
    'replacement',
    'withdrawn',
  ]),
  referenceUrl: Schema.optional(Schema.String),
})

/**
 * Effect Schema for one currency catalog row. Unknown future fields would fail
 * here loudly at boot instead of slipping through as `any`-shaped data.
 */
export const CurrencySchema = Schema.Struct({
  code: Schema.String,
  symbol: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  rounding: Schema.Number,
  rounding_gap_minor: Schema.optional(Schema.Number),
  decimal_digits: Schema.Number,
  crypto: Schema.optional(Schema.Boolean),
  intermediaries: Schema.optional(Schema.Array(Schema.String)),
  aliasOf: Schema.optional(Schema.String),
  aliasScale: Schema.optional(Schema.Number),
  fixedConversion: Schema.optional(FixedConversionSchema),
})

/** Validated decode of the bundled `currencies.json` catalog. */
export const CurrencyListSchema = Schema.Array(CurrencySchema)

/**
 * Fail-fast catalog validation: a malformed row (bad anchor, rate, date, or
 * reason) throws at import time instead of producing silent mis-conversions.
 * Cross-row invariants (anchor exists and is itself live) are checked below.
 */
const decodedCatalog: ReadonlyArray<Currency> = Schema.decodeUnknownSync(
  CurrencyListSchema,
)(currencies) as ReadonlyArray<Currency>

for (const entry of decodedCatalog) {
  const fixed = entry.fixedConversion
  if (!fixed) continue
  if (!decodedCatalog.some((other) => other.code === fixed.anchor)) {
    throw new Error(
      `currencies.json: ${entry.code} fixedConversion anchor ${fixed.anchor} is not a catalog code`,
    )
  }
  if (fixed.anchor === entry.code) {
    throw new Error(
      `currencies.json: ${entry.code} fixedConversion anchor must differ from the code itself`,
    )
  }
  if (
    decodedCatalog.some(
      (other) =>
        other.code === fixed.anchor && other.fixedConversion !== undefined,
    )
  ) {
    throw new Error(
      `currencies.json: ${entry.code} fixedConversion anchor ${fixed.anchor} is itself withdrawn`,
    )
  }
}

/** True when `code` is a supported crypto asset (e.g. BTC, ETH, SAT). */
export function isCryptoCurrency(code: string): boolean {
  return byCode.get(code)?.crypto === true
}

/**
 * Ordered bridge currencies for `code`: the entry's explicit list when present,
 * otherwise `DEFAULT_INTERMEDIARY_CURRENCIES`.
 */
export function intermediaryCurrenciesFor(code: string): readonly string[] {
  return getCurrency(code)?.intermediaries ?? DEFAULT_INTERMEDIARY_CURRENCIES
}

/** Statutory fixed conversion for `code`, if it is a withdrawn currency. */
export function fixedConversionFor(code: string): FixedConversion | undefined {
  return byCode.get(code)?.fixedConversion
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Calendar day before an ISO `YYYY-MM-DD` date (UTC). */
export function dayBeforeIso(dateIso: string): string {
  const match = ISO_DATE_RE.exec(dateIso)
  if (!match) throw new Error(`Invalid date: ${dateIso}`)
  const ms =
    Date.UTC(
      Number(dateIso.slice(0, 4)),
      Number(dateIso.slice(5, 7)) - 1,
      Number(dateIso.slice(8, 10)),
    ) -
    24 * 60 * 60 * 1000
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Latest date with market quotes for a withdrawn currency: the calendar day
 * before its `effectiveFrom`. Returns null for live or unknown codes.
 */
export function lastAvailableDateBeforeFixed(code: string): string | null {
  const effectiveFrom = fixedConversionFor(code)?.effectiveFrom
  if (!effectiveFrom || !ISO_DATE_RE.test(effectiveFrom)) return null
  return dayBeforeIso(effectiveFrom)
}

/** Quote-leg provenance, mirroring the API/web `CurrencyRateSource` shape. */
export type RateProvenance = {
  provider: string
  base: string
  target: string
}

/**
 * User-facing warning about a resolved rate involving withdrawn currencies.
 * Pure and UI-agnostic: every surface (expense form, import wizard, converter,
 * pair card) derives the same warning from the same inputs.
 */
export type CurrencyRateWarning =
  | {
      kind: 'frozen-eol'
      /** Withdrawn codes involved in the pair. */
      codes: string[]
      /** Per-code withdrawal detail for copy + reference links. */
      details: FixedConversionDetail[]
      /** Quote date of the frozen provider rate (always < requestedDate). */
      frozenDate: string
    }
  | {
      kind: 'statutory-fixed' | 'triangulated-fixed'
      /** Withdrawn codes involved in the pair. */
      codes: string[]
      /** Per-code withdrawal detail for copy + reference links. */
      details: FixedConversionDetail[]
    }

export type FixedConversionDetail = {
  code: string
  anchor: string
  unitsPerAnchor: number
  effectiveFrom: string
  reason: FixedConversionReason
  referenceUrl?: string
}

/**
 * Withdrawal details for the withdrawn codes among `codes` (empty for live
 * pairs). Lets list-style surfaces (import wizard, swap tool) warn about a
 * withdrawn pair before any rate resolves.
 */
export function withdrawnDetailsFor(
  codes: ReadonlyArray<string>,
): FixedConversionDetail[] {
  return codes
    .map(fixedDetailFor)
    .filter((detail): detail is FixedConversionDetail => detail !== undefined)
}

function fixedDetailFor(code: string): FixedConversionDetail | undefined {
  const fixed = fixedConversionFor(code)
  if (!fixed) return undefined
  return {
    code,
    anchor: fixed.anchor,
    unitsPerAnchor: fixed.unitsPerAnchor,
    effectiveFrom: fixed.effectiveFrom,
    reason: fixed.reason,
    ...(fixed.referenceUrl ? { referenceUrl: fixed.referenceUrl } : {}),
  }
}

/**
 * Classify a resolved rate for user-facing warnings. Returns null when the rate
 * needs no escalation (no withdrawn code involved).
 *
 * - `frozen-eol`: a withdrawn code is involved but every leg is a market quote
 *   (`sources` has no `fixed` leg) while the quote date predates the request —
 *   the provider's last available quote, frozen at end-of-life.
 * - `statutory-fixed`: every leg is `fixed` and the rate is exact as of the
 *   requested date — a statutory table rate, not a market quote.
 * - `triangulated-fixed`: at least one `fixed` leg composed with live market legs
 *   — the fixed portion is exact, the rest floats.
 */
export function getCurrencyRateWarning(args: {
  base: string
  target: string
  requestedDate: string
  asOfDate: string
  sources: ReadonlyArray<RateProvenance>
}): CurrencyRateWarning | null {
  const { base, target, requestedDate, asOfDate, sources } = args
  if (sources.length === 0) return null
  const details = withdrawnDetailsFor([base, target])
  if (details.length === 0) return null
  const codes = details.map((detail) => detail.code)

  const hasFixedLeg = sources.some((source) => source.provider === 'fixed')
  if (!hasFixedLeg) {
    if (asOfDate >= requestedDate) return null
    return { kind: 'frozen-eol', codes, details, frozenDate: asOfDate }
  }
  const allFixedLegs = sources.every((source) => source.provider === 'fixed')
  if (allFixedLegs && asOfDate === requestedDate) {
    return { kind: 'statutory-fixed', codes, details }
  }
  return { kind: 'triangulated-fixed', codes, details }
}

/** All supported currencies, ordered by ISO code. Schema-validated at boot. */
export const currencyList: ReadonlyArray<Currency> = decodedCatalog

/**
 * ISO codes of every supported currency, inferred from the canonical
 * `currencies.json`. Add or remove a row in the JSON to update both the runtime
 * list and the compile-time union below.
 */
export const supportedCurrencyCodes = currencyList.map(
  (c) => c.code,
) as ReadonlyArray<(typeof currencyList)[number]['code']>
export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number]

const byCode = new Map<string, Currency>(currencyList.map((c) => [c.code, c]))

/** Look up a currency by its ISO code. Returns undefined for unknown codes. */
export function getCurrency(code: string): Currency | undefined {
  return byCode.get(code)
}

/**
 * Rounding-size threshold for `code`'s item/total gap, in minor units. Prefers
 * the researched per-currency `rounding_gap_minor` from `currencies.json`;
 * synthetic or unknown records (custom currencies, forward references) fall
 * back to the digit-based default (0 digits → 1, 3 digits → 3, high-precision
 * crypto → 1, everything else → 51).
 */
export function roundingGapMinor(currency: Currency): number {
  const value = currency.rounding_gap_minor
  if (Number.isSafeInteger(value) && (value as number) >= 1) {
    return value as number
  }
  if (currency.crypto) return 1
  if (currency.decimal_digits === 0) return 1
  if (currency.decimal_digits === 3) return 3
  return 51
}

/** Best-effort resolution of imported currency text to a supported ISO code. */
export function resolveCurrencyCode(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null

  const byTextCode = byCode.get(normalized.toUpperCase())
  if (byTextCode) return byTextCode.code

  const normalizedText = normalized.toLowerCase()
  const matches = currencyList.filter(
    (currency) =>
      currency.symbol.toLowerCase() === normalizedText ||
      currency.aliases?.some((alias) => alias.toLowerCase() === normalizedText),
  )
  return matches.length === 1 ? matches[0]!.code : null
}

/**
 * Resolve a group's stored currency into a canonical `Currency` record. For a
 * known `currencyCode` the canonical entry is returned; for a custom currency
 * (`currencyCode` empty) a synthetic record is built whose `symbol` is the
 * free-text `currency` value the user typed, so it can be displayed verbatim.
 * The returned record intentionally has no localized `name` — the web app is
 * responsible for adding one (or for the custom case, leaving `symbol` as the
 * user-visible label).
 */
export function getCurrencyFromGroup(group: {
  currency: string
  currencyCode?: string | null
}): Currency {
  if (!group.currencyCode) {
    return {
      code: '',
      symbol: group.currency,
      rounding: 0,
      decimal_digits: 2,
    }
  }
  return (
    byCode.get(group.currencyCode) ?? {
      code: group.currencyCode,
      symbol: group.currency,
      rounding: 0,
      decimal_digits: 2,
    }
  )
}

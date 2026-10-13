import { Effect, Layer } from 'effect'

import { exchangeRateLookupDate, utcTodayIso } from '@spliit/domain'
import {
  dayBeforeIso,
  fixedConversionFor,
  getCurrency,
  intermediaryCurrenciesFor,
  isCryptoCurrency,
  supportedCurrencyCodes,
} from '@spliit/domain/currency'

import { fetchCoinbaseSpot, type CryptoFetchImpl } from './crypto-rates'
import {
  CurrencyRateNotFoundError,
  CurrencyRateProviderError,
  UnsupportedCurrencyError,
} from './currency-errors'
import { fetchFrankfurterRates, type FiatFetchImpl } from './fiat-rates'
import { RateCache } from './fx/cache'
import {
  FxInvalidDate,
  FxRateNotFound,
  FxUnsupportedCurrency,
  type FxError,
} from './fx/errors'
import { CryptoRates, FiatRates } from './fx/providers'
import {
  clearRateCache,
  rateCacheKey,
  rateCacheSize,
  readRateCache,
} from './rate-cache'

// Frankfurter historical rates are immutable for past dates, and the
// future-date fallback (provider's latest available rate) only changes
// on weekdays. 24h is plenty to dedupe repeated form interactions.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
// Crypto spot prices for today's date move intraday; a short TTL keeps the
// rate fresh while past dates keep the standard 24h TTL.
const CRYPTO_TODAY_TTL_MS = 15 * 60 * 1000

/**
 * Upstream FX provider that supplied a quote leg. `fixed` is a statutory rate
 * from the currency catalog (withdrawn currencies, e.g. BGN → EUR) — not a
 * market quote.
 */
export type CurrencyRateProviderId = 'frankfurter' | 'coinbase' | 'fixed'

/** One provider quote that contributed to the resolved rate. */
export type CurrencyRateSource = {
  provider: CurrencyRateProviderId
  base: string
  target: string
  /**
   * True when the quote was fetched in the opposite orientation (`target→base`
   * on the provider) and inverted. The `base`/`target` fields always describe
   * the requested orientation so callers can match sources against their
   * request pair; `inverted` reveals the actual upstream quote direction.
   */
  inverted?: boolean
}

export type CurrencyRate = {
  /** Rate of 1 unit of `base` expressed in `target`. */
  rate: number
  /** ISO date the user asked for (YYYY-MM-DD). */
  requestedDate: string
  /**
   * ISO date the provider actually returned (YYYY-MM-DD). Differs from
   * `requestedDate` for future dates, weekends, and provider outages.
   */
  asOfDate: string
  base: string
  target: string
  /**
   * Ordered quote legs that compose this rate. - Direct: one entry (provider
   * that quoted `base`→`target`). - Bridged: two+ entries (e.g. BTC→EUR via
   * Coinbase, EUR→MKD via Frankfurter); intermediate codes are also listed in
   * `via`. - Same-currency / pure alias scale: empty (no external quote).
   */
  sources: CurrencyRateSource[]
  /**
   * Bridge currencies used to compose the rate when no direct pair exists (e.g.
   * `['EUR']` for BTC→MKD via BTC→EUR + EUR→MKD).
   */
  via?: string[]
}

/**
 * Services the FX engine resolves through. Layers are built per call from the
 * injected fetch impls so tests keep scripting provider responses.
 */
type FxEnv = FiatRates | CryptoRates | RateCache

function fxEnv(fetchImpl: FiatFetchImpl, cryptoFetchImpl: CryptoFetchImpl) {
  return Layer.mergeAll(
    FiatRates.Live(fetchImpl),
    CryptoRates.Live(cryptoFetchImpl),
    RateCache.Live,
  )
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const FX_FIAT_CONCURRENCY = 8
const FX_CRYPTO_CONCURRENCY = 8

// Re-exported for the file importer, which bounds its own document-promotion
// fan-out with the same semaphore. New code should import from
// `./concurrency` directly.
export { mapWithConcurrency } from './concurrency'

/**
 * Map an engine `FxError` back to the legacy thrown class the single-rate
 * boundary has always raised, so `getCurrencyRate` callers (and their
 * `instanceof` checks) see no change.
 */
function toLegacyError(err: FxError): Error {
  switch (err._tag) {
    case 'FxUnsupportedCurrency':
      return new UnsupportedCurrencyError(err.currency)
    case 'FxRateNotFound':
      return new CurrencyRateNotFoundError(err.target)
    case 'FxInvalidDate':
      return new CurrencyRateProviderError(`Invalid date: ${err.date}`)
    case 'FxProviderError':
      return new CurrencyRateProviderError(err.message)
  }
}

function assertSupported(code: string) {
  if (!(supportedCurrencyCodes as readonly string[]).includes(code)) {
    throw new UnsupportedCurrencyError(code)
  }
}

function assertSupportedFx(code: string): Effect.Effect<void, FxError> {
  if ((supportedCurrencyCodes as readonly string[]).includes(code)) {
    return Effect.void
  }
  return Effect.fail(new FxUnsupportedCurrency({ currency: code }))
}

function ttlForPair(date: string, involvesCrypto: boolean) {
  if (!involvesCrypto) return DEFAULT_TTL_MS
  return date >= utcTodayIso() ? CRYPTO_TODAY_TTL_MS : DEFAULT_TTL_MS
}

function sameCurrencyRate(date: string, base: string, target: string) {
  return {
    rate: 1,
    requestedDate: date,
    asOfDate: date,
    base,
    target,
    sources: [],
  } satisfies CurrencyRate
}

/** Expand scale aliases (SAT→BTC) so providers never see alias codes. */
function expandAlias(code: string): { code: string; scale: number } {
  const currency = getCurrency(code)
  if (currency?.aliasOf && currency.aliasOf !== code) {
    return { code: currency.aliasOf, scale: currency.aliasScale ?? 1 }
  }
  return { code, scale: 1 }
}

/** True when `date` is on/after the code's withdrawal date. */
function isPostEol(date: string, code: string): boolean {
  const from = fixedConversionFor(code)?.effectiveFrom
  return !!from && date >= from
}

/**
 * Latest date with joint market quotes for a fixed-involving pair: the day
 * before the earliest withdrawal among the involved codes (e.g. BGN↔HRK →
 * 2022-12-31, since HRK withdrew first). Null when neither side is withdrawn.
 */
function eolAttemptDate(base: string, target: string): string | null {
  const froms = [base, target]
    .map((code) => fixedConversionFor(code)?.effectiveFrom)
    .filter((from): from is string => !!from)
    .sort()
  if (froms.length === 0) return null
  return dayBeforeIso(froms[0]!)
}

type ResolveDeps = {
  date: string
  /** In-flight dedupe across a batch: race-safe memoized leg effects. */
  memo: Map<string, Effect.Effect<CurrencyRate | null, FxError, FxEnv>>
  /**
   * When false, withdrawn-currency fallbacks (frozen last quote, statutory
   * table) are skipped: post-withdrawal dates resolve as not-found instead.
   * Absent = allow (the historical always-fallback behavior).
   */
  allowFixedFallback?: boolean
}

/**
 * True when a resolved rate came from a withdrawn-currency fallback rather than
 * a genuine market quote: any `fixed` leg, or a quote frozen at the last
 * pre-withdrawal date for a post-withdrawal request. Strict lookups use this to
 * reject legacy-cached fallback entries (shared cache key) without a key format
 * change; pre-withdrawal weekend fallbacks still count as market.
 */
export function isFallbackComposed(rate: CurrencyRate): boolean {
  if (rate.sources.some((source) => source.provider === 'fixed')) return true
  for (const code of [rate.base, rate.target]) {
    const from = fixedConversionFor(code)?.effectiveFrom
    if (from && rate.requestedDate >= from && rate.asOfDate < from) return true
  }
  return false
}

function makeRate(
  date: string,
  base: string,
  target: string,
  rate: number,
  asOfDate: string,
  options: {
    sources?: CurrencyRateSource[]
    via?: string[]
  } = {},
): CurrencyRate {
  return {
    rate,
    requestedDate: date,
    asOfDate,
    base,
    target,
    sources: options.sources ?? [],
    ...(options.via?.length ? { via: options.via } : {}),
  }
}

/** Fiat↔fiat via Frankfurter only. Crypto codes are never passed here. */
const fetchFiatPair = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  const cache = yield* RateCache
  const fiat = yield* FiatRates
  const key = rateCacheKey(base, target, ctx.date)
  const cached = yield* cache.get(key)
  // Composed fallback results share the leg key namespace; strict lookups
  // must not mistake them for provider quotes.
  if (
    cached &&
    !(ctx.allowFixedFallback === false && isFallbackComposed(cached))
  )
    return cached

  const payload = yield* fiat.fetch(ctx.date, base, [target])
  const rate = payload.rates[target]
  if (typeof rate !== 'number') return null
  const result = makeRate(ctx.date, base, target, rate, payload.date, {
    sources: [{ provider: 'frankfurter', base, target }],
  })
  yield* cache.set(key, result, DEFAULT_TTL_MS)
  return result
})

/**
 * Crypto-involving spot via Coinbase: try direct orientation, then reverse.
 * Returns null when Coinbase has no quote for the pair (caller may bridge).
 */
const fetchCryptoPair = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  if (base === target) return sameCurrencyRate(ctx.date, base, target)

  const key = rateCacheKey(base, target, ctx.date)
  const inFlight = ctx.memo.get(key)
  if (inFlight) return yield* inFlight

  const computation = Effect.gen(function* () {
    const cache = yield* RateCache
    const crypto = yield* CryptoRates
    const cached = yield* cache.get(key)
    // Composed fallback results share the leg key namespace; strict lookups
    // must not mistake them for provider quotes.
    if (
      cached &&
      !(ctx.allowFixedFallback === false && isFallbackComposed(cached))
    )
      return cached
    const direct = yield* crypto.fetchSpot(ctx.date, base, target)
    if (direct !== null) {
      return makeRate(ctx.date, base, target, direct, ctx.date, {
        sources: [{ provider: 'coinbase', base, target }],
      })
    }
    const inverted = yield* crypto.fetchSpot(ctx.date, target, base)
    if (inverted !== null) {
      return makeRate(ctx.date, base, target, 1 / inverted, ctx.date, {
        // Requested orientation is preserved so callers can match sources
        // against their request pair; `inverted` marks the actual upstream
        // quote direction (target→base on Coinbase).
        sources: [{ provider: 'coinbase', base, target, inverted: true }],
      })
    }
    return null
  })
  // Race-safe: concurrent joiners share the single computation instead of
  // issuing duplicate provider calls for a repeated intermediary leg.
  const memoized = yield* Effect.cached(computation)
  ctx.memo.set(key, memoized)
  const result = yield* memoized
  if (result) {
    const cache = yield* RateCache
    yield* cache.set(key, result, ttlForPair(ctx.date, true))
  }
  return result
})

/**
 * One resolved leg after universe classification. Never calls the wrong
 * provider: fiat↔fiat → Frankfurter; any crypto side → Coinbase.
 */
const fetchClassifiedPair = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  a: string,
  b: string,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  if (a === b) return sameCurrencyRate(ctx.date, a, b)
  const aCrypto = isCryptoCurrency(a)
  const bCrypto = isCryptoCurrency(b)
  if (!aCrypto && !bCrypto) return yield* fetchFiatPair(ctx, a, b)
  return yield* fetchCryptoPair(ctx, a, b)
})

const bridgeViaIntermediaries = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
  list: readonly string[],
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  for (const intermediary of list) {
    if (intermediary === base || intermediary === target) continue
    // The two legs are independent provider calls — fetch them together.
    const [leg1, leg2] = yield* Effect.all(
      [
        fetchClassifiedPair(ctx, base, intermediary),
        fetchClassifiedPair(ctx, intermediary, target),
      ],
      { concurrency: 2 },
    )
    if (!leg1 || !leg2) continue
    // The composite rate is only as fresh as its oldest leg: propagate the
    // earliest asOfDate (e.g. a fiat leg that fell back to Friday for a
    // weekend request) so clients can still surface the stale-rate warning.
    // ISO YYYY-MM-DD dates compare lexicographically.
    const asOfDate =
      leg1.asOfDate < leg2.asOfDate ? leg1.asOfDate : leg2.asOfDate
    return makeRate(ctx.date, base, target, leg1.rate * leg2.rate, asOfDate, {
      via: [intermediary],
      sources: [...leg1.sources, ...leg2.sources],
    })
  }
  return null
})

/**
 * Latest provider quote for a withdrawn pair, frozen at the last date with
 * joint market data. `requestedDate` echoes the caller's lookup date while
 * `asOfDate` records the frozen quote's date, so clients surface the same
 * stale-rate signal as weekend fallbacks. Returns null when the provider has no
 * quote even there (caller falls back to the statutory table).
 */
const fetchEolFrozenPair = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  const eolDate = eolAttemptDate(base, target)
  if (!eolDate) return null
  const frozen = yield* fetchClassifiedPair(
    { ...ctx, date: eolDate },
    base,
    target,
  )
  if (!frozen) return null
  return makeRate(ctx.date, base, target, frozen.rate, frozen.asOfDate, {
    sources: frozen.sources,
    via: frozen.via,
  })
})

/** Live anchor quote consumed by the statutory composer below. */
type AnchorLeg = {
  rate: number
  asOfDate: string
  sources: CurrencyRateSource[]
  via?: string[]
}

/**
 * Statutory composer for pairs involving withdrawn currencies, built through
 * each side's anchor: 1 unit of a fixed code equals `1 / unitsPerAnchor` anchor
 * units. Pure anchor pairs need no provider call; cross pairs triangulate with
 * a live anchor quote supplied by `getLeg` (requested date — the anchor is a
 * live currency, so its leg tracks the market). Fixed legs are marked `fixed`,
 * never attributed to a market provider. Returns null when no static
 * composition exists (live anchor leg missing).
 */
const composeFixedRate = Effect.fnUntraced(function* (
  date: string,
  base: string,
  target: string,
  getLeg: (
    base: string,
    target: string,
  ) => Effect.Effect<AnchorLeg | null, FxError, FxEnv>,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  const baseFc = fixedConversionFor(base)
  const targetFc = fixedConversionFor(target)
  if (!baseFc && !targetFc) return null

  const fixedLeg = (code: string, anchor: string): CurrencyRateSource => ({
    provider: 'fixed',
    base: code,
    target: anchor,
  })

  // base→anchor / anchor→target orientation follows the requested pair.
  if (baseFc && target === baseFc.anchor) {
    return makeRate(date, base, target, 1 / baseFc.unitsPerAnchor, date, {
      sources: [fixedLeg(base, target)],
    })
  }
  if (targetFc && base === targetFc.anchor) {
    return makeRate(date, base, target, targetFc.unitsPerAnchor, date, {
      sources: [fixedLeg(base, target)],
    })
  }
  if (baseFc && targetFc && baseFc.anchor === targetFc.anchor) {
    const anchor = baseFc.anchor
    return makeRate(
      date,
      base,
      target,
      targetFc.unitsPerAnchor / baseFc.unitsPerAnchor,
      date,
      {
        via: [anchor],
        sources: [fixedLeg(base, anchor), fixedLeg(anchor, target)],
      },
    )
  }

  // One side fixed, or two fixed codes with different anchors: bridge through
  // the live anchor leg(s) at the requested date.
  const liveBase = baseFc ? baseFc.anchor : base
  const liveTarget = targetFc ? targetFc.anchor : target
  const live = yield* getLeg(liveBase, liveTarget)
  if (!live) return null
  const rate =
    live.rate *
    (baseFc ? 1 / baseFc.unitsPerAnchor : 1) *
    (targetFc ? targetFc.unitsPerAnchor : 1)
  const via = [
    ...(baseFc ? [baseFc.anchor] : []),
    ...(live.via ?? []),
    ...(targetFc ? [targetFc.anchor] : []),
  ]
  return makeRate(date, base, target, rate, live.asOfDate, {
    via: via.length > 0 ? via : undefined,
    sources: [
      ...(baseFc ? [fixedLeg(base, baseFc.anchor)] : []),
      ...live.sources,
      ...(targetFc ? [fixedLeg(targetFc.anchor, target)] : []),
    ],
  })
})

/**
 * Single-pair statutory fallback: the anchor leg resolves through the normal
 * classified providers with shared in-flight dedupe.
 */
const resolveFixedFallback = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
): Effect.fn.Return<CurrencyRate | null, FxError, FxEnv> {
  return yield* composeFixedRate(ctx.date, base, target, (legBase, legTarget) =>
    Effect.map(fetchClassifiedPair(ctx, legBase, legTarget), (leg) =>
      leg
        ? {
            rate: leg.rate,
            asOfDate: leg.asOfDate,
            sources: leg.sources,
            via: leg.via,
          }
        : null,
    ),
  )
})

/**
 * Resolve 1 `base` in `target` on `date`.
 *
 * Routing uses `crypto` metadata from the catalog: - fiat↔fiat → Frankfurter -
 * crypto↔fiat / crypto↔crypto → Coinbase (direct, then reverse) - on Coinbase
 * miss → bridge via EUR then USD (crypto leg Coinbase, fiat leg Frankfurter)
 * Aliases expand before any provider call.
 */
const resolveRate = Effect.fnUntraced(function* (
  ctx: ResolveDeps,
  base: string,
  target: string,
): Effect.fn.Return<CurrencyRate, FxError, FxEnv> {
  const cache = yield* RateCache
  const key = rateCacheKey(base, target, ctx.date)
  const cached = yield* cache.get(key)
  // Strict lookups must never serve a fallback-composed entry cached under
  // the shared key by an earlier fallback-allowed resolution.
  if (
    cached &&
    !(ctx.allowFixedFallback === false && isFallbackComposed(cached))
  )
    return cached

  if (base === target) return sameCurrencyRate(ctx.date, base, target)

  const baseAlias = expandAlias(base)
  const targetAlias = expandAlias(target)
  const scaledBase = baseAlias.code
  const scaledTarget = targetAlias.code
  // rate(aliasBase→aliasTarget) = rate(parentBase→parentTarget) × baseScale / targetScale
  const aliasScale = baseAlias.scale / targetAlias.scale

  if (scaledBase === scaledTarget) {
    return makeRate(ctx.date, base, target, aliasScale, ctx.date)
  }

  const involvesCrypto =
    isCryptoCurrency(scaledBase) || isCryptoCurrency(scaledTarget)
  const involvesFixed =
    !!fixedConversionFor(scaledBase) || !!fixedConversionFor(scaledTarget)

  const wrapScaled = Effect.fnUntraced(function* (
    rate: CurrencyRate,
  ): Effect.fn.Return<CurrencyRate, FxError, FxEnv> {
    const result = makeRate(
      ctx.date,
      base,
      target,
      rate.rate * aliasScale,
      rate.asOfDate,
      {
        sources: rate.sources,
        via: rate.via,
      },
    )
    const innerCache = yield* RateCache
    yield* innerCache.set(key, result, ttlForPair(ctx.date, involvesCrypto))
    return result
  })

  // Withdrawn currencies have no quotes on/after withdrawal: retry the last
  // quoted date first, then the statutory table — never the live pair.
  // Strict lookups skip both fallbacks and run the normal market path below,
  // so post-withdrawal dates resolve as not-found instead.
  if (
    ctx.allowFixedFallback !== false &&
    involvesFixed &&
    (isPostEol(ctx.date, scaledBase) || isPostEol(ctx.date, scaledTarget))
  ) {
    const frozen = yield* fetchEolFrozenPair(ctx, scaledBase, scaledTarget)
    if (frozen) return yield* wrapScaled(frozen)
    const fallback = yield* resolveFixedFallback(ctx, scaledBase, scaledTarget)
    if (fallback) return yield* wrapScaled(fallback)
    return yield* new FxRateNotFound({ target })
  }

  const direct = yield* fetchClassifiedPair(ctx, scaledBase, scaledTarget)
  if (direct) {
    const result = makeRate(
      ctx.date,
      base,
      target,
      direct.rate * aliasScale,
      direct.asOfDate,
      { sources: direct.sources, via: direct.via },
    )
    yield* cache.set(key, result, ttlForPair(ctx.date, involvesCrypto))
    return result
  }

  // Coinbase miss (unknown fiat quote, missing crypto-crypto pair, …) → bridge.
  // Prefer the fiat side's intermediary order for crypto↔fiat; crypto↔crypto
  // uses the base's list (defaults to EUR, USD).
  const baseIsCrypto = isCryptoCurrency(scaledBase)
  const targetIsCrypto = isCryptoCurrency(scaledTarget)
  const list =
    baseIsCrypto && targetIsCrypto
      ? intermediaryCurrenciesFor(scaledBase)
      : intermediaryCurrenciesFor(baseIsCrypto ? scaledTarget : scaledBase)

  const bridged = yield* bridgeViaIntermediaries(
    ctx,
    scaledBase,
    scaledTarget,
    list,
  )
  if (bridged) {
    const result = makeRate(
      ctx.date,
      base,
      target,
      bridged.rate * aliasScale,
      bridged.asOfDate,
      { sources: bridged.sources, via: bridged.via },
    )
    yield* cache.set(key, result, ttlForPair(ctx.date, involvesCrypto))
    return result
  }

  // Pre-withdrawal dates use market quotes when present; the statutory table
  // covers provider gaps for pegged codes (BGN tracked its euro peg).
  // Strict lookups skip this: a provider gap stays not-found.
  if (involvesFixed && ctx.allowFixedFallback !== false) {
    const fallback = yield* resolveFixedFallback(ctx, scaledBase, scaledTarget)
    if (fallback) return yield* wrapScaled(fallback)
  }

  return yield* new FxRateNotFound({ target })
})

/**
 * Resolve the rate of 1 unit of `base` in `target` on `date`. Cached in-process
 * keyed by `(date, base, target)`. Future dates are clamped to today (shared
 * `exchangeRateLookupDate` rule with the web preview and expense persistence),
 * so providers never see a future date; `requestedDate` echoes the clamped
 * date. Crypto pairs involving "today" use a shorter TTL.
 */
export async function getCurrencyRate({
  date,
  base,
  target,
  ttlMs = DEFAULT_TTL_MS,
  fetchImpl = fetchFrankfurterRates,
  cryptoFetchImpl = fetchCoinbaseSpot,
  allowFixedFallback = true,
}: {
  date: string
  base: string
  target: string
  ttlMs?: number
  fetchImpl?: FiatFetchImpl
  cryptoFetchImpl?: CryptoFetchImpl
  /**
   * When false, withdrawn-currency fallbacks are skipped (post-withdrawal dates
   * throw instead of resolving through the statutory table).
   */
  allowFixedFallback?: boolean
}): Promise<CurrencyRate> {
  if (!ISO_DATE_RE.test(date)) {
    throw new CurrencyRateProviderError(`Invalid date: ${date}`)
  }
  // Shared domain rule: future expense dates resolve at today's rate.
  // Clamped here (in addition to callers) so raw API use stays consistent;
  // idempotent for callers that already clamped.
  const lookupDate = exchangeRateLookupDate(date)
  assertSupported(base)
  assertSupported(target)

  const key = rateCacheKey(base, target, lookupDate)
  const cached = readRateCache<CurrencyRate>(key)
  if (cached && !(allowFixedFallback === false && isFallbackComposed(cached)))
    return cached

  const env = fxEnv(fetchImpl, cryptoFetchImpl)

  if (
    isCryptoCurrency(base) ||
    isCryptoCurrency(target) ||
    fixedConversionFor(base) ||
    fixedConversionFor(target)
  ) {
    const program = resolveRate(
      { date: lookupDate, memo: new Map(), allowFixedFallback },
      base,
      target,
    )
    try {
      return await Effect.runPromise(Effect.provide(program, env))
    } catch (err) {
      throw toLegacyError(err as FxError)
    }
  }

  // Pure fiat: single Frankfurter call (preserves prior asOfDate / ttlMs behaviour).
  const program = Effect.gen(function* () {
    const fiat = yield* FiatRates
    const cache = yield* RateCache
    const payload = yield* fiat.fetch(lookupDate, base, [target])
    const rate = payload.rates[target]
    if (typeof rate !== 'number') {
      return yield* new FxRateNotFound({ target })
    }
    const result = makeRate(lookupDate, base, target, rate, payload.date, {
      sources: [{ provider: 'frankfurter', base, target }],
    })
    yield* cache.set(key, result, ttlMs)
    return result
  })
  try {
    return await Effect.runPromise(Effect.provide(program, env))
  } catch (err) {
    throw toLegacyError(err as FxError)
  }
}

/** Test/utility export. Drops all cached entries. */
export function clearCurrencyRateCache() {
  clearRateCache()
}

/** Test/utility export. Entry count after TTL eviction. */
export function currencyRateCacheSize() {
  return rateCacheSize()
}

export type BatchRateRequest = {
  date: string
  base: string
  target: string
  /**
   * When false, this item skips withdrawn-currency fallbacks (frozen last
   * quote, statutory table) and resolves as RATE_NOT_FOUND instead. Absent =
   * allow (the historical always-fallback behavior).
   */
  allowFixedFallback?: boolean
}

/**
 * Discriminated union describing a single rate lookup outcome. Per-item
 * failures are returned alongside successes so the caller can block or surface
 * a specific message per offending expense instead of failing the whole batch.
 */
export type BatchRateResult =
  | { ok: true; rate: CurrencyRate }
  | {
      ok: false
      error:
        | { code: 'UNSUPPORTED_CURRENCY'; currency: string }
        | { code: 'RATE_NOT_FOUND'; target: string }
        | { code: 'INVALID_DATE'; date: string }
        | { code: 'PROVIDER_ERROR'; message: string }
    }

function fxErrorToBatchError(
  err: FxError,
): Extract<BatchRateResult, { ok: false }>['error'] {
  switch (err._tag) {
    case 'FxUnsupportedCurrency':
      return { code: 'UNSUPPORTED_CURRENCY', currency: err.currency }
    case 'FxRateNotFound':
      return { code: 'RATE_NOT_FOUND', target: err.target }
    case 'FxInvalidDate':
      return { code: 'INVALID_DATE', date: err.date }
    case 'FxProviderError':
      return { code: 'PROVIDER_ERROR', message: err.message }
  }
}

/**
 * Resolve multiple rates in parallel. Fiat-only requests are grouped by (date,
 * base) for one Frankfurter multi-quote call. Crypto-involving requests resolve
 * individually with shared in-flight sub-legs so repeated intermediaries
 * (BTC→EUR for BTC→MKD and BTC→BGN) cost a single provider call. Future dates
 * are clamped to today per item (same rule as `getCurrencyRate`).
 */
export async function getCurrencyRates(
  requests: BatchRateRequest[],
  options: {
    fetchImpl?: FiatFetchImpl
    cryptoFetchImpl?: CryptoFetchImpl
  } = {},
): Promise<BatchRateResult[]> {
  const fetchImpl = options.fetchImpl ?? fetchFrankfurterRates
  const cryptoFetchImpl = options.cryptoFetchImpl ?? fetchCoinbaseSpot

  const output: BatchRateResult[] = Array.from({ length: requests.length })
  type Key = string
  // Strict and fallback-allowed items resolve in separate groups: the same
  // triple can legitimately be requested both ways in one batch, and the
  // fallback pass below must not heal strict targets.
  const groupKey = (date: string, base: string, strict: boolean): Key =>
    `${date}|${base.toUpperCase()}|${strict ? 'strict' : 'allow'}`
  const groups = new Map<
    Key,
    {
      date: string
      base: string
      targets: string[]
      indicesByTarget: Map<string, number[]>
      strict: boolean
    }
  >()
  const cryptoGroups = new Map<
    Key,
    {
      date: string
      base: string
      target: string
      indices: number[]
      allowFixedFallback: boolean
    }
  >()
  let allCached = true
  requests.forEach((req, idx) => {
    const base = req.base.toUpperCase()
    const target = req.target.toUpperCase()
    const strict = req.allowFixedFallback === false
    // Shared domain rule: future dates resolve at today's rate. Clamp here so
    // raw batch callers stay consistent with the preview hooks and expense
    // persistence (both also clamp; double-clamping is idempotent). Invalid
    // dates are left untouched so downstream validation still reports
    // INVALID_DATE instead of silently resolving at today.
    const lookupDate = ISO_DATE_RE.test(req.date)
      ? exchangeRateLookupDate(req.date)
      : req.date
    const cached = readRateCache<CurrencyRate>(
      rateCacheKey(base, target, lookupDate),
    )
    if (cached && !(strict && isFallbackComposed(cached))) {
      output[idx] = { ok: true, rate: cached }
      return
    }
    allCached = false
    if (isCryptoCurrency(base) || isCryptoCurrency(target)) {
      // Strict and fallback-allowed resolutions must not share one effect:
      // the same triple can legitimately be requested both ways in a batch.
      const key = `${rateCacheKey(base, target, lookupDate)}|${strict ? 'strict' : 'allow'}`
      const existing = cryptoGroups.get(key)
      if (existing) {
        existing.indices.push(idx)
      } else {
        cryptoGroups.set(key, {
          date: lookupDate,
          base,
          target,
          indices: [idx],
          allowFixedFallback: !strict,
        })
      }
      return
    }
    const key = groupKey(lookupDate, base, strict)
    const existing = groups.get(key)
    if (existing) {
      if (!existing.indicesByTarget.has(target)) {
        existing.targets.push(target)
        existing.indicesByTarget.set(target, [])
      }
      existing.indicesByTarget.get(target)!.push(idx)
    } else {
      const indicesByTarget = new Map<string, number[]>()
      indicesByTarget.set(target, [idx])
      groups.set(key, {
        date: lookupDate,
        base,
        targets: [target],
        indicesByTarget,
        strict,
      })
    }
  })

  if (allCached) return output

  type ResolvedGroup = {
    byTarget: Map<string, BatchRateResult>
  }
  const resolvedByKey = new Map<Key, ResolvedGroup>()

  // Fiat groups run with a bounded concurrency cap so a 276-row import with
  // many distinct (date, base) pairs cannot open hundreds of simultaneous
  // upstream connections. Cache hits were already partitioned out above and
  // stay unthrottled.
  const fiatEffects = Array.from(groups.entries()).map(([key, group]) =>
    Effect.gen(function* () {
      const fiat = yield* FiatRates
      const cache = yield* RateCache
      const byTarget = new Map<string, BatchRateResult>()
      yield* assertSupportedFx(group.base)
      if (!ISO_DATE_RE.test(group.date)) {
        return yield* new FxInvalidDate({ date: group.date })
      }
      const payload = yield* fiat.fetch(group.date, group.base, group.targets)
      for (const target of group.targets) {
        const rate = payload.rates[target]
        if (typeof rate !== 'number') {
          byTarget.set(target, {
            ok: false,
            error: { code: 'RATE_NOT_FOUND', target },
          })
          continue
        }
        const result = makeRate(
          group.date,
          group.base,
          target,
          rate,
          payload.date,
          {
            sources: [
              {
                provider: 'frankfurter',
                base: group.base,
                target,
              },
            ],
          },
        )
        yield* cache.set(
          rateCacheKey(group.base, target, group.date),
          result,
          DEFAULT_TTL_MS,
        )
        byTarget.set(target, { ok: true, rate: result })
      }
      return { key, byTarget }
    }).pipe(
      Effect.catch((err: FxError) => {
        const byTarget = new Map<string, BatchRateResult>()
        for (const target of group.targets) {
          byTarget.set(target, {
            ok: false,
            error: fxErrorToBatchError(err),
          })
        }
        return Effect.succeed({ key, byTarget })
      }),
    ),
  )

  const memo = new Map<
    string,
    Effect.Effect<CurrencyRate | null, FxError, FxEnv>
  >()
  // Crypto groups fan out over distinct pairs just like fiat groups; bound
  // them with the same limiter so a many-pair batch cannot open unbounded
  // simultaneous upstream connections.
  const cryptoEffects = Array.from(cryptoGroups.values()).map(
    ({ date, base, target, indices, allowFixedFallback }) =>
      Effect.gen(function* () {
        yield* assertSupportedFx(base)
        yield* assertSupportedFx(target)
        if (!ISO_DATE_RE.test(date)) {
          return yield* new FxInvalidDate({ date })
        }
        const rate = yield* resolveRate(
          { date, memo, allowFixedFallback },
          base,
          target,
        )
        return {
          ok: true as const,
          indices,
          rate,
        }
      }).pipe(
        Effect.catch((err: FxError) =>
          Effect.succeed({
            ok: false as const,
            indices,
            error: fxErrorToBatchError(err),
          }),
        ),
      ),
  )

  const program = Effect.gen(function* () {
    // Fiat and crypto fan out together, each under its own concurrency cap.
    const [fiatSettled, cryptoSettled] = yield* Effect.all(
      [
        Effect.all(fiatEffects, { concurrency: FX_FIAT_CONCURRENCY }),
        Effect.all(cryptoEffects, { concurrency: FX_CRYPTO_CONCURRENCY }),
      ],
      { concurrency: 2 },
    )
    for (const { key, byTarget } of fiatSettled) {
      resolvedByKey.set(key, { byTarget })
    }
    yield* resolveFixedBatchFallbacks({ groups, resolvedByKey })
    return cryptoSettled
  })

  const cryptoResults = await Effect.runPromise(
    Effect.provide(program, fxEnv(fetchImpl, cryptoFetchImpl)),
  )
  for (const result of cryptoResults) {
    const entry: BatchRateResult = result.ok
      ? { ok: true, rate: result.rate }
      : { ok: false, error: result.error }
    for (const idx of result.indices) {
      output[idx] = entry
    }
  }

  for (const [key, group] of groups) {
    const { byTarget } = resolvedByKey.get(key)!
    for (const target of group.targets) {
      const result = byTarget.get(target)!
      for (const idx of group.indicesByTarget.get(target)!) {
        output[idx] = result
      }
    }
  }
  return output
}

type FiatBatchGroup = {
  date: string
  base: string
  targets: string[]
  indicesByTarget: Map<string, number[]>
  /** When true, this group's misses keep RATE_NOT_FOUND (no fixed fallback). */
  strict: boolean
}

/**
 * Second-chance pass for fixed-involving fiat pairs whose grouped provider
 * fetch missed. Post-withdrawal items retry once at the last quoted date —
 * collapsed by (eolDate, base) so a bulk import costs one extra call per base,
 * not per date — then everything still missing resolves through the statutory
 * composer with live anchor legs grouped by (date, anchor). Successes replace
 * the group's per-target result in place; misses keep their original error.
 */
const resolveFixedBatchFallbacks = Effect.fnUntraced(function* (args: {
  groups: Map<string, FiatBatchGroup>
  resolvedByKey: Map<string, { byTarget: Map<string, BatchRateResult> }>
}): Effect.fn.Return<void, FxError, FxEnv> {
  const fiat = yield* FiatRates
  const cache = yield* RateCache
  type StaticItem = { date: string; base: string; target: string }
  const staticItems: StaticItem[] = []
  const eolRetries = new Map<
    string,
    {
      date: string
      base: string
      items: Array<{ lookupDate: string; target: string }>
    }
  >()

  for (const group of args.groups.values()) {
    // Strict groups opted out of withdrawn-currency fallbacks: their
    // RATE_NOT_FOUND stands so the caller can surface a missing rate.
    if (group.strict) continue
    const groupKey = `${group.date}|${group.base}|allow`
    const { byTarget } = args.resolvedByKey.get(groupKey)!
    for (const target of group.targets) {
      if (byTarget.get(target)?.ok !== false) continue
      if (!fixedConversionFor(group.base) && !fixedConversionFor(target)) {
        continue
      }
      if (isPostEol(group.date, group.base) || isPostEol(group.date, target)) {
        const eolDate = eolAttemptDate(group.base, target)!
        const key = `${eolDate}|${group.base}`
        const item = { lookupDate: group.date, target }
        const existing = eolRetries.get(key)
        if (existing) existing.items.push(item)
        else
          eolRetries.set(key, {
            date: eolDate,
            base: group.base,
            items: [item],
          })
      } else {
        staticItems.push({ date: group.date, base: group.base, target })
      }
    }
  }

  if (eolRetries.size > 0) {
    // Each retry effect reports its own outcome; merging stays sequential
    // below so no shared array is mutated from concurrent fibers.
    const retryOutcomes = yield* Effect.all(
      Array.from(eolRetries.values()).map((retry) =>
        Effect.gen(function* () {
          const successes: Array<{
            lookupDate: string
            base: string
            target: string
            rate: CurrencyRate
          }> = []
          const missed: StaticItem[] = []
          const targets = [...new Set(retry.items.map((item) => item.target))]
          const payload = yield* fiat
            .fetch(retry.date, retry.base, targets)
            .pipe(
              Effect.catch((err: FxError) =>
                err._tag === 'FxProviderError'
                  ? Effect.succeed(null)
                  : Effect.fail(err),
              ),
            )
          if (payload === null) {
            for (const item of retry.items) {
              missed.push({
                date: item.lookupDate,
                base: retry.base,
                target: item.target,
              })
            }
            return { successes, missed }
          }
          for (const item of retry.items) {
            const rate = payload.rates[item.target]
            if (typeof rate !== 'number') {
              missed.push({
                date: item.lookupDate,
                base: retry.base,
                target: item.target,
              })
              continue
            }
            successes.push({
              lookupDate: item.lookupDate,
              base: retry.base,
              target: item.target,
              rate: makeRate(
                item.lookupDate,
                retry.base,
                item.target,
                rate,
                payload.date,
                {
                  sources: [
                    {
                      provider: 'frankfurter',
                      base: retry.base,
                      target: item.target,
                    },
                  ],
                },
              ),
            })
          }
          return { successes, missed }
        }),
      ),
      { concurrency: FX_FIAT_CONCURRENCY },
    )
    for (const outcome of retryOutcomes) {
      for (const missed of outcome.missed) {
        staticItems.push(missed)
      }
      for (const success of outcome.successes) {
        yield* cache.set(
          rateCacheKey(success.base, success.target, success.lookupDate),
          success.rate,
          DEFAULT_TTL_MS,
        )
        args.resolvedByKey
          .get(`${success.lookupDate}|${success.base}|allow`)!
          .byTarget.set(success.target, { ok: true, rate: success.rate })
      }
    }
  }

  if (staticItems.length === 0) return

  // Live anchor legs grouped by (date, base): one provider call each.
  const anchorLegOf = (
    item: StaticItem,
  ): { date: string; base: string; target: string } | null => {
    const baseFc = fixedConversionFor(item.base)
    const targetFc = fixedConversionFor(item.target)
    if (baseFc && item.target === baseFc.anchor) return null
    if (targetFc && item.base === targetFc.anchor) return null
    if (baseFc && targetFc && baseFc.anchor === targetFc.anchor) return null
    return {
      date: item.date,
      base: baseFc ? baseFc.anchor : item.base,
      target: targetFc ? targetFc.anchor : item.target,
    }
  }
  const anchorGroups = new Map<
    string,
    { date: string; base: string; targets: string[] }
  >()
  for (const item of staticItems) {
    const leg = anchorLegOf(item)
    if (!leg) continue
    const key = `${leg.date}|${leg.base}`
    const existing = anchorGroups.get(key)
    if (existing) {
      if (!existing.targets.includes(leg.target)) {
        existing.targets.push(leg.target)
      }
    } else {
      anchorGroups.set(key, {
        date: leg.date,
        base: leg.base,
        targets: [leg.target],
      })
    }
  }
  const anchorLegs = new Map<string, AnchorLeg>()
  const anchorOutcomes = yield* Effect.all(
    Array.from(anchorGroups.values()).map((anchor) =>
      Effect.gen(function* () {
        const entries: Array<{ key: string; leg: AnchorLeg }> = []
        const payload = yield* fiat
          .fetch(anchor.date, anchor.base, anchor.targets)
          .pipe(
            Effect.catch((err: FxError) =>
              err._tag === 'FxProviderError'
                ? Effect.succeed(null)
                : Effect.fail(err),
            ),
          )
        if (payload === null) return entries
        for (const target of anchor.targets) {
          const rate = payload.rates[target]
          if (typeof rate !== 'number') continue
          entries.push({
            key: rateCacheKey(anchor.base, target, anchor.date),
            leg: {
              rate,
              asOfDate: payload.date,
              sources: [{ provider: 'frankfurter', base: anchor.base, target }],
            },
          })
        }
        return entries
      }),
    ),
    { concurrency: FX_FIAT_CONCURRENCY },
  )
  for (const entries of anchorOutcomes) {
    for (const { key, leg } of entries) {
      anchorLegs.set(key, leg)
    }
  }

  for (const item of staticItems) {
    const composed = yield* composeFixedRate(
      item.date,
      item.base,
      item.target,
      (legBase, legTarget) =>
        Effect.succeed(
          anchorLegs.get(rateCacheKey(legBase, legTarget, item.date)) ?? null,
        ),
    )
    if (!composed) continue
    yield* cache.set(
      rateCacheKey(item.base, item.target, item.date),
      composed,
      DEFAULT_TTL_MS,
    )
    args.resolvedByKey
      .get(`${item.date}|${item.base}|allow`)!
      .byTarget.set(item.target, { ok: true, rate: composed })
  }
})

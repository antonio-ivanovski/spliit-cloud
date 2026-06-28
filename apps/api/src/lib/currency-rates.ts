import { supportedCurrencyCodes } from '@spliit/domain/currency'

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2'
const MAX_ENTRIES = 256
// Frankfurter historical rates are immutable for past dates, and the
// future-date fallback (provider's latest available rate) only changes
// on weekdays. 24h is plenty to dedupe repeated form interactions.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

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
}

export class UnsupportedCurrencyError extends Error {
  constructor(code: string) {
    super(`Unsupported currency code: ${code}`)
    this.name = 'UnsupportedCurrencyError'
  }
}

export class CurrencyRateNotFoundError extends Error {
  constructor(target: string) {
    super(`Provider did not return a rate for target ${target}`)
    this.name = 'CurrencyRateNotFoundError'
  }
}

export class CurrencyRateProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CurrencyRateProviderError'
  }
}

type CacheEntry = {
  value: CurrencyRate
  expiresAt: number
}

const store: Map<string, CacheEntry> = new Map()

function cacheKey(base: string, target: string, date: string) {
  return `${date}|${base}|${target}`
}

function evictExpired(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

function enforceCapacity() {
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value as string | undefined
    if (!oldestKey) break
    store.delete(oldestKey)
  }
}

function readCache(key: string): CurrencyRate | null {
  const now = Date.now()
  evictExpired(now)
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    store.delete(key)
    return null
  }
  return entry.value
}

function writeCache(key: string, value: CurrencyRate, ttlMs: number) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
  enforceCapacity()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertSupported(code: string) {
  if (!(supportedCurrencyCodes as readonly string[]).includes(code)) {
    throw new UnsupportedCurrencyError(code)
  }
}

type FrankfurterResponse = {
  base: string
  date: string
  rates: Record<string, number>
}

// v2 returns a flat array of one row per (date, base, quote) triple instead
// of v1's `{ base, date, rates: Record<quote, rate> }` object. We translate
// it back into the v1 shape here so the rest of the module is unchanged.
type FrankfurterV2Entry = {
  date: string
  base: string
  quote: string
  rate: number
}

async function fetchFromProvider(
  date: string,
  base: string,
): Promise<FrankfurterResponse> {
  let res: Response
  try {
    res = await fetch(`${FRANKFURTER_BASE_URL}/rates?date=${date}&base=${base}`)
  } catch (err) {
    throw new CurrencyRateProviderError(
      'Currency rate provider request failed',
      err,
    )
  }
  if (!res.ok) {
    throw new CurrencyRateProviderError(
      `Currency rate provider returned ${res.status}`,
    )
  }
  const entries = (await res.json()) as FrankfurterV2Entry[]
  const rates: Record<string, number> = {}
  for (const entry of entries) {
    rates[entry.quote] = entry.rate
  }
  return {
    base,
    // The provider may fall back to a different (most recent available)
    // date for currencies that lack data on the requested day; pick the
    // first row's date so callers can record the actual as-of date.
    date: entries[0]?.date ?? date,
    rates,
  }
}

/**
 * Resolve the rate of 1 unit of `base` in `target` on `date`. The result is
 * cached in-process keyed by `(date, base, target)`. Past dates are cached
 * because Frankfurter historical rates are immutable; future dates are also
 * cached because the provider's latest-available fallback only moves on
 * weekdays.
 */
export async function getCurrencyRate({
  date,
  base,
  target,
  ttlMs = DEFAULT_TTL_MS,
  fetchImpl = fetchFromProvider,
}: {
  date: string
  base: string
  target: string
  ttlMs?: number
  fetchImpl?: (date: string, base: string) => Promise<FrankfurterResponse>
}): Promise<CurrencyRate> {
  if (!ISO_DATE_RE.test(date)) {
    throw new CurrencyRateProviderError(`Invalid date: ${date}`)
  }
  assertSupported(base)
  assertSupported(target)

  const key = cacheKey(base, target, date)
  const cached = readCache(key)
  if (cached) return cached

  const payload = await fetchImpl(date, base)
  const rate = payload.rates[target]
  if (typeof rate !== 'number') {
    throw new CurrencyRateNotFoundError(target)
  }
  const result: CurrencyRate = {
    rate,
    requestedDate: date,
    asOfDate: payload.date,
    base,
    target,
  }
  writeCache(key, result, ttlMs)
  return result
}

/** Test/utility export. Drops all cached entries. */
export function clearCurrencyRateCache() {
  store.clear()
}

/** Test/utility export. Entry count after TTL eviction. */
export function currencyRateCacheSize() {
  evictExpired(Date.now())
  return store.size
}

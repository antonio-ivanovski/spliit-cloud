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
  constructor(readonly code: string) {
    super(`Unsupported currency code: ${code}`)
    this.name = 'UnsupportedCurrencyError'
  }
}

export class CurrencyRateNotFoundError extends Error {
  constructor(readonly target: string) {
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

export type { FrankfurterResponse }

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
  quotes?: string[],
): Promise<FrankfurterResponse> {
  let res: Response
  try {
    const params = new URLSearchParams({ date, base })
    if (quotes?.length) {
      params.set('quotes', Array.from(new Set(quotes)).join(','))
    }
    res = await fetch(`${FRANKFURTER_BASE_URL}/rates?${params.toString()}`)
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
  fetchImpl?: (
    date: string,
    base: string,
    quotes?: string[],
  ) => Promise<FrankfurterResponse>
}): Promise<CurrencyRate> {
  if (!ISO_DATE_RE.test(date)) {
    throw new CurrencyRateProviderError(`Invalid date: ${date}`)
  }
  assertSupported(base)
  assertSupported(target)

  const key = cacheKey(base, target, date)
  const cached = readCache(key)
  if (cached) return cached

  const payload = await fetchImpl(date, base, [target])
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

export type BatchRateRequest = {
  date: string
  base: string
  target: string
}

/**
 * Discriminated union describing a single rate lookup outcome. Per-item
 * failures are returned alongside successes so the caller can block or
 * surface a specific message per offending expense instead of failing the
 * whole batch.
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

/**
 * Resolve multiple rates in parallel. The requests are grouped by
 * (date, base) so a single batch with N targets on the same (date, base)
 * costs one upstream call — Frankfurter's bulk endpoint returns every
 * quote for a base in one response, and we extract the requested targets
 * from there. Per-target failures are returned alongside successes so
 * the caller can block on a specific expense without aborting the batch.
 *
 * `fetchImpl` is test-only and defaults to the live provider; it lets
 * unit tests swap in a stub for the upstream call.
 */
export async function getCurrencyRates(
  requests: BatchRateRequest[],
  options: {
    fetchImpl?: (
      date: string,
      base: string,
      quotes?: string[],
    ) => Promise<FrankfurterResponse>
  } = {},
): Promise<BatchRateResult[]> {
  const fetchImpl = options.fetchImpl ?? fetchFromProvider

  // Group requests by (date, base) so each upstream call is shared by
  // every target that pair covers. We preserve the original input order
  // in the returned array.
  type Key = string
  const groupKey = (date: string, base: string): Key =>
    `${date}|${base.toUpperCase()}`
  const groups = new Map<
    Key,
    {
      date: string
      base: string
      targets: string[]
      indicesByTarget: Map<string, number[]>
    }
  >()
  requests.forEach((req, idx) => {
    const base = req.base.toUpperCase()
    const target = req.target.toUpperCase()
    const key = groupKey(req.date, base)
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
        date: req.date,
        base,
        targets: [target],
        indicesByTarget,
      })
    }
  })

  type ResolvedGroup = {
    byTarget: Map<string, BatchRateResult>
  }
  const resolvedByKey = new Map<Key, ResolvedGroup>()

  await Promise.all(
    Array.from(groups.entries()).map(async ([key, group]) => {
      const byTarget = new Map<string, BatchRateResult>()
      try {
        // Currency and date validation happen up here so the provider
        // is never called for unsupported codes or malformed dates.
        assertSupported(group.base)
        if (!ISO_DATE_RE.test(group.date)) {
          throw new CurrencyRateProviderError(`Invalid date: ${group.date}`)
        }

        const payload = await fetchImpl(group.date, group.base, group.targets)
        for (const target of group.targets) {
          const rate = payload.rates[target]
          if (typeof rate !== 'number') {
            byTarget.set(target, {
              ok: false,
              error: { code: 'RATE_NOT_FOUND', target },
            })
            continue
          }
          const result: CurrencyRate = {
            rate,
            requestedDate: group.date,
            asOfDate: payload.date,
            base: group.base,
            target,
          }
          writeCache(
            cacheKey(group.base, target, group.date),
            result,
            DEFAULT_TTL_MS,
          )
          byTarget.set(target, { ok: true, rate: result })
        }
      } catch (err) {
        for (const target of group.targets) {
          byTarget.set(target, {
            ok: false,
            error: classifyBatchError(err, group.date, target),
          })
        }
      }
      resolvedByKey.set(key, { byTarget })
    }),
  )

  const output: BatchRateResult[] = new Array(requests.length)
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

function classifyBatchError(
  err: unknown,
  date: string,
  _target: string,
): Extract<BatchRateResult, { ok: false }>['error'] {
  if (err instanceof UnsupportedCurrencyError) {
    return { code: 'UNSUPPORTED_CURRENCY', currency: err.code }
  }
  if (err instanceof CurrencyRateNotFoundError) {
    return { code: 'RATE_NOT_FOUND', target: err.target }
  }
  if (err instanceof CurrencyRateProviderError) {
    return { code: 'PROVIDER_ERROR', message: err.message }
  }
  if (err instanceof Error && /Invalid date/.test(err.message)) {
    return { code: 'INVALID_DATE', date }
  }
  return {
    code: 'PROVIDER_ERROR',
    message: err instanceof Error ? err.message : String(err),
  }
}

/**
 * Best-effort split-mode guess from pre-computed paidFor shares.
 *
 * The parsers always produce paidFor.shares as exact integer cents summing
 * to amountCents (with drift correction applied).  Each guesser inspects the
 * distribution and returns a `splitMode` label — or `null` to let the next
 * guesser in the chain have a go.
 *
 * All guessers are **read-only**: they never modify the shares.  The caller
 * is responsible for setting `splitMode` on the expense.
 *
 * Each guesser accepts its own configuration so that the behaviour can be
 * tuned (e.g. by a future import-wizard step) without touching the parsers.
 */

export type PaidForEntry = { sourceId: string; shares: number }

// ── Shared helpers ────────────────────────────────────────────────────────

export type SplitMode = 'EVENLY' | 'BY_SHARES' | 'BY_AMOUNT'

function gcd2(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

export function gcdOf(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((g, v) => gcd2(g, v), values[0])
}

// ── guessEvenly ───────────────────────────────────────────────────────────

export type GuessEvenlyConfig = {
  /**
   * When `true`, shares within ±1 cent of each other are treated as
   * "evenly split" (the old heuristic from before 2025-07-04).
   *
   * **Warning:** enabling this can reintroduce the EVENLY drift bug
   * (getBalances reflows via amount/N with floating-point, losing the
   * exact cent distribution that the parser painstakingly computed).
   * The default is `false` — only truly identical shares are EVENLY.
   *
   * @default false
   */
  allowOneCentDrift?: boolean

  /**
   * Total number of unique participants involved in this expense
   * (the union of paidBy and paidFor).
   *
   * Defaults to `paidFor.length`.  Setting this is only needed when
   * `paidFor` has fewer entries than the true participant count —
   * e.g. a 1‑to‑1 payment where the payer consumed no share and is
   * therefore absent from `paidFor`.  In that case `paidFor.length === 1`
   * but `involvedParticipantCount === 2`, and the split is recognised as
   * an even 50/50.
   */
  involvedParticipantCount?: number
}

/**
 * Detect an even split.
 *
 * Returns `'EVENLY'` when all shares are identical (or within ±1 cent
 * when `allowOneCentDrift` is enabled), or when the expense involves
 * exactly two participants and `paidFor` contains a single entry
 * (the payer absorbed the full amount — implied 50/50).
 */
export function guessEvenly(
  paidFor: readonly PaidForEntry[],
  _amountCents: number,
  config?: GuessEvenlyConfig,
): 'EVENLY' | null {
  const involved = config?.involvedParticipantCount ?? paidFor.length

  // ── 1-to-1 payment ──────────────────────────────────────────────────
  // When the payer consumed nothing, paidFor has a single entry (the
  // receiver).  If the expense involves exactly two participants overall,
  // the split is implicitly 50/50 → EVENLY.
  if (paidFor.length === 1 && involved === 2) return 'EVENLY'

  if (paidFor.length < 2) return null

  const shares = paidFor.map((p) => p.shares)
  const first = shares[0]

  if (config?.allowOneCentDrift) {
    // Old heuristic: all shares within ±1 cent of the first.
    if (shares.every((s) => Math.abs(s - first) <= 1)) return 'EVENLY'
  } else {
    // Strict equality — only when the amount is perfectly divisible by N
    // (so EVENLY's amount/N recomputation is exact, no drift).
    if (shares.every((s) => s === first)) return 'EVENLY'
  }

  return null
}

// ── guessByShares ─────────────────────────────────────────────────────────

export type GuessBySharesConfig = {
  /**
   * Maximum normalized weight.  Ratios whose largest weight exceeds this
   * value are considered "not humanly sane" (merely large round numbers
   * with a coincidental GCD) and fall through to BY_AMOUNT.
   *
   * For example, shares [20000, 10000] have GCD=10000 → weights [2, 1],
   * which fits under any reasonable cap.  But shares [200000, 100000]
   * with GCD=100000 → weights still [2, 1] also fits.  The cap filters
   * ratios where the individual weights are implausibly large — e.g.
   * [300, 200, 100] → GCD=100 → weights [3, 2, 1] is fine, but
   * [99999, 33333] → GCD=33333 → weights [3, 1] is also fine (weights
   * themselves are small).  The cap is on the *normalised weight*, not
   * the original cent values.
   *
   * @default 25
   */
  maxWeight?: number
}

const DEFAULT_MAX_WEIGHT = 25

/**
 * Detect a clean integer-ratio split (BY_SHARES).
 *
 * Normalises the cents via their GCD and checks that the resulting
 * weights are "sane" (max weight ≤ `maxWeight`, default 25).
 */
export function guessByShares(
  paidFor: readonly PaidForEntry[],
  _amountCents: number,
  config?: GuessBySharesConfig,
): 'BY_SHARES' | null {
  if (paidFor.length < 2) return null

  const shares = paidFor.map((p) => p.shares)
  const g = gcdOf(shares)
  if (g <= 1) return null

  const maxWeight = Math.max(...shares.map((s) => s / g))
  const cap = config?.maxWeight ?? DEFAULT_MAX_WEIGHT
  if (maxWeight > cap) return null

  return 'BY_SHARES'
}

// ── Composite guesser ─────────────────────────────────────────────────────

export type GuessSplitModeConfig = GuessEvenlyConfig & GuessBySharesConfig

/**
 * Best-effort split-mode guess — chains `guessEvenly` and `guessByShares`,
 * falling back to `'BY_AMOUNT'` when neither rule matches.
 *
 * Accepts combined configuration for all guessers:
 *
 * ```ts
 * guessSplitMode(paidFor, amountCents)
 * guessSplitMode(paidFor, amountCents, { allowOneCentDrift: true, maxWeight: 30 })
 * ```
 */
export function guessSplitMode(
  paidFor: readonly PaidForEntry[],
  amountCents: number,
  config?: GuessSplitModeConfig,
): SplitMode {
  return (
    guessEvenly(paidFor, amountCents, config) ??
    guessByShares(paidFor, amountCents, config) ??
    'BY_AMOUNT'
  )
}

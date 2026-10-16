/**
 * Shared expense tail for group importers: major-unit owed/advanced maps in,
 * `paidBy`/`paidFor`/`splitMode` out.
 *
 * Every tabular parser ends the same way: serialize amounts through the domain
 * totals core, pin rounding remainder to the payer, then guess the split mode.
 * This module is the single implementation for that tail — pure, no Effect, no
 * provider knowledge. Category maps, recurrence, and original-amount recovery
 * stay per-provider.
 *
 * Three entry points cover the observed owed shapes (the Sesterce constraint
 * set):
 *
 * - `buildOwedExpense` — per-member owed amounts in major units
 *   (tricount/settleup shape: `Paid by X` advanced, `Paid for X` owed).
 *   Remainder pins to the payer.
 * - `buildNetExpense` — signed per-member nets in major units, payer paid the
 *   full `amountCents` (splitwise shape: cell = `Paid - Owe`; spliit shape:
 *   net-balance columns). Debtors owe their negative net; the payer absorbs the
 *   positive residual so Σ paidFor === amountCents exactly.
 * - `buildWeightedExpense` — cospend member weights (not money; upstream treats
 *   0/missing as 1), passed as `weights`. Equal weights split evenly; unequal
 *   weights become a BY_SHARES ratio (GCD-reduced, capped); implausibly large
 *   ratios fall back to exact cents (BY_AMOUNT). The payer always advances the
 *   full amount.
 */

import type { Currency } from '../currency'
import { distributeRemainder } from '../remainder-distribution'
import { SHARE_SCALE } from '../shares'
import {
  calculateExactShares,
  serializePaidBy,
  serializePaidFor,
} from '../totals'
import type { PaidForEntry } from './split-guess'
import { gcdOf, guessSplitMode, MAX_SHARE_WEIGHT } from './split-guess'
import type { NormalizedSourceExpense } from './types'

export type OwedExpenseInput = {
  /** Expense total in minor units (cents). */
  amountCents: number
  currency: Currency
  /** Per-participant owed amounts in major units (may be fractional). */
  owedMajors: ReadonlyMap<string, number>
  /** Per-participant advanced amounts in major units. Empty = payer only. */
  advancedMajors?: ReadonlyMap<string, number>
  payerId: string
}

export type BuiltOwedExpense = Pick<
  NormalizedSourceExpense,
  'paidBySourceId' | 'paidBy' | 'paidFor' | 'splitMode'
>

/**
 * Serialize owed major-unit entries to integer minor units via the totals core.
 * With the default `pinRemainderToPayer`, any rounding remainder lands on the
 * payer (tricount/settleup behavior: the payer absorbs the residual so Σ
 * paidFor === amountCents exactly). Pass false for the signed-net shape
 * (splitwise/spliit): there the owed subset is partial by construction and the
 * caller distributes the remaining share across the positive members instead.
 */
function serializeOwedCents(
  owedMajors: Iterable<readonly [string, number]>,
  amountCents: number,
  currency: Currency,
  payerId: string,
  pinRemainderToPayer = true,
): Map<string, number> {
  const paidForSerialized = serializePaidFor({
    splitMode: 'BY_AMOUNT',
    amount: amountCents,
    currency,
    paidFor: [...owedMajors]
      .filter(([, share]) => share > 0)
      .map(([sourceId, share]) => ({
        participant: { id: sourceId },
        shares: share,
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
  if (!pinRemainderToPayer) return paidForCents
  const owedTotal = [...paidForCents.values()].reduce((sum, v) => sum + v, 0)
  const remainder = amountCents - owedTotal
  if (remainder !== 0) {
    const exact = calculateExactShares({
      amount: Math.abs(remainder),
      splitMode: 'EVENLY',
      participants: [{ id: payerId, shares: 1 }],
    })
    const fixed = distributeRemainder(exact, Math.abs(remainder))
    const extra = fixed[payerId] ?? 0
    if (extra > 0) {
      paidForCents.set(
        payerId,
        (paidForCents.get(payerId) ?? 0) + (remainder > 0 ? extra : -extra),
      )
    }
  }
  return paidForCents
}

/**
 * Totally-empty paidFor fallback: nothing is owed. Zero totals return an
 * explicit empty shape (the destination validator requires paidFor.shares > 0,
 * so callers skip zero expenses themselves); non-zero totals pin the full
 * amount to the payer. Returns the replacement list, or null when the input
 * already has entries.
 */
function emptyPaidForFallback(
  paidForCents: ReadonlyMap<string, number>,
  amountCents: number,
  payerId: string,
): PaidForEntry[] | null {
  const paidFor = [...paidForCents.entries()]
    .filter(([, shares]) => shares > 0)
    .map(([sourceId, shares]) => ({ sourceId, shares }))
  if (paidFor.length > 0) return null
  if (amountCents === 0) {
    return []
  }
  return [{ sourceId: payerId, shares: amountCents }]
}

/**
 * Zero-total full shape for the net builder: nothing is owed and there is
 * nothing to split, so both sides stay explicit-zero.
 */
function zeroNetShape(payerId: string): BuiltOwedExpense {
  return {
    paidBySourceId: payerId,
    paidBy: [{ sourceId: payerId, shares: 0 }],
    paidFor: [],
    splitMode: 'BY_AMOUNT',
  }
}

/**
 * PaidBy tail shared by the owed and net builders: serialize advanced
 * major-unit entries through the totals core and reconcile to the exact total,
 * pinning remainder to the payer.
 *
 * `dropNonPositive` mirrors the owed builders' `share > 0` filter (empty or
 * fully-dropped advances fall back to payer-only). The net builder passes
 * false: its merged advances go through unfiltered, exactly like the original
 * float merge did.
 */
function finalizePaidBy(
  advancedMajors: Iterable<readonly [string, number]>,
  amountCents: number,
  currency: Currency,
  payerId: string,
  dropNonPositive = true,
): PaidForEntry[] {
  const entries = [...advancedMajors].filter(([, share]) =>
    dropNonPositive ? share > 0 : true,
  )
  const paidByMajor =
    entries.length > 0
      ? entries.map(([sourceId, share]) => ({
          participant: { id: sourceId },
          shares: share,
        }))
      : [{ participant: { id: payerId }, shares: amountCents }]
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
    payerId,
  })
  return Object.entries(paidByFixed).map(([sourceId, shares]) => ({
    sourceId,
    shares,
  }))
}

/** PaidFor + splitMode tail shared by the owed and net builders. */
function finalizeOwedTail(
  paidForCents: ReadonlyMap<string, number>,
  paidBy: readonly PaidForEntry[],
  amountCents: number,
  payerId: string,
): BuiltOwedExpense {
  const paidFor = [...paidForCents.entries()]
    .filter(([, shares]) => shares > 0)
    .map(([sourceId, shares]) => ({ sourceId, shares }))
  const involvedCount = new Set([
    ...paidBy.map((p) => p.sourceId),
    ...paidFor.map((p) => p.sourceId),
  ]).size
  const { splitMode, paidFor: resolvedPaidFor } = guessSplitMode(
    paidFor,
    amountCents,
    { involvedParticipantCount: involvedCount },
  )
  return {
    paidBySourceId: payerId,
    paidBy: [...paidBy],
    paidFor: resolvedPaidFor,
    splitMode,
  }
}

/**
 * Distribute `remainingShare` whole cents evenly across `positiveIds`, folding
 * truncation residue into the payer (who advanced the full amount). Returns
 * per-member consumed shares in integer minor units.
 */
function allocateConsumedMinor(
  positiveIds: readonly string[],
  remainingShare: number,
): Map<string, number> {
  const consumed = new Map<string, number>()
  if (positiveIds.length === 0 || remainingShare === 0) return consumed
  const exact = calculateExactShares({
    amount: remainingShare,
    splitMode: 'EVENLY',
    participants: positiveIds.map((id) => ({ id, shares: 1 })),
  })
  const allocated = distributeRemainder(exact, remainingShare)
  for (const id of positiveIds) {
    consumed.set(id, allocated[id] ?? 0)
  }
  return consumed
}

/**
 * Owed/advanced → paidBy/paidFor/splitMode. Zero/negative owed entries are
 * dropped; when nothing is owed the payer absorbs the full amount. Rounding
 * remainder pins to the payer (current behavior of all 5 parsers).
 */
export function buildOwedExpense(input: OwedExpenseInput): BuiltOwedExpense {
  const { amountCents, currency, payerId } = input

  const paidForCents = serializeOwedCents(
    input.owedMajors.entries(),
    amountCents,
    currency,
    payerId,
  )
  const fallback = emptyPaidForFallback(paidForCents, amountCents, payerId)
  if (fallback !== null) {
    if (fallback.length === 0) {
      // Zero-total: nothing is owed; the caller decides whether a zero
      // expense is valid (spliit skips it — the destination validator
      // requires paidFor.shares > 0). Do not emit a phantom
      // payer-absorbs-full-amount entry; fall through to the paidBy tail so
      // the returned shape stays complete.
      return zeroNetShape(payerId)
    }
    const paidBy = finalizePaidBy([], amountCents, currency, payerId)
    return finalizeOwedTail(
      new Map([[payerId, amountCents]]),
      paidBy,
      amountCents,
      payerId,
    )
  }

  const paidBy = finalizePaidBy(
    input.advancedMajors?.entries() ?? [],
    amountCents,
    currency,
    payerId,
  )
  return finalizeOwedTail(paidForCents, paidBy, amountCents, payerId)
}

export type SettlementInput = {
  payerId: string
  receiverId: string
  amountCents: number
}

export type BuiltSettlement = Pick<
  NormalizedSourceExpense,
  'paidBySourceId' | 'paidBy' | 'paidFor' | 'splitMode'
>

/** Settlement: payer → single receiver, EVENLY, full amount both sides. */
export function buildSettlement(input: SettlementInput): BuiltSettlement {
  return {
    paidBySourceId: input.payerId,
    paidBy: [{ sourceId: input.payerId, shares: input.amountCents }],
    paidFor: [{ sourceId: input.receiverId, shares: input.amountCents }],
    splitMode: 'EVENLY',
  }
}

export type NetExpenseInput = {
  /** Expense total in minor units (cents). The payer advanced this in full. */
  amountCents: number
  currency: Currency
  /**
   * Signed per-member nets in major units (may be fractional): positive = net
   * paid in, negative = net owed. The payer is the member whose entry the
   * caller already resolved (max raw / first positive / first zero).
   */
  netMajors: ReadonlyMap<string, number>
  payerId: string
}

/**
 * Signed-net → paidBy/paidFor/splitMode (splitwise/spliit shape).
 *
 * Negatives are consumed shares: each cell is `Paid - Owe`, so the positive
 * cells net back to the members who advanced money. The owed side is the
 * consumed (negative) shares plus an even split of the remainder across the
 * positive members — the remainder is what they advanced beyond their own
 * consumption (equivalently: their positive nets, since Σ nets === amount).
 * Rounding remainder pins to the payer. The payer advances the full amount.
 */
export function buildNetExpense(input: NetExpenseInput): BuiltOwedExpense {
  const { amountCents, currency, payerId } = input

  const positiveIds: string[] = []
  const owedMajors = new Map<string, number>()
  for (const [sourceId, net] of input.netMajors) {
    if (net > 0) {
      positiveIds.push(sourceId)
    } else if (net < 0) {
      owedMajors.set(sourceId, -net)
    }
  }

  // Consumed (negative) shares, major units → minor via the totals core. No
  // remainder pinning here: the negatives are a partial subset by
  // construction (old splitwise/spliit semantics) and the remainder split
  // across the positives below covers the rest.
  const paidForCents =
    owedMajors.size > 0
      ? serializeOwedCents(
          owedMajors.entries(),
          amountCents,
          currency,
          payerId,
          false,
        )
      : new Map<string, number>()
  const consumedTotal = [...paidForCents.values()].reduce((s, v) => s + v, 0)

  // Positive members split the remainder evenly: what they advanced beyond
  // their own consumption. distributeRemainder truncates toward zero first,
  // so credit the truncation residue back to the payer (who advanced the
  // full amount) to keep the owed side exact.
  const remainingShare = amountCents - consumedTotal
  const consumedMinorById = allocateConsumedMinor(positiveIds, remainingShare)
  for (const [id, shares] of consumedMinorById) {
    if (shares > 0) {
      paidForCents.set(id, (paidForCents.get(id) ?? 0) + shares)
    }
  }

  const fallback = emptyPaidForFallback(paidForCents, amountCents, payerId)
  if (fallback !== null) {
    if (fallback.length === 0) {
      // Zero-total: nothing is owed. The builder still returns a full shape
      // (the spliit parser skips zero expenses itself — the destination
      // validator requires paidFor.shares > 0) so Σ paidFor stays truthful.
      return zeroNetShape(payerId)
    }
    const paidByOnly = finalizePaidBy([], amountCents, currency, payerId)
    return finalizeOwedTail(
      new Map([[payerId, amountCents]]),
      paidByOnly,
      amountCents,
      payerId,
    )
  }

  // paidBy: each positive member advanced `|raw| + consumed share` in major
  // units (old splitwise float merge), serialized once through the totals
  // core so a single rounding applies. The consumed shares are the same
  // integer allocation the paidFor side distributed above — computed once,
  // reused here. Skip the serializer entirely on a zero total — there is
  // nothing to split.
  const scale = 10 ** currency.decimal_digits
  const paidByMajorEntries: Array<readonly [string, number]> = positiveIds.map(
    (id) => {
      const raw = Math.abs(input.netMajors.get(id) ?? 0)
      const consumed = (consumedMinorById.get(id) ?? 0) / scale
      return [id, raw + consumed] as const
    },
  )
  if (positiveIds.length === 0) {
    // No positive nets: payer-only advance, matching the original
    // `shares: amountCents / scale` fallback.
    paidByMajorEntries.push([payerId, amountCents / scale] as const)
  }
  if (amountCents === 0) {
    const paidByZero = finalizePaidBy([], amountCents, currency, payerId)
    const zeroed = paidByZero.map((p) => ({ ...p, shares: 0 }))
    if (zeroed.length === 0) {
      zeroed.push({ sourceId: payerId, shares: 0 })
    }
    return {
      paidBySourceId: payerId,
      paidBy: zeroed,
      paidFor: [],
      splitMode: 'BY_AMOUNT',
    }
  }
  const paidBy = finalizePaidBy(
    paidByMajorEntries,
    amountCents,
    currency,
    payerId,
    false,
  )
  return finalizeOwedTail(paidForCents, paidBy, amountCents, payerId)
}

/**
 * Cap on the largest normalized share weight, mirroring the `BY_SHARES` guesser
 * convention: ratios above it are treated as coincidental round numbers rather
 * than human-intended shares, and fall back to exact cents (`BY_AMOUNT`).
 *
 * @deprecated Use {@link MAX_SHARE_WEIGHT} from `split-guess.ts` — one source
 * of truth, kept as a re-export for old imports.
 */
export const MAX_BUILDER_SHARE_WEIGHT = MAX_SHARE_WEIGHT

export type WeightExpenseInput = {
  /** Expense total in minor units (cents). The payer advanced this in full. */
  amountCents: number
  /** Member weights keyed by source id (upstream treats 0/missing as 1). */
  weights: ReadonlyMap<string, number>
  payerId: string
}

function effectiveBuilderWeight(weight: number | undefined): number {
  return weight !== undefined && Number.isFinite(weight) && weight > 0
    ? weight
    : 1
}

/**
 * Member weights → paidBy/paidFor/splitMode (cospend shape).
 *
 * Equal weights split evenly regardless of divisibility; unequal weights become
 * a BY_SHARES ratio (weights scaled ×100, GCD-reduced, stored in `SHARE_SCALE`
 * fixed units). Implausibly large ratios fall back to exact cents (BY_AMOUNT)
 * with remainder pinned to the payer. The payer always advances the full
 * amount. Unlike `buildOwedExpense`, the mode is derived from the weights
 * directly — re-guessing from rounded cents would misclassify both indivisible
 * even splits and small-ratio splits (GCD 1).
 */
export function buildWeightedExpense(
  input: WeightExpenseInput,
): BuiltOwedExpense {
  const { amountCents, payerId } = input
  const ids = [...input.weights.keys()]
  const weights = ids.map((id) => effectiveBuilderWeight(input.weights.get(id)))
  const paidBy = [{ sourceId: payerId, shares: amountCents }]

  const allEqual = weights.every((w) => w === weights[0])
  if (allEqual) {
    const exact = calculateExactShares({
      amount: amountCents,
      splitMode: 'EVENLY',
      participants: ids.map((id) => ({ id, shares: 1 })),
    })
    const fixed = distributeRemainder(exact, amountCents)
    const paidFor = ids
      .map((id) => ({ sourceId: id, shares: fixed[id] ?? 0 }))
      .filter((p) => p.shares > 0)
    if (paidFor.length === 0) {
      paidFor.push({ sourceId: payerId, shares: amountCents })
    }
    return { paidBySourceId: payerId, paidBy, paidFor, splitMode: 'EVENLY' }
  }

  // Scale weights to integers, reduce by GCD, store in fixed units
  // (100 = 1 displayed share). Ratios with an implausibly large normalized
  // weight fall back to exact cents.
  const scaled = weights.map((w) => Math.max(1, Math.round(w * 100)))
  const divisor = gcdOf(scaled)
  const normalized = scaled.map((s) => (s / divisor) * SHARE_SCALE)
  const maxWeight = Math.max(...normalized) / SHARE_SCALE
  if (maxWeight <= MAX_SHARE_WEIGHT) {
    const paidFor = ids.map((id, i) => ({
      sourceId: id,
      shares: normalized[i]!,
    }))
    return { paidBySourceId: payerId, paidBy, paidFor, splitMode: 'BY_SHARES' }
  }

  const exact = calculateExactShares({
    amount: amountCents,
    splitMode: 'BY_SHARES',
    participants: ids.map((id, i) => ({ id, shares: scaled[i] })),
  })
  const fixed = distributeRemainder(exact, amountCents, { payerId })
  const paidFor = ids
    .map((id) => ({ sourceId: id, shares: fixed[id] ?? 0 }))
    .filter((p) => p.shares > 0)
  if (paidFor.length === 0) {
    paidFor.push({ sourceId: payerId, shares: amountCents })
  }
  return { paidBySourceId: payerId, paidBy, paidFor, splitMode: 'BY_AMOUNT' }
}

import type { Balances, SuggestedSettlement } from '@/lib/balances'

export type CurrencyBalanceBucket = {
  currencyCode?: string
  balances: Balances
  suggestedSettlements: SuggestedSettlement[]
}

/** Pairwise ("direct") legs as returned by `groups.balances.list`. */
export type DirectSettlements = {
  suggestedSettlements: SuggestedSettlement[]
  currencies: {
    currencyCode: string
    directSettlements: SuggestedSettlement[]
  }[]
}

/** Replace each currency bucket's simplified legs with its direct legs. */
export function withDirectLegs<T extends CurrencyBalanceBucket>(
  buckets: T[],
  direct: DirectSettlements,
): T[] {
  return buckets.map((bucket) => ({
    ...bucket,
    suggestedSettlements:
      direct.currencies.find(
        (entry) => entry.currencyCode === bucket.currencyCode,
      )?.directSettlements ?? [],
  }))
}

function appearsOnSettlementLeg(
  participantId: string,
  suggestedSettlements: SuggestedSettlement[] | undefined,
): boolean {
  return (
    suggestedSettlements?.some(
      (leg) => leg.from === participantId || leg.to === participantId,
    ) ?? false
  )
}

/** Keep soft-removed people only when they still matter for settlement UI. */
export function hasUnsettledBalance(
  participantId: string,
  balances: Balances | undefined,
  suggestedSettlements: SuggestedSettlement[] | undefined,
  currencyBalances: CurrencyBalanceBucket[] | undefined,
): boolean {
  if ((balances?.[participantId]?.total ?? 0) !== 0) return true
  if (appearsOnSettlementLeg(participantId, suggestedSettlements)) return true
  for (const bucket of currencyBalances ?? []) {
    if ((bucket.balances[participantId]?.total ?? 0) !== 0) return true
    if (appearsOnSettlementLeg(participantId, bucket.suggestedSettlements)) {
      return true
    }
  }
  return false
}

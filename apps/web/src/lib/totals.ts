export * from '@spliit/domain/totals'

/** Convert a user-facing percentage to safe integer basis points for exact math. */
export function percentageToBasisPoints(value: unknown): number {
  const percentage = Number(value)
  if (!Number.isFinite(percentage)) return 0
  const basisPoints = Math.round(percentage * 100)
  return Number.isSafeInteger(basisPoints) ? basisPoints : 0
}

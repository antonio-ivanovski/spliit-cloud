/**
 * Pure cent-math for the public split + settle demo.
 *
 * Money is integer cents throughout. Both splitters guarantee the shares sum to
 * exactly `amountCents` so the demo never drops or invents a cent.
 */

/** Split evenly: floor share each, then deal the remainder one cent at a time. */
export function splitEvenly(amountCents: number, count: number): number[] {
  if (!Number.isInteger(amountCents) || amountCents < 0)
    return Array(count).fill(0)
  if (count <= 0) return []
  const base = Math.floor(amountCents / count)
  const remainder = amountCents - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Split proportionally to non-negative weights using largest-remainder so the
 * rounded shares still sum to exactly `amountCents`. All-zero or empty weights
 * fall back to an even split.
 */
export function splitByWeights(
  amountCents: number,
  weights: number[],
): number[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return weights.map(() => 0)
  }
  if (weights.length === 0) return []
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const totalWeight = safeWeights.reduce((sum, w) => sum + w, 0)
  if (totalWeight <= 0) return splitEvenly(amountCents, weights.length)

  const floors: number[] = []
  const remainders: Array<{ index: number; frac: number }> = []
  let assigned = 0
  for (let i = 0; i < safeWeights.length; i++) {
    const exact = (amountCents * safeWeights[i]) / totalWeight
    const floor = Math.floor(exact)
    floors.push(floor)
    assigned += floor
    remainders.push({ index: i, frac: exact - floor })
  }
  let leftover = amountCents - assigned
  remainders.sort((a, b) => b.frac - a.frac || a.index - b.index)
  for (let k = 0; k < leftover; k++) {
    floors[remainders[k % remainders.length].index] += 1
  }
  return floors
}

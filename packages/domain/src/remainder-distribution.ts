import {
  fractionNumeratorAbs,
  truncExactAmount,
  type ExactAmount,
} from './exact-math'

export type TieBreakStrategy =
  'EXPENSE_ID_SEEDED' | 'PARTICIPANT_ID_DESC' | 'ROUND_ROBIN' | 'RANDOM_SEEDED'

export type DistributeRemainderOpts = {
  seed?: number
  payerId?: string
  strategy?: TieBreakStrategy
}

/** Build participant order: frac desc, id asc; seed rotates within equal-frac ties. */
function orderForRemainder(
  entries: Array<{
    id: string
    fracNumerator: bigint
    fracDenominator: bigint
  }>,
  seed: number,
  strategy: TieBreakStrategy,
): string[] {
  const sorted = [...entries].sort((a, b) => {
    const left = b.fracNumerator * a.fracDenominator
    const right = a.fracNumerator * b.fracDenominator
    if (left !== right) return left > right ? 1 : -1
    if (strategy === 'PARTICIPANT_ID_DESC') {
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  if (strategy !== 'EXPENSE_ID_SEEDED' && strategy !== 'RANDOM_SEEDED') {
    return sorted.map((e) => e.id)
  }

  // Rotate within consecutive equal-frac groups so largest remainder is preserved
  // while seed fairly breaks ties across expenses.
  const ordered: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (
      j < sorted.length &&
      sorted[j].fracNumerator * sorted[i].fracDenominator ===
        sorted[i].fracNumerator * sorted[j].fracDenominator
    ) {
      j += 1
    }
    const group = sorted.slice(i, j)
    if (group.length > 1) {
      const offset = ((seed % group.length) + group.length) % group.length
      for (let k = 0; k < group.length; k++) {
        ordered.push(group[(k + offset) % group.length].id)
      }
    } else {
      ordered.push(group[0].id)
    }
    i = j
  }
  return ordered
}

/**
 * Truncate toward zero and distribute leftover cents by descending fractional
 * part; EXPENSE_ID_SEEDED rotates within equal-frac ties via seed.
 */
export function distributeRemainder(
  exactShares: Record<string, ExactAmount>,
  amount: number,
  opts?: DistributeRemainderOpts,
): Record<string, number> {
  const ids = Object.keys(exactShares)
  if (ids.length === 0) {
    if (opts?.payerId != null && amount !== 0) {
      return { [opts.payerId]: amount }
    }
    return {}
  }

  const result: Record<string, number> = {}
  type Entry = { id: string; fracNumerator: bigint; fracDenominator: bigint }
  const entries: Entry[] = []

  for (const id of ids) {
    const exact = exactShares[id]
    const truncated = truncExactAmount(exact)
    result[id] = truncated
    entries.push({
      id,
      fracNumerator: fractionNumeratorAbs(exact, truncated),
      fracDenominator: exact.denominator,
    })
  }

  const sumTruncated = Object.values(result).reduce((sum, n) => sum + n, 0)
  const diff = amount - sumTruncated
  if (diff === 0) return result

  if (opts?.payerId != null) {
    result[opts.payerId] = (result[opts.payerId] ?? 0) + diff
    return result
  }

  const strategy = opts?.strategy ?? 'EXPENSE_ID_SEEDED'
  const seed = opts?.seed ?? 0
  const order = orderForRemainder(entries, seed, strategy)
  const step = diff > 0 ? 1 : -1
  let remaining = Math.abs(diff)

  let i = 0
  while (remaining > 0 && order.length > 0) {
    const id = order[i % order.length]
    result[id] = (result[id] ?? 0) + step
    remaining -= 1
    i += 1
  }

  return result
}

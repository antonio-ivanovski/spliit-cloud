import type { RankedCategory } from '../rank'

export function hasWord(needle: string, word: string): boolean {
  // Unicode-aware word boundary: \b only works for Latin. Use lookbehind/ahead for Cyrillic etc.
  const escaped = word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}_])${escaped}(?![\p{L}\p{N}_])`,
    'iu',
  ).test(needle)
}

export function containsAny(needle: string, words: readonly string[]): boolean {
  return words.some((word) => hasWord(needle, word))
}

export function boost(
  ranked: RankedCategory[],
  categoryId: string,
  targetScore: number,
): RankedCategory[] {
  const idx = ranked.findIndex((entry) => entry.id === categoryId)
  if (idx === -1) {
    return [
      ...ranked,
      {
        id: categoryId as RankedCategory['id'],
        score: targetScore,
        isParent: false,
      },
    ]
  }
  const hit = ranked[idx]!
  if (hit.score >= targetScore) return ranked
  const copy = [...ranked]
  copy[idx] = { ...hit, score: targetScore }
  copy.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.isParent !== right.isParent) return left.isParent ? 1 : -1
    return 0
  })
  return copy
}

export function demote(
  ranked: RankedCategory[],
  categoryId: string,
  cap: number,
): RankedCategory[] {
  const idx = ranked.findIndex((entry) => entry.id === categoryId)
  if (idx === -1) return ranked
  const hit = ranked[idx]!
  if (hit.score <= cap) return ranked
  const copy = [...ranked]
  copy[idx] = { ...hit, score: cap }
  copy.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.isParent !== right.isParent) return left.isParent ? 1 : -1
    return 0
  })
  return copy
}

export type CalibrateArgs = {
  needle: string
  ranked: RankedCategory[]
}

import { categoryIdSchema, type CategoryId } from '../categories'
import { knownTokensForCategory, tokenizeSearchText } from './dictionaries'

const DEFAULT_MIN_COUNT = 5
const DEFAULT_MIN_TOKEN_LENGTH = 3

export const DEFAULT_MINE_EXCLUDE: ReadonlySet<string> = new Set([
  'general',
  'uncategorized',
  'payment',
])

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'to',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'by',
  'or',
  'my',
  'our',
  'your',
])

export type ExpenseTitleRow = {
  categoryId: string
  title: string
}

export type AliasCandidate = {
  token: string
  count: number
}

export type AliasCandidateGroup = {
  categoryId: CategoryId
  candidates: AliasCandidate[]
}

export type MineAliasOptions = {
  locale: string
  minCount?: number
  minTokenLength?: number
  exclude?: ReadonlySet<string>
}

/** Count novel title tokens per category for human dictionary review. */
export function mineAliasCandidates(
  rows: readonly ExpenseTitleRow[],
  options: MineAliasOptions,
): AliasCandidateGroup[] {
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT
  const minTokenLength = options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH
  const exclude = options.exclude ?? DEFAULT_MINE_EXCLUDE
  const counts = new Map<CategoryId, Map<string, number>>()

  for (const row of rows) {
    const parsed = categoryIdSchema.safeParse(row.categoryId)
    if (!parsed.success) continue
    const categoryId = parsed.data
    if (exclude.has(categoryId)) continue

    const known = knownTokensForCategory(categoryId, options.locale)
    let categoryCounts = counts.get(categoryId)
    if (!categoryCounts) {
      categoryCounts = new Map()
      counts.set(categoryId, categoryCounts)
    }

    const seenInTitle = new Set<string>()
    for (const token of tokenizeSearchText(row.title)) {
      if (token.length < minTokenLength) continue
      if (STOPWORDS.has(token)) continue
      if (/^\d+$/.test(token)) continue
      if (known.has(token)) continue
      if (seenInTitle.has(token)) continue
      seenInTitle.add(token)
      categoryCounts.set(token, (categoryCounts.get(token) ?? 0) + 1)
    }
  }

  const groups: AliasCandidateGroup[] = []
  for (const [categoryId, tokenCounts] of counts) {
    const candidates = [...tokenCounts.entries()]
      .filter(([, count]) => count >= minCount)
      .map(([token, count]) => ({ token, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.token.localeCompare(right.token),
      )
    if (candidates.length === 0) continue
    groups.push({ categoryId, candidates })
  }

  groups.sort((left, right) => left.categoryId.localeCompare(right.categoryId))
  return groups
}

export function aliasCandidatesToPatch(
  groups: readonly AliasCandidateGroup[],
): Record<string, { aliases: string[] }> {
  const patch: Record<string, { aliases: string[] }> = {}
  for (const group of groups) {
    patch[group.categoryId] = {
      aliases: group.candidates.map((candidate) => candidate.token),
    }
  }
  return patch
}

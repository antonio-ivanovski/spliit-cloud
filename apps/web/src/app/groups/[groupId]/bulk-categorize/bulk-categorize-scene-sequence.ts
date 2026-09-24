export const SORTING_CATEGORIES = [
  'groceries',
  'dining',
  'plane',
  'household',
  'movies',
] as const

export type SortingCategory = (typeof SORTING_CATEGORIES)[number]

export type SortingTitle = {
  title: string
  category: SortingCategory
}

export type SortingReceipt = SortingTitle & {
  id: number
  delay: number
  drift: number
}

export type SortingSequence = {
  titles: readonly SortingTitle[]
  remaining: SortingTitle[]
  stack: SortingReceipt[]
  nextReceiptId: number
}

export const SORTING_STACK_DEPTH = 7

const sample = (random: () => number) =>
  Math.min(0.999999, Math.max(0, random()))

function canFinishWithoutCategoryRepeat(
  titles: readonly SortingTitle[],
  previousCategory: SortingCategory,
) {
  const counts = new Map<SortingCategory, number>()
  for (const title of titles)
    counts.set(title.category, (counts.get(title.category) ?? 0) + 1)
  for (const [category, count] of counts) {
    const otherCount = titles.length - count
    if (count > otherCount + (category === previousCategory ? 0 : 1))
      return false
  }
  return true
}

function drawTitle(
  remaining: SortingTitle[],
  titles: readonly SortingTitle[],
  previous: SortingTitle | null,
  random: () => number,
) {
  if (remaining.length === 0) remaining.push(...titles)
  const differentCategory = remaining.filter(
    (item) => item.category !== previous?.category,
  )
  const differentTitle = differentCategory.filter(
    (item) => item.title !== previous?.title,
  )
  const nonrepeating = differentTitle.length
    ? differentTitle
    : differentCategory.length
      ? differentCategory
      : remaining.filter((item) => item.title !== previous?.title)
  const feasible = nonrepeating.filter((item) => {
    const after = [...remaining]
    after.splice(after.indexOf(item), 1)
    return canFinishWithoutCategoryRepeat(after, item.category)
  })
  const candidates = feasible.length ? feasible : nonrepeating
  const pool = candidates.length ? candidates : remaining
  const picked = pool[Math.floor(sample(random) * pool.length)]
  remaining.splice(remaining.indexOf(picked), 1)
  return picked
}

function receiptFor(
  title: SortingTitle,
  id: number,
  random: () => number,
): SortingReceipt {
  return {
    ...title,
    id,
    delay: 320 + Math.floor(sample(random) * 700),
    drift: Math.round((sample(random) - 0.5) * 24),
  }
}

export function initialSortingStack(
  titles: readonly SortingTitle[],
  random: () => number = Math.random,
  previous: SortingTitle | null = null,
): SortingSequence {
  const remaining: SortingTitle[] = []
  const stack: SortingReceipt[] = []
  if (titles.length === 0) return { titles, remaining, stack, nextReceiptId: 0 }
  for (let index = 0; index < SORTING_STACK_DEPTH; index++) {
    const title = drawTitle(remaining, titles, stack.at(-1) ?? previous, random)
    stack.push(receiptFor(title, index, random))
  }
  return { titles, remaining, stack, nextReceiptId: stack.length }
}

export function advanceSortingStack(
  sequence: SortingSequence,
  replacementTitles: readonly SortingTitle[] | null = null,
  random: () => number = Math.random,
): SortingSequence {
  const filed = sequence.stack[0] ?? null
  if (sequence.stack.length === 0)
    return initialSortingStack(replacementTitles ?? sequence.titles, random)
  const stack = sequence.stack.slice(1)
  const titles = replacementTitles ?? sequence.titles
  const remaining = replacementTitles ? [] : [...sequence.remaining]
  const title = drawTitle(remaining, titles, stack.at(-1) ?? filed, random)
  stack.push(receiptFor(title, sequence.nextReceiptId, random))
  return {
    titles,
    remaining,
    stack,
    nextReceiptId: sequence.nextReceiptId + 1,
  }
}

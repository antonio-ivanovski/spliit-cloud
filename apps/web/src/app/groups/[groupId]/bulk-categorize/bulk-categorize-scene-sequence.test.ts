import { describe, expect, it } from 'vitest'

import {
  advanceSortingStack,
  initialSortingStack,
  SORTING_CATEGORIES,
  SORTING_STACK_DEPTH,
  type SortingTitle,
} from './bulk-categorize-scene-sequence'

const titles: SortingTitle[] = SORTING_CATEGORIES.flatMap((category) => [
  { category, title: `${category} one` },
  { category, title: `${category} two` },
])

describe('sorting receipt sequence', () => {
  it('draws every title before reshuffling and avoids a title repeat at the boundary', () => {
    let sequence = initialSortingStack(titles, () => 0)
    const seen: string[] = []
    for (let index = 0; index < titles.length + 1; index++) {
      seen.push(sequence.stack[0].title)
      sequence = advanceSortingStack(sequence, null, () => 0)
    }
    expect(new Set(seen.slice(0, titles.length)).size).toBe(titles.length)
    expect(seen[titles.length]).not.toBe(seen[titles.length - 1])
  })

  it('avoids the previous category whenever another category is available', () => {
    let sequence = initialSortingStack(titles, () => 0)
    const categories = []
    for (let index = 0; index < 8; index++) {
      categories.push(sequence.stack[0].category)
      sequence = advanceSortingStack(sequence, null, () => 0)
    }
    for (let index = 1; index < categories.length; index++)
      expect(categories[index]).not.toBe(categories[index - 1])
  })

  it('varies wait and carry path within readable limits', () => {
    const early = initialSortingStack(titles, () => 0).stack[0]
    const late = initialSortingStack(titles, () => 0.999).stack[0]
    expect(early).toMatchObject({ delay: 320, drift: -12 })
    expect(late).toMatchObject({ delay: 1019, drift: 12 })
  })

  it('keeps queued receipts printed and adds replacement titles beneath them', () => {
    const sequence = initialSortingStack(titles, () => 0)
    expect(sequence.stack).toHaveLength(SORTING_STACK_DEPTH)
    const next = advanceSortingStack(sequence, null, () => 0)
    expect(next.stack.slice(0, 6)).toEqual(sequence.stack.slice(1))
    expect(next.stack[6].id).toBe(sequence.nextReceiptId)

    const replacement: SortingTitle[] = [
      { category: 'movies', title: 'Festival tickets' },
      { category: 'groceries', title: 'Weekly shop' },
    ]
    const replaced = advanceSortingStack(sequence, replacement, () => 0)
    expect(replaced.stack).toHaveLength(SORTING_STACK_DEPTH)
    expect(replaced.stack.slice(0, 6)).toEqual(sequence.stack.slice(1))
    expect(replacement.map((item) => item.title)).toContain(
      replaced.stack[6].title,
    )
    let afterSixMoreFilings = replaced
    for (let index = 0; index < 6; index++)
      afterSixMoreFilings = advanceSortingStack(
        afterSixMoreFilings,
        null,
        () => 0,
      )
    expect(afterSixMoreFilings.stack[0]).toEqual(replaced.stack[6])
    expect(
      afterSixMoreFilings.stack.every((receipt) =>
        replacement.some((item) => item.title === receipt.title),
      ),
    ).toBe(true)
  })

  it('fills the pile from a short list without repeating a title immediately when avoidable', () => {
    const shortTitles: SortingTitle[] = [
      { category: 'groceries', title: 'Market' },
      { category: 'movies', title: 'Cinema' },
    ]
    let sequence = initialSortingStack(shortTitles, () => 0)
    const drawn: string[] = []
    for (let index = 0; index < 8; index++) {
      expect(sequence.stack).toHaveLength(SORTING_STACK_DEPTH)
      drawn.push(sequence.stack[0].title)
      sequence = advanceSortingStack(sequence, null, () => 0)
    }
    for (let index = 1; index < drawn.length; index++)
      expect(drawn[index]).not.toBe(drawn[index - 1])

    const singleTitle: SortingTitle[] = [
      { category: 'dining', title: 'Only cafe' },
    ]
    const singleSequence = initialSortingStack(singleTitle, () => 0)
    expect(singleSequence.stack).toHaveLength(SORTING_STACK_DEPTH)
    expect(
      advanceSortingStack(singleSequence, null, () => 0).stack.every(
        (receipt) => receipt.title === 'Only cafe',
      ),
    ).toBe(true)
  })
})

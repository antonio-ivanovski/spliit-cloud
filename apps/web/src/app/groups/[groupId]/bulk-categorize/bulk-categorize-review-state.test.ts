import { describe, expect, it } from 'vitest'

import { getRerunReviewState } from './bulk-categorize-review-state'

describe('rerun review note', () => {
  it('stays visible after the final General row is manually assigned', () => {
    const rows = [
      {
        initialCategoryId: 'general' as const,
        categoryId: 'groceries' as const,
      },
    ]
    const withUncertain = getRerunReviewState(rows, {
      general: 0,
      uncertain: 1,
    })
    expect(withUncertain.hasCorrections).toBe(true)
    expect(withUncertain.canRerun).toBe(true)
    const withNone = getRerunReviewState(rows, { general: 0, uncertain: 0 })
    expect(withNone.hasCorrections).toBe(true)
    expect(withNone.canRerun).toBe(false)
    expect(
      getRerunReviewState([{ ...rows[0]!, rerunFeedback: true }], {
        general: 0,
        uncertain: 1,
      }),
    ).toMatchObject({
      changedCount: 0,
      assignedCount: 0,
      hasCorrections: false,
      canRerun: false,
    })
  })

  it('counts only edits made after the latest rerun and clears undone edits', () => {
    const used = {
      initialCategoryId: 'food-and-drink' as const,
      categoryId: 'groceries' as const,
      rerunFeedback: true,
    }
    const proposed = {
      initialCategoryId: 'transportation' as const,
      categoryId: 'transportation' as const,
    }
    const candidates = { general: 1, uncertain: 1 }
    expect(getRerunReviewState([used, proposed], candidates)).toMatchObject({
      proposedCount: 2,
      changedCount: 0,
      hasCorrections: false,
      canRerun: false,
    })
    expect(
      getRerunReviewState(
        [used, { ...proposed, categoryId: 'groceries' }],
        candidates,
      ),
    ).toMatchObject({ changedCount: 1, canRerun: true })
    expect(
      getRerunReviewState(
        [{ ...used, categoryId: used.initialCategoryId, rerunFeedback: false }],
        candidates,
      ),
    ).toMatchObject({ changedCount: 0, hasCorrections: false })
  })
})

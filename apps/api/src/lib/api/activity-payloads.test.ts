import { describe, expect, it } from 'vitest'

import { buildExpenseCommentActivityData } from './activity-payloads'

describe('buildExpenseCommentActivityData', () => {
  it('keeps the typed snapshot fields and bounds the excerpt', () => {
    const payload = buildExpenseCommentActivityData({
      commentId: 'comment-1',
      expenseTitle: 'Dinner',
      authorName: 'Alice',
      excerpt: `${'x'.repeat(160)}ignored`,
    })

    expect(payload).toEqual({
      kind: 'expense_comment',
      commentId: 'comment-1',
      expenseTitle: 'Dinner',
      authorName: 'Alice',
      excerpt: 'x'.repeat(160),
    })
  })
})

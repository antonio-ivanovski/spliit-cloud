import { describe, expect, it, vi } from 'vitest'
import { ExpenseActivityNotificationRouter } from './expense-router'
import type { ActivityNotificationEvent } from './types'

function event(
  type: ActivityNotificationEvent['type'],
): ActivityNotificationEvent {
  return {
    activityId: 'activity-1',
    type,
    groupId: 'group-1',
    actor: null,
    subject: null,
    data: null,
    occurredAt: new Date(),
  }
}

describe('ExpenseActivityNotificationRouter', () => {
  it('routes CRUD activity to push and email adapters', async () => {
    const push = { dispatch: vi.fn(async () => undefined) }
    const email = { dispatch: vi.fn(async () => undefined) }
    const router = new ExpenseActivityNotificationRouter(push, email)

    await router.dispatch(event('EXPENSE_UPDATED'))

    expect(push.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXPENSE_UPDATED' }),
    )
    expect(email.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXPENSE_UPDATED' }),
    )
  })

  it('keeps import summaries on email only', async () => {
    const push = { dispatch: vi.fn(async () => undefined) }
    const email = { dispatch: vi.fn(async () => undefined) }
    const router = new ExpenseActivityNotificationRouter(push, email)

    await router.dispatch(event('EXPENSES_IMPORTED'))

    expect(push.dispatch).not.toHaveBeenCalled()
    expect(email.dispatch).toHaveBeenCalledTimes(1)
  })

  it('keeps the email fallback when push delivery fails', async () => {
    const push = {
      dispatch: vi.fn(async () => Promise.reject(new Error('down'))),
    }
    const email = { dispatch: vi.fn(async () => undefined) }
    const router = new ExpenseActivityNotificationRouter(push, email)

    await router.dispatch(event('EXPENSE_CREATED'))

    expect(email.dispatch).toHaveBeenCalledTimes(1)
  })
})

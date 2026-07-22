import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recurrenceMocks = vi.hoisted(() => ({
  materialize: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('@spliit/api/lib/api/recurrence-series', () => ({
  materializeRecurringExpense: recurrenceMocks.materialize,
  reconcileDueRecurringExpenses: recurrenceMocks.reconcile,
}))

import {
  ActivityNotificationCoordinator,
  initializeDefaultNotificationDispatchers,
  waitForScheduledNotificationDispatchesForTest,
} from '@spliit/api/lib/notifications/dispatcher'
import { JOB_NAMES } from '@spliit/jobs'
import { handlers } from './handlers'

describe('recurring materialization worker notifications', () => {
  beforeEach(() => {
    recurrenceMocks.materialize.mockResolvedValue({
      created: true,
      activityId: 'activity-1',
      groupId: 'group-1',
      expenseId: 'expense-1',
      actor: { type: 'ACCOUNT', id: 'account-owner' },
      title: 'Rent',
      amount: 10000,
      currencyCode: 'EUR',
      date: '2026-07-22',
      activityData: {
        kind: 'expense',
        summary: 'Rent',
        title: 'Rent',
        amount: 10000,
        currencyCode: 'USD',
        date: '2026-07-22',
        originalAmount: 12500,
        conversionRate: 0.8,
        conversionSource: 'EXCHANGE',
        ledgerCurrencyCode: 'EUR',
      },
      activityTime: new Date('2026-07-22T00:05:00.000Z'),
    })
    initializeDefaultNotificationDispatchers()
  })

  afterEach(async () => {
    await waitForScheduledNotificationDispatchesForTest()
    vi.restoreAllMocks()
  })

  it('dispatches recurring activity through the registered coordinator', async () => {
    const coordinatorDispatch = vi
      .spyOn(ActivityNotificationCoordinator.prototype, 'dispatch')
      .mockResolvedValue()

    await handlers[JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]!(
      {
        seriesId: 'series-1',
        sequence: 2,
        occurrenceDate: '2026-07-22',
      },
      {
        boss: {} as never,
        name: JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
        jobId: 'job-1',
        signal: new AbortController().signal,
      },
    )
    await waitForScheduledNotificationDispatchesForTest()

    expect(coordinatorDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'activity-1',
        type: 'RECURRING_EXPENSE_CREATED',
        includeActorAsRecipient: true,
        data: expect.objectContaining({
          originalAmount: 12500,
          conversionRate: 0.8,
          conversionSource: 'EXCHANGE',
          ledgerCurrencyCode: 'EUR',
        }),
        occurredAt: new Date('2026-07-22T00:05:00.000Z'),
      }),
    )
  })
})

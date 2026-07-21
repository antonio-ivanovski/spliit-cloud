import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'

const sendPushMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./push', () => ({
  sendPushNotification: sendPushMock,
  isPermanentPushError: () => false,
}))

import { ExpensePushActivityNotificationDispatcher } from './expense-push-dispatcher'
import type { ActivityNotificationIntent } from './types'

function summaryIntent(
  data: ActivityNotificationIntent['activity']['data'],
): ActivityNotificationIntent {
  return {
    activity: {
      activityId: 'act-summary',
      type:
        data.kind === 'import_summary'
          ? 'EXPENSES_IMPORTED'
          : 'EXPENSE_CATEGORIES_BULK_UPDATED',
      groupId: 'grp-1',
      actor: { type: 'ACCOUNT', id: 'acct-alice' },
      subject: null,
      data,
      occurredAt: new Date('2026-07-21T12:00:00Z'),
    },
    category:
      data.kind === 'import_summary'
        ? NotificationCategory.EXPENSE_CREATED
        : NotificationCategory.EXPENSE_CHANGED,
    recipientAccountId: 'acct-bob',
    channels: [NotificationChannel.PUSH],
  }
}

describe('ExpensePushActivityNotificationDispatcher summaries', () => {
  beforeEach(() => {
    sendPushMock.mockClear()
    prismaMock.group.findUnique.mockResolvedValue({
      name: 'Trip',
      groupType: 'GROUP',
      members: [],
      invitations: [],
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({ name: 'Alice' } as never)
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'push-1',
        endpoint: 'https://push.test/one',
        p256dh: 'key',
        auth: 'secret',
      },
    ] as never)
  })

  it('delivers an import summary', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch(
      summaryIntent({
        kind: 'import_summary',
        count: 4,
        sourceProvider: 'Splitwise',
      }),
    )

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/one' }),
      expect.objectContaining({
        title: 'Expenses imported',
        body: 'Alice imported 4 expenses from Splitwise in Trip.',
      }),
    )
  })

  it('delivers a bulk category summary', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch(
      summaryIntent({
        kind: 'expense_categories_bulk_updated',
        count: 2,
        rows: [],
        fromCategoryId: 'general',
      }),
    )

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Expense categories updated',
        body: 'Alice updated categories for 2 expenses in Trip.',
      }),
    )
  })
})

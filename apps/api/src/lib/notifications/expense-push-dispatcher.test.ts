import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

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

function expenseIntent(args: {
  type: ActivityNotificationIntent['activity']['type']
  data: ActivityNotificationIntent['activity']['data']
  recipientAccountId?: string
  includeActorAsRecipient?: boolean
}): ActivityNotificationIntent {
  return {
    activity: {
      activityId: 'act-push-1',
      type: args.type,
      groupId: 'grp-1',
      actor: { type: 'ACCOUNT', id: 'acct-alice' },
      subject: { type: 'EXPENSE', id: 'exp-1' },
      data: args.data,
      occurredAt: new Date('2026-07-21T12:00:00Z'),
      ...(args.includeActorAsRecipient
        ? { includeActorAsRecipient: true }
        : {}),
    },
    category:
      args.type === 'RECURRING_EXPENSE_CREATED'
        ? NotificationCategory.RECURRING_EXPENSE_CREATED
        : NotificationCategory.EXPENSE_CHANGED,
    recipientAccountId: args.recipientAccountId ?? 'acct-bob',
    channels: [NotificationChannel.PUSH],
  }
}

describe('ExpensePushActivityNotificationDispatcher recurring paths', () => {
  beforeEach(() => {
    sendPushMock.mockClear()
    prismaMock.expense.findUnique.mockResolvedValue({
      paidByList: [{ ledgerParticipantId: 'lp-alice', shares: 100 }],
      paidFor: [
        { ledgerParticipantId: 'lp-alice', shares: 1 },
        { ledgerParticipantId: 'lp-bob', shares: 1 },
      ],
      items: [],
      itemizedRemainder: null,
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        groupMember: {
          accountId: 'acct-alice',
          status: 'ACTIVE',
          account: { id: 'acct-alice', name: 'Alice' },
        },
      },
      {
        groupMember: {
          accountId: 'acct-bob',
          status: 'ACTIVE',
          account: { id: 'acct-bob', name: 'Bob' },
        },
      },
    ] as never)
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

  it('appends cadence+termination to the single-create push body', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch(
      expenseIntent({
        type: 'RECURRING_EXPENSE_CREATED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          amount: 4500,
          currencyCode: 'EUR',
          date: '2026-07-02',
          recurrence: {
            seriesId: 'series-1',
            frequency: 'MONTHLY',
            interval: 2,
            endType: 'COUNT',
            occurrenceLimit: 12,
            endDate: null,
          },
        },
      }),
    )

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('(Every 2 months, 12 total)'),
        title: 'Recurring expense created',
      }),
    )
  })

  it('omits cadence suffix when no recurrence metadata present', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch(
      expenseIntent({
        type: 'RECURRING_EXPENSE_CREATED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          amount: 4500,
          currencyCode: 'EUR',
          date: '2026-07-02',
        },
      }),
    )

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.not.stringContaining('Every '),
      }),
    )
  })

  it('renders cadence+termination on the standalone stop push body', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch({
      activity: {
        activityId: 'act-stop',
        type: 'RECURRING_EXPENSE_STOPPED',
        groupId: 'grp-1',
        actor: { type: 'ACCOUNT', id: 'acct-alice' },
        subject: null,
        data: {
          kind: 'recurring_expense_stopped',
          seriesId: 'series-1',
          title: 'Dinner',
          frequency: 'MONTHLY',
          interval: 2,
          endType: 'COUNT',
          occurrenceLimit: 12,
          endDate: null,
        },
        occurredAt: new Date('2026-07-21T12:00:00Z'),
      },
      category: NotificationCategory.EXPENSE_CHANGED,
      recipientAccountId: 'acct-bob',
      channels: [NotificationChannel.PUSH],
    })

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('(Every 2 months, 12 total)'),
        title: 'Recurring expense stopped',
      }),
    )
  })

  it('renders DATE termination on the standalone stop push body', async () => {
    await new ExpensePushActivityNotificationDispatcher().dispatch({
      activity: {
        activityId: 'act-stop-date',
        type: 'RECURRING_EXPENSE_STOPPED',
        groupId: 'grp-1',
        actor: { type: 'ACCOUNT', id: 'acct-alice' },
        subject: null,
        data: {
          kind: 'recurring_expense_stopped',
          seriesId: 'series-2',
          title: 'Gym',
          frequency: 'YEARLY',
          interval: 1,
          endType: 'DATE',
          occurrenceLimit: null,
          endDate: '2026-12-31',
        },
        occurredAt: new Date('2026-07-21T12:00:00Z'),
      },
      category: NotificationCategory.EXPENSE_CHANGED,
      recipientAccountId: 'acct-bob',
      channels: [NotificationChannel.PUSH],
    })

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('(Every year, until 2026-12-31)'),
      }),
    )
  })

  it('delivers a comment push to the direct expense URL', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      account: { id: 'acct-bob', email: 'bob@test.com', name: 'Bob' },
    } as never)

    await new ExpensePushActivityNotificationDispatcher().dispatch({
      activity: {
        activityId: 'act-comment',
        type: 'EXPENSE_COMMENTED',
        groupId: 'grp-1',
        actor: { type: 'ACCOUNT', id: 'acct-alice' },
        subject: { type: 'EXPENSE', id: 'exp-1' },
        data: {
          kind: 'expense_comment',
          commentId: 'comment-1',
          expenseTitle: 'Dinner',
          authorName: 'Alice',
          excerpt: 'Looks good',
        },
        occurredAt: new Date('2026-07-21T12:00:00Z'),
      },
      category: NotificationCategory.EXPENSE_COMMENT,
      recipientAccountId: 'acct-bob',
      channels: [NotificationChannel.PUSH],
    })

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'New expense comment',
        body: expect.stringContaining('Looks good'),
        url: expect.stringContaining('/groups/grp-1/expenses/exp-1'),
      }),
    )
  })
})

// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import {
  NotificationDeliveryStatus,
  emailTargetKey,
  pushTargetKey,
} from '@spliit/domain/notification-delivery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jobMocks = vi.hoisted(() => ({
  sendJob: vi.fn(),
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return {
    ...jobs,
    sendJob: jobMocks.sendJob,
  }
})

vi.mock('./push', () => ({ isPushConfigured: true }))

import { planActivityNotificationDeliveries } from './delivery-planner'
import type { ActivityNotificationEvent } from './types'
import type { SpliitBoss } from '@spliit/jobs'

function event(
  overrides: Partial<ActivityNotificationEvent> = {},
): ActivityNotificationEvent {
  return {
    activityId: 'activity-1',
    type: 'EXPENSE_CREATED',
    groupId: 'group-1',
    actor: { type: 'ACCOUNT', id: 'account-alice' },
    subject: { type: 'EXPENSE', id: 'expense-1' },
    data: { kind: 'expense', summary: 'Dinner' },
    occurredAt: new Date('2026-07-22T00:00:00Z'),
    ...overrides,
  }
}

const tx = prismaMock as unknown as Parameters<
  typeof planActivityNotificationDeliveries
>[0]['tx']

let lastCreatedIds: string[] = []

function mockExpenseParticipantAccount(accountId: string) {
  prismaMock.expense.findUnique.mockImplementation(((args: {
    select?: Record<string, unknown>
  }) => {
    if (args?.select?.ledger) {
      return Promise.resolve({
        id: 'expense-1',
        title: 'Dinner',
        amount: 4500,
        ledger: { currencyCode: null },
      })
    }
    return Promise.resolve({
      paidByList: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
      paidFor: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
      items: [],
      itemizedRemainder: null,
    })
  }) as never)
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([
    { groupMember: { accountId, status: 'ACTIVE' } },
  ] as never)
  prismaMock.groupMember.findFirst.mockResolvedValue(null)
}

function mockGroup(
  overrides: Partial<{ id: string; name: string; groupType: string }> = {},
) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    name: 'Trip',
    groupType: 'GROUP',
    ...overrides,
  } as never)
}

function mockAccount(
  id: string,
  name = `User ${id}`,
): { id: string; name: string } {
  return { id, name }
}

beforeEach(() => {
  jobMocks.sendJob.mockReset()
  lastCreatedIds = []
  prismaMock.accountNotificationPreference.findMany.mockResolvedValue(
    [] as never,
  )
  prismaMock.pushSubscription.findMany.mockResolvedValue([] as never)
  prismaMock.groupMember.findMany.mockResolvedValue([] as never)
  prismaMock.notificationDelivery.createMany.mockImplementation((async (args: {
    data: Array<{ id: string }>
  }) => {
    const rows = Array.isArray(args.data) ? args.data : [args.data]
    lastCreatedIds = rows.map((row) => row.id)
    return { count: rows.length }
  }) as never)
  prismaMock.notificationDelivery.findMany.mockImplementation((async () =>
    lastCreatedIds.map((id) => ({ id }))) as never)
  mockExpenseParticipantAccount('account-bob')
  mockGroup()
  prismaMock.account.findUnique.mockImplementation((async (args: {
    where: { id: string }
  }) => mockAccount(args.where.id)) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('planActivityNotificationDeliveries', () => {
  it('excludes the actor from recipients when includeActorAsRecipient is not set', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(1)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as { recipientAccountId: string }[]
    expect(data.map((row) => row.recipientAccountId)).toEqual(['account-bob'])
  })

  it('honours an explicit account/category preference override', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.PUSH],
      },
    ] as never)
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: 'push-1' },
      { id: 'push-2' },
    ] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(2)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as Array<{
      recipientAccountId: string
      channel: NotificationChannel
      targetKey: string
      pushSubscriptionId: string | null
    }>
    expect(data.every((row) => row.channel === NotificationChannel.PUSH)).toBe(
      true,
    )
    expect(data.map((row) => row.targetKey).sort()).toEqual(
      [pushTargetKey('push-1'), pushTargetKey('push-2')].sort(),
    )
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('uses system defaults when no preference row exists', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue(
      [] as never,
    )
    prismaMock.pushSubscription.findMany.mockResolvedValue([] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(1)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as Array<{ channel: NotificationChannel; targetKey: string }>
    expect(data[0]?.channel).toBe(NotificationChannel.EMAIL)
    expect(data[0]?.targetKey).toBe(emailTargetKey('account-bob'))
  })

  it('emits zero rows when the stored preference is empty (reset)', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [],
      },
    ] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toEqual([])
    expect(prismaMock.notificationDelivery.createMany).not.toHaveBeenCalled()
  })

  it('creates one row per push subscription for the same recipient', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.PUSH],
      },
    ] as never)
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: 'push-1' },
      { id: 'push-2' },
      { id: 'push-3' },
    ] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(3)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as Array<{ pushSubscriptionId: string }>
    expect(data.map((row) => row.pushSubscriptionId).sort()).toEqual([
      'push-1',
      'push-2',
      'push-3',
    ])
  })

  it('does not create any row when push is selected but no subscription exists', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.PUSH],
      },
    ] as never)
    prismaMock.pushSubscription.findMany.mockResolvedValue([] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toEqual([])
    expect(prismaMock.notificationDelivery.createMany).not.toHaveBeenCalled()
  })

  it('relies on skipDuplicates so a replayed event yields no extra rows', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)

    await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    const createCall =
      prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
    expect(createCall?.skipDuplicates).toBe(true)
    expect((createCall?.data as Array<{ eventKey: string }>)[0]?.eventKey).toBe(
      'activity:activity-1',
    )
  })

  it('deduplicates drafts that share eventKey/account/channel/target', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)
    prismaMock.notificationDelivery.findMany.mockResolvedValue([
      { id: 'delivery-already-exists' },
    ] as never)

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss: null,
    })

    expect(ids).toEqual([])
    expect(prismaMock.notificationDelivery.createMany).toHaveBeenCalledTimes(1)
  })

  it('enqueues notification.deliver jobs when a boss is provided', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)
    const boss = {} as SpliitBoss

    const ids = await planActivityNotificationDeliveries({
      event: event(),
      tx,
      boss,
    })

    expect(ids).toHaveLength(1)
    const deliveryId = ids[0]!
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(1)
    expect(jobMocks.sendJob).toHaveBeenCalledWith(
      boss,
      'notification.deliver',
      { deliveryId },
      expect.objectContaining({ singletonKey: deliveryId }),
    )
    expect(prismaMock.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            status: NotificationDeliveryStatus.PENDING,
            eventKey: 'activity:activity-1',
            recipientAccountId: 'account-bob',
            channel: NotificationChannel.EMAIL,
            targetKey: emailTargetKey('account-bob'),
          }),
        ]),
      }),
    )
  })
})

describe('planActivityNotificationDeliveries transaction rollback', () => {
  it('propagates errors from notificationDelivery.createMany', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)
    prismaMock.notificationDelivery.createMany.mockRejectedValue(
      new Error('db boom'),
    )

    await expect(
      planActivityNotificationDeliveries({
        event: event(),
        tx,
        boss: null,
      }),
    ).rejects.toThrow('db boom')
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('propagates errors from sendJob', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-bob',
        category: NotificationCategory.EXPENSE_CREATED,
        channels: [NotificationChannel.EMAIL],
      },
    ] as never)
    jobMocks.sendJob.mockRejectedValue(new Error('enqueue boom'))

    await expect(
      planActivityNotificationDeliveries({
        event: event(),
        tx,
        boss: {} as SpliitBoss,
      }),
    ).rejects.toThrow('enqueue boom')
  })
})

describe('planActivityNotificationDeliveries — event data handling', () => {
  it('reconstructs a deleted expense snapshot from parsed activity data', async () => {
    // The expense row is gone (delete-and-notify), so loadExpenseSummary
    // (which selects the ledger) returns null. Participant resolution
    // uses a different select and must still succeed.
    prismaMock.expense.findUnique.mockImplementation(
      (args: { select?: Record<string, unknown> }) => {
        if (args?.select?.ledger) return Promise.resolve(null)
        return Promise.resolve({
          paidByList: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
          paidFor: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
          items: [],
          itemizedRemainder: null,
        }) as never
      },
    )
    const ev = event({
      type: 'EXPENSE_DELETED',
      subject: { type: 'EXPENSE', id: 'expense-1' },
      data: {
        kind: 'expense',
        title: 'Hotel',
        amount: 12000,
        currencyCode: 'EUR',
        affectedParticipants: ['lp-bob'],
      },
    })
    const ids = await planActivityNotificationDeliveries({
      event: ev,
      tx,
      boss: null,
    })
    expect(ids).toHaveLength(1)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as Array<{ snapshot: { expense: unknown } }>
    expect(data[0]?.snapshot).toMatchObject({
      kind: 'expense_deleted',
      expense: {
        id: 'expense-1',
        description: 'Hotel',
        amount: 12000,
        currencyCode: 'EUR',
      },
    })
  })

  it('renders a friend-ledger event through the friend_added branch', async () => {
    const ev = event({
      activityId: null,
      type: 'INVITATION_CREATED',
      notificationCategory: NotificationCategory.FRIEND_ADDED,
      recipientAccountId: 'account-bob',
      customEventKey: 'friend:group-1:account-bob',
      data: { kind: 'invitation', summary: 'Bob added you' },
    })
    const ids = await planActivityNotificationDeliveries({
      event: ev,
      tx,
      boss: null,
    })
    expect(ids).toHaveLength(1)
    const data = prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]
      ?.data as Array<{
      activityId: string | null
      eventKey: string
      snapshot: { kind: string }
    }>
    // The synthetic event has no Activity row, so the FK must be null and
    // the event identity carried by customEventKey.
    expect(data[0]?.activityId).toBeNull()
    expect(data[0]?.eventKey).toBe('friend:group-1:account-bob')
    // The effective category (FRIEND_ADDED) wins over the INVITATION_CREATED
    // activity type, so the friend_added snapshot/email branch is used.
    expect(data[0]?.snapshot.kind).toBe('friend_added')
  })
})

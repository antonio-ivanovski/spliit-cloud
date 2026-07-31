// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

import { prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({
  resolveNotificationChannelsForIntents: vi.fn(),
  insertJobs: vi.fn(),
}))

vi.mock('./coordinator-policy', () => ({
  resolveNotificationChannelsForIntents:
    mocks.resolveNotificationChannelsForIntents,
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return { ...jobs, insertJobs: mocks.insertJobs }
})

import type { Prisma } from '@spliit/db'
import type { SpliitBoss } from '@spliit/jobs'

import { planBudgetAlertDeliveries } from './budget-planner'

const tx = prismaMock as unknown as Prisma.TransactionClient

const budget = {
  id: 'budget-1',
  groupId: 'group-1',
  name: 'Groceries',
  amount: 50_000,
  ledgerId: 'ledger-1',
  participantScope: 'SELECTED',
  participantIds: ['participant-1'],
  periodStart: new Date('2026-07-01T00:00:00.000Z'),
  periodEnd: new Date('2026-07-31T00:00:00.000Z'),
  alertType: 'OVER' as const,
  used: 51_250,
  currencyCode: 'EUR',
}

beforeEach(() => {
  mocks.resolveNotificationChannelsForIntents.mockReset()
  mocks.insertJobs.mockReset()
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([
    {
      id: 'participant-1',
      groupMember: {
        accountId: 'account-1',
        status: 'ACTIVE',
        account: { id: 'account-1', name: 'Alice' },
      },
    },
  ] as never)
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    name: 'Home',
    groupType: 'GROUP',
  } as never)
  prismaMock.notificationDelivery.createMany.mockResolvedValue({ count: 1 })
})

describe('planBudgetAlertDeliveries', () => {
  it('plans a durable delivery only for the selected account-backed participant', async () => {
    mocks.resolveNotificationChannelsForIntents.mockResolvedValue([
      {
        channels: [NotificationChannel.EMAIL],
        pushSubscriptionsByAccountId: new Map(),
      },
    ])

    const ids = await planBudgetAlertDeliveries({
      budget,
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(1)
    expect(prismaMock.ledgerParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['participant-1'] },
          kind: 'ACCOUNT_MEMBER',
          removedAt: null,
        }),
      }),
    )
    const delivery =
      prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]?.data[0]
    expect(delivery).toEqual(
      expect.objectContaining({
        activityId: null,
        category: NotificationCategory.BUDGET_ALERT,
        channel: NotificationChannel.EMAIL,
        recipientAccountId: 'account-1',
        eventKey: 'budget:budget-1:2026-07-01:OVER',
      }),
    )
    expect(delivery?.snapshot).toEqual(
      expect.objectContaining({
        kind: 'budget_alert',
        budget: expect.objectContaining({
          used: 51_250,
          limit: 50_000,
        }),
      }),
    )
  })

  it('enqueues delivery jobs when a worker queue is available', async () => {
    mocks.resolveNotificationChannelsForIntents.mockResolvedValue([
      {
        channels: [NotificationChannel.EMAIL],
        pushSubscriptionsByAccountId: new Map(),
      },
    ])
    const boss = {} as SpliitBoss

    await planBudgetAlertDeliveries({ budget, tx, boss })

    expect(mocks.insertJobs).toHaveBeenCalledWith(
      boss,
      'notification.deliver',
      [expect.objectContaining({ deliveryId: expect.any(String) })],
      expect.objectContaining({ db: expect.anything() }),
    )
  })

  it('plans for every active account member when scope is ALL', async () => {
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'participant-1',
        groupMember: {
          accountId: 'account-1',
          status: 'ACTIVE',
          account: { id: 'account-1', name: 'Alice' },
        },
      },
      {
        id: 'participant-2',
        groupMember: {
          accountId: 'account-2',
          status: 'ACTIVE',
          account: { id: 'account-2', name: 'Bob' },
        },
      },
    ] as never)
    mocks.resolveNotificationChannelsForIntents.mockResolvedValue([
      {
        channels: [NotificationChannel.EMAIL],
        pushSubscriptionsByAccountId: new Map(),
      },
      {
        channels: [NotificationChannel.EMAIL],
        pushSubscriptionsByAccountId: new Map(),
      },
    ])

    const ids = await planBudgetAlertDeliveries({
      budget: { ...budget, participantScope: 'ALL', participantIds: [] },
      tx,
      boss: null,
    })

    expect(ids).toHaveLength(2)
    const where = prismaMock.ledgerParticipant.findMany.mock.calls[0]?.[0]
      ?.where as Record<string, unknown>
    expect(where).toEqual(
      expect.objectContaining({ kind: 'ACCOUNT_MEMBER', removedAt: null }),
    )
    expect(where.id).toBeUndefined()
  })

  it('excludes members whose membership is no longer active', async () => {
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'participant-1',
        groupMember: {
          accountId: 'account-1',
          status: 'ACTIVE',
          account: { id: 'account-1', name: 'Alice' },
        },
      },
      {
        id: 'participant-2',
        groupMember: {
          accountId: 'account-2',
          status: 'LEFT',
          account: { id: 'account-2', name: 'Bob' },
        },
      },
    ] as never)
    mocks.resolveNotificationChannelsForIntents.mockResolvedValue([
      {
        channels: [NotificationChannel.EMAIL],
        pushSubscriptionsByAccountId: new Map(),
      },
    ])

    const ids = await planBudgetAlertDeliveries({
      budget: { ...budget, participantScope: 'ALL', participantIds: [] },
      tx,
      boss: null,
    })

    // The LEFT member still contributes historical shares but receives no alert.
    expect(ids).toHaveLength(1)
    const delivery =
      prismaMock.notificationDelivery.createMany.mock.calls[0]?.[0]?.data[0]
    expect(delivery).toEqual(
      expect.objectContaining({ recipientAccountId: 'account-1' }),
    )
  })
})

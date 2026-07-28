import { NotificationChannel } from '@spliit/domain/notifications'
import type { SpliitBoss } from '@spliit/jobs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../test/state'

const jobMocks = vi.hoisted(() => ({
  getApiBoss: vi.fn(),
  sendJob: vi.fn(),
  insertJobs: vi.fn(),
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return { ...jobs, sendJob: jobMocks.sendJob, insertJobs: jobMocks.insertJobs }
})

vi.mock('./boss', () => ({
  getApiBoss: jobMocks.getApiBoss,
}))

vi.mock('../notifications/push', () => ({ isPushConfigured: true }))

import { createExpenseComment } from './expense-comments'

const boss = {} as SpliitBoss
const activityTime = new Date('2026-07-27T12:00:00Z')
const activity = {
  id: 'activity-comment-1',
  ledgerId: 'ledger-1',
  time: activityTime,
  type: 'EXPENSE_COMMENTED' as const,
  actorType: 'ACCOUNT' as const,
  actorId: 'account-alice',
  subjectType: 'EXPENSE' as const,
  subjectId: 'expense-1',
  data: {
    kind: 'expense_comment' as const,
    commentId: 'comment-1',
    expenseTitle: 'Dinner',
    authorName: 'Alice',
    excerpt: 'Looks good',
  },
  expenseCommentId: 'comment-1',
}

let createdDeliveryIds: string[]
let committed: boolean

beforeEach(() => {
  createdDeliveryIds = []
  committed = false
  jobMocks.getApiBoss.mockReset()
  jobMocks.getApiBoss.mockResolvedValue(boss)
  jobMocks.sendJob.mockReset()
  jobMocks.sendJob.mockResolvedValue('job-1')
  jobMocks.insertJobs.mockReset()
  jobMocks.insertJobs.mockResolvedValue(['delivery-1'])

  prisma$Transaction.mockImplementation(async (callback) => {
    try {
      const result = await callback(prismaMock)
      committed = true
      return result
    } catch (error) {
      committed = false
      throw error
    }
  })
  prismaMock.group.findUnique.mockImplementation((async (args: {
    where: { id?: string; ledgerId?: string }
  }) => {
    if (args.where.ledgerId) return { id: 'group-1' }
    return {
      id: 'group-1',
      ledgerId: 'ledger-1',
      name: 'Trip',
      groupType: 'GROUP',
    }
  }) as never)
  prismaMock.expense.findFirst.mockResolvedValue({
    id: 'expense-1',
    title: 'Dinner',
  } as never)
  prismaMock.expenseComment.create.mockResolvedValue({
    id: 'comment-1',
    expenseId: 'expense-1',
    authorAccountId: 'account-alice',
    authorName: 'Alice',
    text: 'Looks good',
    createdAt: activityTime,
    authorAccount: { image: null },
  } as never)
  prismaMock.activity.create.mockResolvedValue(activity as never)
  prismaMock.expense.findUnique.mockImplementation((async (args: {
    select?: { ledger?: unknown }
  }) => {
    if (args.select?.ledger) {
      return {
        id: 'expense-1',
        title: 'Dinner',
        amount: 4200,
        ledger: { currencyCode: 'USD' },
      }
    }
    return {
      paidByList: [{ ledgerParticipantId: 'participant-bob', shares: 4200 }],
      paidFor: [{ ledgerParticipantId: 'participant-bob', shares: 1 }],
      items: [],
      itemizedRemainder: null,
    }
  }) as never)
  prismaMock.expenseComment.findMany.mockResolvedValue([] as never)
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([
    {
      groupMember: { accountId: 'account-bob', status: 'ACTIVE' },
    },
  ] as never)
  prismaMock.accountNotificationPreference.findMany.mockResolvedValue(
    [] as never,
  )
  prismaMock.pushSubscription.findMany.mockResolvedValue([] as never)
  prismaMock.account.findUnique.mockResolvedValue({
    id: 'account-bob',
    name: 'Bob',
  } as never)
  prismaMock.account.findMany.mockImplementation((async (args: {
    where?: { id?: { in?: string[] } | string }
  }) => {
    const ids = (() => {
      if (!args?.where?.id) return [] as string[]
      if (typeof args.where.id === 'string') return [args.where.id]
      return args.where.id.in ?? []
    })()
    return ids.map((id) =>
      id === 'account-alice'
        ? { id, name: 'Alice' }
        : { id, name: id === 'account-bob' ? 'Bob' : `User ${id}` },
    )
  }) as never)
  prismaMock.notificationDelivery.createMany.mockImplementation((async (args: {
    data: Array<{ id: string }>
  }) => {
    createdDeliveryIds = args.data.map((row) => row.id)
    return { count: createdDeliveryIds.length }
  }) as never)
  prismaMock.notificationDelivery.findMany.mockImplementation((async () =>
    createdDeliveryIds.map((id) => ({ id }))) as never)
})

describe('API activity notification planning', () => {
  it('commits the activity, delivery rows, and enqueue together', async () => {
    const result = await createExpenseComment({
      groupId: 'group-1',
      expenseId: 'expense-1',
      authorAccountId: 'account-alice',
      authorName: 'Alice',
      text: 'Looks good',
    })

    expect(result.activity).toEqual(activity)
    expect(committed).toBe(true)
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            activityId: activity.id,
            recipientAccountId: 'account-bob',
            channel: NotificationChannel.EMAIL,
          }),
        ]),
      }),
    )
    expect(jobMocks.insertJobs).toHaveBeenCalledTimes(1)
  })

  it('does not commit when enqueue fails', async () => {
    jobMocks.insertJobs.mockRejectedValue(new Error('enqueue failed'))

    await expect(
      createExpenseComment({
        groupId: 'group-1',
        expenseId: 'expense-1',
        authorAccountId: 'account-alice',
        authorName: 'Alice',
        text: 'Looks good',
      }),
    ).rejects.toThrow('enqueue failed')

    expect(committed).toBe(false)
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.notificationDelivery.createMany).toHaveBeenCalledTimes(1)
  })

  it('persists pending deliveries without enqueue when jobs are disabled', async () => {
    jobMocks.getApiBoss.mockResolvedValue(null)

    await createExpenseComment({
      groupId: 'group-1',
      expenseId: 'expense-1',
      authorAccountId: 'account-alice',
      authorName: 'Alice',
      text: 'Looks good',
    })

    expect(committed).toBe(true)
    expect(prismaMock.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ status: 'PENDING' }),
        ]),
      }),
    )
    expect(jobMocks.insertJobs).not.toHaveBeenCalled()
  })
})

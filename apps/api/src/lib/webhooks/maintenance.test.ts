import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  deliveryFindMany: vi.fn(),
  deliveryUpdateMany: vi.fn(),
  deliveryDeleteMany: vi.fn(),
  attemptUpdateMany: vi.fn(),
  eventDeleteMany: vi.fn(),
  transaction: vi.fn(),
  sendJob: vi.fn(),
}))

vi.mock('@spliit/db', () => ({
  prisma: {
    webhookDelivery: {
      findMany: hoisted.deliveryFindMany,
      updateMany: hoisted.deliveryUpdateMany,
      deleteMany: hoisted.deliveryDeleteMany,
    },
    webhookDeliveryAttempt: { updateMany: hoisted.attemptUpdateMany },
    webhookEvent: { deleteMany: hoisted.eventDeleteMany },
    $transaction: hoisted.transaction,
  },
}))

vi.mock('@spliit/jobs', () => ({
  JOB_NAMES: { WEBHOOK_DELIVER: 'webhook.deliver' },
  sendJob: hoisted.sendJob,
}))

import type { SpliitBoss } from '@spliit/jobs'

import { reconcileWebhookDeliveries } from './maintenance'

const boss = {} as SpliitBoss

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.deliveryFindMany.mockResolvedValue([])
  hoisted.deliveryUpdateMany.mockResolvedValue({ count: 1 })
  hoisted.attemptUpdateMany.mockResolvedValue({ count: 1 })
  hoisted.transaction.mockImplementation(
    async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  )
  hoisted.sendJob.mockResolvedValue('job-1')
})

describe('reconcileWebhookDeliveries', () => {
  it('recovers stale PROCESSING rows and closes their abandoned attempts', async () => {
    hoisted.deliveryFindMany
      .mockResolvedValueOnce([{ id: 'del-1' }, { id: 'del-2' }])
      .mockResolvedValueOnce([{ id: 'del-1' }, { id: 'del-2' }])

    const result = await reconcileWebhookDeliveries(boss)

    expect(hoisted.deliveryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['del-1', 'del-2'] }, status: 'PROCESSING' },
      data: {
        status: 'PENDING',
        lastErrorCode: 'STALE_ATTEMPT',
        lastErrorMessage: 'Recovered an interrupted delivery attempt',
      },
    })
    expect(hoisted.attemptUpdateMany).toHaveBeenCalledWith({
      where: { deliveryId: { in: ['del-1', 'del-2'] }, finishedAt: null },
      data: { finishedAt: expect.any(Date), outcome: 'RETRYING' },
    })
    expect(result.reconciled).toBe(2)
    expect(hoisted.sendJob).toHaveBeenCalledTimes(2)
    expect(hoisted.sendJob).toHaveBeenCalledWith(boss, 'webhook.deliver', {
      deliveryId: 'del-1',
    })
  })

  it('skips attempt cleanup when nothing is stale but still enqueues pending rows', async () => {
    hoisted.deliveryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'del-9' }])

    const result = await reconcileWebhookDeliveries(boss)

    expect(hoisted.transaction).not.toHaveBeenCalled()
    expect(hoisted.attemptUpdateMany).not.toHaveBeenCalled()
    expect(hoisted.deliveryUpdateMany).not.toHaveBeenCalled()
    expect(hoisted.sendJob).toHaveBeenCalledWith(boss, 'webhook.deliver', {
      deliveryId: 'del-9',
    })
    expect(result).toEqual({ reconciled: 1, nextCursor: null })
  })
})

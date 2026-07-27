import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendJob: vi.fn(),
}))

vi.mock('@spliit/db', () => ({
  prisma: {
    notificationDelivery: {
      findMany: hoisted.findMany,
    },
  },
}))

vi.mock('@spliit/jobs', () => ({
  ...({} as Record<string, unknown>),
  JOB_NAMES: { NOTIFICATION_DELIVER: 'notification.deliver' },
  sendJob: hoisted.sendJob,
}))

import type { SpliitBoss } from '@spliit/jobs'
import { reconcileMissingDeliveryJobs } from './delivery-reconciliation'

const boss = {} as SpliitBoss

describe('delivery-reconciliation', () => {
  it('enqueues missing delivery jobs for PENDING and PROCESSING rows', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue('job-1')
    hoisted.findMany.mockResolvedValue([
      { id: 'delivery-1' },
      { id: 'delivery-2' },
    ])

    const result = await reconcileMissingDeliveryJobs(boss)

    expect(result.reconciled).toBe(2)
    expect(result.scanned).toBe(2)
    expect(result.nextCursor).toBeNull()
    expect(hoisted.sendJob).toHaveBeenCalledTimes(2)
    expect(hoisted.sendJob).toHaveBeenCalledWith(
      boss,
      'notification.deliver',
      { deliveryId: 'delivery-1' },
      { singletonKey: 'delivery-1' },
    )
    expect(hoisted.sendJob).toHaveBeenCalledWith(
      boss,
      'notification.deliver',
      { deliveryId: 'delivery-2' },
      { singletonKey: 'delivery-2' },
    )
  })

  it('counts a row as reconciled only when sendJob returns a job id', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue(undefined)
    hoisted.findMany.mockResolvedValue([{ id: 'delivery-1' }])

    const result = await reconcileMissingDeliveryJobs(boss)

    expect(result.reconciled).toBe(0)
    expect(result.scanned).toBe(1)
    expect(result.nextCursor).toBeNull()
    expect(hoisted.sendJob).toHaveBeenCalledTimes(1)
  })

  it('returns zero when no deliveries need reconciliation', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.findMany.mockResolvedValue([])

    const result = await reconcileMissingDeliveryJobs(boss)

    expect(result.reconciled).toBe(0)
    expect(result.scanned).toBe(0)
    expect(result.nextCursor).toBeNull()
    expect(hoisted.sendJob).not.toHaveBeenCalled()
  })

  it('paginates deterministically by ascending id to avoid starvation', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue('job-x')
    hoisted.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({ id: `d${i}` })),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` })),
      )
      .mockResolvedValue([])

    const result = await reconcileMissingDeliveryJobs(boss)

    expect(result.reconciled).toBe(105)
    expect(result.scanned).toBe(105)
    expect(result.nextCursor).toBeNull()
    expect(hoisted.findMany).toHaveBeenCalledTimes(2)
    expect(hoisted.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'd99' } }),
        orderBy: { id: 'asc' },
        take: 100,
      }),
    )
  })

  it('stops after the scan limit and returns a continuation cursor', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue(undefined)
    // Every page is a full batch so the walk never exhausts naturally.
    // The scan limit (1000) is hit after 10 full pages.
    hoisted.findMany.mockImplementation(async () =>
      Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}` })),
    )

    const result = await reconcileMissingDeliveryJobs(boss)

    expect(result.scanned).toBe(1000)
    expect(result.reconciled).toBe(0)
    expect(result.nextCursor).toBe('row-99')
    expect(hoisted.findMany).toHaveBeenCalledTimes(10)
  })

  it('resumes from a provided cursor', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue('job-1')
    hoisted.findMany.mockResolvedValue([{ id: 'after-cursor' }])

    const result = await reconcileMissingDeliveryJobs(boss, {
      cursor: 'prev-cursor',
    })

    expect(result.reconciled).toBe(1)
    expect(hoisted.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'prev-cursor' } }),
      }),
    )
  })

  it('queries for PENDING and PROCESSING statuses only', async () => {
    hoisted.findMany.mockReset()
    hoisted.sendJob.mockReset()
    hoisted.sendJob.mockResolvedValue('job-1')
    hoisted.findMany.mockResolvedValue([{ id: 'd' }])

    await reconcileMissingDeliveryJobs(boss)

    expect(hoisted.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        },
        orderBy: { id: 'asc' },
        take: 100,
      }),
    )
  })
})

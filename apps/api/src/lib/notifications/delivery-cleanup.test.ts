import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@spliit/db', () => ({
  prisma: {
    notificationDelivery: {
      deleteMany: hoisted.deleteMany,
      findMany: hoisted.findMany,
    },
  },
}))

import {
  runNotificationCleanup,
  SENT_RETENTION_MS,
  TERMINAL_FAILURE_RETENTION_MS,
} from './delivery-cleanup'

describe('delivery-cleanup', () => {
  it('deletes SENT rows older than 24 hours using id-bounded batches', async () => {
    hoisted.findMany.mockReset()
    hoisted.deleteMany.mockReset()
    hoisted.deleteMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => ({
        count: args.where.id.in.length,
      }),
    )
    // SENT page: 3 eligible ids, then no more. Failed page: none.
    hoisted.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([])

    const result = await runNotificationCleanup()

    expect(result.sentDeleted).toBe(3)
    expect(result.failedDeleted).toBe(0)
    expect(hoisted.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SENT' }),
        orderBy: { id: 'asc' },
        take: 500,
      }),
    )
    expect(hoisted.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a', 'b', 'c'] } } }),
    )
  })

  it('deletes PERMANENT_FAILURE and RETRY_EXHAUSTED rows older than 30 days', async () => {
    hoisted.findMany.mockReset()
    hoisted.deleteMany.mockReset()
    hoisted.deleteMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => ({
        count: args.where.id.in.length,
      }),
    )
    // SENT page: none. Failed page: 2 eligible ids, then no more.
    hoisted.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'd' }, { id: 'e' }])
      .mockResolvedValueOnce([])

    const result = await runNotificationCleanup()

    expect(result.failedDeleted).toBe(2)
    expect(hoisted.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PERMANENT_FAILURE', 'RETRY_EXHAUSTED'] },
        }),
        orderBy: { id: 'asc' },
        take: 500,
      }),
    )
    expect(hoisted.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['d', 'e'] } } }),
    )
  })

  it('batches deletions in id-bounded chunks of 500', async () => {
    hoisted.findMany.mockReset()
    hoisted.deleteMany.mockReset()
    hoisted.deleteMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => ({
        count: args.where.id.in.length,
      }),
    )
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `s${i}` }))
    // SENT: full 500 page, then 200 more, then empty. Failed: empty.
    hoisted.findMany
      .mockResolvedValueOnce(page(500))
      .mockResolvedValueOnce(page(200))
      .mockResolvedValueOnce([])
      .mockResolvedValue([])

    const result = await runNotificationCleanup()

    expect(result.sentDeleted).toBe(700)
    // Two SENT deletions (500 + 200); the third SENT findMany and the
    // failed findMany returned empty so no further deletes.
    expect(hoisted.deleteMany).toHaveBeenCalledTimes(2)
  })

  it('has correct retention periods', () => {
    expect(SENT_RETENTION_MS).toBe(24 * 60 * 60 * 1000)
    expect(TERMINAL_FAILURE_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})

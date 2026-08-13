import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@spliit/db', () => ({
  prisma: {
    account: {
      deleteMany: mocks.deleteMany,
      findMany: mocks.findMany,
    },
  },
}))

import {
  runAnonymousAccountCleanup,
  UNACKNOWLEDGED_ANONYMOUS_ACCOUNT_RETENTION_MS,
} from './anonymous-account-cleanup'

describe('anonymous-account-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => ({
        count: args.where.id.in.length,
      }),
    )
  })

  it('deletes credential-less and unacknowledged anonymous accounts older than one week', async () => {
    const now = new Date('2026-08-14T12:00:00.000Z')
    mocks.findMany.mockResolvedValueOnce([
      { id: 'anonymous-1' },
      { id: 'anonymous-2' },
    ])

    await expect(runAnonymousAccountCleanup(now)).resolves.toEqual({
      deleted: 2,
    })

    const cutoff = new Date(
      now.getTime() - UNACKNOWLEDGED_ANONYMOUS_ACCOUNT_RETENTION_MS,
    )
    const eligibility = {
      isAnonymous: true,
      OR: [
        {
          createdAt: { lte: cutoff },
          anonymousRecoveryCredential: { is: null },
        },
        {
          anonymousRecoveryCredential: {
            is: {
              acknowledgedAt: null,
              createdAt: { lte: cutoff },
            },
          },
        },
      ],
    }
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: eligibility,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    })
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        ...eligibility,
        id: { in: ['anonymous-1', 'anonymous-2'] },
      },
    })
  })

  it('does nothing when no abandoned account is eligible', async () => {
    mocks.findMany.mockResolvedValueOnce([])

    await expect(runAnonymousAccountCleanup()).resolves.toEqual({ deleted: 0 })
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })

  it('processes eligible accounts in bounded batches', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: `anonymous-${index}`,
    }))
    mocks.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([])

    await expect(runAnonymousAccountCleanup()).resolves.toEqual({
      deleted: 100,
    })
    expect(mocks.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('uses a seven-day retention period', () => {
    expect(UNACKNOWLEDGED_ANONYMOUS_ACCOUNT_RETENTION_MS).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
  })
})

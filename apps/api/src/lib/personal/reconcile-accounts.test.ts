import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock, resetPrisma } from '../../test/state'
import type * as inclusionModule from './inclusion'

vi.mock('./inclusion', async (importOriginal) => {
  const actual = await importOriginal<typeof inclusionModule>()
  return {
    ...actual,
    runPersonalSyncResult: vi.fn(async () => 1),
  }
})

import { JOB_NAMES } from '@spliit/jobs'

import { runPersonalSyncResult } from './inclusion'
import { reconcilePersonalAccounts } from './reconcile-accounts'

const mockedSync = vi.mocked(runPersonalSyncResult)

function boss() {
  return { send: vi.fn(async () => 'job-1') } as never
}

beforeEach(() => {
  resetPrisma()
  vi.clearAllMocks()
})

describe('reconcilePersonalAccounts', () => {
  it('enumerates every profile, including master-off accounts, and reconciles each', async () => {
    prismaMock.personalProfile.findMany.mockResolvedValue([
      { accountId: 'a-1' },
      { accountId: 'a-off' },
    ] as never)

    const result = await reconcilePersonalAccounts(boss(), {})

    // No sharedEnabled filter: master-off accounts must be paged so their
    // linked rows get cleanup/orphan repair through the normal path.
    expect(prismaMock.personalProfile.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    )
    expect(prismaMock.personalProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        orderBy: { accountId: 'asc' },
      }),
    )
    expect(mockedSync).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ scanned: 2, reconciled: 2 })
  })

  it('continues pages with a singleton continuation key', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      accountId: `a-${String(i).padStart(3, '0')}`,
    }))
    prismaMock.personalProfile.findMany.mockResolvedValue(rows as never)
    const fakeBoss = boss()

    const result = await reconcilePersonalAccounts(fakeBoss, {})

    expect(result.nextCursor).toBe('a-049')
    expect(fakeBoss.send).toHaveBeenCalledWith(
      JOB_NAMES.RECONCILE_PERSONAL,
      { cursor: 'a-049' },
      expect.objectContaining({
        singletonKey: 'personal-reconcile:a-049',
      }),
    )
  })

  it('skips permanent failures and retries retryable pages', async () => {
    const { PersonalSyncError } = await import('./inclusion')
    prismaMock.personalProfile.findMany.mockResolvedValue([
      { accountId: 'a-1' },
      { accountId: 'a-2' },
    ] as never)
    mockedSync
      .mockRejectedValueOnce(
        new PersonalSyncError({ message: 'permanent', retryable: false }),
      )
      .mockResolvedValueOnce(1 as never)

    const result = await reconcilePersonalAccounts(boss(), {})

    expect(result).toMatchObject({ scanned: 2, reconciled: 1 })

    mockedSync.mockRejectedValueOnce(
      new PersonalSyncError({ message: 'deadlock detected', retryable: true }),
    )
    await expect(reconcilePersonalAccounts(boss(), {})).rejects.toThrow()
  })
})

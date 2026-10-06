import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({ sendJob: vi.fn(), getBoss: vi.fn() }))
vi.mock('./boss', () => ({ getApiBossForWrite: mocks.getBoss }))
vi.mock('@spliit/jobs', async (original) => ({
  ...(await original()),
  sendJob: mocks.sendJob,
}))

import {
  processCategorizationJob,
  retryCategorizationRun,
} from './bulk-categorization-run'

beforeEach(() => {
  mocks.getBoss.mockReset().mockResolvedValue({})
  mocks.sendJob.mockReset().mockResolvedValue('job-1')
  prisma$Transaction.mockImplementation(async (callback) =>
    (callback as (tx: unknown) => Promise<unknown>)(prismaMock),
  )
})

describe('categorization job safety', () => {
  it('ignores a duplicate or obsolete job without reading candidates', async () => {
    prismaMock.bulkCategorizationRun.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never)
    await processCategorizationJob('run-1', 'full', 'obsolete-attempt')
    expect(prismaMock.bulkCategorizationRow.findMany).not.toHaveBeenCalled()
  })

  it('retries a failed full pass with a new attempt and keeps saved progress', async () => {
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
      id: 'run-1',
      status: 'FAILED_FULL',
      revision: 3,
      processed: 25,
      updatedAt: new Date(),
    } as never)
    prismaMock.bulkCategorizationRun.updateMany.mockResolvedValueOnce({
      count: 1,
    } as never)
    await retryCategorizationRun('run-1', 3)
    expect(prismaMock.bulkCategorizationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', revision: 3 },
        data: expect.objectContaining({
          status: 'QUEUED',
          revision: { increment: 1 },
        }),
      }),
    )
    expect(mocks.sendJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        runId: 'run-1',
        phase: 'full',
        attemptId: expect.any(String),
      }),
      expect.anything(),
    )
  })

  it('rejects retry after another admin changed the review', async () => {
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
      id: 'run-1',
      status: 'FAILED_RERUN',
      revision: 4,
      updatedAt: new Date(),
    } as never)
    await expect(retryCategorizationRun('run-1', 3)).rejects.toThrow('Refresh')
    expect(mocks.sendJob).not.toHaveBeenCalled()
  })
})

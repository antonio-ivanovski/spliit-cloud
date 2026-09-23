import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({
  categorize: vi.fn(),
  neighbors: vi.fn(),
  sendJob: vi.fn(),
  getBoss: vi.fn(),
}))
vi.mock('../ai/batch-categorize', () => ({
  categorizeExpensesWithJev: mocks.categorize,
}))
vi.mock('../ai/jev-neighbors', () => ({
  loadJevDateNeighbors: mocks.neighbors,
}))
vi.mock('./boss', () => ({ getApiBossForWrite: mocks.getBoss }))
vi.mock('@spliit/jobs', async (original) => ({
  ...(await original()),
  sendJob: mocks.sendJob,
}))

import {
  processCategorizationJob,
  retryCategorizationRun,
} from './bulk-categorization-run'

describe('resumable automatic Jev pass', () => {
  let run: Record<string, unknown>
  beforeEach(() => {
    run = {
      id: 'run-1',
      groupId: 'group-1',
      accountId: 'account-1',
      mode: 'jev',
      status: 'QUEUED',
      locale: 'en-US',
      total: 1,
      processed: 0,
      round: 1,
      applied: 0,
      skipped: 0,
      candidates: [
        {
          id: 'expense-1',
          title: 'Market',
          version: 1,
          expenseDate: '2026-09-22T00:00:00.000Z',
          amount: 100,
          currency: 'USD',
        },
      ],
      calibration: {
        sample: [],
        confirmed: [],
        metrics: [],
        existingCategorized: 0,
        next: 'full',
      },
      examples: [],
      suggestions: [],
      error: null,
    }
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockImplementation(
      async () => run as never,
    )
    prismaMock.bulkCategorizationRun.findUnique.mockImplementation(
      async () => run as never,
    )
    prismaMock.bulkCategorizationRun.update.mockImplementation(async (args) => {
      run = { ...run, ...args.data }
      return run as never
    })
    mocks.categorize.mockReset()
    mocks.neighbors.mockReset().mockResolvedValue(new Map())
    mocks.getBoss.mockReset().mockResolvedValue({})
    mocks.sendJob.mockReset().mockResolvedValue('job-1')
  })

  it('retries the saved second-pass target without repeating the first pass', async () => {
    mocks.categorize
      .mockResolvedValueOnce(
        new Map([
          [
            'expense-1',
            { categoryId: 'general', confidence: 0.9, probabilities: [] },
          ],
        ]),
      )
      .mockRejectedValueOnce(new Error('temporary Jev failure'))
      .mockResolvedValueOnce(
        new Map([
          [
            'expense-1',
            { categoryId: 'groceries', confidence: 0.9, probabilities: [] },
          ],
        ]),
      )
    await expect(processCategorizationJob('run-1', 'full')).rejects.toThrow(
      'temporary Jev failure',
    )
    expect(run.status).toBe('FAILED_FULL')
    expect(run.examples).toMatchObject({
      phase: 'second',
      targetIds: ['expense-1'],
    })
    expect(run.processed).toBe(0)
    await retryCategorizationRun('run-1')
    await processCategorizationJob('run-1', 'full')
    expect(mocks.categorize).toHaveBeenCalledTimes(3)
    expect(run.status).toBe('REVIEW')
    expect(run.suggestions).toMatchObject([
      {
        categoryId: 'groceries',
        firstPass: { categoryId: 'general' },
        secondPass: { categoryId: 'groceries' },
      },
    ])
  })
})

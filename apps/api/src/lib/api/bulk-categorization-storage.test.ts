import { beforeEach, describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../test/state'
import {
  getCategorizationReviewPage,
  updateRunSuggestions,
} from './bulk-categorization-run'

beforeEach(() => {
  prisma$Transaction.mockImplementation(async (callback) =>
    (callback as (tx: unknown) => Promise<unknown>)(prismaMock),
  )
})

describe('paged categorization review', () => {
  it('reads only a bounded page in its saved review order', async () => {
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
      revision: 2,
      status: 'REVIEW',
      candidateTotal: 10_000,
    } as never)
    prismaMock.bulkCategorizationRow.findMany.mockResolvedValue([] as never)
    const page = await getCategorizationReviewPage('run-1', 9_900, 100)
    expect(page).toEqual({
      rows: [],
      total: 10_000,
      revision: 2,
      nextCursor: null,
    })
    expect(prismaMock.bulkCategorizationRow.findMany).toHaveBeenCalledWith({
      where: { runId: 'run-1', reviewOrder: { gt: 9_900 } },
      orderBy: { reviewOrder: 'asc' },
      take: 100,
    })
  })

  it('filters General rows while keeping a stable review-order cursor', async () => {
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
      revision: 2,
      status: 'REVIEW',
      candidateTotal: 10_000,
    } as never)
    prismaMock.bulkCategorizationRow.findMany.mockResolvedValue([] as never)
    prismaMock.bulkCategorizationRow.count.mockResolvedValue(17 as never)
    const page = await getCategorizationReviewPage('run-1', 95, 100, 'general')
    expect(page.total).toBe(17)
    expect(prismaMock.bulkCategorizationRow.findMany).toHaveBeenCalledWith({
      where: {
        runId: 'run-1',
        reviewOrder: { gt: 95 },
        categoryId: 'general',
      },
      orderBy: { reviewOrder: 'asc' },
      take: 100,
    })
  })

  it('edits one draft row and returns revised counts', async () => {
    prismaMock.bulkCategorizationRun.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      revision: 5,
      candidateTotal: 100,
    } as never)
    prismaMock.bulkCategorizationRow.findUnique.mockResolvedValue({
      runId: 'run-1',
      expenseId: 'expense-1',
      stage: 'SUGGESTED',
      title: 'Taxi',
      expenseVersion: 1,
      expenseDate: new Date(),
      amount: 100,
      currency: 'USD',
      categoryId: 'general',
      initialCategoryId: 'general',
      source: 'none',
      choices: [],
      rerunFeedback: false,
    } as never)
    prismaMock.bulkCategorizationRow.update.mockResolvedValue({} as never)
    prismaMock.bulkCategorizationRow.count
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(1 as never)

    await expect(
      updateRunSuggestions('run-1', 4, [
        { expenseId: 'expense-1', categoryId: 'taxi' },
      ]),
    ).resolves.toEqual({
      revision: 5,
      selected: 1,
      general: 99,
      newFeedback: 1,
    })
    expect(prismaMock.bulkCategorizationRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId_expenseId: { runId: 'run-1', expenseId: 'expense-1' } },
        data: expect.objectContaining({
          categoryId: 'taxi',
          manualCorrection: true,
        }),
      }),
    )
  })

  it('rejects a stale edit before touching any draft row', async () => {
    prismaMock.bulkCategorizationRun.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    await expect(
      updateRunSuggestions('run-1', 3, [
        { expenseId: 'expense-1', categoryId: 'taxi' },
      ]),
    ).rejects.toThrow('Refresh')
    expect(prismaMock.bulkCategorizationRow.update).not.toHaveBeenCalled()
  })
})

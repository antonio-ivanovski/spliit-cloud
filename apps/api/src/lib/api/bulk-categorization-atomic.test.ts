import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CATEGORY_ID } from '@spliit/domain'

import '../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({
  getApiBoss: vi.fn(),
  logActivity: vi.fn(),
  planNotificationForActivity: vi.fn(),
  hasEligibleWebhookEndpoints: vi.fn(),
  enqueueBudgetEvaluation: vi.fn(),
}))

vi.mock('./boss', () => ({ getApiBoss: mocks.getApiBoss }))
vi.mock('./activities', () => ({
  logActivity: mocks.logActivity,
  planNotificationForActivity: mocks.planNotificationForActivity,
}))
vi.mock('../webhooks/planner', () => ({
  hasEligibleWebhookEndpoints: mocks.hasEligibleWebhookEndpoints,
  planExpenseBatchWebhook: vi.fn(),
}))
vi.mock('../webhooks/snapshot', () => ({
  loadExpenseSnapshotsChunked: vi.fn(),
}))
vi.mock('../budgets/enqueue', () => ({
  enqueueBudgetEvaluation: mocks.enqueueBudgetEvaluation,
}))

import { applyCategorizationRun } from './bulk-categorization-run'

const run = {
  id: 'run-1',
  groupId: 'group-1',
  accountId: 'account-1',
  status: 'REVIEW',
  suggestions: [
    {
      id: 'expense-1',
      title: 'Lunch',
      version: 1,
      expenseDate: '2026-09-01T00:00:00.000Z',
      amount: 1200,
      currency: 'USD',
      categoryId: 'food-and-drink',
      initialCategoryId: 'food-and-drink',
      source: 'local',
      choices: [],
    },
    {
      id: 'expense-2',
      title: 'Taxi',
      version: 2,
      expenseDate: '2026-09-02T00:00:00.000Z',
      amount: 800,
      currency: 'USD',
      categoryId: 'transportation',
      initialCategoryId: 'transportation',
      source: 'local',
      choices: [],
    },
  ],
}

let transactionCommitted: boolean

beforeEach(() => {
  transactionCommitted = false
  mocks.getApiBoss.mockReset().mockResolvedValue({})
  mocks.logActivity
    .mockReset()
    .mockResolvedValue({ id: 'activity-1', time: new Date() })
  mocks.planNotificationForActivity.mockReset().mockResolvedValue(undefined)
  mocks.hasEligibleWebhookEndpoints.mockReset().mockResolvedValue(false)
  mocks.enqueueBudgetEvaluation.mockReset().mockResolvedValue(undefined)

  prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue(
    run as never,
  )
  prismaMock.bulkCategorizationRun.updateMany.mockResolvedValue({
    count: 1,
  } as never)
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    ledgerId: 'ledger-1',
    archived: false,
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([
    {
      id: 'expense-1',
      title: 'Lunch',
      categoryId: DEFAULT_CATEGORY_ID,
      version: 1,
    },
    {
      id: 'expense-2',
      title: 'Taxi',
      categoryId: DEFAULT_CATEGORY_ID,
      version: 2,
    },
  ] as never)
  prismaMock.expense.updateMany.mockResolvedValue({ count: 1 } as never)
  prisma$Transaction.mockImplementation(async (callback) => {
    try {
      const result = await (callback as (tx: unknown) => Promise<unknown>)(
        prismaMock,
      )
      transactionCommitted = true
      return result
    } catch (error) {
      transactionCommitted = false
      throw error
    }
  })
})

describe('atomic bulk categorization save', () => {
  it('commits category writes and run completion together', async () => {
    await expect(applyCategorizationRun('run-1')).resolves.toEqual({
      groupId: 'group-1',
      applied: 2,
      skipped: 0,
    })

    expect(transactionCommitted).toBe(true)
    expect(prismaMock.bulkCategorizationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', status: 'REVIEW' },
        data: expect.objectContaining({ status: 'DONE', applied: 2 }),
      }),
    )
    expect(prisma$Transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10000,
      timeout: 60000,
    })
  })

  it('rejects the transaction if any selected expense has a stale version', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      {
        id: 'expense-1',
        title: 'Lunch',
        categoryId: DEFAULT_CATEGORY_ID,
        version: 1,
      },
      {
        id: 'expense-2',
        title: 'Taxi',
        categoryId: DEFAULT_CATEGORY_ID,
        version: 3,
      },
    ] as never)

    await expect(applyCategorizationRun('run-1')).rejects.toThrow(
      'No categories were applied',
    )

    expect(transactionCommitted).toBe(false)
    expect(prismaMock.bulkCategorizationRun.updateMany).not.toHaveBeenCalled()
  })
})

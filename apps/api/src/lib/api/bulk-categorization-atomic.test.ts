import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prisma$Transaction, prismaMock } from '../../test/state'

const mocks = vi.hoisted(() => ({
  bulkUpdate: vi.fn(),
  enqueueBudgetEvaluation: vi.fn(),
}))
vi.mock('./category-bulk', () => ({
  bulkUpdateExpenseCategories: mocks.bulkUpdate,
}))
vi.mock('../budgets/enqueue', () => ({
  enqueueBudgetEvaluation: mocks.enqueueBudgetEvaluation,
}))

import { applyCategorizationRun } from './bulk-categorization-run'

const row = (index: number) => ({
  expenseId: `expense-${index}`,
  expenseVersion: 1,
  categoryId: 'groceries',
  title: `Expense ${index}`,
})
let transactionCommitted: boolean

beforeEach(() => {
  transactionCommitted = false
  prismaMock.bulkCategorizationRun.updateMany.mockResolvedValue({
    count: 1,
  } as never)
  prismaMock.bulkCategorizationRun.findUniqueOrThrow.mockResolvedValue({
    id: 'run-1',
    groupId: 'group-1',
    status: 'REVIEW',
    revision: 1,
  } as never)
  prismaMock.bulkCategorizationRow.findMany.mockResolvedValue([
    row(1),
    row(2),
  ] as never)
  prismaMock.bulkCategorizationRun.update.mockResolvedValue({} as never)
  prismaMock.group.findUniqueOrThrow.mockResolvedValue({
    ledgerId: 'ledger-1',
  } as never)
  prismaMock.expense.findMany.mockImplementation(async (args: unknown) => {
    const ids = (args as { where?: { id?: { in?: string[] } } })?.where?.id
      ?.in as string[] | undefined
    return (ids ?? []).map((id) => ({
      id,
      version: 1,
      categoryId: 'general',
    })) as never
  })
  mocks.bulkUpdate.mockReset().mockResolvedValue({ applied: 2, skipped: 0 })
  mocks.enqueueBudgetEvaluation.mockReset().mockResolvedValue(undefined)
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
  it('uses the saving admin and commits category writes with completion', async () => {
    await expect(
      applyCategorizationRun('run-1', 1, 'saving-admin'),
    ).resolves.toEqual({
      groupId: 'group-1',
      applied: 2,
      skipped: 0,
    })
    expect(transactionCommitted).toBe(true)
    expect(mocks.bulkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'saving-admin',
        setBased: true,
        transaction: prismaMock,
      }),
    )
    expect(prismaMock.bulkCategorizationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DONE', applied: 2 }),
      }),
    )
  })

  it('rolls back when one selected expense conflicts', async () => {
    mocks.bulkUpdate.mockResolvedValueOnce({ applied: 1, skipped: 1 })
    await expect(
      applyCategorizationRun('run-1', 1, 'saving-admin'),
    ).rejects.toThrow('No categories were applied')
    expect(transactionCommitted).toBe(false)
    expect(prismaMock.bulkCategorizationRun.update).not.toHaveBeenCalled()
  })

  it('rolls back the whole save when a later chunk fails', async () => {
    prismaMock.bulkCategorizationRow.findMany.mockResolvedValueOnce(
      Array.from({ length: 2001 }, (_, index) => row(index)) as never,
    )
    mocks.bulkUpdate
      .mockResolvedValueOnce({ applied: 2000, skipped: 0 })
      .mockRejectedValueOnce(new Error('write failed'))
    await expect(
      applyCategorizationRun('run-1', 1, 'saving-admin'),
    ).rejects.toThrow('write failed')
    expect(transactionCommitted).toBe(false)
    expect(mocks.bulkUpdate).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale review revision before writing expenses', async () => {
    prismaMock.bulkCategorizationRun.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never)
    await expect(
      applyCategorizationRun('run-1', 0, 'saving-admin'),
    ).rejects.toThrow('Refresh')
    expect(mocks.bulkUpdate).not.toHaveBeenCalled()
  })

  it('blocks save when a selected expense changed and reports no writes', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 'expense-1', version: 2, categoryId: 'general' },
      { id: 'expense-2', version: 1, categoryId: 'general' },
    ] as never)
    await expect(
      applyCategorizationRun('run-1', 1, 'saving-admin'),
    ).rejects.toThrow('Some selected expenses changed')
    expect(transactionCommitted).toBe(false)
    expect(mocks.bulkUpdate).not.toHaveBeenCalled()
    expect(prismaMock.bulkCategorizationRun.update).not.toHaveBeenCalled()
  })

  it('saves unaffected expenses when conflicts are explicitly skipped', async () => {
    prismaMock.expense.findMany.mockImplementation(
      async () =>
        [
          { id: 'expense-1', version: 2, categoryId: 'general' },
          { id: 'expense-2', version: 1, categoryId: 'general' },
        ] as never,
    )
    mocks.bulkUpdate.mockResolvedValueOnce({ applied: 1, skipped: 0 })
    await expect(
      applyCategorizationRun('run-1', 1, 'saving-admin', ['expense-1']),
    ).resolves.toEqual({
      groupId: 'group-1',
      applied: 1,
      skipped: 1,
    })
    expect(transactionCommitted).toBe(true)
    expect(mocks.bulkUpdate).toHaveBeenCalledTimes(1)
    expect(prismaMock.bulkCategorizationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DONE',
          applied: 1,
          skipped: 1,
        }),
      }),
    )
  })
})

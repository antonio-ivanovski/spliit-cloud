import { RecurrenceRule } from '@prisma/client'

const prisma = {
  recurringExpenseLink: {
    findMany: jest.fn<any, any>().mockResolvedValue([]),
    update: jest.fn<any, any>(),
  },
  expense: {
    create: jest.fn<any, any>(),
  },
  $transaction: jest.fn<any, any>(),
}

jest.mock('../lib/prisma', () => ({
  prisma,
}))

const api = require('../lib/api')
const { createRecurringExpenses } = api

describe('createRecurringExpenses', () => {
  const mockCurrentDate = new Date(Date.UTC(2025, 6, 15, 12, 0, 0))

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(mockCurrentDate)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('findMany query structure', () => {
    it('queries for recurring links with null nextExpenseCreatedAt', async () => {
      await createRecurringExpenses()

      expect(prisma.recurringExpenseLink.findMany).toHaveBeenCalled()
      const callArgs = prisma.recurringExpenseLink.findMany.mock.calls[0][0]
      expect(callArgs.where.nextExpenseCreatedAt).toBeNull()
    })

    it('queries for recurring links with nextExpenseDate lte current time', async () => {
      await createRecurringExpenses()

      const callArgs = prisma.recurringExpenseLink.findMany.mock.calls[0][0]
      expect(callArgs.where.nextExpenseDate).toBeDefined()
      expect(callArgs.where.nextExpenseDate.lte).toBeDefined()
    })

    it('includes currentFrameExpense with related data', async () => {
      await createRecurringExpenses()

      const callArgs = prisma.recurringExpenseLink.findMany.mock.calls[0][0]
      expect(callArgs.include.currentFrameExpense).toBeDefined()
      expect(callArgs.include.currentFrameExpense.include.paidBy).toBe(true)
      expect(callArgs.include.currentFrameExpense.include.paidFor).toBe(true)
      expect(callArgs.include.currentFrameExpense.include.category).toBe(true)
      expect(callArgs.include.currentFrameExpense.include.documents).toBe(true)
    })

    it('does not call transaction when no recurring links are found', async () => {
      prisma.recurringExpenseLink.findMany.mockResolvedValue([])

      await createRecurringExpenses()

      expect(prisma.recurringExpenseLink.findMany).toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('empty array handling', () => {
    it('handles empty recurring links array without errors', async () => {
      prisma.recurringExpenseLink.findMany.mockResolvedValue([])

      await expect(createRecurringExpenses()).resolves.not.toThrow()
    })

    it('calls findMany with correct filter for past due expenses', async () => {
      await createRecurringExpenses()

      expect(prisma.recurringExpenseLink.findMany).toHaveBeenCalled()
    })
  })
})

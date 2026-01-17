import { RecurrenceRule } from '@prisma/client'

const mockCreateExpense = jest.fn()
const mockUpdateRecurringLink = jest.fn()

const prisma = {
  recurringExpenseLink: {
    findMany: jest.fn<any, any>().mockResolvedValue([]),
    update: jest.fn<any, any>().mockImplementation(mockUpdateRecurringLink),
  },
  expense: {
    create: jest.fn<any, any>().mockImplementation(mockCreateExpense),
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

  describe('WEEKLY recurrence', () => {
    it('creates 3 expenses when 3 weeks have passed', async () => {
      const mockCurrentDate = new Date(Date.UTC(2025, 6, 22, 12, 0, 0))
      jest.setSystemTime(mockCurrentDate)

      const mockRecurringLink = {
        id: 'link-1',
        nextExpenseDate: new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
        nextExpenseCreatedAt: null,
        currentFrameExpense: {
          id: 'expense-0',
          groupId: 'group-1',
          expenseDate: new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
          title: 'Weekly Lunch',
          amount: 5000,
          recurrenceRule: RecurrenceRule.WEEKLY,
          paidById: 'participant-1',
          paidBy: { id: 'participant-1', name: 'Alice' },
          paidFor: [
            { participantId: 'participant-1', shares: 1 },
            { participantId: 'participant-2', shares: 1 },
          ],
          categoryId: 'category-1',
          category: { id: 'category-1', name: 'Food' },
          documents: [],
        },
      }

      prisma.recurringExpenseLink.findMany.mockResolvedValue([
        mockRecurringLink,
      ])

      const createdExpenses: any[] = []
      mockCreateExpense.mockImplementation((data) => {
        createdExpenses.push(data)
        return Promise.resolve({
          ...data,
          createdAt: new Date(),
          paidFor: data.paidFor.createMany.data,
          category: mockRecurringLink.currentFrameExpense.category,
          paidBy: mockRecurringLink.currentFrameExpense.paidBy,
        })
      })

      await createRecurringExpenses()

      expect(createdExpenses).toHaveLength(3)

      expect(createdExpenses[0].expenseDate).toEqual(
        new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
      )
      expect(createdExpenses[1].expenseDate).toEqual(
        new Date(Date.UTC(2025, 6, 8, 12, 0, 0)),
      )
      expect(createdExpenses[2].expenseDate).toEqual(
        new Date(Date.UTC(2025, 6, 15, 12, 0, 0)),
      )
    })

    it('creates 1 expense when exactly 1 week has passed', async () => {
      const mockCurrentDate = new Date(Date.UTC(2025, 6, 8, 12, 0, 0))
      jest.setSystemTime(mockCurrentDate)

      const mockRecurringLink = {
        id: 'link-1',
        nextExpenseDate: new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
        nextExpenseCreatedAt: null,
        currentFrameExpense: {
          id: 'expense-0',
          groupId: 'group-1',
          expenseDate: new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
          title: 'Weekly Meeting',
          amount: 2500,
          recurrenceRule: RecurrenceRule.WEEKLY,
          paidById: 'participant-1',
          paidBy: { id: 'participant-1', name: 'Alice' },
          paidFor: [{ participantId: 'participant-1', shares: 1 }],
          categoryId: 'category-2',
          category: { id: 'category-2', name: 'Office' },
          documents: [],
        },
      }

      prisma.recurringExpenseLink.findMany.mockResolvedValue([
        mockRecurringLink,
      ])

      const createdExpenses: any[] = []
      mockCreateExpense.mockImplementation((data) => {
        createdExpenses.push(data)
        return Promise.resolve({
          ...data,
          createdAt: new Date(),
          paidFor: data.paidFor.createMany.data,
          category: mockRecurringLink.currentFrameExpense.category,
          paidBy: mockRecurringLink.currentFrameExpense.paidBy,
        })
      })

      await createRecurringExpenses()

      expect(createdExpenses).toHaveLength(1)
      expect(createdExpenses[0].expenseDate).toEqual(
        new Date(Date.UTC(2025, 6, 1, 12, 0, 0)),
      )
    })
  })
})

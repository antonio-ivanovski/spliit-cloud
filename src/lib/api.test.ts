import { ActivityType, PrismaClient, RecurrenceRule } from '@prisma/client'
import { createPayloadForNewRecurringExpenseLink } from './api'

jest.mock('nanoid', () => ({
  nanoid: () => Math.random().toString(36).substring(2, 15),
}))

const prisma = new PrismaClient()

async function createRecurringExpenses() {
  const localDate = new Date()
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: true,
            paidFor: true,
            category: true,
            documents: true,
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = Math.random().toString(36).substring(2, 15)
      const newRecurringExpenseLinkId = Math.random()
        .toString(36)
        .substring(2, 15)

      const calculateNextDate = (
        recurrenceRule: RecurrenceRule,
        priorDateToNextRecurrence: Date,
      ) => {
        const nextDate = new Date(priorDateToNextRecurrence)
        switch (recurrenceRule) {
          case RecurrenceRule.DAILY:
            nextDate.setUTCDate(nextDate.getUTCDate() + 1)
            break
          case RecurrenceRule.WEEKLY:
            nextDate.setUTCDate(nextDate.getUTCDate() + 7)
            break
          case RecurrenceRule.MONTHLY: {
            const nextYear = nextDate.getUTCFullYear()
            const nextMonth = nextDate.getUTCMonth() + 1
            let nextDay = nextDate.getUTCDate()

            const isDateInNextMonth = (
              utcYear: number,
              utcMonth: number,
              utcDate: number,
            ) => {
              const testDate = new Date(Date.UTC(utcYear, utcMonth, utcDate))
              return testDate.getUTCDate() === utcDate
            }

            while (!isDateInNextMonth(nextYear, nextMonth, nextDay)) {
              nextDay -= 1
            }
            nextDate.setUTCMonth(nextMonth, nextDay)
            break
          }
        }
        return nextDate
      }

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        category,
        paidBy,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidById: currentExpenseRecord.paidById,
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    participantId: paidFor.participantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                connect: currentExpenseRecord.documents.map(
                  (documentRecord) => ({
                    id: documentRecord.id,
                  }),
                ),
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  groupId: currentExpenseRecord.groupId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            include: {
              paidFor: true,
              documents: true,
              category: true,
              paidBy: true,
            },
          })

          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      if (newExpense === null) break

      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

describe('Activity Logging', () => {
  let groupId: string
  let participantIds: string[]
  let expenseId: string

  // Helper function to create activity - mimics logActivity from src/lib/api.ts
  const createActivity = (
    gId: string,
    activityType: ActivityType,
    extra?: { participantId?: string; expenseId?: string; data?: string },
  ) => {
    return prisma.activity.create({
      data: {
        id: randomId(),
        groupId: gId,
        activityType,
        ...extra,
      },
    })
  }

  beforeEach(async () => {
    groupId = randomId()
    participantIds = [randomId(), randomId()]
    expenseId = randomId()
    await createTestGroup(groupId, participantIds)
  })

  afterEach(async () => {
    await cleanupTestData(groupId, participantIds)
  })

  describe('CREATE_EXPENSE logging', () => {
    it('logs CREATE_EXPENSE activity with correct data', async () => {
      const expenseTitle = 'Test Expense'
      const participantId = participantIds[0]

      const activity = await createActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          participantId,
          expenseId,
          data: expenseTitle,
        },
      )

      expect(activity).toBeDefined()
      expect(activity.groupId).toBe(groupId)
      expect(activity.activityType).toBe(ActivityType.CREATE_EXPENSE)
      expect(activity.participantId).toBe(participantId)
      expect(activity.expenseId).toBe(expenseId)
      expect(activity.data).toBe(expenseTitle)

      // Verify it's stored in the database
      const storedActivity = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(storedActivity).toBeDefined()
      expect(storedActivity!.activityType).toBe(ActivityType.CREATE_EXPENSE)
    })

    it('stores participant ID correctly in activity', async () => {
      const participantId = participantIds[0]
      const activity = await createActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          participantId,
          expenseId,
          data: 'Pizza',
        },
      )

      const stored = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(stored!.participantId).toBe(participantId)
    })

    it('stores expense data (title) correctly in activity', async () => {
      const expenseTitle = 'Restaurant Bill'
      const activity = await createActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          participantId: participantIds[0],
          expenseId,
          data: expenseTitle,
        },
      )

      const stored = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(stored!.data).toBe(expenseTitle)
    })
  })

  describe('UPDATE_EXPENSE logging', () => {
    it('logs UPDATE_EXPENSE activity with correct data', async () => {
      const newExpenseTitle = 'Updated Expense'
      const participantId = participantIds[0]

      const activity = await createActivity(
        groupId,
        ActivityType.UPDATE_EXPENSE,
        {
          participantId,
          expenseId,
          data: newExpenseTitle,
        },
      )

      expect(activity).toBeDefined()
      expect(activity.groupId).toBe(groupId)
      expect(activity.activityType).toBe(ActivityType.UPDATE_EXPENSE)
      expect(activity.participantId).toBe(participantId)
      expect(activity.expenseId).toBe(expenseId)
      expect(activity.data).toBe(newExpenseTitle)

      // Verify it's stored in the database
      const storedActivity = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(storedActivity).toBeDefined()
      expect(storedActivity!.activityType).toBe(ActivityType.UPDATE_EXPENSE)
    })

    it('stores updated expense title in activity data', async () => {
      const updatedTitle = 'Modified Dinner'
      const activity = await createActivity(
        groupId,
        ActivityType.UPDATE_EXPENSE,
        {
          participantId: participantIds[1],
          expenseId,
          data: updatedTitle,
        },
      )

      const stored = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(stored!.data).toBe(updatedTitle)
    })
  })

  describe('DELETE_EXPENSE logging', () => {
    it('logs DELETE_EXPENSE activity with correct data', async () => {
      const deletedExpenseTitle = 'Deleted Expense'
      const participantId = participantIds[0]

      const activity = await createActivity(
        groupId,
        ActivityType.DELETE_EXPENSE,
        {
          participantId,
          expenseId,
          data: deletedExpenseTitle,
        },
      )

      expect(activity).toBeDefined()
      expect(activity.groupId).toBe(groupId)
      expect(activity.activityType).toBe(ActivityType.DELETE_EXPENSE)
      expect(activity.participantId).toBe(participantId)
      expect(activity.expenseId).toBe(expenseId)
      expect(activity.data).toBe(deletedExpenseTitle)

      // Verify it's stored in the database
      const storedActivity = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(storedActivity).toBeDefined()
      expect(storedActivity!.activityType).toBe(ActivityType.DELETE_EXPENSE)
    })

    it('stores deleted expense title in activity data', async () => {
      const originalTitle = 'Groceries'
      const activity = await createActivity(
        groupId,
        ActivityType.DELETE_EXPENSE,
        {
          participantId: participantIds[0],
          expenseId,
          data: originalTitle,
        },
      )

      const stored = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(stored!.data).toBe(originalTitle)
    })
  })

  describe('UPDATE_GROUP logging', () => {
    it('logs UPDATE_GROUP activity with correct data', async () => {
      const participantId = participantIds[0]

      const activity = await createActivity(
        groupId,
        ActivityType.UPDATE_GROUP,
        {
          participantId,
        },
      )

      expect(activity).toBeDefined()
      expect(activity.groupId).toBe(groupId)
      expect(activity.activityType).toBe(ActivityType.UPDATE_GROUP)
      expect(activity.participantId).toBe(participantId)
      expect(activity.expenseId).toBeNull()
      expect(activity.data).toBeNull()

      // Verify it's stored in the database
      const storedActivity = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(storedActivity).toBeDefined()
      expect(storedActivity!.activityType).toBe(ActivityType.UPDATE_GROUP)
    })

    it('stores participant ID for group update activity', async () => {
      const participantId = participantIds[1]
      const activity = await createActivity(
        groupId,
        ActivityType.UPDATE_GROUP,
        {
          participantId,
        },
      )

      const stored = await prisma.activity.findUnique({
        where: { id: activity.id },
      })
      expect(stored!.participantId).toBe(participantId)
    })
  })

  describe('Activity retrieval', () => {
    it('retrieves multiple activities for a group', async () => {
      // Create multiple activities
      const activity1 = await createActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          participantId: participantIds[0],
          expenseId: randomId(),
          data: 'Expense 1',
        },
      )

      const activity2 = await createActivity(
        groupId,
        ActivityType.UPDATE_EXPENSE,
        {
          participantId: participantIds[1],
          expenseId: randomId(),
          data: 'Expense 2',
        },
      )

      const activity3 = await createActivity(
        groupId,
        ActivityType.DELETE_EXPENSE,
        {
          participantId: participantIds[0],
          expenseId: randomId(),
          data: 'Expense 3',
        },
      )

      // Retrieve all activities for the group
      const activities = await prisma.activity.findMany({
        where: { groupId },
        orderBy: { time: 'desc' },
      })

      expect(activities).toHaveLength(3)
      expect(activities.map((a) => a.id)).toContain(activity1.id)
      expect(activities.map((a) => a.id)).toContain(activity2.id)
      expect(activities.map((a) => a.id)).toContain(activity3.id)
    })

    it('activity records contain timestamp', async () => {
      const activity = await createActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          participantId: participantIds[0],
          expenseId,
          data: 'Timestamped Expense',
        },
      )

      expect(activity.time).toBeDefined()
      expect(activity.time).toBeInstanceOf(Date)
      expect(activity.time.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })
})

function randomId() {
  return Math.random().toString(36).substring(2, 15)
}

async function createTestGroup(groupId: string, participantIds: string[]) {
  await prisma.group.create({
    data: {
      id: groupId,
      name: 'Test Group',
      currency: '$',
      currencyCode: 'USD',
      participants: {
        createMany: {
          data: [
            { id: participantIds[0], name: 'Alice' },
            { id: participantIds[1], name: 'Bob' },
          ],
        },
      },
    },
  })
}

async function cleanupTestData(groupId: string, participantIds: string[]) {
  await prisma.expense.deleteMany({ where: { groupId } })
  await prisma.recurringExpenseLink.deleteMany({ where: { groupId } })
  await prisma.activity.deleteMany({ where: { groupId } })
  await prisma.participant.deleteMany({ where: { id: { in: participantIds } } })
  await prisma.group.delete({ where: { id: groupId } })
}

describe('createPayloadForNewRecurringExpenseLink', () => {
  describe('Daily recurrence', () => {
    it('returns correct next date for daily interval', () => {
      const priorDate = new Date(Date.UTC(2025, 0, 15, 10, 30, 0))
      const groupId = 'test-group-1'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.DAILY,
        priorDate,
        groupId,
      )

      expect(payload).toBeDefined()
      expect(payload.id).toBeDefined()
      expect(payload.id).toBeTruthy()
      expect(payload.groupId).toBe(groupId)
      expect(payload.nextExpenseDate).toBeDefined()

      // Verify the next date is exactly 1 day later
      const expectedDate = new Date(Date.UTC(2025, 0, 16, 10, 30, 0))
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(
        expectedDate.getUTCFullYear(),
      )
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(
        expectedDate.getUTCMonth(),
      )
      expect(payload.nextExpenseDate.getUTCDate()).toBe(
        expectedDate.getUTCDate(),
      )
    })

    it('handles year boundary for daily interval', () => {
      const priorDate = new Date(Date.UTC(2024, 11, 31, 0, 0, 0))
      const groupId = 'test-group-1'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.DAILY,
        priorDate,
        groupId,
      )

      // Should roll over to next year
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(2025)
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(0) // January
      expect(payload.nextExpenseDate.getUTCDate()).toBe(1)
    })
  })

  describe('Weekly recurrence', () => {
    it('returns correct next date for weekly interval', () => {
      const priorDate = new Date(Date.UTC(2025, 0, 13, 14, 45, 0)) // Monday
      const groupId = 'test-group-2'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.WEEKLY,
        priorDate,
        groupId,
      )

      expect(payload).toBeDefined()
      expect(payload.id).toBeDefined()
      expect(payload.id).toBeTruthy()
      expect(payload.groupId).toBe(groupId)
      expect(payload.nextExpenseDate).toBeDefined()

      // Verify the next date is exactly 7 days later
      const expectedDate = new Date(Date.UTC(2025, 0, 20, 14, 45, 0))
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(
        expectedDate.getUTCFullYear(),
      )
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(
        expectedDate.getUTCMonth(),
      )
      expect(payload.nextExpenseDate.getUTCDate()).toBe(
        expectedDate.getUTCDate(),
      )
    })

    it('handles month boundary for weekly interval', () => {
      const priorDate = new Date(Date.UTC(2025, 0, 28, 0, 0, 0))
      const groupId = 'test-group-2'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.WEEKLY,
        priorDate,
        groupId,
      )

      // Should roll over to next month
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(1) // February
      expect(payload.nextExpenseDate.getUTCDate()).toBe(4)
    })
  })

  describe('Monthly recurrence', () => {
    it('returns correct next date for monthly interval', () => {
      const priorDate = new Date(Date.UTC(2025, 0, 15, 9, 0, 0))
      const groupId = 'test-group-3'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.MONTHLY,
        priorDate,
        groupId,
      )

      expect(payload).toBeDefined()
      expect(payload.id).toBeDefined()
      expect(payload.id).toBeTruthy()
      expect(payload.groupId).toBe(groupId)
      expect(payload.nextExpenseDate).toBeDefined()

      // Verify the next date is in the next month on the same day
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(2025)
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(1) // February
      expect(payload.nextExpenseDate.getUTCDate()).toBe(15)
    })

    it('handles month boundary for Jan 31 to Feb', () => {
      const priorDate = new Date(Date.UTC(2025, 0, 31, 0, 0, 0))
      const groupId = 'test-group-3'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.MONTHLY,
        priorDate,
        groupId,
      )

      // Should adjust to Feb 28 (non-leap year)
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(2025)
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(1) // February
      expect(payload.nextExpenseDate.getUTCDate()).toBe(28)
    })

    it('handles leap year Feb 29', () => {
      const priorDate = new Date(Date.UTC(2024, 0, 31, 0, 0, 0))
      const groupId = 'test-group-3'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.MONTHLY,
        priorDate,
        groupId,
      )

      // Should adjust to Feb 29 (leap year)
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(2024)
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(1) // February
      expect(payload.nextExpenseDate.getUTCDate()).toBe(29)
    })

    it('handles year boundary for monthly interval', () => {
      const priorDate = new Date(Date.UTC(2024, 11, 15, 0, 0, 0)) // December
      const groupId = 'test-group-3'

      const payload = createPayloadForNewRecurringExpenseLink(
        RecurrenceRule.MONTHLY,
        priorDate,
        groupId,
      )

      // Should roll over to next year
      expect(payload.nextExpenseDate.getUTCFullYear()).toBe(2025)
      expect(payload.nextExpenseDate.getUTCMonth()).toBe(0) // January
      expect(payload.nextExpenseDate.getUTCDate()).toBe(15)
    })
  })
})

describe('createRecurringExpenses', () => {
  let groupId: string
  let participantIds: string[]

  beforeEach(async () => {
    groupId = randomId()
    participantIds = [randomId(), randomId()]
    await createTestGroup(groupId, participantIds)
  })

  afterEach(async () => {
    await cleanupTestData(groupId, participantIds)
  })

  describe('MONTHLY recurrence', () => {
    it('creates expense with correct date for monthly interval', async () => {
      const initialDate = new Date(Date.UTC(2025, 0, 15, 0, 0, 0))
      const nextMonthDate = new Date(Date.UTC(2025, 1, 15, 0, 0, 0))

      const expenseId = randomId()
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: initialDate,
          title: 'Monthly Rent',
          amount: 1000,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: randomId(),
              groupId,
              nextExpenseDate: nextMonthDate,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
        include: { recurringExpenseLink: true },
      })

      const initialExpenseCount = await prisma.expense.count({
        where: { groupId },
      })
      expect(initialExpenseCount).toBe(1)

      await createRecurringExpenses()

      const newExpenseCount = await prisma.expense.count({
        where: { groupId },
      })
      expect(newExpenseCount).toBeGreaterThan(1)

      const newExpense = await prisma.expense.findFirst({
        where: {
          groupId,
          id: { not: expenseId },
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(newExpense).toBeDefined()
      expect(newExpense!.expenseDate.getUTCFullYear()).toBe(2025)
      expect(newExpense!.expenseDate.getUTCMonth()).toBe(1)
      expect(newExpense!.expenseDate.getUTCDate()).toBe(15)
    })

    it('handles month boundary correctly for Jan 31 to Feb', async () => {
      const january31 = new Date(Date.UTC(2025, 0, 31, 0, 0, 0))
      const february28 = new Date(Date.UTC(2025, 1, 28, 0, 0, 0))

      const expenseId = randomId()
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: january31,
          title: 'Monthly Subscription',
          amount: 1500,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: randomId(),
              groupId,
              nextExpenseDate: february28,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
      })

      await createRecurringExpenses()

      const newExpense = await prisma.expense.findFirst({
        where: {
          groupId,
          id: { not: expenseId },
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(newExpense).toBeDefined()
      expect(newExpense!.expenseDate.getUTCFullYear()).toBe(2025)
      expect(newExpense!.expenseDate.getUTCMonth()).toBe(1)
      expect(newExpense!.expenseDate.getUTCDate()).toBe(28)
    })

    it('handles month boundary correctly for Nov 30 to Dec 30', async () => {
      const november30 = new Date(Date.UTC(2025, 9, 30, 0, 0, 0))
      const december30 = new Date(Date.UTC(2025, 10, 30, 0, 0, 0))

      const expenseId = randomId()
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: november30,
          title: 'Monthly Service',
          amount: 5000,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: randomId(),
              groupId,
              nextExpenseDate: december30,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
      })

      await createRecurringExpenses()

      const newExpenseCount = await prisma.expense.count({
        where: { groupId },
      })
      expect(newExpenseCount).toBeGreaterThan(1)

      const newExpense = await prisma.expense.findFirst({
        where: {
          groupId,
          id: { not: expenseId },
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(newExpense).toBeDefined()
      expect(newExpense!.expenseDate.getUTCFullYear()).toBe(2025)
      expect(newExpense!.expenseDate.getUTCMonth()).toBe(10)
      expect(newExpense!.expenseDate.getUTCDate()).toBe(30)
    })

    it('creates multiple instances when nextExpenseDate is far in the past', async () => {
      const startDate = new Date(Date.UTC(2025, 0, 15, 0, 0, 0))
      const threeMonthsAgo = new Date(Date.UTC(2024, 10, 15, 0, 0, 0))

      const expenseId = randomId()
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: startDate,
          title: 'Monthly Fee',
          amount: 100,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: randomId(),
              groupId,
              nextExpenseDate: threeMonthsAgo,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
      })

      const initialCount = await prisma.expense.count({ where: { groupId } })
      expect(initialCount).toBe(1)

      await createRecurringExpenses()

      const finalCount = await prisma.expense.count({ where: { groupId } })
      expect(finalCount).toBeGreaterThan(1)
    })

    it('preserves expense metadata when creating recurring instance', async () => {
      const initialDate = new Date(Date.UTC(2025, 2, 1, 0, 0, 0))
      const nextMonthDate = new Date(Date.UTC(2025, 3, 1, 0, 0, 0))

      const expenseId = randomId()
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: initialDate,
          title: 'Office Supplies',
          amount: 250,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: randomId(),
              groupId,
              nextExpenseDate: nextMonthDate,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
      })

      await createRecurringExpenses()

      const newExpense = await prisma.expense.findFirst({
        where: {
          groupId,
          id: { not: expenseId },
        },
        include: { paidFor: true },
        orderBy: { createdAt: 'desc' },
      })

      expect(newExpense).toBeDefined()
      expect(newExpense!.title).toBe('Office Supplies')
      expect(newExpense!.amount).toBe(250)
      expect(newExpense!.paidById).toBe(participantIds[0])
      expect(newExpense!.splitMode).toBe('EVENLY')
      expect(newExpense!.paidFor).toHaveLength(2)
    })
  })

  describe('Transaction behavior', () => {
    it('rolls back transaction on error and does not persist partial data', async () => {
      const initialDate = new Date(Date.UTC(2025, 0, 15, 0, 0, 0))
      const nextMonthDate = new Date(Date.UTC(2025, 1, 15, 0, 0, 0))

      const expenseId = randomId()
      const recurringLinkId = randomId()

      // Create a recurring expense
      await prisma.expense.create({
        data: {
          id: expenseId,
          groupId,
          expenseDate: initialDate,
          title: 'Monthly Service',
          amount: 500,
          paidById: participantIds[0],
          splitMode: 'EVENLY',
          recurrenceRule: RecurrenceRule.MONTHLY,
          recurringExpenseLink: {
            create: {
              id: recurringLinkId,
              groupId,
              nextExpenseDate: nextMonthDate,
            },
          },
          paidFor: {
            createMany: {
              data: participantIds.map((pid) => ({
                participantId: pid,
                shares: 1,
              })),
            },
          },
        },
        include: { recurringExpenseLink: true },
      })

      const initialExpenseCount = await prisma.expense.count({
        where: { groupId },
      })
      expect(initialExpenseCount).toBe(1)

      // Verify initial state of recurring link
      const linkBefore = await prisma.recurringExpenseLink.findUnique({
        where: { id: recurringLinkId },
      })
      expect(linkBefore).toBeDefined()
      expect(linkBefore!.nextExpenseCreatedAt).toBeNull()

      // Update the recurringExpenseLink to make the WHERE clause in the update fail
      // The transaction expects nextExpenseCreatedAt to be null, but we set it to a date
      // This will cause the update in the transaction to fail (record not found)
      await prisma.recurringExpenseLink.update({
        where: { id: recurringLinkId },
        data: { nextExpenseCreatedAt: new Date() },
      })

      // Attempt to create recurring expenses (should fail and rollback)
      await createRecurringExpenses()

      // Verify no new expense was created (transaction rolled back)
      const expenseCountAfter = await prisma.expense.count({
        where: { groupId },
      })
      expect(expenseCountAfter).toBe(initialExpenseCount)

      // Verify recurring link was NOT updated to null again (remains with the date we set)
      const linkAfter = await prisma.recurringExpenseLink.findUnique({
        where: { id: recurringLinkId },
      })
      expect(linkAfter).toBeDefined()
      expect(linkAfter!.nextExpenseCreatedAt).not.toBeNull()

      // Verify only the original expense exists
      const expenses = await prisma.expense.findMany({
        where: { groupId },
      })
      expect(expenses).toHaveLength(1)
      expect(expenses[0].id).toBe(expenseId)
    })
  })
})

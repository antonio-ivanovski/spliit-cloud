import { PrismaClient, RecurrenceRule } from '@prisma/client'

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
})

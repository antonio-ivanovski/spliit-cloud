import { prisma, RecurrenceRule } from '@spliit/db'
import { calculateNextDate } from '@spliit/domain'
import { randomId } from './shared'

export async function createRecurringExpenses() {
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
        ledger: {
          group: {
            archived: false,
          },
        },
      },
      select: {
        id: true,
        ledgerId: true,
        nextExpenseCreatedAt: true,
        nextExpenseDate: true,
        currentFrameExpense: {
          select: {
            id: true,
            ledgerId: true,
            expenseDate: true,
            title: true,
            categoryId: true,
            amount: true,
            originalAmount: true,
            originalCurrency: true,
            conversionRate: true,
            splitMode: true,
            recurrenceRule: true,
            isReimbursement: true,
            notes: true,
            paidBySplitMode: true,
            paidByList: {
              select: { ledgerParticipantId: true, shares: true },
            },
            paidFor: { select: { ledgerParticipantId: true, shares: true } },
            documents: {
              select: { id: true, url: true, width: true, height: true },
            },
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        paidByList,
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
              paidBySplitMode: currentExpenseRecord.paidBySplitMode,
              paidByList: {
                createMany: {
                  data: currentExpenseRecord.paidByList.map((pb) => ({
                    ledgerParticipantId: pb.ledgerParticipantId,
                    shares: pb.shares,
                  })),
                },
              },
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    ledgerParticipantId: paidFor.ledgerParticipantId,
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
                  ledgerId: currentExpenseRecord.ledgerId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            include: {
              paidFor: true,
              documents: true,
              paidByList: true,
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

export function createPayloadForNewRecurringExpenseLink(
  _recurrenceRule: RecurrenceRule,
  _priorDateToNextRecurrence: Date,
  _groupId: string,
) {
  throw new Error(
    'createPayloadForNewRecurringExpenseLink is a transitional stub; build the payload with the group ledgerId',
  )
}

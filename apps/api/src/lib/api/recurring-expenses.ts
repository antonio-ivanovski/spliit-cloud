import { prisma, type RecurrenceRule } from '@spliit/db'
import { calculateNextDate } from '@spliit/domain'
import { scheduleDefaultNotificationDispatch } from '../notifications/dispatcher'
import { buildExpenseActivityData, logActivity } from './activities'
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
            items: {
              select: {
                id: true,
                title: true,
                unitPrice: true,
                quantity: true,
                amount: true,
                splitMode: true,
                paidFor: {
                  select: { ledgerParticipantId: true, shares: true },
                },
              },
            },
            itemizedRemainder: {
              select: {
                splitMode: true,
                paidFor: {
                  select: { ledgerParticipantId: true, shares: true },
                },
              },
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

      const { items, itemizedRemainder, ...destructeredCurrentExpenseRecord } =
        currentExpenseRecord

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
              items: {
                create: items.map((item) => ({
                  id: randomId(),
                  title: item.title,
                  unitPrice: item.unitPrice,
                  quantity: item.quantity,
                  amount: item.amount,
                  splitMode: item.splitMode,
                  paidFor: {
                    createMany: {
                      data: item.paidFor.map((pf) => ({
                        ledgerParticipantId: pf.ledgerParticipantId,
                        shares: pf.shares,
                      })),
                    },
                  },
                })),
              },
              ...(itemizedRemainder
                ? {
                    itemizedRemainder: {
                      create: {
                        splitMode: itemizedRemainder.splitMode,
                        paidFor: {
                          createMany: {
                            data: itemizedRemainder.paidFor.map((pf) => ({
                              ledgerParticipantId: pf.ledgerParticipantId,
                              shares: pf.shares,
                            })),
                          },
                        },
                      },
                    },
                  }
                : {}),
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
              items: {
                include: { paidFor: true },
              },
              itemizedRemainder: {
                include: { paidFor: true },
              },
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

      const ledgerInfo = await prisma.ledger.findUnique({
        where: { id: newExpense.ledgerId },
        select: {
          currencyCode: true,
          group: { select: { id: true } },
        },
      })
      const expenseDateStr = newExpense.expenseDate.toISOString().slice(0, 10)
      const activity = await logActivity(ledgerInfo!.group!.id, {
        type: 'EXPENSE_CREATED',
        actor: { type: 'SYSTEM', id: 'system' },
        subject: { type: 'EXPENSE', id: newExpense.id },
        data: buildExpenseActivityData({
          summary: newExpense.title,
          title: newExpense.title,
          amount: newExpense.amount,
          currencyCode: ledgerInfo?.currencyCode ?? null,
          date: expenseDateStr,
        }),
      })
      scheduleDefaultNotificationDispatch({
        activityId: activity.id,
        type: 'EXPENSE_CREATED',
        groupId: ledgerInfo!.group!.id,
        actor: { type: 'SYSTEM', id: 'system' },
        subject: { type: 'EXPENSE', id: newExpense.id },
        data: buildExpenseActivityData({
          summary: newExpense.title,
          title: newExpense.title,
          amount: newExpense.amount,
          currencyCode: ledgerInfo?.currencyCode ?? null,
          date: expenseDateStr,
        }),
        occurredAt: activity.time,
      })

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

import {
  ActivityType,
  prisma,
  RecurrenceRule,
  type Expense as DbExpense,
} from '@spliit/db'
import {
  calculateNextDate,
  categoryIdSchema,
  computePaidForFromItems,
  DEFAULT_CATEGORY_ID,
  getCategoryById,
  type Category,
  type CategoryId,
  type Expense,
} from '@spliit/domain'
import { deleteS3Object, markS3ObjectAsOwned } from '../../routes/upload'
import { resolveParticipantDisplayName } from '../invitations'
import { logActivity } from './activities'
import { createRecurringExpenses } from './recurring-expenses'
import { getMemberLedgerParticipantId, randomId } from './shared'

/**
 * Resolve a `categoryId` string from the database to the in-code
 * {@link Category} object. Returns the default "General" category when
 * the stored id is not in the in-code list (e.g. it was written by an
 * older version of the app or is otherwise invalid).
 */
function resolveCategory(categoryId: string): Category {
  const parsedCategoryId = categoryIdSchema.safeParse(categoryId)
  return (
    (parsedCategoryId.success
      ? getCategoryById(parsedCategoryId.data)
      : undefined) ?? getCategoryById(DEFAULT_CATEGORY_ID)!
  )
}

/**
 * Narrow a `categoryId` string from the database to the {@link CategoryId}
 * literal union, falling back to the default category if the stored id is
 * not in the in-code list.
 */
function narrowCategoryId(categoryId: string): CategoryId {
  const parsed = categoryIdSchema.safeParse(categoryId)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

export async function createExpense(
  expense: Expense,
  groupId: string,
  actor: { accountId: string },
): Promise<DbExpense> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  const ledgerId = group.ledgerId
  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId,
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))

  for (const participantId of [
    ...expense.paidByList.map((p) => p.participant),
    ...expense.paidFor.map((p) => p.participant),
    ...(expense.items ?? []).flatMap((item) =>
      item.paidFor.map((p) => p.participant),
    ),
    ...(expense.itemizedRemainder?.paidFor ?? []).map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  const expenseId = randomId()
  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: expense.title,
  })

  const isCreateRecurrence = expense.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = isCreateRecurrence
    ? {
        id: randomId(),
        ledgerId,
        nextExpenseDate: calculateNextDate(
          expense.recurrenceRule as RecurrenceRule,
          expense.expenseDate,
        ),
      }
    : undefined

  const createdExpense = await prisma.expense.create({
    data: {
      id: expenseId,
      ledgerId,
      expenseDate: expense.expenseDate,
      categoryId: expense.category,
      amount: expense.amount,
      originalAmount: expense.originalAmount,
      originalCurrency: expense.originalCurrency,
      conversionRate: expense.conversionRate,
      title: expense.title,
      paidBySplitMode: expense.paidBySplitMode,
      paidByList: {
        createMany: {
          data: expense.paidByList.map((paidBy) => ({
            ledgerParticipantId: paidBy.participant,
            shares: paidBy.shares,
          })),
        },
      },
      splitMode: expense.splitMode,
      recurrenceRule: expense.recurrenceRule,
      ...(recurringExpenseLinkPayload
        ? {
            recurringExpenseLink: {
              create: recurringExpenseLinkPayload,
            },
          }
        : {}),
      paidFor: {
        createMany: {
          data:
            expense.splitMode === 'ITEMIZED'
              ? computePaidForFromItems(
                  expense.items ?? [],
                  [...participantIds],
                  expense.originalCurrency
                    ? (expense.originalAmount ?? expense.amount)
                    : expense.amount,
                  expense.itemizedRemainder,
                ).paidFor.map((p) => ({
                  ledgerParticipantId: p.participant,
                  shares: p.shares,
                }))
              : expense.paidFor.map((paidFor) => ({
                  ledgerParticipantId: paidFor.participant,
                  shares: paidFor.shares,
                })),
        },
      },
      items: {
        create: (expense.items ?? []).map((item) => ({
          id: item.id ?? randomId(),
          title: item.title,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          amount: item.amount,
          splitMode: item.splitMode,
          paidFor: {
            createMany: {
              data: item.paidFor.map((pf) => ({
                ledgerParticipantId: pf.participant,
                shares: pf.shares,
              })),
            },
          },
        })),
      },
      ...(expense.itemizedRemainder
        ? {
            itemizedRemainder: {
              create: {
                splitMode: expense.itemizedRemainder.splitMode,
                paidFor: {
                  createMany: {
                    data: expense.itemizedRemainder.paidFor.map((pf) => ({
                      ledgerParticipantId: pf.participant,
                      shares: pf.shares,
                    })),
                  },
                },
              },
            },
          }
        : {}),
      isReimbursement: expense.isReimbursement,
      documents: {
        createMany: {
          data: expense.documents.map((doc) => ({
            id: randomId(),
            url: doc.url,
            width: doc.width,
            height: doc.height,
          })),
        },
      },
      notes: expense.notes,
    },
  })

  for (const doc of expense.documents) {
    await markS3ObjectAsOwned(doc.url)
  }

  return createdExpense
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
) {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: existingExpense?.title,
  })

  for (const doc of existingExpense.documents) {
    await deleteS3Object(doc.url)
  }

  await prisma.expense.deleteMany({
    where: { id: expenseId, ledgerId: existingExpense.ledgerId },
  })
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expense: Expense,
  actor: { accountId: string },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId: group.ledgerId,
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))
  for (const participantId of [
    ...expense.paidByList.map((p) => p.participant),
    ...expense.paidFor.map((p) => p.participant),
    ...(expense.items ?? []).flatMap((item) =>
      item.paidFor.map((p) => p.participant),
    ),
    ...(expense.itemizedRemainder?.paidFor ?? []).map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: expense.title,
  })

  const removedDocuments = existingExpense.documents.filter(
    (existingDoc) =>
      !expense.documents.some((doc) => doc.id === existingDoc.id),
  )
  for (const doc of removedDocuments) {
    await deleteS3Object(doc.url)
  }

  // Handle items: delete stale, create/update incoming
  const incomingItems = expense.items ?? []
  const existingItems = existingExpense.items ?? []

  const isLeavingItemized =
    existingExpense.splitMode === 'ITEMIZED' &&
    expense.splitMode !== 'ITEMIZED' &&
    existingItems.some((i) => i.paidFor.length > 0)

  if (isLeavingItemized) {
    await prisma.expenseItemPaidFor.deleteMany({
      where: { expenseItem: { expenseId } },
    })
  }

  const incomingIds = new Set(
    incomingItems.filter((i) => i.id).map((i) => i.id!),
  )
  const itemsToDelete = existingItems.filter((i) => !incomingIds.has(i.id))
  if (itemsToDelete.length > 0) {
    await prisma.expenseItem.deleteMany({
      where: { id: { in: itemsToDelete.map((i) => i.id) } },
    })
  }

  for (const item of incomingItems) {
    if (item.id && incomingIds.has(item.id)) {
      await prisma.expenseItem.update({
        where: { id: item.id },
        data: {
          title: item.title,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          amount: item.amount,
          splitMode: item.splitMode,
        },
      })
      if (!isLeavingItemized) {
        await prisma.expenseItemPaidFor.deleteMany({
          where: { expenseItemId: item.id },
        })
        if (item.paidFor.length > 0) {
          await prisma.expenseItemPaidFor.createMany({
            data: item.paidFor.map((pf) => ({
              expenseItemId: item.id!,
              ledgerParticipantId: pf.participant,
              shares: pf.shares,
            })),
          })
        }
      }
    } else {
      const itemId = item.id ?? randomId()
      await prisma.expenseItem.create({
        data: {
          id: itemId,
          expenseId,
          title: item.title,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          amount: item.amount,
          splitMode: item.splitMode,
          ...(!isLeavingItemized && item.paidFor.length > 0
            ? {
                paidFor: {
                  createMany: {
                    data: item.paidFor.map((pf) => ({
                      ledgerParticipantId: pf.participant,
                      shares: pf.shares,
                    })),
                  },
                },
              }
            : {}),
        },
      })
    }
  }

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expense.recurrenceRule === RecurrenceRule.NONE &&
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== expense.recurrenceRule &&
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expense.recurrenceRule !== RecurrenceRule.NONE &&
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = {
    id: randomId(),
    ledgerId: group.ledgerId,
    nextExpenseDate: calculateNextDate(
      expense.recurrenceRule as RecurrenceRule,
      expense.expenseDate,
    ),
  }

  const updatedRecurrenceExpenseLinkNextExpenseDate = calculateNextDate(
    expense.recurrenceRule as RecurrenceRule,
    existingExpense.expenseDate,
  )

  const expensePaidFor =
    expense.splitMode === 'ITEMIZED'
      ? computePaidForFromItems(
          expense.items ?? [],
          [...participantIds],
          expense.originalCurrency
            ? (expense.originalAmount ?? expense.amount)
            : expense.amount,
          expense.itemizedRemainder,
        ).paidFor
      : expense.paidFor

  await prisma.expenseItemizedRemainder.deleteMany({
    where: { expenseId },
  })
  if (expense.itemizedRemainder) {
    await prisma.expenseItemizedRemainder.create({
      data: {
        expenseId,
        splitMode: expense.itemizedRemainder.splitMode,
        paidFor: {
          createMany: {
            data: expense.itemizedRemainder.paidFor.map((pf) => ({
              ledgerParticipantId: pf.participant,
              shares: pf.shares,
            })),
          },
        },
      },
    })
  }

  const createdExpense = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expense.expenseDate,
      amount: expense.amount,
      originalAmount: expense.originalAmount,
      originalCurrency: expense.originalCurrency,
      conversionRate: expense.conversionRate,
      title: expense.title,
      categoryId: expense.category,
      paidBySplitMode: expense.paidBySplitMode,
      ...(expense.paidByList.length > 0
        ? {
            paidByList: {
              create: expense.paidByList
                .filter(
                  (p) =>
                    !existingExpense.paidByList.some(
                      (pb) => pb.ledgerParticipantId === p.participant,
                    ),
                )
                .map((paidBy) => ({
                  ledgerParticipantId: paidBy.participant,
                  shares: paidBy.shares,
                })),
              update: expense.paidByList.map((paidBy) => ({
                where: {
                  expenseId_ledgerParticipantId: {
                    expenseId,
                    ledgerParticipantId: paidBy.participant,
                  },
                },
                data: {
                  shares: paidBy.shares,
                },
              })),
              deleteMany: existingExpense.paidByList
                .filter(
                  (paidBy) =>
                    !expense.paidByList.some(
                      (p) => p.participant === paidBy.ledgerParticipantId,
                    ),
                )
                .map(({ ledgerParticipantId, shares }) => ({
                  ledgerParticipantId,
                  shares,
                })),
            },
          }
        : {}),
      splitMode: expense.splitMode,
      recurrenceRule: expense.recurrenceRule,
      paidFor: {
        create: expensePaidFor
          .filter(
            (p) =>
              !existingExpense.paidFor.some(
                (pp) => pp.ledgerParticipantId === p.participant,
              ),
          )
          .map((paidFor) => ({
            ledgerParticipantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        update: expensePaidFor.map((paidFor) => ({
          where: {
            expenseId_ledgerParticipantId: {
              expenseId,
              ledgerParticipantId: paidFor.participant,
            },
          },
          data: {
            shares: paidFor.shares,
          },
        })),
        deleteMany: existingExpense.paidFor.filter(
          (paidFor) =>
            !expensePaidFor.some(
              (pf) => pf.participant === paidFor.ledgerParticipantId,
            ),
        ),
      },
      recurringExpenseLink: {
        ...(isCreateRecurrenceExpenseLink
          ? {
              create: newRecurringExpenseLink,
            }
          : {}),
        ...(isUpdateRecurrenceExpenseLink
          ? {
              update: {
                nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
              },
            }
          : {}),
        delete: isDeleteRecurrenceExpenseLink,
      },
      isReimbursement: expense.isReimbursement,
      documents: {
        connectOrCreate: expense.documents.map((doc) => ({
          create: doc,
          where: { id: doc.id },
        })),
        deleteMany: existingExpense.documents
          .filter(
            (existingDoc) =>
              !expense.documents.some((doc) => doc.id === existingDoc.id),
          )
          .map((doc) => ({
            id: doc.id,
          })),
      },
      notes: expense.notes,
    },
  })

  for (const doc of expense.documents) {
    await markS3ObjectAsOwned(doc.url)
  }

  return createdExpense
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        ...e.paidByList.map((pb) => pb.ledgerParticipant.id),
        ...e.paidFor.map((pf) => pf.ledgerParticipant.id),
      ]),
    ),
  )
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

  const rows = await prisma.expense.findMany({
    select: {
      amount: true,
      categoryId: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      paidBySplitMode: true,
      paidByList: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: { select: { account: { select: { name: true } } } },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      paidFor: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: { select: { account: { select: { name: true } } } },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
      items: {
        select: {
          id: true,
          title: true,
          unitPrice: true,
          quantity: true,
          amount: true,
          splitMode: true,
          paidFor: {
            select: {
              ledgerParticipantId: true,
              shares: true,
            },
          },
        },
      },
      itemizedRemainder: {
        select: {
          splitMode: true,
          paidFor: {
            select: {
              ledgerParticipantId: true,
              shares: true,
            },
          },
        },
      },
    },
    where: {
      ledgerId: group.ledgerId,
      title: options?.filter
        ? { contains: options.filter, mode: 'insensitive' }
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })

  return rows.map((row) => ({
    ...row,
    paidByList: row.paidByList.map((pb) => ({
      ledgerParticipant: {
        id: pb.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pb.ledgerParticipant),
      },
      shares: pb.shares,
    })),
    paidFor: row.paidFor.map((pf) => ({
      ledgerParticipant: {
        id: pf.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pf.ledgerParticipant),
      },
      shares: pf.shares,
    })),
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
  }))
}

export async function getGroupExpenseCount(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return 0
  return prisma.expense.count({ where: { ledgerId: group.ledgerId } })
}

export async function getExpense(groupId: string, expenseId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return null
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ledgerId: group.ledgerId },
    include: {
      paidByList: { include: { ledgerParticipant: true } },
      paidFor: true,
      documents: true,
      recurringExpenseLink: true,
      items: {
        include: { paidFor: true },
      },
      itemizedRemainder: {
        include: { paidFor: true },
      },
    },
  })
  if (!expense) return null
  return {
    ...expense,
    categoryId: narrowCategoryId(expense.categoryId),
    category: resolveCategory(expense.categoryId),
  }
}

import { prisma, RecurrenceRule, type Expense as DbExpense } from '@spliit/db'
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
import { scheduleDefaultNotificationDispatch } from '../notifications/dispatcher'
import { buildExpenseActivityData, logActivity } from './activities'
import {
  getAffectedParticipantIds,
  getExpenseChangeSummary,
  type ChangeContext,
} from './expense-activity-diff'
import { createRecurringExpenses } from './recurring-expenses'
import { randomId } from './shared'

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

/**
 * Normalize the Prisma `getExpense` return value to the domain
 * `Expense` shape expected by diff and affected-participant utilities.
 * The Prisma model stores `ledgerParticipantId` while the domain uses
 * `participant` for payer / split / item references.
 */
function toExpenseDomainShape(
  existing: NonNullable<Awaited<ReturnType<typeof getExpense>>>,
): Expense {
  return {
    title: existing.title,
    amount: existing.amount,
    expenseDate: existing.expenseDate,
    category: existing.categoryId,
    notes: existing.notes ?? undefined,
    recurrenceRule: existing.recurrenceRule,
    splitMode: existing.splitMode,
    paidBySplitMode: existing.paidBySplitMode,
    paidByList: existing.paidByList.map((pb) => ({
      participant: pb.ledgerParticipantId,
      shares: pb.shares,
    })),
    paidFor: existing.paidFor.map((pf) => ({
      participant: pf.ledgerParticipantId,
      shares: pf.shares,
    })),
    items: (existing.items ?? []).map((item) => ({
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
    itemizedRemainder: existing.itemizedRemainder
      ? {
          splitMode: existing.itemizedRemainder.splitMode,
          paidFor: existing.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    documents: existing.documents.map((d) => ({
      id: d.id,
      url: d.url,
      width: d.width,
      height: d.height,
    })),
    originalAmount: existing.originalAmount ?? undefined,
    originalCurrency: existing.originalCurrency ?? undefined,
    conversionRate: existing.conversionRate ?? undefined,
    isReimbursement: existing.isReimbursement,
  } as unknown as Expense
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

  const expenseDateStr = expense.expenseDate.toISOString().slice(0, 10)

  const isCreateRecurrence = expense.recurrenceRule !== RecurrenceRule.NONE

  const { activity, createdExpense } = await prisma.$transaction(async (tx) => {
    const activity = await logActivity(
      groupId,
      {
        type: 'EXPENSE_CREATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: buildExpenseActivityData({
          summary: expense.title,
          title: expense.title,
          amount: expense.amount,
          currencyCode: expense.originalCurrency ?? null,
          date: expenseDateStr,
        }),
      },
      tx,
    )

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

    const createdExpense = await tx.expense.create({
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

    return { activity, createdExpense }
  })

  for (const doc of expense.documents) {
    await markS3ObjectAsOwned(doc.url)
  }

  scheduleDefaultNotificationDispatch({
    activityId: activity.id,
    type: 'EXPENSE_CREATED',
    groupId,
    actor: { type: 'ACCOUNT', id: actor.accountId },
    subject: { type: 'EXPENSE', id: expenseId },
    data: buildExpenseActivityData({
      summary: expense.title,
      title: expense.title,
      amount: expense.amount,
      currencyCode: expense.originalCurrency ?? null,
      date: expenseDateStr,
    }),
    occurredAt: activity.time,
  })

  return createdExpense
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
) {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const affectedParticipantIds = [
    ...getAffectedParticipantIds({
      oldExpense: toExpenseDomainShape(existingExpense),
    }),
  ]

  const expenseDateStr = existingExpense.expenseDate.toISOString().slice(0, 10)

  const activity = await prisma.$transaction(async (tx) => {
    const act = await logActivity(
      groupId,
      {
        type: 'EXPENSE_DELETED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: buildExpenseActivityData({
          summary: existingExpense.title,
          title: existingExpense.title,
          amount: existingExpense.amount,
          currencyCode: existingExpense.originalCurrency ?? null,
          date: expenseDateStr,
          affectedParticipants: affectedParticipantIds,
        }),
      },
      tx,
    )

    await tx.expense.deleteMany({
      where: { id: expenseId, ledgerId: existingExpense.ledgerId },
    })

    return act
  })

  // Best-effort S3 cleanup — errors are logged but not propagated.
  for (const doc of existingExpense.documents) {
    try {
      await deleteS3Object(doc.url)
    } catch (err) {
      console.warn(`[expenses] failed to delete S3 object ${doc.url}:`, err)
    }
  }

  scheduleDefaultNotificationDispatch({
    activityId: activity.id,
    type: 'EXPENSE_DELETED',
    groupId,
    actor: { type: 'ACCOUNT', id: actor.accountId },
    subject: { type: 'EXPENSE', id: expenseId },
    data: buildExpenseActivityData({
      summary: existingExpense.title,
      title: existingExpense.title,
      amount: existingExpense.amount,
      currencyCode: existingExpense.originalCurrency ?? null,
      date: expenseDateStr,
      affectedParticipants: affectedParticipantIds,
    }),
    occurredAt: activity.time,
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

  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId: group.ledgerId,
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: {
      id: true,
      displayName: true,
      groupMember: { select: { account: { select: { name: true } } } },
      invitations: {
        where: { status: 'PENDING' },
        select: { email: true, temporaryName: true },
        take: 1,
      },
    },
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

  // Build participant name map for change formatting.
  const participantNameMap = new Map<string, string>()
  for (const p of participants) {
    participantNameMap.set(p.id, resolveParticipantDisplayName(p))
  }

  const changeCtx: ChangeContext = {
    getParticipantName: (id: string) => participantNameMap.get(id) ?? id,
    getCategoryName: (id: string) => resolveCategory(id).name,
    formatCurrencyCents: (cents, currency) => {
      const code =
        currency ?? group.ledger.currencyCode ?? group.ledger.currency
      const whole = Math.floor(Math.abs(cents) / 100)
      const frac = Math.abs(cents) % 100
      const sign = cents < 0 ? '-' : ''
      return `${sign}${code} ${whole}.${frac.toString().padStart(2, '0')}`
    },
  }

  const expenseDateStr = expense.expenseDate.toISOString().slice(0, 10)

  const changeSummary = getExpenseChangeSummary(
    toExpenseDomainShape(existingExpense),
    expense,
    changeCtx,
  )

  // Union of old + new participant IDs so update emails reach everyone
  // who was on the expense, including those removed by the change.
  const affectedParticipantIds = [
    ...getAffectedParticipantIds({
      oldExpense: toExpenseDomainShape(existingExpense),
      newExpense: expense,
    }),
  ]

  // S3 document deletions before transaction (external side effect)
  const removedDocuments = existingExpense.documents.filter(
    (existingDoc) =>
      !expense.documents.some((doc) => doc.id === existingDoc.id),
  )
  // S3 document deletions moved to post-transaction best-effort cleanup below

  // Handle items: delete stale, create/update incoming
  const incomingItems = expense.items ?? []
  const existingItems = existingExpense.items ?? []

  const isLeavingItemized =
    existingExpense.splitMode === 'ITEMIZED' &&
    expense.splitMode !== 'ITEMIZED' &&
    existingItems.some((i) => i.paidFor.length > 0)

  const incomingIds = new Set(
    incomingItems.filter((i) => i.id).map((i) => i.id!),
  )
  const itemsToDelete = existingItems.filter((i) => !incomingIds.has(i.id))

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

  // Transaction: activity log + all DB writes are atomic
  const { activity, createdExpense } = await prisma.$transaction(async (tx) => {
    let act: Awaited<ReturnType<typeof logActivity>> | null = null

    if (changeSummary) {
      act = await logActivity(
        groupId,
        {
          type: 'EXPENSE_UPDATED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'EXPENSE', id: expenseId },
          data: buildExpenseActivityData({
            summary: expense.title,
            title: expense.title,
            amount: expense.amount,
            currencyCode: expense.originalCurrency ?? null,
            date: expenseDateStr,
            changedFields: changeSummary.changedFields,
            changes: changeSummary.changes,
            affectedParticipants: affectedParticipantIds,
          }),
        },
        tx,
      )
    }

    if (isLeavingItemized) {
      await tx.expenseItemPaidFor.deleteMany({
        where: { expenseItem: { expenseId } },
      })
    }

    if (itemsToDelete.length > 0) {
      await tx.expenseItem.deleteMany({
        where: { id: { in: itemsToDelete.map((i) => i.id) } },
      })
    }

    for (const item of incomingItems) {
      if (item.id && incomingIds.has(item.id)) {
        await tx.expenseItem.update({
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
          await tx.expenseItemPaidFor.deleteMany({
            where: { expenseItemId: item.id },
          })
          if (item.paidFor.length > 0) {
            await tx.expenseItemPaidFor.createMany({
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
        await tx.expenseItem.create({
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

    await tx.expenseItemizedRemainder.deleteMany({
      where: { expenseId },
    })
    if (expense.itemizedRemainder) {
      await tx.expenseItemizedRemainder.create({
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

    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        expenseDate: expense.expenseDate,
        amount: expense.amount,
        originalAmount: expense.originalAmount ?? null,
        originalCurrency: expense.originalCurrency ?? null,
        conversionRate: expense.conversionRate ?? null,
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

    return { activity: act, createdExpense: updated }
  })

  // Best-effort S3 cleanup — errors are logged but not propagated so they
  // don't corrupt the perceived mutation outcome.
  for (const doc of removedDocuments) {
    try {
      await deleteS3Object(doc.url)
    } catch (err) {
      console.warn(`[expenses] failed to delete S3 object ${doc.url}:`, err)
    }
  }
  for (const doc of expense.documents) {
    try {
      await markS3ObjectAsOwned(doc.url)
    } catch (err) {
      console.warn(
        `[expenses] failed to mark S3 object as owned ${doc.url}:`,
        err,
      )
    }
  }

  if (activity && changeSummary) {
    scheduleDefaultNotificationDispatch({
      activityId: activity.id,
      type: 'EXPENSE_UPDATED',
      groupId,
      actor: { type: 'ACCOUNT', id: actor.accountId },
      subject: { type: 'EXPENSE', id: expenseId },
      data: buildExpenseActivityData({
        summary: expense.title,
        title: expense.title,
        amount: expense.amount,
        currencyCode: expense.originalCurrency ?? null,
        date: expenseDateStr,
        changedFields: changeSummary.changedFields,
        changes: changeSummary.changes,
        affectedParticipants: affectedParticipantIds,
      }),
      occurredAt: activity.time,
    })
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
      conversionRate: true,
      categoryId: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      originalAmount: true,
      originalCurrency: true,
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
    conversionRate: row.conversionRate?.toNumber() ?? null,
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

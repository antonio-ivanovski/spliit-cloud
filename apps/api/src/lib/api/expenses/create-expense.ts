import type { Expense as DbExpense } from '@spliit/db'
import { prisma } from '@spliit/db'
import {
  calculateRecurrenceDate,
  computePaidForFromItems,
  type Expense,
} from '@spliit/domain'
import { env as jobsEnv } from '@spliit/jobs'

import { resolveConversion } from '../../expense-conversion'
import {
  buildExpenseActivityData,
  logActivity,
  planNotificationForActivity,
} from '../activities'
import { getApiBoss } from '../boss'
import {
  buildRecurringTemplate,
  createSeriesForExpense,
  getApiBossForWrite,
  getExpenseRecurrence,
} from '../recurrence-series'
import { randomId } from '../shared'
import { promoteExpenseDocuments } from './helpers'

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

  const conversion = await resolveConversion(expense, {
    ledgerCurrency: group.ledger.currencyCode ?? null,
    expenseDate: expense.expenseDate,
  })

  const expenseAmount = conversion.ledgerAmountMinor

  const activeParticipants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId,
      removedAt: null,
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  // Settlements may involve soft-removed participants who still appear in
  // balances. Keep them off new ordinary expenses, but allow reimbursements.
  const removedParticipants = expense.isReimbursement
    ? await prisma.ledgerParticipant.findMany({
        where: { ledgerId, removedAt: { not: null } },
        select: { id: true },
      })
    : []
  const participantIds = new Set([
    ...activeParticipants.map((p) => p.id),
    ...removedParticipants.map((p) => p.id),
  ])

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

  const recurrence = getExpenseRecurrence(
    expense as unknown as { recurrence?: unknown; recurrenceRule?: string },
    expense.expenseDate,
  )
  const isCreateRecurrence = recurrence !== null
  const queueBoss =
    recurrence && jobsEnv.JOBS_ENABLED ? await getApiBossForWrite() : undefined

  const documents = await promoteExpenseDocuments(expense.documents)
  const recurringPaidFor =
    expense.splitMode === 'ITEMIZED'
      ? computePaidForFromItems(
          expense.items ?? [],
          [...participantIds],
          conversion.originalAmount ?? expenseAmount,
          expense.itemizedRemainder,
          expenseId,
        ).paidFor
      : expense.paidFor

  const activityType = isCreateRecurrence
    ? ('RECURRING_EXPENSE_CREATED' as const)
    : ('EXPENSE_CREATED' as const)

  const recurringSeriesId = isCreateRecurrence ? randomId() : undefined

  // When the anchor date is in the past and more than one occurrence is
  // immediately due, seed a catch-up batch so the worker produces one
  // combined summary instead of a schedule-created notification plus
  // individual catch-up notifications.
  let catchUpSeed:
    | {
        id: string
        startDate: string
        count: number
        mode: 'INITIAL_CREATION'
        dueThrough: string
      }
    | undefined
  if (recurrence && recurringSeriesId) {
    const today = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ),
    )
    const todayIso = today.toISOString().slice(0, 10)
    const occ2Date = calculateRecurrenceDate(
      expense.expenseDate,
      recurrence.frequency,
      recurrence.interval,
      2,
    )
    // Only seed a catch-up batch when occurrence two is both due and
    // permitted by the termination config. COUNT 1 schedules have no
    // occurrence two; DATE schedules where occurrence two falls after
    // the end date likewise have no second occurrence to catch up.
    const occ2Permitted =
      recurrence.end.type === 'INDEFINITE' ||
      (recurrence.end.type === 'COUNT' && recurrence.end.count >= 2) ||
      (recurrence.end.type === 'DATE' && occ2Date <= recurrence.end.endDate)
    if (occ2Date <= today && occ2Permitted) {
      catchUpSeed = {
        id: `recurring-catchup:${recurringSeriesId}:${expenseDateStr}`,
        startDate: expenseDateStr,
        count: 1,
        mode: 'INITIAL_CREATION',
        dueThrough: todayIso,
      }
    }
  }

  const boss = await getApiBoss()
  const createdExpense = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Group" WHERE id = ${groupId} FOR UPDATE`
    const lockedGroup = await tx.group.findUnique({
      where: { id: groupId },
      select: { archived: true },
    })
    if (lockedGroup?.archived)
      throw new Error('This group is archived and no new expenses can be added')
    const activity = await logActivity(
      groupId,
      {
        type: activityType,
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: buildExpenseActivityData({
          summary: expense.title,
          title: expense.title,
          amount: expenseAmount,
          currencyCode: conversion.originalCurrency,
          date: expenseDateStr,
          originalAmount: conversion.originalAmount ?? undefined,
          conversionRate: conversion.conversionRate ?? undefined,
          conversionSource: conversion.conversionSource,
          ledgerCurrencyCode: group.ledger.currencyCode ?? null,
          ...(recurrence && recurringSeriesId
            ? {
                recurrence: {
                  seriesId: recurringSeriesId,
                  frequency: recurrence.frequency,
                  interval: recurrence.interval,
                  endType: recurrence.end.type,
                  occurrenceLimit:
                    recurrence.end.type === 'COUNT'
                      ? recurrence.end.count
                      : null,
                  endDate:
                    recurrence.end.type === 'DATE'
                      ? recurrence.end.endDate.toISOString().slice(0, 10)
                      : null,
                },
              }
            : {}),
        }),
      },
      tx,
    )

    if (recurrence && recurringSeriesId) {
      await createSeriesForExpense({
        tx,
        seriesId: recurringSeriesId,
        ledgerId,
        creatorAccountId: actor.accountId,
        anchorDate: expense.expenseDate,
        config: recurrence,
        template: buildRecurringTemplate({
          expense: { ...expense, paidForOverride: recurringPaidFor },
          conversion,
        }),
        boss: queueBoss,
        catchUpBatch: catchUpSeed,
      })
    }

    const createdExpense = await tx.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        expenseDate: expense.expenseDate,
        categoryId: expense.category,
        amount: expenseAmount,
        originalAmount: conversion.originalAmount,
        originalCurrency: conversion.originalCurrency,
        conversionRate: conversion.conversionRate,
        conversionSource: conversion.conversionSource,
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
        ...(recurringSeriesId
          ? { recurringSeriesId, recurrenceSequence: 1 }
          : {}),
        paidFor: {
          createMany: {
            data:
              expense.splitMode === 'ITEMIZED'
                ? computePaidForFromItems(
                    expense.items ?? [],
                    [...participantIds],
                    conversion.originalAmount ?? expenseAmount,
                    expense.itemizedRemainder,
                    expenseId,
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
            // Item IDs are database-global and create requests may be copied
            // or replayed, so never persist a client-provided ID here.
            id: randomId(),
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
            data: documents.map((doc) => ({
              id: randomId(),
              url: doc.url,
              width: doc.width,
              height: doc.height,
              ledgerId,
            })),
          },
        },
        notes: expense.notes,
      },
    })

    if (!catchUpSeed) {
      await planNotificationForActivity(
        tx,
        activity,
        isCreateRecurrence ? { includeActorAsRecipient: true } : {},
        { boss },
      )
    }

    return createdExpense
  })

  return createdExpense
}

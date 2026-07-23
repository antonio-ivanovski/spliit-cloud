import type { Prisma } from '@spliit/db'
import { prisma } from '@spliit/db'
import {
  calculateRecurrenceDate,
  computePaidForFromItems,
  type Expense,
} from '@spliit/domain'
import { env as jobsEnv } from '@spliit/jobs'
import { deleteS3Object } from '../../../routes/upload'
import { resolveConversion } from '../../expense-conversion'
import { resolveParticipantDisplayName } from '../../invitations'
import { scheduleDefaultNotificationDispatch } from '../../notifications/dispatcher'
import { buildExpenseActivityData, logActivity } from '../activities'
import {
  getAffectedParticipantIds,
  getExpenseChangeSummary,
  type ChangeContext,
} from '../expense-activity-diff'
import {
  buildRecurringTemplate,
  createSeriesForExpense,
  enqueueMaterialization,
  getApiBoss,
  getExpenseRecurrence,
} from '../recurrence-series'
import { randomId } from '../shared'
import {
  futureRowAfterShape,
  futureRowBeforeShape,
  futureRowSnapshotSelect,
  sharedRecurrenceFromSeries,
} from './future-row-diff'
import {
  promoteExpenseDocuments,
  resolveCategory,
  toExpenseDomainShape,
} from './helpers'
import { getExpense } from './queries'

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expense: Expense,
  actor: { accountId: string },
  options?: { scope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const preserveRecurringDates =
    options?.scope === 'THIS_AND_FUTURE' &&
    existingExpense.recurringSeriesId !== null &&
    existingExpense.recurrenceSequence !== null

  const conversion = await resolveConversion(expense, {
    ledgerCurrency: group.ledger.currencyCode ?? null,
    expenseDate: preserveRecurringDates
      ? existingExpense.expenseDate
      : expense.expenseDate,
  })

  const expenseAmount = conversion.ledgerAmountMinor

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
      groupMember: {
        select: {
          account: { select: { id: true, name: true, image: true } },
        },
      },
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
    ledgerCurrencyCode: group.ledger.currencyCode ?? group.ledger.currency,
  }

  const expenseDateStr = expense.expenseDate.toISOString().slice(0, 10)

  const documents = await promoteExpenseDocuments(expense.documents)
  const recurrence = getExpenseRecurrence(
    expense as unknown as { recurrence?: unknown; recurrenceRule?: string },
    expense.expenseDate,
  )
  const legacyRecurrenceRule =
    recurrence?.frequency === 'DAILY' ||
    recurrence?.frequency === 'WEEKLY' ||
    recurrence?.frequency === 'MONTHLY'
      ? recurrence.frequency
      : ('NONE' as const)
  const queueBoss =
    recurrence && jobsEnv.JOBS_ENABLED ? await getApiBoss() : undefined

  // Diff against the post-resolution shape so ledger `amount` and
  // conversion fields are compared in the same units as the stored row.
  const resolvedExpense = {
    ...expense,
    recurrenceRule: legacyRecurrenceRule,
    amount: expenseAmount,
    conversion: conversion.conversionSource
      ? conversion.conversionSource === 'CUSTOM'
        ? ({
            type: 'custom' as const,
            currency: conversion.originalCurrency ?? '',
            rate: conversion.conversionRate ?? 1,
          } as const)
        : ({
            type: 'exchange' as const,
            currency: conversion.originalCurrency ?? '',
          } as const)
      : undefined,
    originalAmount: conversion.originalAmount ?? undefined,
    originalCurrency: conversion.originalCurrency ?? undefined,
    conversionRate: conversion.conversionRate ?? undefined,
    conversionSource: conversion.conversionSource,
  }

  const changeSummary = getExpenseChangeSummary(
    toExpenseDomainShape(existingExpense),
    resolvedExpense,
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

  const removedDocuments = existingExpense.documents.filter(
    (existingDoc) => !documents.some((doc) => doc.id === existingDoc.id),
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
  const existingItemIds = new Set(existingItems.map((i) => i.id))
  const itemsToDelete = existingItems.filter((i) => !incomingIds.has(i.id))

  const existingSeries = existingExpense.recurringSeries
  const detachRecurrence = existingSeries !== null && recurrence === null
  const isDeleteRecurrence =
    detachRecurrence && options?.scope === 'THIS_AND_FUTURE'
  const isUpdateRecurrence = existingSeries !== null && recurrence !== null
  const isCreateRecurrence = existingSeries === null && recurrence !== null

  const expensePaidFor =
    expense.splitMode === 'ITEMIZED'
      ? computePaidForFromItems(
          expense.items ?? [],
          [...participantIds],
          conversion.originalAmount ?? expenseAmount,
          expense.itemizedRemainder,
          expenseId,
        ).paidFor
      : expense.paidFor

  const recurrenceTemplate = recurrence
    ? buildRecurringTemplate({
        expense: { ...expense, paidForOverride: expensePaidFor },
        conversion,
      })
    : null

  // Exchange rates are date-sensitive. Resolve them before entering the
  // write transaction, then apply the resulting snapshots while the series
  // row is locked. Newly materialized rows will use the updated series
  // template after this transaction commits.
  const materializedFutureRows =
    isUpdateRecurrence && options?.scope === 'THIS_AND_FUTURE'
      ? await prisma.expense.findMany({
          where: {
            recurringSeriesId: existingSeries!.id,
            recurrenceSequence: {
              gte: existingExpense.recurrenceSequence ?? 1,
            },
          },
          orderBy: { recurrenceSequence: 'asc' },
          select: { id: true, expenseDate: true, recurrenceSequence: true },
        })
      : []
  const materializedConversions = new Map<
    string,
    Awaited<ReturnType<typeof resolveConversion>>
  >()
  if (recurrenceTemplate) {
    const conversionInput =
      recurrenceTemplate.conversionSource === 'CUSTOM'
        ? {
            type: 'custom' as const,
            currency: recurrenceTemplate.originalCurrency ?? '',
            rate: recurrenceTemplate.conversionRate ?? 1,
          }
        : recurrenceTemplate.conversionSource === 'EXCHANGE'
          ? {
              type: 'exchange' as const,
              currency: recurrenceTemplate.originalCurrency ?? '',
            }
          : undefined
    for (const row of materializedFutureRows) {
      materializedConversions.set(
        row.id,
        await resolveConversion(
          { amount: recurrenceTemplate.amount, conversion: conversionInput },
          {
            ledgerCurrency: group.ledger.currencyCode ?? null,
            expenseDate: row.expenseDate,
          },
        ),
      )
    }
  }

  // Transaction: activity log + all DB writes are atomic
  const { updatedExpense, changedRows } = await prisma.$transaction(
    async (tx) => {
      if (existingExpense.recurringSeriesId) {
        await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${existingExpense.recurringSeriesId} FOR UPDATE`
        if (options?.scope === 'THIS_AND_FUTURE' && existingSeries !== null) {
          const lockedSeries = await tx.recurringExpenseSeries.findUnique({
            where: { id: existingSeries.id },
            select: { version: true },
          })
          if (
            !lockedSeries ||
            lockedSeries.version !== existingSeries.version
          ) {
            throw new Error(
              'Recurring expense series changed while it was being updated; retry the update',
            )
          }
        }
      }
      type ChangedRow = {
        activity: Awaited<ReturnType<typeof logActivity>>
        expenseId: string
        scheduledDate: string
        participantIds: string[]
        data: ReturnType<typeof buildExpenseActivityData>
      }
      const changedRows: ChangedRow[] = []

      if (changeSummary) {
        const activity = await logActivity(
          groupId,
          {
            type: 'EXPENSE_UPDATED',
            actor: { type: 'ACCOUNT', id: actor.accountId },
            subject: { type: 'EXPENSE', id: expenseId },
            data: buildExpenseActivityData({
              summary: expense.title,
              title: expense.title,
              amount: expenseAmount,
              currencyCode: conversion.originalCurrency,
              date: expenseDateStr,
              changedFields: changeSummary.changedFields,
              changes: changeSummary.changes,
              affectedParticipants: affectedParticipantIds,
              originalAmount: conversion.originalAmount ?? undefined,
              conversionRate: conversion.conversionRate ?? undefined,
              conversionSource: conversion.conversionSource,
              ledgerCurrencyCode: group.ledger.currencyCode ?? null,
            }),
          },
          tx,
        )
        changedRows.push({
          activity,
          expenseId,
          scheduledDate: expenseDateStr,
          participantIds: affectedParticipantIds,
          data: activity.data as ReturnType<typeof buildExpenseActivityData>,
        })
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
        if (item.id && existingItemIds.has(item.id)) {
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

      // Only manage `ExpenseItemizedRemainder` rows for ITEMIZED expenses.
      // The remainder is semantically meaningless otherwise, and we
      // proactively delete any pre-existing rows so leftover artifacts from
      // past (buggy) edits are cleaned up the next time the expense is
      // updated.
      if (expense.splitMode === 'ITEMIZED') {
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
      }

      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: {
          expenseDate: preserveRecurringDates
            ? existingExpense.expenseDate
            : expense.expenseDate,
          amount: expenseAmount,
          originalAmount: conversion.originalAmount,
          originalCurrency: conversion.originalCurrency,
          conversionRate: conversion.conversionRate,
          conversionSource: conversion.conversionSource,
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
          ...(detachRecurrence
            ? {
                recurringSeries: { disconnect: true },
                recurrenceSequence: null,
              }
            : {}),
          isReimbursement: expense.isReimbursement,
          documents: {
            connectOrCreate: documents.map((doc) => ({
              create: { ...doc, ledgerId: group.ledgerId },
              where: { id: doc.id },
            })),
            deleteMany: existingExpense.documents
              .filter(
                (existingDoc) =>
                  !documents.some((doc) => doc.id === existingDoc.id),
              )
              .map((doc) => ({
                id: doc.id,
              })),
          },
          notes: expense.notes,
        },
      })

      if (isDeleteRecurrence && existingSeries) {
        await tx.recurringExpenseSeries.update({
          where: { id: existingSeries.id },
          data: { status: 'CANCELLED' },
        })
      } else if ((isCreateRecurrence || isUpdateRecurrence) && recurrence) {
        const seriesId = existingSeries?.id ?? randomId()
        const template = recurrenceTemplate!
        if (!existingSeries) {
          await createSeriesForExpense({
            tx,
            seriesId,
            ledgerId: group.ledgerId,
            creatorAccountId: actor.accountId,
            anchorDate: expense.expenseDate,
            config: recurrence,
            template,
            boss: queueBoss,
          })
          await tx.expense.update({
            where: { id: expenseId },
            data: { recurringSeriesId: seriesId, recurrenceSequence: 1 },
          })
        } else if (options?.scope === 'THIS_AND_FUTURE') {
          const anchorSequence = existingExpense.recurrenceSequence ?? 1
          // `occurrencesCreated` is authoritative and monotonic. Do not infer
          // progress from surviving expense rows: occurrence-only deletion can
          // leave sequence gaps, and this-and-future delete-only intentionally
          // removes later rows while keeping the series active.
          const seriesProgress = await tx.recurringExpenseSeries.findUnique({
            where: { id: existingSeries.id },
            select: { occurrencesCreated: true, status: true },
          })
          if (!seriesProgress) throw new Error('Recurring series not found')
          const latest = await tx.expense.findFirst({
            where: { recurringSeriesId: existingSeries.id },
            orderBy: { expenseDate: 'desc' },
            select: { expenseDate: true },
          })
          const maxSequence = Math.max(
            anchorSequence,
            seriesProgress.occurrencesCreated,
          )
          let nextOrdinal = maxSequence - anchorSequence + 2
          let nextOccurrenceDate = calculateRecurrenceDate(
            expense.expenseDate,
            recurrence.frequency,
            recurrence.interval,
            nextOrdinal,
          )
          while (
            latest?.expenseDate &&
            nextOccurrenceDate <= latest.expenseDate
          ) {
            nextOrdinal += 1
            nextOccurrenceDate = calculateRecurrenceDate(
              expense.expenseDate,
              recurrence.frequency,
              recurrence.interval,
              nextOrdinal,
            )
          }
          const completed =
            (recurrence.end.type === 'COUNT' &&
              maxSequence >= recurrence.end.count) ||
            (recurrence.end.type === 'DATE' &&
              nextOccurrenceDate > recurrence.end.endDate)
          const terminalStatus =
            seriesProgress.status === 'CANCELLED' ||
            seriesProgress.status === 'COMPLETED'
              ? seriesProgress.status
              : null
          // Preserve the original terminal status unconditionally.
          // A cancelled series must never become completed, and vice versa.
          const nextStatus = terminalStatus
            ? terminalStatus
            : completed
              ? ('COMPLETED' as const)
              : ('ACTIVE' as const)
          // When the series is already terminal, only update template
          // fields and version — scheduling metadata must not change.
          const terminal = terminalStatus !== null
          await tx.recurringExpenseSeries.update({
            where: { id: existingSeries.id },
            data: {
              ...(!terminal
                ? {
                    frequency: recurrence.frequency,
                    interval: recurrence.interval,
                    endType: recurrence.end.type,
                    occurrenceLimit:
                      recurrence.end.type === 'COUNT'
                        ? recurrence.end.count
                        : null,
                    endDate:
                      recurrence.end.type === 'DATE'
                        ? recurrence.end.endDate
                        : null,
                    anchorDate: expense.expenseDate,
                    anchorSequence,
                    occurrencesCreated: maxSequence,
                    nextOccurrenceDate,
                    nextOccurrenceOrdinal: nextOrdinal,
                  }
                : {}),
              status: nextStatus,
              version: { increment: 1 },
              template,
              catchUpBatch: null,
            },
          })
          const futureRowIds = materializedFutureRows
            .filter((r) => r.id !== expenseId)
            .map((r) => r.id)
          const futureRowSnapshots =
            futureRowIds.length > 0
              ? await tx.expense.findMany({
                  where: { id: { in: futureRowIds } },
                  select: futureRowSnapshotSelect,
                })
              : []
          const futureRowSnapshotMap = new Map(
            futureRowSnapshots.map((r) => [r.id, r]),
          )
          // Series recurrence is identical on both sides of the per-row diff.
          const shared = sharedRecurrenceFromSeries(existingSeries)
          for (const row of materializedFutureRows) {
            // The edited occurrence was already updated above (including its
            // documents). Future rows receive the new template while retaining
            // their own date, recurrence identity, and attachments.
            if (row.id === expenseId) continue
            const rowConv = materializedConversions.get(row.id) ?? conversion
            await updateMaterializedOccurrence(tx, row, template, rowConv)
            // Per-row diff: full snapshot before vs template + this row's
            // resolved conversion after. Only log when the diff engine
            // detects a meaningful change, and store its real
            // changedFields/changes — never the hard-coded ['recurrence'].
            const before = futureRowSnapshotMap.get(row.id)
            if (!before) continue
            const beforeShape = futureRowBeforeShape(before, shared)
            const afterShape = futureRowAfterShape({
              row: before,
              template,
              rowConv,
              shared,
            })
            const rowChangeSummary = getExpenseChangeSummary(
              beforeShape,
              afterShape,
              changeCtx,
            )
            if (!rowChangeSummary) continue
            const rowDateStr = row.expenseDate.toISOString().slice(0, 10)
            const rowParticipantIds = [
              ...getAffectedParticipantIds({
                oldExpense: beforeShape,
                newExpense: afterShape,
              }),
            ]
            const rowActivityData = buildExpenseActivityData({
              summary: template.title,
              title: template.title,
              amount: rowConv.ledgerAmountMinor,
              currencyCode: rowConv.originalCurrency,
              date: rowDateStr,
              changedFields: rowChangeSummary.changedFields,
              changes: rowChangeSummary.changes,
              affectedParticipants: rowParticipantIds,
              originalAmount: rowConv.originalAmount ?? undefined,
              conversionRate: rowConv.conversionRate ?? undefined,
              conversionSource: rowConv.conversionSource,
              ledgerCurrencyCode: group.ledger.currencyCode ?? null,
            })
            const rowAct = await logActivity(
              groupId,
              {
                type: 'EXPENSE_UPDATED',
                actor: { type: 'ACCOUNT', id: actor.accountId },
                subject: { type: 'EXPENSE', id: row.id },
                data: rowActivityData,
              },
              tx,
            )
            changedRows.push({
              activity: rowAct,
              expenseId: row.id,
              scheduledDate: rowDateStr,
              participantIds: rowParticipantIds,
              data: rowActivityData,
            })
          }
          if (!completed && !terminalStatus) {
            await enqueueMaterialization(
              tx,
              {
                seriesId: existingSeries.id,
                sequence: maxSequence + 1,
                occurrenceDate: nextOccurrenceDate,
              },
              queueBoss,
            )
          }
        }
      }
      return { updatedExpense: updated, changedRows }
    },
  )

  // Best-effort S3 cleanup — errors are logged but not propagated so they
  // don't corrupt the perceived mutation outcome.
  for (const doc of removedDocuments) {
    try {
      await deleteS3Object(doc.url)
    } catch (err) {
      console.warn(`[expenses] failed to delete S3 object ${doc.url}:`, err)
    }
  }

  const changedCount = changedRows.length
  if (changedCount === 0) {
    // Nothing changed for any row — no notification.
  } else if (changedCount === 1) {
    // Single row changed (selected or sole future row): normal delivery
    // using that row's own activity data, so titles/dates/affected
    // participants are accurate even when only a future row differs.
    const row = changedRows[0]!
    scheduleDefaultNotificationDispatch({
      activityId: row.activity.id,
      type: 'EXPENSE_UPDATED',
      groupId,
      actor: { type: 'ACCOUNT', id: actor.accountId },
      subject: { type: 'EXPENSE', id: row.expenseId },
      data: row.data,
      occurredAt: row.activity.time,
    })
  } else {
    // Multi-row update: one summary notification with count and date
    // range. The summary id anchors on the first row's committed
    // activity id so back-to-back same-day bulk edits produce distinct
    // push notifications instead of collapsing.
    const sortedDates = changedRows.map((r) => r.scheduledDate).sort()
    const summaryStartDate = sortedDates[0] ?? expenseDateStr
    const summaryEndDate = sortedDates.at(-1) ?? expenseDateStr
    const unionParticipantIds: string[] = []
    for (const row of changedRows) {
      for (const pid of row.participantIds) {
        if (!unionParticipantIds.includes(pid)) unionParticipantIds.push(pid)
      }
    }
    const series = existingExpense.recurringSeriesId
      ? await prisma.recurringExpenseSeries.findUnique({
          where: { id: existingExpense.recurringSeriesId },
          select: {
            frequency: true,
            interval: true,
            endType: true,
            occurrenceLimit: true,
            endDate: true,
          },
        })
      : null
    const primaryAct = changedRows[0]!.activity
    const summaryId = `update-summary:${existingExpense.recurringSeriesId ?? expenseId}:${primaryAct.id}`
    scheduleDefaultNotificationDispatch({
      activityId: summaryId,
      type: 'EXPENSE_UPDATED',
      groupId,
      actor: { type: 'ACCOUNT', id: actor.accountId },
      subject: { type: 'EXPENSE', id: expenseId },
      data: {
        kind: 'recurring_expense_summary',
        summary: `${changedCount} expenses updated`,
        title: updatedExpense.title,
        count: changedCount,
        startDate: summaryStartDate,
        endDate: summaryEndDate,
        affectedParticipants: unionParticipantIds,
        seriesId: existingExpense.recurringSeriesId ?? undefined,
        frequency: series?.frequency ?? undefined,
        interval: series?.interval ?? undefined,
        endType: series?.endType ?? undefined,
        occurrenceLimit: series?.occurrenceLimit ?? undefined,
        seriesEndDate:
          series?.endDate?.toISOString?.()?.slice(0, 10) ?? undefined,
        operation: 'update' as const,
        stopped: false,
      },
      occurredAt: primaryAct.time,
    })
  }

  return updatedExpense
}
/** Replace the mutable template fields on a materialized occurrence. Dates,
 * recurrence identity, and documents intentionally remain untouched. */
async function updateMaterializedOccurrence(
  tx: Prisma.TransactionClient,
  row: { id: string },
  template: ReturnType<typeof buildRecurringTemplate>,
  conversion: {
    ledgerAmountMinor: number
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  },
) {
  await tx.expenseItemizedRemainder.deleteMany({ where: { expenseId: row.id } })
  await tx.expense.update({
    where: { id: row.id },
    data: {
      amount: conversion.ledgerAmountMinor,
      originalAmount: conversion.originalAmount,
      originalCurrency: conversion.originalCurrency,
      conversionRate: conversion.conversionRate,
      conversionSource: conversion.conversionSource,
      title: template.title,
      categoryId: template.categoryId,
      paidBySplitMode: template.paidBySplitMode as never,
      splitMode: template.splitMode as never,
      isReimbursement: template.isReimbursement,
      notes: template.notes,
      paidByList: {
        deleteMany: {},
        createMany: { data: template.paidByList },
      },
      paidFor: {
        deleteMany: {},
        createMany: { data: template.paidFor },
      },
      items: {
        deleteMany: {},
        create: template.items.map((item) => ({
          id: randomId(),
          title: item.title,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          amount: item.amount,
          splitMode: item.splitMode as never,
          paidFor: { createMany: { data: item.paidFor } },
        })),
      },
    },
  })
  if (template.itemizedRemainder) {
    await tx.expenseItemizedRemainder.create({
      data: {
        expenseId: row.id,
        splitMode: template.itemizedRemainder.splitMode as never,
        paidFor: {
          createMany: { data: template.itemizedRemainder.paidFor },
        },
      },
    })
  }
}

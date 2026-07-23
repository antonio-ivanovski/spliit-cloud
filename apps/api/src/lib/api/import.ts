import {
  GroupMemberStatus,
  GroupRole,
  GroupType,
  LedgerParticipantKind,
  prisma,
} from '@spliit/db'
import type { Expense, GroupFormValues } from '@spliit/domain'
import {
  collapseExpenseFromApi,
  planLegacyRecurringImport,
} from '@spliit/domain/import'
import { env as jobsEnv } from '@spliit/jobs'
import { resolveConversion } from '../expense-conversion'
import { scheduleDefaultNotificationDispatch } from '../notifications/dispatcher'
import {
  buildExpenseActivityData,
  buildImportSummaryActivityData,
  logActivity,
} from './activities'
import {
  buildRecurringTemplate,
  createSeriesForExpense,
  getApiBoss,
} from './recurrence-series'
import { randomId } from './shared'

export type ImportParticipantMapping =
  | {
      mode: 'LINK_ACCOUNT'
      sourceName: string
      linkedAccountId: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_EMAIL'
      sourceName: string
      email: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_LINK'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'UNLINKED_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'LINK_EXISTING_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_CONTACT'
      sourceName: string
      email: string
      destLedgerParticipantId: string
    }

export type ImportSourceMeta = {
  provider: string
  sourceGroupId: string
  sourceUrl?: string
}

export type ImportInput = {
  targetGroupId?: string
  groupFormValues?: GroupFormValues
  participants: ImportParticipantMapping[]
  expenses: Expense[]
  sourceMeta?: ImportSourceMeta
}

export type ImportInviteResult = {
  sourceName: string
  kind: 'EMAIL' | 'LINK'
  invitationId: string
  inviteUrl?: string
  email?: string
}

export type ImportResult = {
  groupId: string
  ledgerId: string
  importedExpenses: number
  sourceGroupId: string | null
  invites: ImportInviteResult[]
}

export async function importGroup(
  input: ImportInput,
  actor: { accountId: string },
): Promise<ImportResult> {
  // Legacy spliit.app export only carries recurrenceRule. Matching historical
  // rows collapse into one destination series; Cloud series metadata is never
  // accepted on this transport.
  const recurringPlan = planLegacyRecurringImport(
    input.expenses.map((expense) => collapseExpenseFromApi(expense)),
  )
  const queueBoss =
    jobsEnv.JOBS_ENABLED && recurringPlan.series.length > 0
      ? await getApiBoss()
      : undefined
  const baseResult = await prisma.$transaction(async (tx) => {
    let groupId: string
    let ledgerId: string

    if (input.targetGroupId) {
      const existing = await tx.group.findUnique({
        where: { id: input.targetGroupId },
        select: { id: true, ledgerId: true, archived: true, groupType: true },
      })
      if (!existing) {
        throw new Error('Target group not found')
      }
      if (existing.archived) {
        throw new Error('Cannot import into an archived group')
      }
      if (existing.groupType === GroupType.FRIEND) {
        throw new Error('Cannot import into a friend ledger')
      }
      if (!existing.ledgerId) {
        throw new Error('Target group is missing its ledger')
      }
      groupId = existing.id
      ledgerId = existing.ledgerId
    } else {
      if (!input.groupFormValues) {
        throw new Error('Either targetGroupId or groupFormValues is required')
      }
      const ledger = await tx.ledger.create({
        data: {
          id: randomId(),
          currency: input.groupFormValues.currency,
          currencyCode: input.groupFormValues.currencyCode || null,
        },
      })
      const group = await tx.group.create({
        data: {
          id: randomId(),
          name: input.groupFormValues.name,
          information: input.groupFormValues.information,
          ledgerId: ledger.id,
        },
      })
      const adminMember = await tx.groupMember.create({
        data: {
          id: randomId(),
          groupId: group.id,
          accountId: actor.accountId,
          role: GroupRole.ADMIN,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      groupId = group.id
      ledgerId = ledger.id
      void adminMember
    }

    const destIdByClientKey = new Map<string, string>()
    const inviteMappings: Array<{
      mode: 'INVITE_BY_EMAIL' | 'INVITE_BY_LINK'
      sourceName: string
      destLedgerParticipantId: string
      email?: string
    }> = []

    const existingLpIds = input.targetGroupId
      ? new Set(
          (
            await tx.ledgerParticipant.findMany({
              where: { ledgerId },
              select: { id: true },
            })
          ).map((p) => p.id),
        )
      : null

    for (const mapping of input.participants) {
      const destId = mapping.destLedgerParticipantId
      if (mapping.mode === 'UNLINKED_PARTICIPANT') {
        await tx.ledgerParticipant.create({
          data: {
            id: destId,
            ledgerId,
            kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
            displayName: mapping.sourceName,
          },
        })
        destIdByClientKey.set(destId, destId)
        continue
      }
      if (
        mapping.mode === 'INVITE_BY_EMAIL' ||
        mapping.mode === 'INVITE_BY_LINK' ||
        mapping.mode === 'INVITE_CONTACT'
      ) {
        await tx.ledgerParticipant.create({
          data: {
            id: destId,
            ledgerId,
            kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
            displayName: mapping.sourceName,
          },
        })
        destIdByClientKey.set(destId, destId)
        inviteMappings.push({
          mode:
            mapping.mode === 'INVITE_CONTACT'
              ? 'INVITE_BY_EMAIL'
              : mapping.mode,
          sourceName: mapping.sourceName,
          destLedgerParticipantId: destId,
          email:
            mapping.mode === 'INVITE_BY_EMAIL' ||
            mapping.mode === 'INVITE_CONTACT'
              ? mapping.email
              : undefined,
        })
        continue
      }
      if (mapping.mode === 'LINK_EXISTING_PARTICIPANT') {
        if (!existingLpIds) {
          throw new Error(
            `Cannot map to an existing participant when creating a new group: ${mapping.sourceName}.`,
          )
        }
        if (!existingLpIds.has(destId)) {
          throw new Error(
            `Destination LedgerParticipant "${destId}" not found in target group for source participant "${mapping.sourceName}.`,
          )
        }
        destIdByClientKey.set(destId, destId)
        continue
      }

      const account = await tx.account.findUnique({
        where: { id: mapping.linkedAccountId },
        select: { id: true },
      })
      if (!account) {
        throw new Error(`Linked account not found: ${mapping.linkedAccountId}`)
      }
      const existingMember = await tx.groupMember.findUnique({
        where: {
          groupId_accountId: {
            groupId,
            accountId: mapping.linkedAccountId,
          },
        },
        include: { ledgerParticipant: true },
      })
      let memberId: string
      if (existingMember) {
        memberId = existingMember.id
      } else {
        const created = await tx.groupMember.create({
          data: {
            id: randomId(),
            groupId,
            accountId: mapping.linkedAccountId,
            role: GroupRole.MEMBER,
            status: GroupMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
        })
        memberId = created.id
      }
      if (existingMember?.ledgerParticipant) {
        destIdByClientKey.set(destId, existingMember.ledgerParticipant.id)
        continue
      }
      await tx.ledgerParticipant.create({
        data: {
          id: destId,
          ledgerId,
          groupMemberId: memberId,
        },
      })
      destIdByClientKey.set(destId, destId)
    }

    const ledgerCurrency = (
      await tx.ledger.findUnique({
        where: { id: ledgerId },
        select: { currencyCode: true },
      })
    )?.currencyCode
    // Union of LedgerParticipant IDs touched by any imported expense
    // (paidBy ∪ paidFor). The post-commit notification dispatcher
    // filters this down to active group members with a real email so
    // one summary email fans out to everyone affected.
    const affectedParticipantIds = new Set<string>()
    let totalAmount = 0
    // Resolve per expense by index — titles are not unique in imports.
    const resolvedConversions: Awaited<ReturnType<typeof resolveConversion>>[] =
      []
    for (const expense of input.expenses) {
      resolvedConversions.push(
        await resolveConversion(expense, {
          ledgerCurrency: ledgerCurrency ?? null,
          expenseDate: expense.expenseDate,
        }),
      )
    }

    const seriesIdByKey = new Map(
      recurringPlan.series.map((plan) => [plan.seriesKey, randomId()] as const),
    )
    const membershipByExpenseIndex = new Map(
      recurringPlan.membership.map((row) => [row.expenseIndex, row] as const),
    )

    const resolvePaidParticipants = (expense: Expense) => {
      const resolvedPaidByList = expense.paidByList
        .map((paidBy) => {
          const resolved = destIdByClientKey.get(paidBy.participant)
          if (!resolved) return null
          return {
            ledgerParticipantId: resolved,
            shares: paidBy.shares,
          }
        })
        .filter(
          (row): row is { ledgerParticipantId: string; shares: number } =>
            row !== null,
        )
      if (resolvedPaidByList.length === 0) {
        throw new Error(
          `Expense "${expense.title}" has no remaining paidBy participants after import resolution`,
        )
      }
      const seenPaidByIds = new Set<string>()
      for (const row of resolvedPaidByList) {
        if (seenPaidByIds.has(row.ledgerParticipantId)) {
          throw new Error(
            `Expense "${expense.title}" has two paidBy entries for the same LedgerParticipant (${row.ledgerParticipantId}). Each source participant must map to a unique destination.`,
          )
        }
        seenPaidByIds.add(row.ledgerParticipantId)
      }
      const resolvedPaidFor: Array<{
        ledgerParticipantId: string
        shares: number
      }> = []
      const seenPaidForIds = new Set<string>()
      for (const paidFor of expense.paidFor) {
        const resolved = destIdByClientKey.get(paidFor.participant)
        if (!resolved) continue
        if (seenPaidForIds.has(resolved)) {
          throw new Error(
            `Expense "${expense.title}" has two paidFor entries for the same LedgerParticipant (${resolved}). Each source participant must map to a unique destination.`,
          )
        }
        seenPaidForIds.add(resolved)
        resolvedPaidFor.push({
          ledgerParticipantId: resolved,
          shares: paidFor.shares,
        })
      }
      if (resolvedPaidFor.length === 0) {
        throw new Error(
          `Expense "${expense.title}" has no remaining paidFor participants after import resolution`,
        )
      }
      return { resolvedPaidByList, resolvedPaidFor }
    }

    for (const plan of recurringPlan.series) {
      const seriesId = seriesIdByKey.get(plan.seriesKey)
      if (!seriesId) continue
      const anchorExpense = input.expenses[plan.anchorIndex]!
      const conversion = resolvedConversions[plan.anchorIndex]!
      const { resolvedPaidByList, resolvedPaidFor } =
        resolvePaidParticipants(anchorExpense)
      for (const row of resolvedPaidByList) {
        affectedParticipantIds.add(row.ledgerParticipantId)
      }
      for (const row of resolvedPaidFor) {
        affectedParticipantIds.add(row.ledgerParticipantId)
      }
      const template = buildRecurringTemplate({
        expense: {
          ...anchorExpense,
          paidByList: resolvedPaidByList.map((row) => ({
            participant: row.ledgerParticipantId,
            shares: row.shares,
          })),
          paidFor: resolvedPaidFor.map((row) => ({
            participant: row.ledgerParticipantId,
            shares: row.shares,
          })),
          items: (anchorExpense.items ?? []).map((item) => ({
            ...item,
            paidFor: item.paidFor
              .map((row) => {
                const resolved = destIdByClientKey.get(row.participant)
                return resolved
                  ? { participant: resolved, shares: row.shares }
                  : null
              })
              .filter(
                (row): row is { participant: string; shares: number } =>
                  row !== null,
              ),
          })),
          itemizedRemainder: anchorExpense.itemizedRemainder
            ? {
                ...anchorExpense.itemizedRemainder,
                paidFor: anchorExpense.itemizedRemainder.paidFor
                  .map((row) => {
                    const resolved = destIdByClientKey.get(row.participant)
                    return resolved
                      ? { participant: resolved, shares: row.shares }
                      : null
                  })
                  .filter(
                    (row): row is { participant: string; shares: number } =>
                      row !== null,
                  ),
              }
            : undefined,
        },
        conversion,
      })
      await createSeriesForExpense({
        tx,
        seriesId,
        ledgerId,
        creatorAccountId: actor.accountId,
        anchorDate: anchorExpense.expenseDate,
        config: plan.config,
        template,
        boss: queueBoss,
        occurrencesCreated: plan.occurrenceCount,
        nextOccurrenceDate: plan.nextOccurrenceDate,
        nextOccurrenceOrdinal: 2,
      })
    }

    for (
      let expenseIndex = 0;
      expenseIndex < input.expenses.length;
      expenseIndex++
    ) {
      const expense = input.expenses[expenseIndex]!
      const expenseId = randomId()
      const conversion = resolvedConversions[expenseIndex]!
      const ledgerAmount = conversion.ledgerAmountMinor
      const dateStr = expense.expenseDate.toISOString().slice(0, 10)
      await logActivity(
        groupId,
        {
          type: 'EXPENSE_CREATED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'EXPENSE', id: expenseId },
          data: buildExpenseActivityData({
            summary: expense.title,
            title: expense.title,
            amount: ledgerAmount,
            // Expense currency when converted; ledger currency for same-currency
            // (originalCurrency is null and amount is already ledger minor units).
            currencyCode: conversion.originalCurrency ?? ledgerCurrency ?? null,
            date: dateStr,
            originalAmount: conversion.originalAmount ?? undefined,
            conversionRate: conversion.conversionRate ?? undefined,
            conversionSource: conversion.conversionSource,
            ledgerCurrencyCode: ledgerCurrency ?? null,
          }),
        },
        tx,
      )
      if (!expense.isReimbursement) {
        totalAmount += ledgerAmount
      }
      const { resolvedPaidByList, resolvedPaidFor } =
        resolvePaidParticipants(expense)
      for (const row of resolvedPaidByList) {
        affectedParticipantIds.add(row.ledgerParticipantId)
      }
      for (const row of resolvedPaidFor) {
        affectedParticipantIds.add(row.ledgerParticipantId)
      }
      const membership = membershipByExpenseIndex.get(expenseIndex)
      const destinationSeriesId = membership
        ? seriesIdByKey.get(membership.seriesKey)
        : undefined
      await tx.expense.create({
        data: {
          id: expenseId,
          ledgerId,
          expenseDate: expense.expenseDate,
          title: expense.title,
          categoryId: expense.category,
          amount: ledgerAmount,
          originalAmount: conversion.originalAmount,
          originalCurrency: conversion.originalCurrency,
          conversionRate: conversion.conversionRate,
          conversionSource: conversion.conversionSource,
          paidBySplitMode: expense.paidBySplitMode,
          paidByList: {
            createMany: {
              data: resolvedPaidByList,
            },
          },
          splitMode: expense.splitMode,
          ...(destinationSeriesId && membership
            ? {
                recurringSeriesId: destinationSeriesId,
                recurrenceSequence: membership.sequence,
              }
            : {}),
          isReimbursement: expense.isReimbursement,
          notes: expense.notes,
          paidFor: {
            createMany: {
              data: resolvedPaidFor,
            },
          },
          documents: {
            createMany: {
              data: expense.documents.map((doc) => ({
                id: randomId(),
                url: doc.url,
                width: doc.width,
                height: doc.height,
                ledgerId,
              })),
            },
          },
        },
      })
    }

    // Single summary activity for the whole import so the feed shows
    // "Alice imported N expenses from <provider>" once. Per-expense
    // EXPENSE_CREATED rows above keep the detailed audit trail.
    const summaryActivity = await logActivity(
      groupId,
      {
        type: 'EXPENSES_IMPORTED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildImportSummaryActivityData({
          summary: input.sourceMeta
            ? `Imported from ${input.sourceMeta.provider}`
            : 'Imported expenses',
          count: input.expenses.length,
          totalAmount,
          currencyCode: ledgerCurrency ?? null,
          sourceProvider: input.sourceMeta?.provider,
          affectedParticipants: [...affectedParticipantIds],
        }),
      },
      tx,
    )

    return {
      groupId,
      ledgerId,
      importedExpenses: input.expenses.length,
      sourceGroupId: input.sourceMeta?.sourceGroupId ?? null,
      inviteMappings,
      summaryActivity: {
        activityId: summaryActivity.id,
        actorAccountId: actor.accountId,
        time: summaryActivity.time,
        count: input.expenses.length,
        totalAmount,
        currencyCode: ledgerCurrency ?? null,
        sourceProvider: input.sourceMeta?.provider,
        affectedParticipants: [...affectedParticipantIds],
      },
    }
  })

  if (baseResult.summaryActivity.affectedParticipants.length > 0) {
    scheduleDefaultNotificationDispatch({
      activityId: baseResult.summaryActivity.activityId,
      type: 'EXPENSES_IMPORTED',
      groupId: baseResult.groupId,
      actor: {
        type: 'ACCOUNT',
        id: baseResult.summaryActivity.actorAccountId,
      },
      subject: { type: 'GROUP', id: baseResult.groupId },
      data: buildImportSummaryActivityData({
        summary: baseResult.summaryActivity.sourceProvider
          ? `Imported from ${baseResult.summaryActivity.sourceProvider}`
          : 'Imported expenses',
        count: baseResult.summaryActivity.count,
        totalAmount: baseResult.summaryActivity.totalAmount,
        currencyCode: baseResult.summaryActivity.currencyCode,
        sourceProvider: baseResult.summaryActivity.sourceProvider,
        affectedParticipants: baseResult.summaryActivity.affectedParticipants,
      }),
      occurredAt: baseResult.summaryActivity.time,
    })
  }

  const { createEmailInvitation, createLinkInvitation, sendInvitationEmail } =
    await import('../invitations')
  const group = await prisma.group.findUnique({
    where: { id: baseResult.groupId },
    select: { name: true },
  })
  if (!group) {
    throw new Error('Group not found after import commit')
  }
  const inviter = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { name: true, email: true },
  })
  const inviterDisplayName = inviter?.name || inviter?.email || 'Someone'

  const inviteResults: ImportInviteResult[] = []
  for (const invite of baseResult.inviteMappings) {
    if (invite.mode === 'INVITE_BY_EMAIL') {
      const email = invite.email!
      const invitation = await createEmailInvitation({
        groupId: baseResult.groupId,
        email,
        role: GroupRole.MEMBER,
        inviterAccountId: actor.accountId,
        temporaryName: invite.sourceName,
        ledgerParticipantId: invite.destLedgerParticipantId,
      })
      const existingAccount = await prisma.account.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
        select: { id: true },
      })
      if (!existingAccount) {
        await sendInvitationEmail({
          invitationId: invitation.id,
          groupId: baseResult.groupId,
          groupName: group.name,
          inviterDisplayName,
          inviterRole: GroupRole.ADMIN,
          recipientEmail: invitation.email,
          recipientIsExistingUser: false,
          temporaryName: invite.sourceName,
          sourceProvider: input.sourceMeta?.provider,
          expenseCount: input.expenses.length,
          totalAmount: baseResult.summaryActivity.totalAmount,
          currencyCode: baseResult.summaryActivity.currencyCode,
        })
      }
      inviteResults.push({
        sourceName: invite.sourceName,
        kind: 'EMAIL',
        invitationId: invitation.id,
        email,
      })
    } else {
      const link = await createLinkInvitation({
        groupId: baseResult.groupId,
        role: GroupRole.MEMBER,
        inviterAccountId: actor.accountId,
        temporaryName: invite.sourceName,
        ledgerParticipantId: invite.destLedgerParticipantId,
      })
      inviteResults.push({
        sourceName: invite.sourceName,
        kind: 'LINK',
        invitationId: link.invitation.id,
        inviteUrl: link.inviteUrl,
      })
    }
  }

  return {
    groupId: baseResult.groupId,
    ledgerId: baseResult.ledgerId,
    importedExpenses: baseResult.importedExpenses,
    sourceGroupId: baseResult.sourceGroupId,
    invites: inviteResults,
  }
}

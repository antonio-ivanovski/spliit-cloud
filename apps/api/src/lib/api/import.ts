import {
  GroupMemberStatus,
  GroupRole,
  LedgerParticipantKind,
  prisma,
} from '@spliit/db'
import type { Expense, GroupFormValues } from '@spliit/domain'
import {
  buildExpenseActivityData,
  buildGroupActivityData,
  logActivity,
} from './activities'
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
  const baseResult = await prisma.$transaction(async (tx) => {
    let groupId: string
    let ledgerId: string

    if (input.targetGroupId) {
      const existing = await tx.group.findUnique({
        where: { id: input.targetGroupId },
        select: { id: true, ledgerId: true, archived: true },
      })
      if (!existing) {
        throw new Error('Target group not found')
      }
      if (existing.archived) {
        throw new Error('Cannot import into an archived group')
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
        mapping.mode === 'INVITE_BY_LINK'
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
          mode: mapping.mode,
          sourceName: mapping.sourceName,
          destLedgerParticipantId: destId,
          email: mapping.mode === 'INVITE_BY_EMAIL' ? mapping.email : undefined,
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

    for (const expense of input.expenses) {
      const expenseId = randomId()
      await logActivity(
        groupId,
        {
          type: 'EXPENSE_CREATED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'EXPENSE', id: expenseId },
          data: buildExpenseActivityData({
            summary: expense.title,
            title: expense.title,
            amount: expense.amount,
          }),
        },
        tx,
      )
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
      await tx.expense.create({
        data: {
          id: expenseId,
          ledgerId,
          expenseDate: expense.expenseDate,
          title: expense.title,
          categoryId: expense.category,
          amount: expense.amount,
          originalAmount: expense.originalAmount,
          originalCurrency: expense.originalCurrency,
          conversionRate: expense.conversionRate,
          paidBySplitMode: expense.paidBySplitMode,
          paidByList: {
            createMany: {
              data: resolvedPaidByList,
            },
          },
          splitMode: expense.splitMode,
          recurrenceRule: expense.recurrenceRule,
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
              })),
            },
          },
        },
      })
    }

    if (input.sourceMeta) {
      const data = `Imported from ${input.sourceMeta.provider} group ${input.sourceMeta.sourceGroupId}`
      await logActivity(
        groupId,
        {
          type: 'GROUP_UPDATED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'GROUP', id: groupId },
          data: buildGroupActivityData({ summary: data }),
        },
        tx,
      )
    }

    return {
      groupId,
      ledgerId,
      importedExpenses: input.expenses.length,
      sourceGroupId: input.sourceMeta?.sourceGroupId ?? null,
      inviteMappings,
    }
  })

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
      })
      const existingAccount = await prisma.account.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
        select: { id: true },
      })
      await sendInvitationEmail({
        invitationId: invitation.id,
        groupId: baseResult.groupId,
        groupName: group.name,
        inviterDisplayName,
        inviterRole: GroupRole.ADMIN,
        recipientEmail: invitation.email,
        recipientIsExistingUser: !!existingAccount,
      })
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

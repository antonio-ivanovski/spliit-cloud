import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'
import { type GroupFormValues } from '@spliit/domain'

import { resolveParticipantDisplayName } from '../invitations/display'
import {
  buildGroupActivityData,
  logActivity,
  planNotificationForActivity,
} from './activities'
import { getApiBoss } from './boss'
import type { DiffableGroup } from './group-activity-diff'
import { getGroupChangeSummary } from './group-activity-diff'
import { accountSummarySelect } from './selects/account-summary'
import { loadGroupWithLedger, randomId } from './shared'

/**
 * Create a cloud group with its accounting Ledger. The current account is added
 * as an ADMIN/ACTIVE member and a matching LedgerParticipant is created so
 * expenses can be recorded against them.
 */
export async function createGroup(
  groupFormValues: GroupFormValues,
  options: { adminAccountId: string },
) {
  return prisma.$transaction(async (tx) => {
    const ledger = await tx.ledger.create({
      data: {
        id: randomId(),
        currency: groupFormValues.currency,
        currencyCode: groupFormValues.currencyCode || null,
      },
    })

    const group = await tx.group.create({
      data: {
        id: randomId(),
        name: groupFormValues.name,
        information: groupFormValues.information,
        ledgerId: ledger.id,
      },
    })

    const adminMember = await tx.groupMember.create({
      data: {
        id: randomId(),
        groupId: group.id,
        accountId: options.adminAccountId,
        role: GroupRole.ADMIN,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await tx.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
        groupMemberId: adminMember.id,
      },
    })

    return { group, ledger, adminMember }
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  actor: { accountId: string },
) {
  const existingGroup = await loadGroupWithLedger(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')
  if (!existingGroup.ledgerId) throw new Error('Group has no ledger')
  if (existingGroup.archived) {
    throw new Error('Cannot modify settings of an archived group')
  }

  const oldGroup: DiffableGroup = {
    name: existingGroup.name,
    information: existingGroup.information,
    currency: existingGroup.ledger.currency,
    currencyCode: existingGroup.ledger.currencyCode,
  }
  const newGroup: DiffableGroup = {
    name: groupFormValues.name,
    information: groupFormValues.information ?? null,
    currency: groupFormValues.currency,
    currencyCode: groupFormValues.currencyCode || null,
  }

  const currencyChanged =
    oldGroup.currency !== newGroup.currency ||
    (oldGroup.currencyCode ?? null) !== (newGroup.currencyCode ?? null)

  if (currencyChanged) {
    const expenseCount = await prisma.expense.count({
      where: { ledgerId: existingGroup.ledgerId },
    })
    if (expenseCount > 0) {
      throw new Error(
        'Cannot change the group currency after expenses exist. Ledger amounts would no longer match.',
      )
    }
  }

  const summary = getGroupChangeSummary(oldGroup, newGroup, {})

  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.group.update({
      where: { id: groupId },
      data: {
        name: groupFormValues.name,
        information: groupFormValues.information,
      },
    })
    await tx.ledger.update({
      where: { id: existingGroup.ledgerId },
      data: {
        currency: groupFormValues.currency,
        currencyCode: groupFormValues.currencyCode || null,
      },
    })
    const activity = await logActivity(
      groupId,
      {
        type: 'GROUP_UPDATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({
          summary: groupFormValues.name,
          ...(summary
            ? {
                changedFields: summary.changedFields,
                changes: summary.changes,
              }
            : {}),
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    return { group, activity }
  })
  return result.group
}

export async function getGroup(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: true,
      members: {
        where: { status: GroupMemberStatus.ACTIVE },
        include: {
          account: { select: accountSummarySelect },
          ledgerParticipant: true,
        },
      },
      invitations: {
        where: { status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }],
      },
    },
  })
  if (!group) return null

  const invitationsWithParticipants =
    group.invitations.length > 0
      ? await prisma.groupInvitation.findMany({
          where: { groupId, status: 'PENDING' },
          include: { ledgerParticipant: true },
          orderBy: [{ createdAt: 'asc' }],
        })
      : []

  const allUnlinkedParticipants = group.ledgerId
    ? await prisma.ledgerParticipant.findMany({
        where: {
          ledgerId: group.ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          removedAt: null,
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: { id: true, displayName: true },
      })
    : []
  const linkedViaInvitation = new Set<string>()
  for (const inv of invitationsWithParticipants) {
    if (inv.ledgerParticipant) linkedViaInvitation.add(inv.ledgerParticipant.id)
  }
  const unlinkedParticipants = allUnlinkedParticipants.filter(
    (p) => !linkedViaInvitation.has(p.id),
  )

  return {
    ...group,
    currency: group.ledger?.currency ?? '$',
    currencyCode: group.ledger?.currencyCode ?? null,
    participants: [
      ...group.members.flatMap((m) =>
        m.ledgerParticipant
          ? [
              {
                id: m.ledgerParticipant.id,
                name: m.account?.name ?? '',
                account: m.account
                  ? {
                      id: m.account.id,
                      name: m.account.name,
                      image: m.account.image ?? null,
                    }
                  : null,
                pending: false,
                unlinked: false,
              },
            ]
          : [],
      ),
      ...invitationsWithParticipants.flatMap((inv) =>
        inv.ledgerParticipant
          ? [
              {
                id: inv.ledgerParticipant.id,
                name: resolveParticipantDisplayName({
                  groupMember: null,
                  invitations: [
                    {
                      email: inv.email,
                      temporaryName: inv.temporaryName,
                    },
                  ],
                }),
                account: null,
                pending: true,
                unlinked: false,
              },
            ]
          : [],
      ),
      ...unlinkedParticipants.map((p) => ({
        id: p.id,
        name: p.displayName ?? '',
        account: null,
        pending: false,
        unlinked: true,
      })),
    ],
  }
}

export async function getGroups(groupIds: string[]) {
  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    include: {
      ledger: { select: { currency: true, currencyCode: true } },
      _count: { select: { members: true } },
    },
  })
  // Prisma's relation-count key is `_count`; expose a plain public field.
  return groups.map(({ _count, ...group }) => ({
    ...group,
    memberCount: _count.members,
  }))
}

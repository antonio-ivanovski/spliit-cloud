import {
  GroupMemberStatus,
  GroupRole,
  GroupType,
  prisma,
  type Prisma,
} from '@spliit/db'
import {
  type GroupFormValues,
  type GroupUpdateFormValues,
} from '@spliit/domain'

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
import { randomId } from './shared'

/**
 * Create a cloud group with its accounting Ledger. The current account is added
 * as an ADMIN/ACTIVE member and a matching LedgerParticipant is created so
 * expenses can be recorded against them.
 */
export async function createGroup(
  groupFormValues: GroupFormValues,
  options: {
    adminAccountId: string
    tx?: Prisma.TransactionClient
  },
) {
  const run = async (tx: Prisma.TransactionClient) => {
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
        // Stored verbatim: title-emoji extraction is a client concern (the
        // group form moves it live); the API never rewrites the name.
        name: groupFormValues.name,
        emoji: groupFormValues.emoji ?? null,
        color: groupFormValues.color ?? null,
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
  }
  return options.tx ? run(options.tx) : prisma.$transaction(run)
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupUpdateFormValues,
  actor: { accountId: string },
) {
  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`
    const existingGroup = await tx.group.findUnique({
      where: { id: groupId },
      include: { ledger: true },
    })
    if (!existingGroup) throw new Error('Invalid group ID')
    if (!existingGroup.ledgerId || !existingGroup.ledger)
      throw new Error('Group has no ledger')
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
      const expenseCount = await tx.expense.count({
        where: { ledgerId: existingGroup.ledgerId },
      })
      if (expenseCount > 0) {
        throw new Error(
          'Cannot change the group currency after expenses exist. Ledger amounts would no longer match.',
        )
      }
    }
    const summary = getGroupChangeSummary(oldGroup, newGroup, {})

    // Appearance changes: `undefined` leaves the stored value untouched
    // (partial API callers must not accidentally dismiss the intro); `''` is
    // the explicit "none picked" sentinel. Friend ledgers keep the peer
    // avatar as their identity and never carry an emoji/color.
    const appearance =
      existingGroup.groupType === GroupType.FRIEND
        ? {}
        : {
            ...(groupFormValues.emoji === undefined
              ? {}
              : { emoji: groupFormValues.emoji }),
            ...(groupFormValues.color === undefined
              ? {}
              : { color: groupFormValues.color }),
          }

    const group = await tx.group.update({
      where: { id: groupId },
      data: {
        name: groupFormValues.name,
        information: groupFormValues.information,
        ...appearance,
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

/**
 * Record that the group's admins declined the "groups can have an emoji" intro.
 * Writes the `''` declined sentinel only while the emoji is still undecided, so
 * a concurrent emoji pick is never clobbered. The decision is group-wide: the
 * first admin to dismiss ends the prompt for everyone, but the settings picker
 * can still set an emoji later.
 */
export async function dismissGroupEmojiIntro(groupId: string) {
  await prisma.group.updateMany({
    where: { id: groupId, emoji: null },
    data: { emoji: '' },
  })
}

export async function getGroup(
  groupId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const group = await client.group.findUnique({
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
      ? await client.groupInvitation.findMany({
          where: { groupId, status: 'PENDING' },
          include: { ledgerParticipant: true },
          orderBy: [{ createdAt: 'asc' }],
        })
      : []

  const allUnlinkedParticipants = group.ledgerId
    ? await client.ledgerParticipant.findMany({
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

export async function getGroups(
  groupIds: string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const groups = await client.group.findMany({
    where: { id: { in: groupIds } },
    include: {
      ledger: {
        select: { currency: true, currencyCode: true },
      },
      _count: { select: { members: true } },
    },
  })
  // Prisma's relation-count key is `_count`; expose a plain public field.
  return groups.map(({ _count, ...group }) => ({
    ...group,
    memberCount: _count.members,
  }))
}

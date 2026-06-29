import { ActivityType, GroupMemberStatus, GroupRole, prisma } from '@spliit/db'
import { type GroupFormValues } from '@spliit/domain'
import { resolveParticipantDisplayName } from '../invitations'
import { logActivity } from './activities'
import {
  getMemberLedgerParticipantId,
  loadGroupWithLedger,
  randomId,
} from './shared'

/**
 * Create a cloud group with its accounting Ledger. The current account is
 * added as an ADMIN/ACTIVE member and a matching LedgerParticipant is created
 * so expenses can be recorded against them.
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

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  await logActivity(groupId, ActivityType.UPDATE_GROUP, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
  })

  return prisma.$transaction(async (tx) => {
    const group = await tx.group.update({
      where: { id: groupId },
      data: {
        name: groupFormValues.name,
        information: groupFormValues.information,
      },
    })

    if (existingGroup.ledgerId) {
      await tx.ledger.update({
        where: { id: existingGroup.ledgerId },
        data: {
          currency: groupFormValues.currency,
          currencyCode: groupFormValues.currencyCode || null,
        },
      })
    }

    return group
  })
}

export async function getGroup(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: true,
      members: {
        where: { status: GroupMemberStatus.ACTIVE },
        include: { account: true, ledgerParticipant: true },
      },
      invitations: {
        where: { status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }],
      },
    },
  })
  if (!group) return null

  // Materialize a virtual LedgerParticipant for each pending invitation that
  // does not yet have one.
  if (group.ledgerId && group.invitations.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const invitation of group.invitations) {
        if (invitation.ledgerParticipantId) continue

        const existing = await tx.ledgerParticipant.findFirst({
          where: {
            ledgerId: group.ledgerId!,
            groupMemberId: null,
            invitations: {
              some: { email: invitation.email, status: 'PENDING' },
            },
          },
          select: { id: true },
        })

        const participantId = existing?.id ?? randomId()
        if (!existing) {
          await tx.ledgerParticipant.create({
            data: {
              id: participantId,
              ledgerId: group.ledgerId!,
            },
          })
        }
        await tx.groupInvitation.update({
          where: { id: invitation.id },
          data: { ledgerParticipantId: participantId },
        })
      }
    })
  }

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
        where: { ledgerId: group.ledgerId, kind: 'UNLINKED_PARTICIPANT' },
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
                pending: true,
                unlinked: false,
              },
            ]
          : [],
      ),
      ...unlinkedParticipants.map((p) => ({
        id: p.id,
        name: p.displayName ?? '',
        pending: false,
        unlinked: true,
      })),
    ],
  }
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: {
        ledger: { select: { currency: true, currencyCode: true } },
        _count: { select: { members: true } },
      },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
  }))
}

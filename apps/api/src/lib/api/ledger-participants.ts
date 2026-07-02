import {
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupRole,
  LedgerParticipantKind,
  prisma,
  type Prisma,
} from '@spliit/db'
import { buildGroupActivityData, logActivity } from './activities'
import { randomId } from './shared'

/**
 * One-way admin migration of an unlinked `LedgerParticipant` to an
 * account.
 */
export async function linkUnlinkedParticipantToAccount(opts: {
  groupId: string
  ledgerParticipantId: string
  accountId: string
  actor: { accountId: string }
}): Promise<{ groupMemberId: string; ledgerParticipantId: string }> {
  const { groupId, ledgerParticipantId, accountId, actor } = opts

  return prisma.$transaction(async (tx) => {
    const participant = await tx.ledgerParticipant.findUnique({
      where: { id: ledgerParticipantId },
      include: {
        ledger: { select: { id: true, group: { select: { id: true } } } },
      },
    })
    if (!participant) {
      throw new Error('Ledger participant not found')
    }
    if (participant.ledger.group?.id !== groupId) {
      throw new Error('Ledger participant does not belong to this group')
    }
    if (participant.kind !== LedgerParticipantKind.UNLINKED_PARTICIPANT) {
      throw new Error('Ledger participant is not unlinked')
    }
    if (participant.groupMemberId) {
      throw new Error('Ledger participant is already linked to a member')
    }

    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    })
    if (!account) {
      throw new Error('Account not found')
    }

    const existingMember = await tx.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId } },
    })

    let groupMemberId: string
    if (existingMember) {
      const reactivated = await tx.groupMember.update({
        where: { id: existingMember.id },
        data: {
          status: GroupMemberStatus.ACTIVE,
          joinedAt: existingMember.joinedAt ?? new Date(),
          leftAt: null,
        },
      })
      groupMemberId = reactivated.id
    } else {
      const created = await tx.groupMember.create({
        data: {
          id: randomId(),
          groupId,
          accountId,
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      groupMemberId = created.id
    }

    const existingLp = await tx.ledgerParticipant.findUnique({
      where: { groupMemberId },
    })
    if (existingLp && existingLp.id !== participant.id) {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: participant.id,
        targetId: existingLp.id,
      })
      await tx.ledgerParticipant.delete({ where: { id: participant.id } })

      await logActivity(
        groupId,
        {
          type: 'GROUP_UPDATED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'GROUP', id: groupId },
          data: buildGroupActivityData({
            summary: `ledger-participant:merged:${participant.id}:${existingLp.id}`,
          }),
        },
        tx,
      )

      return {
        groupMemberId,
        ledgerParticipantId: existingLp.id,
      }
    }

    await tx.ledgerParticipant.update({
      where: { id: participant.id },
      data: {
        groupMemberId,
        kind: LedgerParticipantKind.ACCOUNT_MEMBER,
        displayName: null,
      },
    })

    await logActivity(
      groupId,
      {
        type: 'GROUP_UPDATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({
          summary: `ledger-participant:linked:${participant.id}`,
        }),
      },
      tx,
    )

    return {
      groupMemberId,
      ledgerParticipantId: participant.id,
    }
  })
}

/**
 * Rewrite all expense references from one `LedgerParticipant` id to another.
 */
export async function mergeLedgerParticipantReferences(
  tx: Prisma.TransactionClient,
  opts: { sourceId: string; targetId: string },
): Promise<void> {
  const { sourceId, targetId } = opts

  await coalesceExpenseReferences(tx.expensePaidBy, sourceId, targetId)
  await coalesceExpenseReferences(tx.expensePaidFor, sourceId, targetId)

  await tx.expensePaidBy.updateMany({
    where: { ledgerParticipantId: sourceId },
    data: { ledgerParticipantId: targetId },
  })
  await tx.expensePaidFor.updateMany({
    where: { ledgerParticipantId: sourceId },
    data: { ledgerParticipantId: targetId },
  })
}

async function coalesceExpenseReferences<
  T extends {
    findMany: (args: {
      where: { ledgerParticipantId: string }
    }) => Promise<Array<{ expenseId: string; shares: number }>>
    findUnique: (args: {
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: string
          ledgerParticipantId: string
        }
      }
    }) => Promise<{ expenseId: string; shares: number } | null>
    update: (args: {
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: string
          ledgerParticipantId: string
        }
      }
      data: { shares: number }
    }) => Promise<unknown>
    delete: (args: {
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: string
          ledgerParticipantId: string
        }
      }
    }) => Promise<unknown>
  },
>(table: T, sourceId: string, targetId: string): Promise<void> {
  const sourceRows = await table.findMany({
    where: { ledgerParticipantId: sourceId },
  })
  for (const row of sourceRows) {
    const target = await table.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: row.expenseId,
          ledgerParticipantId: targetId,
        },
      },
    })
    if (!target) continue
    await table.update({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: target.expenseId,
          ledgerParticipantId: targetId,
        },
      },
      data: { shares: target.shares + row.shares },
    })
    await table.delete({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId: row.expenseId,
          ledgerParticipantId: sourceId,
        },
      },
    })
  }
}

/**
 * One-way admin migration of an unlinked `LedgerParticipant` onto the
 * materialized `LedgerParticipant` of a pending invitation.
 */
export async function linkUnlinkedParticipantToPendingInvite(opts: {
  groupId: string
  ledgerParticipantId: string
  pendingInvitationId: string
  actor: { accountId: string }
}): Promise<{ groupMemberId: null; ledgerParticipantId: string }> {
  const { groupId, ledgerParticipantId, pendingInvitationId, actor } = opts

  return prisma.$transaction(async (tx) => {
    const participant = await tx.ledgerParticipant.findUnique({
      where: { id: ledgerParticipantId },
      include: {
        ledger: { select: { id: true, group: { select: { id: true } } } },
      },
    })
    if (!participant) {
      throw new Error('Ledger participant not found')
    }
    if (participant.ledger.group?.id !== groupId) {
      throw new Error('Ledger participant does not belong to this group')
    }
    if (participant.kind !== LedgerParticipantKind.UNLINKED_PARTICIPANT) {
      throw new Error('Ledger participant is not unlinked')
    }
    if (participant.groupMemberId) {
      throw new Error('Ledger participant is already linked to a member')
    }

    const invitation = await tx.groupInvitation.findUnique({
      where: { id: pendingInvitationId },
      include: {
        ledgerParticipant: {
          select: { id: true, ledgerId: true, groupMemberId: true },
        },
      },
    })
    if (!invitation) {
      throw new Error('Invitation not found')
    }
    if (invitation.groupId !== groupId) {
      throw new Error('Invitation does not belong to this group')
    }
    if (invitation.status !== GroupInvitationStatus.PENDING) {
      throw new Error('Invitation is not pending')
    }
    const targetLp = invitation.ledgerParticipant
    if (!targetLp) {
      throw new Error('Invitation has no materialized ledger participant')
    }
    if (targetLp.ledgerId !== participant.ledger.id) {
      throw new Error('Invitation ledger participant is in a different ledger')
    }
    if (targetLp.id === participant.id) {
      throw new Error('Cannot merge a participant into itself')
    }

    await mergeLedgerParticipantReferences(tx, {
      sourceId: participant.id,
      targetId: targetLp.id,
    })
    await tx.ledgerParticipant.delete({ where: { id: participant.id } })

    await logActivity(
      groupId,
      {
        type: 'GROUP_UPDATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({
          summary: `ledger-participant:merged-into-invitation:${participant.id}:${targetLp.id}`,
        }),
      },
      tx,
    )

    return { groupMemberId: null, ledgerParticipantId: targetLp.id }
  })
}

/**
 * List the unlinked `LedgerParticipant` rows in a group.
 */
export async function listUnlinkedParticipants(groupId: string): Promise<
  Array<{
    id: string
    displayName: string | null
  }>
> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []
  return prisma.ledgerParticipant.findMany({
    where: { ledgerId: group.ledgerId, kind: 'UNLINKED_PARTICIPANT' },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    select: { id: true, displayName: true },
  })
}

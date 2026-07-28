import {
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupRole,
  GroupType,
  LedgerParticipantKind,
  prisma,
} from '@spliit/db'
import {
  RevokeInvitationPreconditionError,
  revokeInvitation,
} from '../invitations'
import { resolveParticipantDisplayName } from '../invitations/display'
import {
  buildGroupActivityData,
  logActivity,
  planNotificationForActivity,
} from './activities'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
  getSettlementLegsForParticipant,
} from './balances'
import { getApiBoss } from './boss'
import { RemoveMemberPreconditionError, removeMember } from './members'

export type SoftRemoveParticipantKind = 'member' | 'invitation' | 'unlinked'

export class SoftRemoveParticipantPreconditionError extends Error {
  constructor(
    public readonly code: 'unsettledBalance' | 'alreadyRemoved',
    message: string,
  ) {
    super(message)
    this.name = 'SoftRemoveParticipantPreconditionError'
  }
}

const participantSelect = {
  id: true,
  kind: true,
  displayName: true,
  ledgerId: true,
  removedAt: true,
  groupMemberId: true,
  groupMember: {
    select: {
      id: true,
      role: true,
      status: true,
      account: { select: { name: true } },
    },
  },
  invitations: {
    select: { id: true, email: true, temporaryName: true },
    where: { status: GroupInvitationStatus.PENDING },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const

export async function loadSoftRemoveParticipant(
  ledgerId: string,
  participantId: string,
) {
  const participant = await prisma.ledgerParticipant.findFirst({
    where: { id: participantId, ledgerId },
    select: participantSelect,
  })
  if (!participant) {
    throw new Error('Participant not found')
  }
  return participant
}

export function getSoftRemoveParticipantKind(
  participant: Awaited<ReturnType<typeof loadSoftRemoveParticipant>>,
): SoftRemoveParticipantKind {
  if (
    participant.groupMemberId &&
    participant.groupMember?.status === GroupMemberStatus.ACTIVE
  ) {
    return 'member'
  }
  if (participant.invitations[0]) {
    return 'invitation'
  }
  return 'unlinked'
}

export function getSoftRemoveParticipantName(
  participant: Awaited<ReturnType<typeof loadSoftRemoveParticipant>>,
) {
  if (
    participant.kind === LedgerParticipantKind.ACCOUNT_MEMBER &&
    participant.groupMember
  ) {
    return participant.groupMember.account.name
  }
  const invitation = participant.invitations[0]
  return (
    invitation?.temporaryName ??
    invitation?.email ??
    participant.displayName ??
    'Unknown participant'
  )
}

const previewParticipantSelect = {
  id: true,
  displayName: true,
  groupMember: {
    select: { account: { select: { name: true } } },
  },
  invitations: {
    select: { email: true, temporaryName: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const

export async function getSoftRemoveParticipantPreview(opts: {
  groupId: string
  ledgerId: string
  ledgerParticipantId: string
}) {
  const participant = await loadSoftRemoveParticipant(
    opts.ledgerId,
    opts.ledgerParticipantId,
  )
  if (participant.removedAt) {
    throw new SoftRemoveParticipantPreconditionError(
      'alreadyRemoved',
      'Participant has already been removed',
    )
  }

  const [balances, group] = await Promise.all([
    getGroupBalances(opts.groupId),
    prisma.group.findUnique({
      where: { id: opts.groupId },
      select: { ledger: { select: { currencyCode: true } } },
    }),
  ])
  const currentBalance = balances[participant.id]?.total ?? 0
  const settlementLegs = getSettlementLegsForParticipant(
    balances,
    participant.id,
  )
  const participantName = getSoftRemoveParticipantName(participant)

  const counterpartyIds = [
    ...new Set(
      settlementLegs
        .flatMap((leg) => [leg.from, leg.to])
        .filter((id) => id !== participant.id),
    ),
  ]
  const counterparties =
    counterpartyIds.length === 0
      ? []
      : await prisma.ledgerParticipant.findMany({
          where: {
            ledgerId: opts.ledgerId,
            id: { in: counterpartyIds },
          },
          select: previewParticipantSelect,
        })

  const participants = [
    { id: participant.id, name: participantName },
    ...counterparties.map((counterparty) => ({
      id: counterparty.id,
      name:
        resolveParticipantDisplayName(counterparty) || 'Unknown participant',
    })),
  ]

  return {
    participantName,
    participantKind: getSoftRemoveParticipantKind(participant),
    hasUnsettledBalance: currentBalance !== 0,
    currentBalance,
    settlementLegs,
    currencyCode: group?.ledger.currencyCode ?? null,
    participants,
  }
}

export async function softRemoveParticipant(opts: {
  groupId: string
  ledgerId: string
  ledgerParticipantId: string
  settleBalances?: boolean
  actor: { accountId: string }
  groupType: GroupType
}) {
  const { groupId, ledgerId, ledgerParticipantId, settleBalances, actor } = opts

  if (opts.groupType === GroupType.FRIEND) {
    throw new Error('Friend ledger participant management is not allowed')
  }

  const participant = await loadSoftRemoveParticipant(
    ledgerId,
    ledgerParticipantId,
  )
  if (participant.removedAt) {
    throw new SoftRemoveParticipantPreconditionError(
      'alreadyRemoved',
      'Participant has already been removed',
    )
  }

  const kind = getSoftRemoveParticipantKind(participant)
  const invitation = participant.invitations[0]

  if (kind === 'member' && participant.groupMemberId) {
    await removeMember({
      groupId,
      memberId: participant.groupMemberId,
      settleBalances,
      actor,
    })
    // removeMember already sets removedAt on the ledger participant.
    return { ledgerParticipantId, kind }
  }

  if (kind === 'invitation' && invitation) {
    await revokeInvitation({
      invitationId: invitation.id,
      groupId,
      settleBalances,
      actor,
    })
    // revokeInvitation already sets removedAt on the ledger participant.
    return { ledgerParticipantId, kind }
  }

  // Unlinked (or access-less) participant: settle optionally, then soft-hide.
  const balances = await getGroupBalances(groupId)
  const hasUnsettledBalance = (balances[participant.id]?.total ?? 0) !== 0
  if (hasUnsettledBalance && settleBalances === undefined) {
    throw new SoftRemoveParticipantPreconditionError(
      'unsettledBalance',
      'Participant has unsettled balances. Settle them first or remove without settling.',
    )
  }

  const participantName = getSoftRemoveParticipantName(participant)
  const activityArgs = {
    type: 'PARTICIPANT_REMOVED' as const,
    actor: { type: 'ACCOUNT' as const, id: actor.accountId },
    subject: {
      type: 'LEDGER_PARTICIPANT' as const,
      id: participant.id,
    },
    data: buildGroupActivityData({
      summary: `Participant ${participantName} was removed`,
    }),
  }

  const boss = await getApiBoss()
  await prisma.$transaction(async (tx) => {
    const settlementActivities = settleBalances
      ? (
          await createSettlementExpensesForLeave(
            groupId,
            participant.id,
            actor,
            tx,
          )
        ).activities
      : []

    if (
      participant.groupMemberId &&
      participant.groupMember?.role === GroupRole.ADMIN &&
      participant.groupMember.status === GroupMemberStatus.ACTIVE
    ) {
      const remainingAdmins = await tx.groupMember.count({
        where: {
          groupId,
          status: GroupMemberStatus.ACTIVE,
          role: GroupRole.ADMIN,
          NOT: { id: participant.groupMemberId },
        },
      })
      if (remainingAdmins === 0) {
        throw new Error('Group must keep at least one admin')
      }
    }

    if (
      participant.groupMemberId &&
      participant.groupMember?.status === GroupMemberStatus.ACTIVE
    ) {
      await tx.groupMember.update({
        where: { id: participant.groupMemberId },
        data: { status: GroupMemberStatus.REMOVED, leftAt: new Date() },
      })
    }

    await tx.ledgerParticipant.update({
      where: { id: participant.id },
      data: { removedAt: new Date() },
    })

    const activity = await logActivity(groupId, activityArgs, tx)
    await planNotificationForActivity(tx, activity, {}, { boss })
    for (const settlementActivity of settlementActivities) {
      await planNotificationForActivity(
        tx,
        settlementActivity.activity,
        {},
        { boss },
      )
    }
  })

  return { ledgerParticipantId, kind }
}

export function mapSoftRemoveParticipantError(error: unknown): never {
  if (
    error instanceof SoftRemoveParticipantPreconditionError ||
    error instanceof RemoveMemberPreconditionError ||
    error instanceof RevokeInvitationPreconditionError
  ) {
    throw error
  }
  throw error
}

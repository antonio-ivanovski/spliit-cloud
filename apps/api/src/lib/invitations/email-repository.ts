import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'

import {
  buildInvitationActivityData,
  logActivity,
  planNotificationForActivity,
} from '../api/activities'
import { getApiBoss } from '../api/boss'
import { randomId } from '../api/shared'
import { adjustSplitPresetsForRemovedParticipant } from '../api/split-presets'
import { removeParticipantFromSubgroup } from '../api/subgroups'
import { getInvitationDisplayName } from './display'
import type { InvitationClock } from './effects/dependencies'
import { InvitationError } from './effects/errors'
import { reconcileMemberLedgerParticipant } from './ledger-reconciliation'

/** Email match guard for accepting an email-targeted invitation. */
export function assertCanAcceptEmailInvitation(
  invitation: { email: string | null; type: GroupInvitationType },
  accountEmail: string,
) {
  if (invitation.type !== GroupInvitationType.EMAIL) {
    throw new InvitationError('This invitation is not an email invitation.')
  }
  if (
    !invitation.email ||
    invitation.email.toLowerCase() !== accountEmail.toLowerCase()
  ) {
    throw new InvitationError(
      'Invitation email does not match the authenticated account email',
    )
  }
}

/** Email match guard for declining an email-targeted invitation. */
export function assertCanDeclineEmailInvitation(
  invitation: { email: string | null; type: GroupInvitationType },
  accountEmail: string,
) {
  if (invitation.type !== GroupInvitationType.EMAIL) {
    throw new InvitationError('This invitation is not an email invitation.')
  }
  if (
    !invitation.email ||
    invitation.email.toLowerCase() !== accountEmail.toLowerCase()
  ) {
    throw new InvitationError('This invitation was not sent to your account.')
  }
}

/** Mark a pending invitation as declined by the invitee. */
export async function declineEmailInvitation(opts: {
  invitationId: string
  accountEmail: string
  accountId: string
}) {
  const boss = await getApiBoss()
  const { updated } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "GroupInvitation" WHERE "id" = ${opts.invitationId} FOR UPDATE`
    const invitation = await tx.groupInvitation.findUnique({
      where: { id: opts.invitationId },
    })
    if (!invitation) throw new InvitationError('Invitation not found.')
    if (invitation.status !== GroupInvitationStatus.PENDING) {
      throw new InvitationError('Invitation is no longer pending.')
    }
    assertCanDeclineEmailInvitation(invitation, opts.accountEmail)
    const updated = await tx.groupInvitation.update({
      where: { id: opts.invitationId },
      data: {
        status: GroupInvitationStatus.DECLINED,
      },
    })
    if (invitation.ledgerParticipantId) {
      await adjustSplitPresetsForRemovedParticipant(
        invitation.ledgerParticipantId,
        tx,
      )
      await removeParticipantFromSubgroup(invitation.ledgerParticipantId, tx)
    }
    const activity = await logActivity(
      invitation.groupId,
      {
        type: 'INVITATION_DECLINED',
        actor: { type: 'ACCOUNT', id: opts.accountId },
        subject: { type: 'INVITATION', id: opts.invitationId },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(invitation),
        }),
      },
      tx,
    )
    await planNotificationForActivity(tx, activity, {}, { boss })
    return { updated, activity }
  })
  return updated
}

/** Accept a pending email-targeted invitation for the current account. */
export async function acceptEmailInvitation(
  opts: {
    invitationId: string
    accountId: string
    accountEmail: string
    expectedGroupId?: string
  },
  { now }: InvitationClock,
) {
  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    // Serialize acceptance against revocation, retargeting, and other accepts.
    // Read authorization only after acquiring the invitation's write lock.
    await tx.$queryRaw`SELECT "id" FROM "GroupInvitation" WHERE "id" = ${opts.invitationId} FOR UPDATE`
    const invitation = await tx.groupInvitation.findUnique({
      where: { id: opts.invitationId },
      include: { group: { include: { ledger: true } } },
    })
    if (!invitation) {
      throw new InvitationError('Invitation not found')
    }
    if (opts.expectedGroupId && invitation.groupId !== opts.expectedGroupId) {
      throw new InvitationError('Invitation not found')
    }
    if (invitation.status !== GroupInvitationStatus.PENDING) {
      throw new InvitationError('Invitation is no longer pending')
    }
    assertCanAcceptEmailInvitation(invitation, opts.accountEmail)
    if (!invitation.group.ledger) {
      throw new Error('Group has no ledger')
    }

    const member = await tx.groupMember.upsert({
      where: {
        groupId_accountId: {
          groupId: invitation.groupId,
          accountId: opts.accountId,
        },
      },
      create: {
        id: randomId(),
        groupId: invitation.groupId,
        accountId: opts.accountId,
        role: invitation.role,
        status: 'ACTIVE',
        joinedAt: now(),
      },
      update: {
        role: invitation.role,
        status: 'ACTIVE',
        joinedAt: now(),
        leftAt: null,
      },
    })

    await reconcileMemberLedgerParticipant(tx, {
      memberId: member.id,
      ledgerId: invitation.group.ledger!.id,
      pendingParticipantId: invitation.ledgerParticipantId,
    })

    await tx.groupInvitation.update({
      where: { id: invitation.id },
      data: {
        status: GroupInvitationStatus.ACCEPTED,
        acceptedById: opts.accountId,
        acceptedAt: now(),
      },
    })

    const activity = await logActivity(
      invitation.groupId,
      {
        type: 'INVITATION_ACCEPTED',
        actor: { type: 'ACCOUNT', id: opts.accountId },
        subject: { type: 'INVITATION', id: invitation.id },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(invitation),
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })

    return { member, activity }
  })
  return result.member
}

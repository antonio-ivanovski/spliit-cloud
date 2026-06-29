import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupRole,
  prisma,
} from '@spliit/db'
import { TRPCError } from '@trpc/server'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
} from '../api/balances'
import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { sendEmail } from '../mail/send'
import { getInvitationDisplayName } from './display'
import { reconcileMemberLedgerParticipant } from './ledger-reconciliation'

export type CreateInvitationInput = {
  groupId: string
  email: string
  role: GroupRole
  inviterAccountId: string
  /** Pending-only label. Ignored after acceptance. */
  temporaryName?: string | null
}

export class InvitationError extends TRPCError {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message })
  }
}

async function assertNotInvitingSelf(
  inviterAccountId: string,
  normalizedEmail: string,
) {
  const inviter = await prisma.account.findUnique({
    where: { id: inviterAccountId },
  })
  if (inviter && inviter.email.toLowerCase() === normalizedEmail) {
    throw new InvitationError(
      'You cannot invite yourself to a group you belong to.',
    )
  }
}

async function assertNotExistingMember(
  groupId: string,
  normalizedEmail: string,
) {
  const existingMember = await prisma.groupMember.findFirst({
    where: {
      groupId,
      account: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    },
    select: { id: true },
  })
  if (existingMember) {
    throw new InvitationError('This person is already a member of the group.')
  }
}

async function assertNoConflictingEmailInvitation(
  groupId: string,
  normalizedEmail: string,
) {
  const existingPending = await prisma.groupInvitation.findFirst({
    where: {
      groupId,
      type: GroupInvitationType.EMAIL,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: GroupInvitationStatus.PENDING,
    },
    select: { id: true },
  })
  if (existingPending) {
    throw new InvitationError(
      'An invitation is already pending for this email. Revoke the existing one below and try again.',
    )
  }
  const existingAccepted = await prisma.groupInvitation.findFirst({
    where: {
      groupId,
      type: GroupInvitationType.EMAIL,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: GroupInvitationStatus.ACCEPTED,
    },
    select: { id: true },
  })
  if (existingAccepted) {
    throw new InvitationError('This email is already a member of the group.')
  }
}

/**
 * Create an email-targeted invitation.
 */
export async function createEmailInvitation({
  groupId,
  email,
  role,
  inviterAccountId,
  temporaryName,
}: CreateInvitationInput) {
  const normalizedEmail = email.toLowerCase()

  await assertNotInvitingSelf(inviterAccountId, normalizedEmail)
  await assertNotExistingMember(groupId, normalizedEmail)
  await assertNoConflictingEmailInvitation(groupId, normalizedEmail)

  return prisma.groupInvitation.create({
    data: {
      id: randomId(),
      type: GroupInvitationType.EMAIL,
      groupId,
      email: normalizedEmail,
      role,
      temporaryName: temporaryName ?? null,
      invitedById: inviterAccountId,
    },
  })
}

export const createInvitation = createEmailInvitation

export async function listGroupInvitations(groupId: string) {
  return prisma.groupInvitation.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'desc' }],
  })
}

export class RevokeInvitationPreconditionError extends Error {
  constructor(
    public readonly reason: 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'RevokeInvitationPreconditionError'
  }
}

export async function revokeInvitation(opts: {
  invitationId: string
  groupId: string
  settleBalances?: boolean
  actor: { accountId: string }
}) {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: opts.invitationId },
  })
  if (!invitation) return null

  let hasUnsettledBalance = false
  if (invitation.ledgerParticipantId) {
    const balances = await getGroupBalances(opts.groupId)
    hasUnsettledBalance =
      (balances[invitation.ledgerParticipantId]?.total ?? 0) !== 0
  }
  if (hasUnsettledBalance && opts.settleBalances !== true) {
    throw new RevokeInvitationPreconditionError(
      'unsettledBalance',
      'Invitation has unsettled balances. Settle them before revoking.',
    )
  }

  return prisma.$transaction(async (tx) => {
    if (
      opts.settleBalances &&
      invitation.ledgerParticipantId &&
      invitation.status === GroupInvitationStatus.PENDING
    ) {
      await createSettlementExpensesForLeave(
        opts.groupId,
        invitation.ledgerParticipantId,
        opts.actor,
        tx,
      )
    }

    const updated = await tx.groupInvitation.update({
      where: { id: opts.invitationId },
      data: {
        status: GroupInvitationStatus.REVOKED,
        revokedAt: new Date(),
      },
    })

    if (
      invitation.ledgerParticipantId &&
      invitation.status === GroupInvitationStatus.PENDING
    ) {
      const inUse = await tx.expensePaidFor.count({
        where: {
          ledgerParticipantId: invitation.ledgerParticipantId,
        },
      })
      if (inUse === 0) {
        await tx.ledgerParticipant
          .delete({ where: { id: invitation.ledgerParticipantId } })
          .catch(() => undefined)
      }
    }

    return updated
  })
}

export async function getRevokeInvitationPreview(opts: {
  invitationId: string
  groupId: string
}): Promise<{
  invitationEmail: string
  invitationLabel: string
  hasUnsettledBalance: boolean
}> {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: opts.invitationId },
  })
  if (!invitation || invitation.groupId !== opts.groupId) {
    throw new Error('Invitation not found in this group')
  }

  let hasUnsettledBalance = false
  if (invitation.ledgerParticipantId) {
    const balances = await getGroupBalances(opts.groupId)
    hasUnsettledBalance =
      (balances[invitation.ledgerParticipantId]?.total ?? 0) !== 0
  }

  return {
    invitationEmail: invitation.email,
    invitationLabel: getInvitationDisplayName(invitation),
    hasUnsettledBalance,
  }
}

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

/**
 * Mark a pending invitation as declined by the invitee.
 */
export async function declineInvitation(opts: {
  invitationId: string
  accountEmail: string
}) {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: opts.invitationId },
  })
  if (!invitation) {
    throw new InvitationError('Invitation not found.')
  }
  if (invitation.status !== GroupInvitationStatus.PENDING) {
    throw new InvitationError('Invitation is no longer pending.')
  }
  assertCanDeclineEmailInvitation(invitation, opts.accountEmail)
  return prisma.groupInvitation.update({
    where: { id: opts.invitationId },
    data: {
      status: GroupInvitationStatus.DECLINED,
    },
  })
}

/**
 * Send the invitation email to the recipient.
 */
export async function sendInvitationEmail(opts: {
  invitationId: string
  groupId: string
  groupName: string
  inviterDisplayName: string
  inviterRole: GroupRole
  recipientEmail: string
  recipientIsExistingUser: boolean
}) {
  const {
    invitationId,
    groupId,
    groupName,
    inviterDisplayName,
    inviterRole,
    recipientEmail,
    recipientIsExistingUser,
  } = opts

  const webBase = getWebBaseUrl()
  const acceptUrl = `${webBase}/groups/${groupId}`
  const signInUrl = `${webBase}/?invitation=${invitationId}`

  const subject = `${inviterDisplayName} invited you to ${groupName} on Spliit Cloud`

  const text = recipientIsExistingUser
    ? [
        `${inviterDisplayName} (${inviterRole.toLowerCase()}) invited you to join "${groupName}" on Spliit Cloud.`,
        '',
        `Open Spliit to accept or decline the invitation:`,
        acceptUrl,
        '',
        `If you don't recognize this group, you can safely ignore this email.`,
      ].join('\n')
    : [
        `${inviterDisplayName} invited you to join "${groupName}" on Spliit Cloud.`,
        '',
        `Create an account to join the group:`,
        signInUrl,
        '',
        `If you don't want to join, you can safely ignore this email.`,
      ].join('\n')

  try {
    await sendEmail({ to: recipientEmail, subject, text })
  } catch (err) {
    console.warn(
      `[invitations] failed to send invitation email for ${invitationId}:`,
      err,
    )
  }
}

/**
 * Accept a pending email-targeted invitation for the current account.
 */
export async function acceptInvitation(opts: {
  invitationId: string
  accountId: string
  accountEmail: string
}) {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: opts.invitationId },
    include: { group: { include: { ledger: true } } },
  })
  if (!invitation) {
    throw new Error('Invitation not found')
  }
  if (invitation.status !== GroupInvitationStatus.PENDING) {
    throw new Error('Invitation is no longer pending')
  }
  assertCanAcceptEmailInvitation(invitation, opts.accountEmail)
  if (!invitation.group.ledger) {
    throw new Error('Group has no ledger')
  }

  const result = await prisma.$transaction(async (tx) => {
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
        joinedAt: new Date(),
      },
      update: {
        role: invitation.role,
        status: 'ACTIVE',
        joinedAt: new Date(),
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
        acceptedAt: new Date(),
      },
    })

    return member
  })

  return result
}

/** List pending email invitations targeted at the current account. */
export async function listPendingEmailInvitationsForAccount(
  accountEmail: string,
) {
  return prisma.groupInvitation.findMany({
    where: {
      type: GroupInvitationType.EMAIL,
      status: GroupInvitationStatus.PENDING,
      email: accountEmail.toLowerCase(),
    },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      group: { select: { id: true, name: true } },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
  })
}

export const listPendingInvitationsForAccount =
  listPendingEmailInvitationsForAccount

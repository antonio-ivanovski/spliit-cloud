import { GroupInvitationStatus, GroupRole, prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
  randomId,
} from './api'
import { getWebBaseUrl } from './auth/urls'
import { sendEmail } from './mail/send'

export type CreateInvitationInput = {
  groupId: string
  email: string
  role: GroupRole
  inviterAccountId: string
}

export class InvitationError extends TRPCError {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message })
  }
}

export async function createInvitation({
  groupId,
  email,
  role,
  inviterAccountId,
}: CreateInvitationInput) {
  const normalizedEmail = email.toLowerCase()

  const inviter = await prisma.account.findUnique({
    where: { id: inviterAccountId },
  })
  if (inviter && inviter.email.toLowerCase() === normalizedEmail) {
    throw new InvitationError(
      'You cannot invite yourself to a group you belong to.',
    )
  }

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

  // Reject if there is already a pending invitation for the same email in
  // this group. The user should revoke the existing invitation first.
  const existingPending = await prisma.groupInvitation.findFirst({
    where: {
      groupId,
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

  // Reject if there is already an accepted invitation for the same email in
  // this group. The account already belongs to the group (or the email was
  // claimed by someone else).
  const existingAccepted = await prisma.groupInvitation.findFirst({
    where: {
      groupId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: GroupInvitationStatus.ACCEPTED,
    },
    select: { id: true },
  })
  if (existingAccepted) {
    throw new InvitationError('This email is already a member of the group.')
  }

  return prisma.groupInvitation.create({
    data: {
      id: randomId(),
      groupId,
      email: normalizedEmail,
      role,
      invitedById: inviterAccountId,
    },
  })
}

export async function listGroupInvitations(groupId: string) {
  return prisma.groupInvitation.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'desc' }],
  })
}

/**
 * Error thrown when an admin attempts to revoke a pending invitation whose
 * materializeed ledger participant has unsettled balances without explicitly
 * choosing whether to settle them first. Callers should map this to
 * `PRECONDITION_FAILED` so the web client can re-render the revoke dialog
 * with the missing decision (settle+revoke vs. revoke only).
 */
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
  // Pre-check: if the invitation has a materialized ledger participant,
  // detect any unsettled balances involving it so we can prompt the admin
  // for an explicit decision before touching the ledger. The same balance
  // pipeline that backs the leave / remove flows (`getPublicBalances`) is
  // used so the UI and the mutation agree on what "settled" means.
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
  if (hasUnsettledBalance && opts.settleBalances === undefined) {
    throw new RevokeInvitationPreconditionError(
      'unsettledBalance',
      'Invitation has unsettled balances. Settle them first or revoke without settling.',
    )
  }

  return prisma.$transaction(async (tx) => {
    // When the admin opts in, write one reimbursement-style settlement
    // expense per leg involving the invitation's participant before
    // revoking. The expenses commit in the same transaction as the
    // invitation status flip so the ledger and the membership state
    // stay in sync.
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
        ledgerParticipantId: null,
      },
    })

    // Only delete the materialized ledger participant if it has no historical
    // expenses referencing it. This preserves historical paid-by / paid-for
    // rows that captured pre-acceptance expenses for the invitee.
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

/**
 * Read-only summary the web client uses to render the admin "revoke
 * invitation" dialog before the admin confirms. Bundles everything the
 * dialog needs in a single query:
 *   - the invitation's email (so the dialog can address it),
 *   - whether the invitation's materialized ledger participant has
 *     unsettled balances (so the dialog can pick between the simple
 *     confirm and the three-option variant).
 *
 * Caller authorization (ADMIN of the group, invitation belongs to
 * that group, invitation is still PENDING) is enforced by the
 * procedure that wraps this helper — this function only loads the
 * data.
 */
export async function getRevokeInvitationPreview(opts: {
  invitationId: string
  groupId: string
}): Promise<{
  invitationEmail: string
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
    hasUnsettledBalance,
  }
}

/**
 * Mark a pending invitation as declined by the invitee. The authenticated
 * account email must match the invitation email (case-insensitive); the
 * invitation must be in the PENDING state.
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
  if (invitation.email.toLowerCase() !== opts.accountEmail.toLowerCase()) {
    throw new InvitationError('This invitation was not sent to your account.')
  }
  return prisma.groupInvitation.update({
    where: { id: opts.invitationId },
    data: {
      status: GroupInvitationStatus.DECLINED,
    },
  })
}

/**
 * Send the invitation email to the recipient. The body and target URL are
 * tailored depending on whether the recipient already has an account on this
 * Spliit Cloud instance:
 *
 *  - existing user: "in-app" style email with a deep link to the group, asking
 *    them to open Spliit to accept or decline.
 *  - new user: "sign-up" style email with a sign-up deep link, asking them to
 *    create an account to join the group.
 *
 * Email-send failures are logged but never thrown: the DB row remains the
 * source of truth, and the in-app UI will surface the invite to existing
 * users regardless of email delivery.
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
  // Both flows land on the group page. The /groups/:id route now allows
  // pending invitees (matching the account email) to open the page and
  // surfaces an Accept/Decline banner in the group header. Linking to
  // /groups/:id/members (the previous target) forced a redirect through
  // a forbidden loadGroupContext because pending invitees are not yet
  // ACTIVE members.
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
        `${inviterDisplayName} invited you to "${groupName}" on Spliit Cloud.`,
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
 * Accept a pending invitation for the current account. The invitation must
 * exist, be PENDING, and the authenticated account email must match the
 * invitation email exactly (case-insensitive). The function is idempotent in
 * the sense that accepting a non-pending invitation is rejected.
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
  if (invitation.email.toLowerCase() !== opts.accountEmail.toLowerCase()) {
    throw new Error(
      'Invitation email does not match the authenticated account email',
    )
  }
  if (!invitation.group.ledger) {
    throw new Error('Group has no ledger')
  }

  const result = await prisma.$transaction(async (tx) => {
    // Create the group member (or upgrade a PENDING one) and a matching
    // LedgerParticipant so expenses can be recorded against the new member.
    // No display name is stored on either row: the name is always resolved
    // at read time from `Account.name` via the relations.
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

    // Reuse the LedgerParticipant materialized for the pending invitation
    // (if any) so expenses recorded against the invitee before acceptance are
    // preserved. Otherwise create a new participant linked to the member.
    if (invitation.ledgerParticipantId) {
      await tx.ledgerParticipant.update({
        where: { id: invitation.ledgerParticipantId },
        data: {
          groupMemberId: member.id,
        },
      })
    } else {
      await tx.ledgerParticipant.upsert({
        where: { groupMemberId: member.id },
        create: {
          id: randomId(),
          ledgerId: invitation.group.ledger!.id,
          groupMemberId: member.id,
        },
        update: {},
      })
    }

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

export async function listPendingInvitationsForAccount(accountEmail: string) {
  return prisma.groupInvitation.findMany({
    where: {
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

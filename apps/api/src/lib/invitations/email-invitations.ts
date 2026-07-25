import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupType,
  prisma,
  type GroupRole,
} from '@spliit/db'
import { TRPCError } from '@trpc/server'
import {
  buildExpenseActivityData,
  buildInvitationActivityData,
  logActivity,
  scheduleActivityNotification,
} from '../api/activities'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
} from '../api/balances'
import { randomId } from '../api/shared'
import { sendEmail } from '../mail/send'
import { renderInvitationEmail } from '../mail/templates/invitation'
import { scheduleDefaultNotificationDispatch } from '../notifications/dispatcher'
import { getInvitationDisplayName } from './display'
import { reconcileMemberLedgerParticipant } from './ledger-reconciliation'

export type CreateInvitationInput = {
  groupId: string
  email: string
  role: GroupRole
  inviterAccountId: string
  /** Pending-only label. Ignored after acceptance. */
  temporaryName?: string | null
  ledgerParticipantId?: string | null
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
      status: GroupMemberStatus.ACTIVE,
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
  ledgerParticipantId,
}: CreateInvitationInput) {
  const normalizedEmail = email.toLowerCase()

  await assertNotInvitingSelf(inviterAccountId, normalizedEmail)
  await assertNotExistingMember(groupId, normalizedEmail)
  await assertNoConflictingEmailInvitation(groupId, normalizedEmail)

  const invitation = await prisma.groupInvitation.create({
    data: {
      id: randomId(),
      type: GroupInvitationType.EMAIL,
      groupId,
      email: normalizedEmail,
      role,
      temporaryName: temporaryName ?? null,
      invitedById: inviterAccountId,
      ...(ledgerParticipantId
        ? { ledgerParticipantId: ledgerParticipantId }
        : {}),
    },
  })

  const activity = await logActivity(groupId, {
    type: 'INVITATION_CREATED',
    actor: { type: 'ACCOUNT', id: inviterAccountId },
    subject: { type: 'INVITATION', id: invitation.id },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
      invitationType: 'EMAIL',
      role,
    }),
  })

  scheduleActivityNotification(activity, groupId, {
    type: 'INVITATION_CREATED',
    actor: { type: 'ACCOUNT', id: inviterAccountId },
    subject: { type: 'INVITATION', id: invitation.id },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
      invitationType: 'EMAIL',
      role,
    }),
  })
  return invitation
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
  if (hasUnsettledBalance && opts.settleBalances === undefined) {
    throw new RevokeInvitationPreconditionError(
      'unsettledBalance',
      'Invitation has unsettled balances. Settle them before revoking.',
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    let settlementActivities = undefined as
      | Awaited<
          ReturnType<typeof createSettlementExpensesForLeave>
        >['activities']
      | undefined
    if (
      opts.settleBalances &&
      invitation.ledgerParticipantId &&
      invitation.status === GroupInvitationStatus.PENDING
    ) {
      const r = await createSettlementExpensesForLeave(
        opts.groupId,
        invitation.ledgerParticipantId,
        opts.actor,
        tx,
      )
      settlementActivities = r.activities
    }

    const [updated, activity] = await Promise.all([
      tx.groupInvitation.update({
        where: { id: opts.invitationId },
        data: {
          status: GroupInvitationStatus.REVOKED,
          revokedAt: new Date(),
        },
      }),
      logActivity(
        opts.groupId,
        {
          type: 'INVITATION_REVOKED',
          actor: { type: 'ACCOUNT', id: opts.actor.accountId },
          subject: { type: 'INVITATION', id: opts.invitationId },
          data: buildInvitationActivityData({
            displayLabel: getInvitationDisplayName(invitation),
          }),
        },
        tx,
      ),
    ])

    if (
      invitation.ledgerParticipantId &&
      invitation.status === GroupInvitationStatus.PENDING
    ) {
      await tx.ledgerParticipant.update({
        where: { id: invitation.ledgerParticipantId },
        data: { removedAt: new Date() },
      })
    }

    return { updated, settlementActivities, activity }
  })
  scheduleActivityNotification(result.activity, opts.groupId, {
    type: 'INVITATION_REVOKED',
    actor: { type: 'ACCOUNT', id: opts.actor.accountId },
    subject: { type: 'INVITATION', id: opts.invitationId },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
    }),
  })
  if (result.settlementActivities) {
    for (const meta of result.settlementActivities) {
      scheduleDefaultNotificationDispatch({
        activityId: meta.activityId,
        type: 'EXPENSE_CREATED',
        groupId: opts.groupId,
        actor: { type: 'ACCOUNT', id: opts.actor.accountId },
        subject: { type: 'EXPENSE', id: meta.expenseId },
        data: buildExpenseActivityData({
          summary: meta.title,
          title: meta.title,
          amount: meta.amount,
          currencyCode: meta.currencyCode,
          date: meta.date,
        }),
        occurredAt: meta.time,
      })
    }
  }
  return result.updated
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
  accountId: string
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
  const { updated, activity } = await prisma.$transaction(async (tx) => {
    const [updated, activity] = await Promise.all([
      tx.groupInvitation.update({
        where: { id: opts.invitationId },
        data: {
          status: GroupInvitationStatus.DECLINED,
        },
      }),
      logActivity(
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
      ),
    ])
    return { updated, activity }
  })

  scheduleActivityNotification(activity, invitation.groupId, {
    type: 'INVITATION_DECLINED',
    actor: { type: 'ACCOUNT', id: opts.accountId },
    subject: { type: 'INVITATION', id: opts.invitationId },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
    }),
  })
  return updated
}

/**
 * Send the invitation email to the recipient.
 *
 * Both HTML and text bodies are rendered by `renderInvitationEmail`.
 */
export async function sendInvitationEmail(opts: {
  invitationId: string
  groupId: string
  groupName: string
  inviterDisplayName: string
  inviterRole: GroupRole
  recipientEmail: string
  recipientIsExistingUser: boolean
  temporaryName?: string | null
  sourceProvider?: string
  sourceGroupName?: string
  expenseCount?: number
  totalAmount?: number
  currencyCode?: string | null
}) {
  try {
    const rendered = await renderInvitationEmail(opts)
    await sendEmail({ to: opts.recipientEmail, ...rendered })
  } catch (err) {
    console.warn(
      `[invitations] failed to send invitation email for ${opts.invitationId}:`,
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

    return { member, activity }
  })
  scheduleActivityNotification(result.activity, invitation.groupId, {
    type: 'INVITATION_ACCEPTED',
    actor: { type: 'ACCOUNT', id: opts.accountId },
    subject: { type: 'INVITATION', id: invitation.id },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
    }),
  })
  return result.member
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
      // Friend-typed group invitations are reconciled via the friend
      // ledger auto-accept flow (`autoAcceptPendingFriendInvitationsForAccount`)
      // so they never surface through the general "pending invitations"
      // panel.
      group: { groupType: GroupType.GROUP },
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

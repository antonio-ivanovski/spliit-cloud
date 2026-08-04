import { TRPCError } from '@trpc/server'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupType,
  prisma,
  type GroupRole,
} from '@spliit/db'

import {
  buildInvitationActivityData,
  logActivity,
  planNotificationForActivity,
} from '../api/activities'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
} from '../api/balances'
import { getApiBoss } from '../api/boss'
import { randomId } from '../api/shared'
import { removeParticipantFromSubgroup } from '../api/subgroups'
import { sendEmail } from '../mail/send'
import { renderInvitationEmail } from '../mail/templates/invitation'
import { getInvitationDisplayName } from './display'
import {
  materializePendingInvitationParticipant,
  reconcileMemberLedgerParticipant,
} from './ledger-reconciliation'

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

export async function assertNotInvitingSelf(
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

export async function assertNotExistingMember(
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

export async function assertNoConflictingEmailInvitation(
  groupId: string,
  normalizedEmail: string,
  excludeInvitationId?: string,
) {
  const existingPending = await prisma.groupInvitation.findFirst({
    where: {
      groupId,
      type: GroupInvitationType.EMAIL,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: GroupInvitationStatus.PENDING,
      ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
    },
    select: { id: true },
  })
  if (existingPending) {
    throw new InvitationError(
      'An invitation is already pending for this email. Revoke the existing one below and try again.',
    )
  }
}

/** Find a pending EMAIL invitation for a group and email, if any. */
export async function findPendingEmailInvitation(
  groupId: string,
  email: string,
) {
  return prisma.groupInvitation.findFirst({
    where: {
      groupId,
      type: GroupInvitationType.EMAIL,
      status: GroupInvitationStatus.PENDING,
      email: { equals: email, mode: 'insensitive' },
    },
    select: { id: true, role: true, type: true },
  })
}

/** Create an email-targeted invitation. */
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

  // When the destination matches an existing account, the account profile
  // name is authoritative and overwrites any submitted temporary name —
  // mirroring the pending-invitation manage path so pending rows and emails
  // are consistent.
  const matchedAccount = await prisma.account.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { name: true },
  })
  const effectiveTemporaryName = matchedAccount
    ? matchedAccount.name
    : (temporaryName ?? null)

  const boss = await getApiBoss()
  return prisma.$transaction(async (tx) => {
    const participantId = await materializePendingInvitationParticipant(tx, {
      groupId,
      suppliedParticipantId: ledgerParticipantId,
      displayName: effectiveTemporaryName,
    })

    const invitation = await tx.groupInvitation.create({
      data: {
        id: randomId(),
        type: GroupInvitationType.EMAIL,
        groupId,
        email: normalizedEmail,
        role,
        temporaryName: effectiveTemporaryName,
        invitedById: inviterAccountId,
        ledgerParticipantId: participantId,
      },
    })

    const activity = await logActivity(
      groupId,
      {
        type: 'INVITATION_CREATED',
        actor: { type: 'ACCOUNT', id: inviterAccountId },
        subject: { type: 'INVITATION', id: invitation.id },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(invitation),
          invitationType: 'EMAIL',
          role,
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    return invitation
  })
}

export const createInvitation = createEmailInvitation

export async function listGroupInvitations(groupId: string) {
  return prisma.groupInvitation.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'desc' }],
  })
}

export async function isInvitationParticipantUnused(args: {
  groupId: string
  ledgerParticipantId: string | null
}): Promise<boolean> {
  if (!args.ledgerParticipantId) return true
  const unusedParticipantIds = await getUnusedInvitationParticipantIds({
    groupId: args.groupId,
    ledgerParticipantIds: [args.ledgerParticipantId],
  })
  return unusedParticipantIds.has(args.ledgerParticipantId)
}

export async function getUnusedInvitationParticipantIds(args: {
  groupId: string
  ledgerParticipantIds: Array<string | null>
}): Promise<Set<string>> {
  const participantIds = [
    ...new Set(
      args.ledgerParticipantIds.filter(
        (participantId): participantId is string => participantId !== null,
      ),
    ),
  ]
  if (participantIds.length === 0) return new Set()

  const [participants, balances] = await Promise.all([
    prisma.ledgerParticipant.findMany({
      where: { id: { in: participantIds } },
      select: {
        id: true,
        _count: {
          select: {
            expensesPaidByList: true,
            expensesPaidFor: true,
            expenseItemPaidFor: true,
            expenseItemizedRemainderPaidFor: true,
          },
        },
      },
    }),
    getGroupBalances(args.groupId),
  ])

  const unused: string[] = []
  for (const participant of participants) {
    const counts = participant._count
    const usedInExpense =
      counts.expensesPaidByList > 0 ||
      counts.expensesPaidFor > 0 ||
      counts.expenseItemPaidFor > 0 ||
      counts.expenseItemizedRemainderPaidFor > 0
    if (!usedInExpense && (balances[participant.id]?.total ?? 0) === 0) {
      unused.push(participant.id)
    }
  }
  return new Set(unused)
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

  const boss = await getApiBoss()
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
    if (invitation.ledgerParticipantId) {
      await removeParticipantFromSubgroup(invitation.ledgerParticipantId, tx)
    }

    await planNotificationForActivity(tx, activity, {}, { boss })
    if (settlementActivities) {
      await Promise.all(
        settlementActivities.map((meta) =>
          planNotificationForActivity(tx, meta.activity, {}, { boss }),
        ),
      )
    }

    return { updated, settlementActivities, activity }
  })
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

/** Mark a pending invitation as declined by the invitee. */
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
  const boss = await getApiBoss()
  const { updated } = await prisma.$transaction(async (tx) => {
    const updated = await tx.groupInvitation.update({
      where: { id: opts.invitationId },
      data: {
        status: GroupInvitationStatus.DECLINED,
      },
    })
    if (invitation.ledgerParticipantId) {
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

/** Accept a pending email-targeted invitation for the current account. */
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

  const boss = await getApiBoss()
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

    await planNotificationForActivity(tx, activity, {}, { boss })

    return { member, activity }
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

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
  randomId,
} from './api'
import { getWebBaseUrl } from './auth/urls'
import { sendEmail } from './mail/send'

/**
 * Generic "Pending invite" fallback label for invitations with no email
 * and no temporary name.
 */
export const PENDING_INVITEE_FALLBACK_LABEL = 'Pending invite'

/**
 * Reserved TLDs used for synthetic placeholder emails. Anything under
 * `*.placeholder.local` is by convention not a real address — it is a
 * synthetic identifier that satisfies `Account.email`'s non-null /
 * unique contract for users and invitations that have no real address.
 *
 *   - `${token}@link.placeholder.local`           — link-invite recipient
 *   - `${providerAccountId}@${provider}.placeholder.local` — OAuth
 *     provider that did not return an email (e.g. Reddit, Discord
 *     phone-only accounts)
 *
 * The unique constraint on `Account.email` stays the source of
 * identity, and application code can treat `.placeholder.local` as a
 * "no real email" marker (e.g. to skip email-only features like
 * password reset or notifications for these users).
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.local'

/** True when the email is a synthetic placeholder, not a real address. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`.${PLACEHOLDER_EMAIL_DOMAIN}`)
}

/** Build a synthetic email for an OAuth provider that did not return one. */
export function buildProviderPlaceholderEmail(
  provider: string,
  providerAccountId: string,
): string {
  const safeProvider = provider.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return `${providerAccountId}@${safeProvider}.${PLACEHOLDER_EMAIL_DOMAIN}`
}

/** Build a synthetic email for a link invitation. `token` must be unique. */
export function buildLinkPlaceholderEmail(token: string): string {
  return `${token}@link.${PLACEHOLDER_EMAIL_DOMAIN}`
}

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

/**
 * Display name for an invitation row. Priority:
 * `temporaryName` → `email` → {@link PENDING_INVITEE_FALLBACK_LABEL}.
 * Callers should prefer `Account.name` for accepted invitations.
 */
export function getInvitationDisplayName(invitation: {
  email: string | null
  temporaryName: string | null
}): string {
  return (
    invitation.temporaryName ??
    invitation.email ??
    PENDING_INVITEE_FALLBACK_LABEL
  )
}

/**
 * Display name for a `LedgerParticipant`. Priority: accepted
 * `Account.name` → invitation `temporaryName` → invitation `email`.
 */
export function resolveParticipantDisplayName(participant: {
  groupMember: { account: { name: string } } | null
  invitations: Array<{
    email: string | null
    temporaryName: string | null
  }>
}): string {
  const accountName = participant.groupMember?.account.name
  if (accountName) return accountName
  const invitation = participant.invitations[0]
  if (!invitation) return ''
  return getInvitationDisplayName(invitation)
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
 * Create an email-targeted invitation. Owns normalization, duplicate
 * checks, and the create call. The seam exists so a future
 * `createLinkInvitation` can sit next to it.
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

/**
 * Error thrown when an admin attempts to revoke a pending invitation whose
 * materialized ledger participant has unsettled balances without settling
 * them first. Revoking with an unsettled balance would leave the ledger
 * pointing at a participant that no longer appears in the group, which
 * breaks the balances view — so this is rejected outright. The web
 * client maps this to `PRECONDITION_FAILED` so the revoke dialog can
 * prompt for the settle-and-revoke decision.
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
  /**
   * Required when the invitee has unsettled balances. When `true`, the
   * helper auto-creates one settlement expense per leg involving the
   * invitee before flipping the invitation to `REVOKED`, so the ledger
   * stays in sync. When `false` or unset while balances are unsettled,
   * {@link RevokeInvitationPreconditionError} is thrown — the only way
   * out is to settle first.
   */
  settleBalances?: boolean
  actor: { accountId: string }
}) {
  // Pre-check: if the invitation has a materialized ledger participant,
  // detect any unsettled balances involving it. We use the same balance
  // pipeline that backs the leave / archive flows so the UI and the
  // mutation agree on what "settled" means. The invitee must be settled
  // before the revoke can proceed — otherwise the participant stays in
  // the ledger but disappears from the active roster, leaving the
  // balances view with an orphan side of a leg.
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
        // Keep `ledgerParticipantId` set on revoke so historical expenses
        // (which reference this participant through `paidBy` / `paidFor`)
        // still resolve a name in the activity feed via the participant's
        // invitation relation. The UI only renders PENDING invitations, so
        // the link is invisible to the user but useful for read-time joins.
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
 * Read-only summary for the admin "revoke invitation" dialog: the
 * invitation's display label and whether the invitee has unsettled
 * balances. Caller authorization is enforced by the procedure.
 */
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
 * Mark a pending invitation as declined by the invitee. Today every
 * invitation is email-targeted, so this delegates to
 * {@link assertCanDeclineEmailInvitation} which preserves the previous
 * case-insensitive email match. The status flip remains identical to
 * the pre-refactor behavior.
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
 * Accept a pending invitation for the current account. Today every
 * invitation is email-targeted, so this calls
 * {@link assertCanAcceptEmailInvitation} (case-insensitive email match)
 * before flipping the status. The transaction that materializes the new
 * `GroupMember` and reuses the existing pending `LedgerParticipant` is
 * unchanged.
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

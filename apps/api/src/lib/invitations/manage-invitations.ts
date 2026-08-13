import {
  GroupInvitationStatus,
  GroupInvitationType,
  prisma,
  type GroupRole,
} from '@spliit/db'
import type { InvitationActivityChange } from '@spliit/domain/activities'

import {
  buildInvitationActivityData,
  logActivity,
  planNotificationForActivity,
} from '../api/activities'
import { getApiBoss } from '../api/boss'
import { getWebBaseUrl } from '../auth/urls'
import { buildLinkPlaceholderEmail, getInvitationDisplayName } from './display'
import {
  InvitationError,
  assertNoConflictingEmailInvitation,
  assertNotExistingMember,
  assertNotInvitingSelf,
  sendInvitationEmail,
} from './email-invitations'
import {
  LINK_INVITATION_DEFAULT_TTL_MS,
  generateLinkToken,
  hashLinkToken,
} from './link-invitations'

export type PendingInvitationDelivery =
  | { type: 'EMAIL'; email: string }
  | { type: 'LINK' }

export type UpdatePendingInvitationInput = {
  invitationId: string
  groupId: string
  role: GroupRole
  temporaryName?: string | null
  delivery: PendingInvitationDelivery
}

export type UpdatePendingInvitationResult = {
  invitation: {
    id: string
    groupId: string
    type: GroupInvitationType
    email: string
    temporaryName: string | null
    role: GroupRole
    status: GroupInvitationStatus
    expiresAt: Date | null
    ledgerParticipantId: string | null
    updatedAt: Date
  }
  /** One-time shareable URL, returned only for `EMAIL -> LINK` conversions. */
  inviteUrl: string | null
  /** Whether the invitation email must be (re)sent to the new recipient. */
  shouldSendEmail: boolean
}

type LoadedInvitation = NonNullable<
  Awaited<ReturnType<typeof prisma.groupInvitation.findUnique>>
>

/**
 * Update a pending invitation in place: retarget the recipient email, convert
 * between EMAIL and LINK delivery, or edit the pending display name/role —
 * always preserving the invitation row, its ledger participant, expenses,
 * balances, and subgroup links.
 *
 * Validations mirror the create path (no self-invite, no active member, no
 * conflicting pending email invitation) with the current invitation excluded.
 * The row is mutated with a conditional `PENDING` update so a concurrent
 * acceptance/revoke cannot race an update into a resolved invitation.
 *
 * `EMAIL -> LINK` generates a fresh credential; `LINK -> EMAIL` clears the old
 * credential so the previous link stops working immediately (the email-match
 * acceptance guard then rejects the old recipient). `LINK -> LINK` metadata
 * saves keep the existing credential untouched.
 */
export async function updatePendingInvitation(
  opts: UpdatePendingInvitationInput & {
    actorAccountId: string
    inviterDisplayName: string
    inviterRole: GroupRole
  },
): Promise<UpdatePendingInvitationResult> {
  const invitation = await loadPendingInvitation(
    opts.invitationId,
    opts.groupId,
  )

  const delivery = opts.delivery
  const isEmailDelivery = delivery.type === 'EMAIL'
  const normalizedEmail =
    delivery.type === 'EMAIL' ? delivery.email.toLowerCase() : ''
  const destinationChanged =
    isEmailDelivery && normalizedEmail !== invitation.email.toLowerCase()
  const switchingToEmail =
    isEmailDelivery && invitation.type !== GroupInvitationType.EMAIL

  if (isEmailDelivery) {
    if (destinationChanged || switchingToEmail) {
      await assertNotInvitingSelf(opts.actorAccountId, normalizedEmail)
      await assertNotExistingMember(opts.groupId, normalizedEmail)
      await assertNoConflictingEmailInvitation(
        opts.groupId,
        normalizedEmail,
        invitation.id,
      )
    }
  }

  // If the destination matches an existing account, the account profile name
  // is authoritative and overwrites any submitted temporary name.
  let matchedAccount: { id: string; name: string | null } | null = null
  if (isEmailDelivery) {
    matchedAccount = await prisma.account.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, name: true },
    })
  }
  const submittedName = opts.temporaryName?.trim() || null
  const effectiveTemporaryName = matchedAccount
    ? matchedAccount.name
    : submittedName

  // Plan the writes before opening the transaction so the activity change
  // payload stays display-safe and the credential update is atomic.
  const switchingToLink =
    !isEmailDelivery && invitation.type !== GroupInvitationType.LINK

  let newToken: string | null = null
  let newTokenHash: string | null = null
  let newPlaceholderEmail: string | null = null
  let newExpiresAt: Date | null = null
  if (switchingToLink) {
    newToken = generateLinkToken()
    newTokenHash = await hashLinkToken(newToken)
    newPlaceholderEmail = buildLinkPlaceholderEmail(newToken)
    newExpiresAt = new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS)
  }

  const changes: InvitationActivityChange[] = []
  if (switchingToEmail || switchingToLink) {
    changes.push({
      field: 'deliveryType',
      before: invitation.type,
      after: isEmailDelivery
        ? GroupInvitationType.EMAIL
        : GroupInvitationType.LINK,
    })
  }
  if (isEmailDelivery) {
    if (switchingToEmail) {
      changes.push({ field: 'destination', after: normalizedEmail })
    } else if (destinationChanged) {
      changes.push({
        field: 'destination',
        before: invitation.email,
        after: normalizedEmail,
      })
    }
  } else if (switchingToLink) {
    // Old destination was a real email; a LINK has no destination.
    changes.push({
      field: 'destination',
      before: invitation.email,
      after: null,
    })
  }
  if (effectiveTemporaryName !== invitation.temporaryName) {
    changes.push({
      field: 'displayName',
      before: invitation.temporaryName,
      after: effectiveTemporaryName,
    })
  }
  if (opts.role !== invitation.role) {
    changes.push({
      field: 'role',
      before: invitation.role,
      after: opts.role,
    })
  }

  const boss = await getApiBoss()
  const updated = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {
      role: opts.role,
      temporaryName: effectiveTemporaryName,
    }
    if (isEmailDelivery) {
      data.email = normalizedEmail
      if (switchingToEmail) {
        data.type = GroupInvitationType.EMAIL
        data.tokenHash = null
        data.expiresAt = null
      }
    } else {
      if (switchingToLink) {
        data.type = GroupInvitationType.LINK
        data.email = newPlaceholderEmail
        data.tokenHash = newTokenHash
        data.expiresAt = newExpiresAt
      }
    }

    const flipped = await tx.groupInvitation.updateMany({
      where: {
        id: opts.invitationId,
        groupId: opts.groupId,
        status: GroupInvitationStatus.PENDING,
      },
      data,
    })
    if (flipped.count === 0) {
      throw new InvitationError('This invitation is no longer pending.')
    }

    if (invitation.ledgerParticipantId) {
      await tx.ledgerParticipant.update({
        where: { id: invitation.ledgerParticipantId },
        data: { displayName: effectiveTemporaryName },
      })
    }

    if (changes.length > 0) {
      const activity = await logActivity(
        opts.groupId,
        {
          type: 'INVITATION_UPDATED',
          actor: { type: 'ACCOUNT', id: opts.actorAccountId },
          subject: { type: 'INVITATION', id: invitation.id },
          data: buildInvitationActivityData({
            displayLabel: getInvitationDisplayName({
              email: isEmailDelivery
                ? normalizedEmail
                : (newPlaceholderEmail ?? invitation.email),
              temporaryName: effectiveTemporaryName,
            }),
            invitationType: isEmailDelivery
              ? GroupInvitationType.EMAIL
              : GroupInvitationType.LINK,
            role: opts.role,
            changedFields: changes.map((change) => change.field),
            changes,
          }),
        },
        tx,
      )
      await planNotificationForActivity(tx, activity, {}, { boss })
    }

    return tx.groupInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    })
  })

  const inviteUrl =
    newToken && updated.expiresAt
      ? `${getWebBaseUrl()}/groups/${updated.groupId}#invite=${newToken}`
      : null

  // Only notify the new recipient when the destination actually changed or
  // the delivery switched to EMAIL; metadata-only saves must not resend.
  // Existing-account recipients get the existing-user template (no
  // "you will appear as" line, no temporary name in the subject) — they are
  // notified by email just like new users, matching the create path.
  const shouldSendEmail =
    isEmailDelivery && (destinationChanged || switchingToEmail)

  if (shouldSendEmail) {
    await sendInvitationEmail({
      invitationId: updated.id,
      groupId: updated.groupId,
      groupName: (await loadGroupName(updated.groupId)) ?? '',
      inviterDisplayName: opts.inviterDisplayName,
      inviterRole: opts.inviterRole,
      recipientEmail: updated.email,
      senderAccountId: opts.actorAccountId,
      recipientIsExistingUser: matchedAccount !== null,
      temporaryName: matchedAccount ? undefined : updated.temporaryName,
    })
  }

  return {
    invitation: {
      id: updated.id,
      groupId: updated.groupId,
      type: updated.type,
      email: updated.email,
      temporaryName: updated.temporaryName,
      role: updated.role,
      status: updated.status,
      expiresAt: updated.expiresAt,
      ledgerParticipantId: updated.ledgerParticipantId,
      updatedAt: updated.updatedAt,
    },
    inviteUrl,
    shouldSendEmail,
  }
}

export type RegenerateLinkInvitationInput = {
  invitationId: string
  groupId: string
}

export type RegenerateLinkInvitationResult = {
  invitation: {
    id: string
    groupId: string
    type: GroupInvitationType
    email: string
    temporaryName: string | null
    role: GroupRole
    status: GroupInvitationStatus
    expiresAt: Date | null
    ledgerParticipantId: string | null
    updatedAt: Date
  }
  inviteUrl: string
}

/**
 * Atomically rotate a link invitation's credential: the old URL stops working
 * the moment the new hash is written. The invitation row, ledger participant,
 * expenses, balances, and subgroup links are untouched.
 */
export async function regenerateLinkInvitation(
  opts: RegenerateLinkInvitationInput & {
    actorAccountId: string
  },
): Promise<RegenerateLinkInvitationResult> {
  const invitation = await loadPendingInvitation(
    opts.invitationId,
    opts.groupId,
  )
  if (invitation.type !== GroupInvitationType.LINK) {
    throw new InvitationError('Only link invitations can generate a new link.')
  }

  const token = generateLinkToken()
  const tokenHash = await hashLinkToken(token)
  const expiresAt = new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS)

  const boss = await getApiBoss()
  const updated = await prisma.$transaction(async (tx) => {
    const flipped = await tx.groupInvitation.updateMany({
      where: {
        id: opts.invitationId,
        groupId: opts.groupId,
        status: GroupInvitationStatus.PENDING,
      },
      data: { tokenHash, expiresAt },
    })
    if (flipped.count === 0) {
      throw new InvitationError('This invitation is no longer pending.')
    }

    const activity = await logActivity(
      opts.groupId,
      {
        type: 'INVITATION_UPDATED',
        actor: { type: 'ACCOUNT', id: opts.actorAccountId },
        subject: { type: 'INVITATION', id: invitation.id },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(invitation),
          invitationType: GroupInvitationType.LINK,
          role: invitation.role,
          changedFields: ['credential'],
          changes: [{ field: 'credential', after: 'rotated' }],
        }),
      },
      tx,
    )
    await planNotificationForActivity(tx, activity, {}, { boss })

    return tx.groupInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    })
  })

  return {
    invitation: {
      id: updated.id,
      groupId: updated.groupId,
      type: updated.type,
      email: updated.email,
      temporaryName: updated.temporaryName,
      role: updated.role,
      status: updated.status,
      expiresAt: updated.expiresAt,
      ledgerParticipantId: updated.ledgerParticipantId,
      updatedAt: updated.updatedAt,
    },
    inviteUrl: `${getWebBaseUrl()}/groups/${updated.groupId}#invite=${token}`,
  }
}

async function loadPendingInvitation(
  invitationId: string,
  groupId: string,
): Promise<LoadedInvitation> {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: invitationId },
  })
  if (!invitation || invitation.groupId !== groupId) {
    throw new InvitationError('Invitation not found.')
  }
  if (invitation.status !== GroupInvitationStatus.PENDING) {
    throw new InvitationError('Only pending invitations can be updated.')
  }
  return invitation
}

async function loadGroupName(groupId: string): Promise<string | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true },
  })
  return group?.name ?? null
}

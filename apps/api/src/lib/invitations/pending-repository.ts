import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
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
import type { InvitationWriteContext } from './effects/dependencies'
import {
  InviteForbiddenError,
  InviteLinkEndedError,
  InviteNotFoundError,
  endedReasonOf,
  isSharedLinkRow,
  validateSharedLinkLimits,
} from './effects/domain'
import { InvitationError } from './effects/errors'
import {
  assertNoConflictingEmailInvitation,
  assertNotExistingMember,
  assertNotInvitingSelf,
  sendInvitationEmail,
} from './email-invitations'
import {
  LINK_INVITATION_DEFAULT_TTL_MS,
  QR_INVITATION_DEFAULT_TTL_MS,
} from './link-repository'

export type PendingInvitationDelivery =
  | { type: 'EMAIL'; email: string }
  | { type: 'LINK' }

export type UpdatePendingInvitationInput = {
  invitationId: string
  groupId: string
  role: GroupRole
  temporaryName?: string | null
  delivery: PendingInvitationDelivery
  /**
   * Shared-link edits: label, join cap, and expiry (as a fresh duration from
   * save time). Only meaningful when the row is a shared link and the delivery
   * stays LINK. Kind (one-time ↔ shared) and role are locked.
   */
  shared?: {
    label?: string | null
    maxUses?: number | null
    ttlMs?: number | null
  }
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
    isMultiUse: boolean
    linkToken: string | null
    useCount: number
    maxUses: number | null
    label: string | null
    updatedAt: Date
  }
  /** One-time shareable URL, returned only for `EMAIL -> LINK` conversions. */
  inviteUrl: string | null
  /** Whether the invitation email must be (re)sent to the new recipient. */
  shouldSendEmail: boolean
  /**
   * True when the (re)send was delivered, or when no send was attempted
   * (metadata-only save). False when a send was attempted but skipped (SMTP
   * unconfigured) or failed — the DB row is still the source of truth.
   */
  emailDelivered: boolean
}

export type GetSharedLinkUrlResult = {
  inviteUrl: string
  expiresAt: Date | null
  useCount: number
  maxUses: number | null
  label: string | null
}

/**
 * Copy-anytime reader for shared links: the only place that turns a stored
 * plaintext token into a shareable URL. Any active group member may call it;
 * the pending list never carries the token, so this dedicated read is the sole
 * token surface beside creation and rotation. The Effect operation facade
 * supplies time and classifies its failures.
 */
export async function getSharedLinkUrl(
  args: {
    groupId: string
    invitationId: string
    accountId: string
  },
  now: () => Date,
): Promise<GetSharedLinkUrlResult> {
  const group = await prisma.group.findUnique({
    where: { id: args.groupId },
    select: { id: true, archived: true },
  })
  if (!group) {
    throw new InviteNotFoundError({
      message: 'Group not found',
    })
  }
  if (group.archived) {
    throw new InviteForbiddenError({
      message: 'Archived groups cannot share invitations',
    })
  }
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_accountId: { groupId: args.groupId, accountId: args.accountId },
    },
    select: { status: true },
  })
  if (!membership || membership.status !== GroupMemberStatus.ACTIVE) {
    // Same NOT_FOUND as a missing link: no oracle for whether the group,
    // the membership, or the link failed.
    throw new InviteNotFoundError({
      message: 'Shared link not found',
    })
  }
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: args.invitationId },
    select: {
      groupId: true,
      type: true,
      status: true,
      isMultiUse: true,
      linkToken: true,
      expiresAt: true,
      useCount: true,
      maxUses: true,
      label: true,
    },
  })
  if (
    !invitation ||
    invitation.groupId !== args.groupId ||
    invitation.type !== GroupInvitationType.LINK ||
    !isSharedLinkRow(invitation) ||
    invitation.status !== GroupInvitationStatus.PENDING
  ) {
    // Deliberately one NOT_FOUND for every dead case (missing link,
    // one-time link, QR session, revoked link): the caller learns nothing
    // about which secret exists.
    throw new InviteNotFoundError({
      message: 'Shared link not found',
    })
  }
  // Liveness through the single shared helper, not inline comparisons.
  const ended = endedReasonOf(
    {
      status: invitation.status,
      isMultiUse: true,
      expiresAt: invitation.expiresAt,
      useCount: invitation.useCount,
      maxUses: invitation.maxUses,
    },
    now(),
  )
  if (ended !== null) {
    throw new InviteLinkEndedError({
      reason: ended,
      isShared: true,
    })
  }
  if (!invitation.linkToken) {
    throw new InviteNotFoundError({
      message: 'Shared link not found',
    })
  }
  return {
    inviteUrl: `${getWebBaseUrl()}/groups/${args.groupId}?invite=${invitation.linkToken}`,
    expiresAt: invitation.expiresAt,
    useCount: invitation.useCount,
    maxUses: invitation.maxUses,
    label: invitation.label,
  }
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
  context: InvitationWriteContext,
): Promise<UpdatePendingInvitationResult> {
  const now = context.now
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

  // Shared links are multi-use LINK rows with a stored plaintext token.
  // QR sessions have no stored token and retain their separate policy.
  const isSharedRow = isSharedLinkRow({
    isMultiUse:
      invitation.type === GroupInvitationType.LINK && invitation.isMultiUse,
    linkToken: invitation.linkToken,
  })

  // Shared links live entirely in the LINK world: they cannot switch
  // delivery (a shared link has no named recipient to email) and their role
  // is locked to MEMBER. Per-link kind conversion is revoke + create.
  if (isSharedRow) {
    if (isEmailDelivery) {
      throw new InvitationError(
        'Shared links cannot be converted to email invitations. Revoke this link and invite by email instead.',
      )
    }
    if (opts.role !== 'MEMBER') {
      throw new InvitationError(
        'Shared links always join as members. To invite an admin, use email or a one-time link.',
      )
    }
  }

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
    matchedAccount = await prisma.user.findFirst({
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
    newToken = context.credential.token
    newTokenHash = context.credential.tokenHash
    newPlaceholderEmail = buildLinkPlaceholderEmail(newToken)
    newExpiresAt = new Date(now().getTime() + LINK_INVITATION_DEFAULT_TTL_MS)
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

  // Shared-link limit/label edits. `ttlMs` is a fresh duration from save
  // time — the resulting absolute date is shown before confirming.
  //
  // Every field is present-or-absent: `undefined` means "no change" and must
  // never clear anything, an explicit value (possibly `null`) means "set
  // it". A metadata-only save (`shared: undefined`, or `shared: {}`) leaves
  // the link's limits and expiry untouched.
  let sharedLabel: string | null | undefined
  let sharedMaxUses: number | null | undefined
  let sharedExpiresAt: Date | null | undefined
  if (isSharedRow && opts.shared !== undefined) {
    const shared = opts.shared
    if (shared.label !== undefined) {
      const label = shared.label?.trim() || null
      const validated = validateSharedLinkLimits({ label })
      if (validated.label !== invitation.label) {
        changes.push({
          field: 'label',
          before: invitation.label,
          after: validated.label,
        })
        sharedLabel = validated.label
      }
    }
    if (shared.maxUses !== undefined) {
      const validated = validateSharedLinkLimits({ maxUses: shared.maxUses })
      if (validated.maxUses !== invitation.maxUses) {
        changes.push({
          field: 'maxUses',
          before:
            invitation.maxUses == null
              ? 'unlimited'
              : String(invitation.maxUses),
          after:
            validated.maxUses == null ? 'unlimited' : String(validated.maxUses),
        })
        sharedMaxUses = validated.maxUses
      }
    }
    if (shared.ttlMs !== undefined) {
      const validated = validateSharedLinkLimits({ ttlMs: shared.ttlMs })
      const newExpiresAt =
        validated.ttlMs == null
          ? null
          : new Date(now().getTime() + validated.ttlMs)
      const before = invitation.expiresAt?.getTime() ?? null
      const after = newExpiresAt?.getTime() ?? null
      if (before !== after) {
        changes.push({
          field: 'expiry',
          before: invitation.expiresAt?.toISOString() ?? null,
          after: newExpiresAt?.toISOString() ?? null,
        })
        sharedExpiresAt = newExpiresAt
      }
    }
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
        // A converted row is a personal email invite; drop QR session flags.
        data.isMultiUse = false
      }
    } else {
      if (switchingToLink) {
        data.type = GroupInvitationType.LINK
        data.email = newPlaceholderEmail
        data.tokenHash = newTokenHash
        data.expiresAt = newExpiresAt
      }
      if (isSharedRow) {
        // Shared-link limit edits stay on the same credential.
        if (sharedLabel !== undefined) data.label = sharedLabel
        if (sharedMaxUses !== undefined) data.maxUses = sharedMaxUses
        if (sharedExpiresAt !== undefined) data.expiresAt = sharedExpiresAt
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
              label: sharedLabel === undefined ? invitation.label : sharedLabel,
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
      ? `${getWebBaseUrl()}/groups/${updated.groupId}?invite=${newToken}`
      : null

  // Only notify the new recipient when the destination actually changed or
  // the delivery switched to EMAIL; metadata-only saves must not resend.
  // Existing-account recipients get the existing-user template (no
  // "you will appear as" line, no temporary name in the subject) — they are
  // notified by email just like new users, matching the create path.
  const shouldSendEmail =
    isEmailDelivery && (destinationChanged || switchingToEmail)

  const emailDelivered = shouldSendEmail
    ? await sendInvitationEmail({
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
    : true

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
      isMultiUse: updated.isMultiUse,
      linkToken: updated.linkToken,
      useCount: updated.useCount,
      maxUses: updated.maxUses,
      label: updated.label,
      updatedAt: updated.updatedAt,
    },
    inviteUrl,
    shouldSendEmail,
    emailDelivered,
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
    isMultiUse: boolean
    linkToken: string | null
    useCount: number
    maxUses: number | null
    label: string | null
    updatedAt: Date
  }
  inviteUrl: string
}

/**
 * Atomically rotate a link invitation's credential: the old URL stops working
 * the moment the new hash is written. The invitation row, ledger participant,
 * expenses, balances, and subgroup links are untouched.
 *
 * Rotation preserves the link's identity: join count, expiry, label, and limits
 * stay as they are — only the secret changes (QR sessions are the exception:
 * rotating one starts a fresh room with a fresh short TTL and a reset join
 * counter). Rotating a full or expired link does not revive it.
 */
export async function regenerateLinkInvitation(
  opts: RegenerateLinkInvitationInput & {
    actorAccountId: string
  },
  context: InvitationWriteContext,
): Promise<RegenerateLinkInvitationResult> {
  const now = context.now
  const invitation = await loadPendingInvitation(
    opts.invitationId,
    opts.groupId,
  )
  if (invitation.type !== GroupInvitationType.LINK) {
    throw new InvitationError('Only link invitations can generate a new link.')
  }
  const isShared = isSharedLinkRow(invitation)

  const { token, tokenHash } = context.credential
  // Rotating a QR session must not silently promote it to a 30-day
  // multi-use link — keep the short nearby-session TTL.
  const expiresAt = isShared
    ? invitation.expiresAt
    : new Date(
        now().getTime() +
          (invitation.isMultiUse
            ? QR_INVITATION_DEFAULT_TTL_MS
            : LINK_INVITATION_DEFAULT_TTL_MS),
      )

  const boss = await getApiBoss()
  const updated = await prisma.$transaction(async (tx) => {
    // Rotating a QR session starts a fresh room: reset the join counter so
    // the new code does not inherit the old code's joins (joiner history
    // stays keyed by invitation id in the activity log). Single-use links
    // keep the email==token invariant by refreshing the placeholder.
    // Shared links rotate the credential only: count, expiry, label, and
    // limits describe the logical link, not the secret — but the stored
    // plaintext must rotate with the hash so copy-anytime serves the new
    // URL.
    const flipped = await tx.groupInvitation.updateMany({
      where: {
        id: opts.invitationId,
        groupId: opts.groupId,
        status: GroupInvitationStatus.PENDING,
      },
      data: {
        tokenHash,
        ...(isShared ? {} : { expiresAt }),
        ...(isShared
          ? { linkToken: token }
          : invitation.isMultiUse
            ? { useCount: 0 }
            : { email: buildLinkPlaceholderEmail(token) }),
      },
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
      isMultiUse: updated.isMultiUse,
      linkToken: updated.linkToken,
      useCount: updated.useCount,
      maxUses: updated.maxUses,
      label: updated.label,
      updatedAt: updated.updatedAt,
    },
    inviteUrl: `${getWebBaseUrl()}/groups/${opts.groupId}?invite=${token}`,
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

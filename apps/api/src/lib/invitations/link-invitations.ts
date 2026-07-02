import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  prisma,
  type GroupRole,
} from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import {
  buildInvitationActivityData,
  logActivity,
} from '../api/activities'
import { buildLinkPlaceholderEmail, getInvitationDisplayName } from './display'
import { reconcileMemberLedgerParticipant } from './ledger-reconciliation'

export class InvitationError extends TRPCError {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message })
  }
}

/** Default expiry for link invitations. 30 days. */
export const LINK_INVITATION_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Generate a high-entropy, URL-safe raw token for a new link invitation. */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/** SHA-256 hash of a link token. */
export async function hashLinkToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function resolveLinkExpiresAt(expiresAt: Date | null | undefined): Date {
  if (expiresAt) return expiresAt
  return new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS)
}

export type CreateLinkInvitationInput = {
  groupId: string
  role: GroupRole
  inviterAccountId: string
  temporaryName?: string | null
  expiresAt?: Date | null
  ledgerParticipantId?: string | null
}

export type CreateLinkInvitationResult = {
  invitation: {
    id: string
    groupId: string
    role: GroupRole
    temporaryName: string | null
    expiresAt: Date
  }
  token: string
  inviteUrl: string
}

/**
 * Create a link invitation.
 */
export async function createLinkInvitation(
  input: CreateLinkInvitationInput,
): Promise<CreateLinkInvitationResult> {
  const token = generateLinkToken()
  const tokenHash = await hashLinkToken(token)
  const expiresAt = resolveLinkExpiresAt(input.expiresAt)
  const webBase = getWebBaseUrl()

  const invitation = await prisma.groupInvitation.create({
    data: {
      id: randomId(),
      type: GroupInvitationType.LINK,
      groupId: input.groupId,
      email: buildLinkPlaceholderEmail(token),
      role: input.role,
      temporaryName: input.temporaryName ?? null,
      invitedById: input.inviterAccountId,
      tokenHash,
      expiresAt,
      ...(input.ledgerParticipantId
        ? { ledgerParticipantId: input.ledgerParticipantId }
        : {}),
    },
  })

  await logActivity(invitation.groupId, {
    type: 'INVITATION_CREATED',
    actor: { type: 'ACCOUNT', id: input.inviterAccountId },
    subject: { type: 'INVITATION', id: invitation.id },
    data: buildInvitationActivityData({
      displayLabel: getInvitationDisplayName(invitation),
      invitationType: 'LINK',
      role: input.role,
    }),
  })

  return {
    invitation: {
      id: invitation.id,
      groupId: invitation.groupId,
      role: invitation.role,
      temporaryName: invitation.temporaryName,
      expiresAt: invitation.expiresAt!,
    },
    token,
    inviteUrl: `${webBase}/groups/${invitation.groupId}?invite=${token}`,
  }
}

export type LinkInvitationPreview = {
  group: { id: string; name: string }
  inviter: { name: string }
  temporaryName: string | null
  role: GroupRole
  usable: boolean
  reason: 'revoked' | 'declined' | 'accepted' | 'expired' | 'unknown' | null
  expiresAt: Date | null
}

/**
 * Public-safe preview of a link invitation, looked up by the raw token.
 */
export async function getLinkInvitationPreview(
  token: string,
): Promise<LinkInvitationPreview | null> {
  const tokenHash = await hashLinkToken(token)
  const invitation = await prisma.groupInvitation.findFirst({
    where: { tokenHash },
    include: {
      group: { select: { id: true, name: true } },
      invitedBy: { select: { name: true } },
    },
  })
  if (!invitation) return null

  let reason: LinkInvitationPreview['reason'] = null
  let usable = invitation.status === GroupInvitationStatus.PENDING
  if (!usable) {
    if (invitation.status === GroupInvitationStatus.REVOKED) reason = 'revoked'
    else if (invitation.status === GroupInvitationStatus.DECLINED)
      reason = 'declined'
    else if (invitation.status === GroupInvitationStatus.ACCEPTED)
      reason = 'accepted'
    else reason = 'unknown'
  } else if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    usable = false
    reason = 'expired'
  }

  return {
    group: { id: invitation.group.id, name: invitation.group.name },
    inviter: { name: invitation.invitedBy?.name ?? '' },
    temporaryName: invitation.temporaryName,
    role: invitation.role,
    usable,
    reason,
    expiresAt: invitation.expiresAt ?? null,
  }
}

/**
 * Accept a link invitation for the current account.
 */
export async function acceptLinkInvitation(opts: {
  token: string
  accountId: string
}) {
  const tokenHash = await hashLinkToken(opts.token)

  const preview = await getLinkInvitationPreview(opts.token)
  if (!preview) {
    throw new InvitationError('Invitation not found.')
  }
  if (!preview.usable) {
    const reason =
      preview.reason === 'expired'
        ? 'This invitation link has expired.'
        : preview.reason === 'revoked'
          ? 'This invitation link was revoked by an admin.'
          : preview.reason === 'declined'
            ? 'This invitation link was declined.'
            : preview.reason === 'accepted'
              ? 'This invitation link has already been used.'
              : 'This invitation link is no longer valid.'
    throw new InvitationError(reason)
  }

  const existingMember = await prisma.groupMember.findFirst({
    where: {
      groupId: preview.group.id,
      accountId: opts.accountId,
      status: GroupMemberStatus.ACTIVE,
    },
    select: { id: true },
  })
  if (existingMember) {
    throw new InvitationError(
      'You are already a member of this group. Open the group from your list instead.',
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const flipped = await tx.groupInvitation.updateMany({
      where: {
        tokenHash,
        status: GroupInvitationStatus.PENDING,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: {
        status: GroupInvitationStatus.ACCEPTED,
        acceptedById: opts.accountId,
        acceptedAt: new Date(),
      },
    })
    if (flipped.count === 0) {
      throw new InvitationError('This invitation link is no longer valid.')
    }

    const invitation = await tx.groupInvitation.findUnique({
      where: { tokenHash },
      include: { group: { include: { ledger: true } } },
    })
    if (!invitation || !invitation.group.ledger) {
      throw new InvitationError('Invitation is missing its group ledger.')
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
      ledgerId: invitation.group.ledger.id,
      pendingParticipantId: invitation.ledgerParticipantId,
    })

    await logActivity(
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

    return { groupId: invitation.groupId, role: invitation.role }
  })

  return result
}

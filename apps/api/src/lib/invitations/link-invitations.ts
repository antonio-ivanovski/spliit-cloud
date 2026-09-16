import { TRPCError } from '@trpc/server'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupType,
  Prisma,
  prisma,
  type GroupRole,
  type Prisma as PrismaTypes,
} from '@spliit/db'
import type { SpliitBoss } from '@spliit/jobs'

import {
  buildInvitationActivityData,
  logActivity,
  planNotificationForActivity,
} from '../api/activities'
import { getApiBoss } from '../api/boss'
import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { FixedWindowLimiter, logRateLimitExceeded } from '../rate-limit'
import {
  buildLinkPlaceholderEmail,
  buildQrSessionPlaceholderEmail,
  getInvitationDisplayName,
} from './display'
import { findPendingEmailInvitation } from './email-invitations'
import {
  materializePendingInvitationParticipant,
  reconcileMemberLedgerParticipant,
} from './ledger-reconciliation'

export class InvitationError extends TRPCError {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message })
  }
}

class DuplicateFriendLedgerError extends Error {
  constructor(
    readonly invitationId: string,
    readonly groupId: string,
    readonly pairKey: string,
  ) {
    super('Duplicate friend ledger')
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  )
}

async function removeDuplicateFriendLinkInvitation(
  err: DuplicateFriendLedgerError,
): Promise<void> {
  await prisma.group
    .delete({ where: { id: err.groupId } })
    .catch(async (deleteErr) => {
      await prisma.groupInvitation
        .delete({ where: { id: err.invitationId } })
        .catch(() => {})
      console.warn(
        `[friends] failed to remove duplicate friend link group ${err.groupId} for pair ${err.pairKey}.`,
        deleteErr,
      )
    })
}

/** Default expiry for link invitations. 30 days. */
export const LINK_INVITATION_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Default expiry for multi-use QR / nearby session invitations. 15 min. */
export const QR_INVITATION_DEFAULT_TTL_MS = 15 * 60 * 1000

/**
 * Max joins per QR session. Bounds the blast radius of a forwarded screenshot:
 * the atomic accept gate rejects further joins once reached, and liveness
 * checks treat a full session as dead so the host can start a new one.
 */
export const QR_SESSION_MAX_USES = 30

/** Generate a high-entropy, URL-safe raw token for a new link invitation. */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
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
  notificationBoss?: SpliitBoss | null
  token?: string
  tx?: PrismaTypes.TransactionClient
  /**
   * Multi-use QR / nearby session: the invitation stays PENDING across accepts
   * (until expiry/revoke). Each accepter gets a fresh ledger participant and no
   * pre-accept participant is materialized.
   */
  isMultiUse?: boolean
}

export type CreateLinkInvitationResult = {
  invitation: {
    id: string
    groupId: string
    role: GroupRole
    temporaryName: string | null
    expiresAt: Date
    isMultiUse: boolean
    useCount: number
  }
  token: string
  inviteUrl: string
}

/** Create a link invitation. */
export async function createLinkInvitation(
  input: CreateLinkInvitationInput,
): Promise<CreateLinkInvitationResult> {
  const token = input.token ?? generateLinkToken()
  const tokenHash = await hashLinkToken(token)
  const expiresAt = resolveLinkExpiresAt(input.expiresAt)
  const webBase = getWebBaseUrl()
  const boss =
    input.notificationBoss !== undefined
      ? input.notificationBoss
      : await getApiBoss()

  const run = async (tx: PrismaTypes.TransactionClient) => {
    // Multi-use QR sessions have no named invitee, so there is nothing to
    // attribute pre-accept expenses to — each accepter gets a fresh
    // participant at accept time instead.
    const participantId = input.isMultiUse
      ? null
      : await materializePendingInvitationParticipant(tx, {
          groupId: input.groupId,
          suppliedParticipantId: input.ledgerParticipantId,
          displayName: input.temporaryName,
        })

    const inv = await tx.groupInvitation.create({
      data: {
        id: randomId(),
        type: GroupInvitationType.LINK,
        groupId: input.groupId,
        // Multi-use QR sessions are listed to every group member, so the
        // placeholder must be random — never the credential (see
        // buildQrSessionPlaceholderEmail).
        email: input.isMultiUse
          ? buildQrSessionPlaceholderEmail(randomId())
          : buildLinkPlaceholderEmail(token),
        role: input.role,
        temporaryName: input.temporaryName ?? null,
        invitedById: input.inviterAccountId,
        tokenHash,
        expiresAt,
        ledgerParticipantId: participantId,
        isMultiUse: input.isMultiUse ?? false,
        useCount: 0,
      },
    })

    const activity = await logActivity(
      inv.groupId,
      {
        type: 'INVITATION_CREATED',
        actor: { type: 'ACCOUNT', id: input.inviterAccountId },
        subject: { type: 'INVITATION', id: inv.id },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(inv),
          invitationType: 'LINK',
          role: input.role,
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    return inv
  }
  const invitation = input.tx
    ? await run(input.tx)
    : await prisma.$transaction(run)
  return {
    invitation: {
      id: invitation.id,
      groupId: invitation.groupId,
      role: invitation.role,
      temporaryName: invitation.temporaryName,
      expiresAt: invitation.expiresAt!,
      isMultiUse: invitation.isMultiUse,
      useCount: invitation.useCount,
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
  isMultiUse: boolean
  useCount: number
}

/** Public-safe preview of a link invitation, looked up by the raw token. */
export async function getLinkInvitationPreview(
  token: string,
): Promise<LinkInvitationPreview | null> {
  const tokenHash = await hashLinkToken(token)
  return getLinkInvitationPreviewByHash(tokenHash)
}

async function getLinkInvitationPreviewByHash(
  tokenHash: string,
): Promise<LinkInvitationPreview | null> {
  const invitation = await prisma.groupInvitation.findFirst({
    where: { tokenHash },
    select: {
      status: true,
      expiresAt: true,
      temporaryName: true,
      role: true,
      isMultiUse: true,
      useCount: true,
      group: { select: { id: true, name: true, groupType: true } },
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

  const inviterName = invitation.invitedBy?.name ?? ''
  const groupName =
    invitation.group.groupType === GroupType.FRIEND
      ? `Friend ledger with ${inviterName || 'someone'}`
      : invitation.group.name

  return {
    group: { id: invitation.group.id, name: groupName },
    inviter: { name: inviterName },
    temporaryName: invitation.temporaryName,
    role: invitation.role,
    usable,
    reason,
    expiresAt: invitation.expiresAt ?? null,
    isMultiUse: invitation.isMultiUse,
    useCount: invitation.useCount,
  }
}

/** Accept a link invitation for the current account. */
export async function acceptLinkInvitation(
  opts: {
    accountId: string
  } & ({ token: string } | { tokenHash: string }),
) {
  const tokenHash =
    'tokenHash' in opts ? opts.tokenHash : await hashLinkToken(opts.token)
  const preview = await getLinkInvitationPreviewByHash(tokenHash)
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

  // A pending EMAIL invitation for the account's email takes
  // precedence over the link: redeeming the link would join through
  // the wrong invitation (and its ledger participant), orphaning the
  // email invite. The email invitation is the recipient-specific
  // intent, so surface it instead of accepting via the link.
  const account = await prisma.account.findUnique({
    where: { id: opts.accountId },
    select: { email: true },
  })
  if (account?.email) {
    const pendingEmailInvitation = await findPendingEmailInvitation(
      preview.group.id,
      account.email,
    )
    if (pendingEmailInvitation) {
      throw new InvitationError(
        'You already have a personal email invitation to this group. Open it from your invitations instead of using this link.',
      )
    }
  }

  // Multi-use QR sessions branch off here: usability was already gated by
  // the preview above, and the multi-use accept re-gates atomically inside
  // its transaction.
  if (preview.isMultiUse) {
    return acceptMultiUseLinkInvitation({
      accountId: opts.accountId,
      tokenHash,
    })
  }

  const boss = await getApiBoss()
  const result = await prisma
    .$transaction(async (tx) => {
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
        select: {
          id: true,
          groupId: true,
          role: true,
          invitedById: true,
          email: true,
          temporaryName: true,
          ledgerParticipantId: true,
          group: {
            select: {
              groupType: true,
              ledger: { select: { id: true } },
            },
          },
        },
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
        select: { id: true },
      })

      if (invitation.group.groupType === GroupType.FRIEND) {
        const pairKey = [opts.accountId, invitation.invitedById]
          .sort()
          .join(':')
        try {
          await tx.group.update({
            where: { id: invitation.groupId },
            data: { friendPairKey: pairKey },
          })
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new DuplicateFriendLedgerError(
              invitation.id,
              invitation.groupId,
              pairKey,
            )
          }
          throw err
        }
      }

      await reconcileMemberLedgerParticipant(tx, {
        memberId: member.id,
        ledgerId: invitation.group.ledger.id,
        pendingParticipantId: invitation.ledgerParticipantId,
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

      return {
        groupId: invitation.groupId,
        role: invitation.role,
        invitationId: invitation.id,
        activity,
      }
    })
    .catch(async (err) => {
      if (err instanceof DuplicateFriendLedgerError) {
        console.warn(
          `[friends] duplicate friend ledger detected while accepting link invitation ${err.invitationId}; removing stale group ${err.groupId}.`,
          err,
        )
        await removeDuplicateFriendLinkInvitation(err)
        throw new InvitationError('A friend ledger already exists.')
      }
      throw err
    })

  return { groupId: result.groupId, role: result.role }
}

/**
 * Per-group join velocity brake for QR sessions (process-local best effort,
 * like the other FixedWindowLimiters). Bounds how fast a forwarded code can
 * convert into joins; the lifetime cap is enforced atomically in the accept
 * gate below.
 */
const qrAcceptVelocityLimiter = new FixedWindowLimiter({
  limit: 30,
  windowMs: 5 * 60 * 1000,
})

/**
 * Accept a multi-use QR / nearby session invitation. Unlike single-use links,
 * the invitation stays PENDING (until expiry/revoke) so any number of accounts
 * can join with the same token. Each joiner gets a fresh ledger participant —
 * the invitation carries no shared pending participant to steal — and the join
 * is counted in `useCount`.
 */
async function acceptMultiUseLinkInvitation(opts: {
  accountId: string
  tokenHash: string
}) {
  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    // Conditional increment doubles as the usability gate: a revoked,
    // expired, or already-full invitation flips zero rows and the join is
    // rejected below.
    const claimed = await tx.groupInvitation.updateMany({
      where: {
        tokenHash: opts.tokenHash,
        status: GroupInvitationStatus.PENDING,
        isMultiUse: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        useCount: { lt: QR_SESSION_MAX_USES },
      },
      data: { useCount: { increment: 1 } },
    })
    if (claimed.count === 0) {
      // Distinguish a full room from a dead code so guests get actionable
      // feedback instead of a generic "no longer valid".
      const existing = await tx.groupInvitation.findUnique({
        where: { tokenHash: opts.tokenHash },
        select: {
          status: true,
          isMultiUse: true,
          expiresAt: true,
          useCount: true,
        },
      })
      if (
        existing?.isMultiUse &&
        existing.status === GroupInvitationStatus.PENDING &&
        (!existing.expiresAt || existing.expiresAt > new Date()) &&
        existing.useCount >= QR_SESSION_MAX_USES
      ) {
        throw new InvitationError(
          'This QR session is full. Ask the host to show a new code.',
        )
      }
      throw new InvitationError('This invitation link is no longer valid.')
    }

    const invitation = await tx.groupInvitation.findUnique({
      where: { tokenHash: opts.tokenHash },
      select: {
        id: true,
        groupId: true,
        role: true,
        invitedById: true,
        email: true,
        temporaryName: true,
        group: {
          select: {
            groupType: true,
            ledger: { select: { id: true } },
          },
        },
      },
    })
    if (!invitation || !invitation.group.ledger) {
      throw new InvitationError('Invitation is missing its group ledger.')
    }
    if (invitation.group.groupType === GroupType.FRIEND) {
      throw new InvitationError(
        'QR invitations are not supported for friend ledgers.',
      )
    }

    const velocity = qrAcceptVelocityLimiter.hit(
      `qr-accept:${invitation.groupId}`,
    )
    if (!velocity.allowed) {
      logRateLimitExceeded({
        policy: 'qr-accept',
        identity: `qr-accept:${invitation.groupId}`,
        retryAfterSeconds: velocity.retryAfterSeconds,
        path: 'invitations.acceptLink',
      })
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many joins at once. Please try again shortly.',
      })
    }

    // Re-check membership inside the transaction: the increment above
    // serializes concurrent accepts on the invitation row, so a racing
    // double-accept by the same account is visible here. Throwing rolls
    // back the increment — no phantom useCount or activity rows.
    const reentrantMember = await tx.groupMember.findFirst({
      where: {
        groupId: invitation.groupId,
        accountId: opts.accountId,
        status: GroupMemberStatus.ACTIVE,
      },
      select: { id: true },
    })
    if (reentrantMember) {
      throw new InvitationError(
        'You are already a member of this group. Open the group from your list instead.',
      )
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
      select: { id: true },
    })

    await reconcileMemberLedgerParticipant(tx, {
      memberId: member.id,
      ledgerId: invitation.group.ledger.id,
      pendingParticipantId: null,
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

    return { groupId: invitation.groupId, role: invitation.role }
  })

  return { groupId: result.groupId, role: result.role }
}

export type QrSessionJoiner = {
  accountId: string
  name: string | null
  image: string | null
  joinedAt: Date
}

/** Max joiners reported per QR session. */
export const QR_SESSION_JOINERS_LIMIT = 20

/**
 * Resolve who joined via the given multi-use QR sessions, oldest first. Source
 * of truth is the INVITATION_ACCEPTED activity log (one row per accept, subject
 * = the invitation), not member `joinedAt` — a member may join through several
 * channels over their lifetime.
 */
export async function listQrSessionJoiners(
  invitationIds: string[],
): Promise<Map<string, QrSessionJoiner[]>> {
  const result = new Map<string, QrSessionJoiner[]>()
  for (const id of invitationIds) result.set(id, [])
  if (invitationIds.length === 0) return result
  const activities = await prisma.activity.findMany({
    where: {
      type: 'INVITATION_ACCEPTED',
      subjectType: 'INVITATION',
      subjectId: { in: invitationIds },
      actorType: 'ACCOUNT',
      actorId: { not: null },
    },
    orderBy: [{ time: 'asc' }],
    select: { subjectId: true, actorId: true, time: true },
  })
  if (activities.length === 0) return result
  const accountIds = [...new Set(activities.map((a) => a.actorId!))]
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true, image: true },
  })
  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const activity of activities) {
    const account = byId.get(activity.actorId!)
    // Skip deleted accounts; dedupe rejoins, keeping the first join.
    if (!account) continue
    const joiners = result.get(activity.subjectId!)!
    if (joiners.some((j) => j.accountId === account.id)) continue
    if (joiners.length >= QR_SESSION_JOINERS_LIMIT) continue
    joiners.push({
      accountId: account.id,
      name: account.name,
      image: account.image,
      joinedAt: activity.time,
    })
  }
  return result
}

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
import type {
  InvitationClock,
  InvitationWriteContext,
} from './effects/dependencies'
import {
  InvitationError,
  InviteAlreadyMemberError,
  InviteConflictError,
  InviteLinkEndedError,
  InviteNotFoundError,
  InviteRejoinBlockedError,
  InviteRateLimitedError,
  InviteDuplicateFriendLedgerError,
} from './effects/errors'
import { endedReasonOf, isSharedLinkRow } from './effects/liveness'
import { findPendingEmailInvitation } from './email-invitations'
import {
  materializePendingInvitationParticipant,
  reconcileMemberLedgerParticipant,
} from './ledger-reconciliation'

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
 *
 * New QR sessions persist this value as `maxUses` on the row (see
 * `createLinkInvitation`); the accept gate reads the row, never this constant.
 * Kept for the backfill default and for tests.
 */
export const QR_SESSION_MAX_USES = 30

function resolveLinkExpiresAt(
  expiresAt: Date | null | undefined,
  now: () => Date,
): Date {
  if (expiresAt) return expiresAt
  return new Date(now().getTime() + LINK_INVITATION_DEFAULT_TTL_MS)
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
  /**
   * General-purpose shared (multi-person) link: like a QR session but
   * long-lived, labelled, and retrievable for copying by any group member.
   * Implies `isMultiUse`. Forces MEMBER role, no pending participant, and
   * stores the raw token (`linkToken`) so members can copy the URL later.
   *
   * These invariants are enforced at the lib layer (not only at the router), so
   * a future caller cannot mint an admin-granting forwardable link.
   */
  isShared?: boolean
  /** Member-facing label for a shared link (≤40 chars). */
  label?: string | null
  /** Per-link join cap for a shared link (`null` = unlimited). */
  maxUses?: number | null
}

export type CreateLinkInvitationResult = {
  invitation: {
    id: string
    groupId: string
    role: GroupRole
    temporaryName: string | null
    expiresAt: Date | null
    isMultiUse: boolean
    useCount: number
    maxUses: number | null
    label: string | null
    isShared: boolean
  }
  token: string
  inviteUrl: string
}

/** Create a link invitation. */
export async function createLinkInvitation(
  input: CreateLinkInvitationInput,
  context: InvitationWriteContext,
): Promise<CreateLinkInvitationResult> {
  const { token, tokenHash } = context.credential
  const isSharedInput = input.isShared === true
  // Shared links resolve their own expiry (null = never expires); every
  // other link kind falls back to the 30-day default.
  const expiresAt = isSharedInput
    ? (input.expiresAt ?? null)
    : resolveLinkExpiresAt(input.expiresAt, context.now)
  const webBase = getWebBaseUrl()
  const boss =
    input.notificationBoss !== undefined
      ? input.notificationBoss
      : await getApiBoss()

  const run = async (tx: PrismaTypes.TransactionClient) => {
    // Shared links and QR sessions have no named invitee, so there is nothing
    // to attribute pre-accept expenses to — each accepter gets a fresh
    // participant at accept time instead.
    const participantId =
      input.isMultiUse || isSharedInput
        ? null
        : await materializePendingInvitationParticipant(tx, {
            groupId: input.groupId,
            suppliedParticipantId: input.ledgerParticipantId,
            displayName: input.temporaryName,
          })

    const effectiveRole = isSharedInput ? 'MEMBER' : input.role
    const effectiveMultiUse = isSharedInput || input.isMultiUse === true
    const effectiveTemporaryName = isSharedInput
      ? null
      : (input.temporaryName ?? null)

    const inv = await tx.groupInvitation.create({
      data: {
        id: randomId(),
        type: GroupInvitationType.LINK,
        groupId: input.groupId,
        // Multi-use rows are listed to every group member, so the placeholder
        // must be random — never the credential (see
        // buildQrSessionPlaceholderEmail). One-time links keep the
        // email==token invariant so rotation can refresh the placeholder.
        email:
          input.isMultiUse || isSharedInput
            ? buildQrSessionPlaceholderEmail(randomId())
            : buildLinkPlaceholderEmail(token),
        role: effectiveRole,
        temporaryName: effectiveTemporaryName,
        invitedById: input.inviterAccountId,
        tokenHash,
        expiresAt,
        ledgerParticipantId: participantId,
        isMultiUse: effectiveMultiUse,
        useCount: 0,
        // Shared links store the raw token so members can copy the URL
        // later via a dedicated endpoint. `tokenHash` stays the
        // accept/dedupe authority.
        ...(isSharedInput
          ? {
              maxUses: input.maxUses ?? null,
              label: input.label ?? null,
              linkToken: token,
            }
          : {
              maxUses: input.isMultiUse ? QR_SESSION_MAX_USES : null,
              label: null,
              linkToken: null,
            }),
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
          role: effectiveRole,
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
  const isSharedResult = isSharedLinkRow({
    isMultiUse: invitation.isMultiUse,
    linkToken: invitation.linkToken,
  })
  return {
    invitation: {
      id: invitation.id,
      groupId: invitation.groupId,
      role: invitation.role,
      temporaryName: invitation.temporaryName,
      expiresAt: invitation.expiresAt,
      isMultiUse: invitation.isMultiUse,
      useCount: invitation.useCount,
      maxUses: invitation.maxUses,
      label: invitation.label,
      isShared: isSharedResult,
    },
    token,
    inviteUrl: `${webBase}/groups/${invitation.groupId}?invite=${token}`,
  }
}

export type ShareMemberSample = {
  name: string | null
  image: string | null
}

export type LinkInvitationPreview = {
  group: {
    id: string
    name: string
    groupType: GroupType
    emoji: string | null
    color: string | null
    currencyCode: string | null
  }
  inviter: { name: string; image: string | null }
  temporaryName: string | null
  role: GroupRole
  usable: boolean
  reason:
    | 'revoked'
    | 'declined'
    | 'accepted'
    | 'expired'
    | 'full'
    | 'unknown'
    | null
  expiresAt: Date | null
  isMultiUse: boolean
  useCount: number
  maxUses: number | null
  /**
   * Whether the row is a copyable shared link. Public-safe boolean used to pick
   * the right full-cap message; the raw token never leaves the server through
   * this type.
   */
  isShared: boolean
  memberCount: number
  /** Earliest-joined active members (max 3), for social preview avatars. */
  memberSample: ShareMemberSample[]
}

export async function getLinkInvitationPreviewByHash(
  tokenHash: string,
  opts: { includeSharing?: boolean },
  now: () => Date,
): Promise<LinkInvitationPreview | null> {
  const invitation = await prisma.groupInvitation.findFirst({
    where: { tokenHash },
    select: {
      status: true,
      expiresAt: true,
      temporaryName: true,
      role: true,
      isMultiUse: true,
      linkToken: true,
      useCount: true,
      maxUses: true,
      group: {
        select: {
          id: true,
          name: true,
          groupType: true,
          emoji: true,
          color: true,
          ledger: { select: { currencyCode: true } },
        },
      },
      invitedBy: { select: { name: true, image: true } },
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
  } else {
    // Liveness is derived through the single shared helper, not inline
    // comparisons, so preview, list, copy, and the accept gate never
    // disagree. The row's `maxUses` is the cap; a missing (`null`) cap is
    // unlimited and can never report 'full'.
    const ended = endedReasonOf(
      {
        status: invitation.status,
        isMultiUse: invitation.isMultiUse,
        expiresAt: invitation.expiresAt,
        useCount: invitation.useCount,
        maxUses: invitation.maxUses,
      },
      now(),
    )
    if (ended !== null) {
      usable = false
      reason = ended
    }
  }

  const inviterName = invitation.invitedBy?.name ?? ''
  const groupName =
    invitation.group.groupType === GroupType.FRIEND
      ? `Friend ledger with ${inviterName || 'someone'}`
      : invitation.group.name

  // Sharing extras (member count + avatar sample) are only needed for social
  // previews of *usable* invitations, and only when the caller opts in. The
  // accept path and the public tRPC preview stay on the single invitation
  // read above so joins never pay for the two extra member queries — and dead
  // links (revoked/expired/used) expose no member data at all.
  let memberCount = 0
  let memberSample: ShareMemberSample[] = []
  if (opts.includeSharing && usable) {
    const [count, sample] = await Promise.all([
      Promise.resolve(
        prisma.groupMember.count({
          where: {
            groupId: invitation.group.id,
            status: GroupMemberStatus.ACTIVE,
          },
        }),
      ).catch(() => 0),
      Promise.resolve(
        prisma.groupMember.findMany({
          where: {
            groupId: invitation.group.id,
            status: GroupMemberStatus.ACTIVE,
          },
          select: { account: { select: { name: true, image: true } } },
          orderBy: { joinedAt: 'asc' },
          take: 3,
        }),
      ).catch(() => [] as []),
    ])
    memberCount = count ?? 0
    memberSample = (sample ?? []).map((member) => ({
      name: member.account?.name ?? null,
      image: member.account?.image ?? null,
    }))
  }

  return {
    group: {
      id: invitation.group.id,
      name: groupName,
      groupType: invitation.group.groupType,
      emoji: invitation.group.emoji ?? null,
      color: invitation.group.color ?? null,
      currencyCode: invitation.group.ledger?.currencyCode ?? null,
    },
    inviter: {
      name: inviterName,
      // The inviter's avatar is only needed for the social card of a live
      // invitation; dead links expose no personal data beyond the pre-existing
      // group/inviter names.
      image: usable ? (invitation.invitedBy?.image ?? null) : null,
    },
    temporaryName: invitation.temporaryName,
    role: invitation.role,
    usable,
    reason,
    expiresAt: invitation.expiresAt ?? null,
    isMultiUse: invitation.isMultiUse,
    useCount: invitation.useCount,
    maxUses: invitation.maxUses,
    // Whether the row is a copyable shared link. This boolean (never the
    // token) is all the public preview needs to pick the right full-cap
    // message; the raw token stays server-side.
    isShared: isSharedLinkRow({
      isMultiUse: invitation.isMultiUse,
      linkToken: invitation.linkToken,
    }),
    memberCount,
    memberSample,
  }
}

/** Accept a link invitation for the current account. */
export async function acceptLinkInvitation(
  opts: {
    accountId: string
    expectedGroupId?: string
    tokenHash: string
  },
  context: InvitationClock,
) {
  const now = context.now
  const tokenHash = opts.tokenHash
  const preview = await getLinkInvitationPreviewByHash(tokenHash, {}, now)
  if (
    !preview ||
    (opts.expectedGroupId !== undefined &&
      preview.group.id !== opts.expectedGroupId)
  ) {
    throw new InviteNotFoundError({ message: 'Invitation not found.' })
  }
  if (!preview.usable) {
    // A dead link reports which kind it is so the guest knows whether to ask
    // a member for a new link or the host for a new code. The message is the
    // single shared wording for dead links; the router maps the tagged
    // failure to `BAD_REQUEST` through the invite boundary.
    throw new InviteLinkEndedError({
      reason: preview.reason ?? 'unknown',
      isShared: preview.isShared,
    })
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
    throw new InviteAlreadyMemberError({
      message:
        'You are already a member of this group. Open the group from your list instead.',
    })
  }

  // A pending EMAIL invitation for the account's email takes
  // precedence over the link: redeeming the link would join through
  // the wrong invitation (and its ledger participant), orphaning the
  // email invite. The email invitation is the recipient-specific
  // intent, so surface it instead of accepting via the link.
  const account = await prisma.user.findUnique({
    where: { id: opts.accountId },
    select: { email: true },
  })
  if (account?.email) {
    const pendingEmailInvitation = await findPendingEmailInvitation(
      preview.group.id,
      account.email,
    )
    if (pendingEmailInvitation) {
      throw new InviteConflictError({
        message:
          'You already have a personal email invitation to this group. Open it from your invitations instead of using this link.',
      })
    }
  }

  // Multi-use QR sessions branch off here: usability was already gated by
  // the preview above, and the multi-use accept re-gates atomically inside
  // its transaction.
  if (preview.isMultiUse) {
    return acceptMultiUseLinkInvitation(
      {
        accountId: opts.accountId,
        tokenHash,
      },
      now,
    )
  }

  const boss = await getApiBoss()
  const result = await prisma
    .$transaction(async (tx) => {
      const flipped = await tx.groupInvitation.updateMany({
        where: {
          tokenHash,
          status: GroupInvitationStatus.PENDING,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
        },
        data: {
          status: GroupInvitationStatus.ACCEPTED,
          acceptedById: opts.accountId,
          acceptedAt: now(),
        },
      })
      if (flipped.count === 0) {
        throw new InviteLinkEndedError({ reason: 'unknown', isShared: false })
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
          label: true,
          expiresAt: true,
          linkToken: true,
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
        throw new InviteNotFoundError({
          message: 'Invitation is missing its group ledger.',
        })
      }

      if (invitation.expiresAt && invitation.expiresAt <= now()) {
        throw new InviteLinkEndedError({
          reason: 'expired',
          isShared: invitation.linkToken !== null,
        })
      }

      if (
        invitation.group.groupType === GroupType.FRIEND &&
        !invitation.invitedById
      ) {
        // The inviter's account was deleted (pending invites are revoked on
        // deletion, but a concurrent accept can slip through). Without the
        // inviter the friend pair key cannot be built.
        throw new InviteLinkEndedError({ reason: 'unknown', isShared: false })
      }

      const previousMember = await tx.groupMember.findUnique({
        where: {
          groupId_accountId: {
            groupId: invitation.groupId,
            accountId: opts.accountId,
          },
        },
        select: { status: true },
      })
      if (
        previousMember?.status === GroupMemberStatus.REMOVED ||
        previousMember?.status === GroupMemberStatus.SUSPENDED
      ) {
        throw new InviteRejoinBlockedError({
          message:
            'You cannot rejoin this group with an invite link. Ask a group admin for help.',
        })
      }
      if (previousMember?.status === GroupMemberStatus.ACTIVE) {
        throw new InviteAlreadyMemberError({
          message:
            'You are already a member of this group. Open the group from your list instead.',
        })
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
        select: { id: true },
      })

      if (invitation.group.groupType === GroupType.FRIEND) {
        const pairKey = [opts.accountId, invitation.invitedById]
          .sort((a, b) => {
            const left = a ?? ''
            const right = b ?? ''
            return left < right ? -1 : left > right ? 1 : 0
          })
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
        throw new InviteDuplicateFriendLedgerError({
          message: 'A friend ledger already exists.',
        })
      }
      throw err
    })

  return { groupId: result.groupId, role: result.role }
}

/**
 * Per-group join velocity brake for multi-use links (process-local best effort,
 * like the other FixedWindowLimiters). Bounds how fast a forwarded link can
 * convert into joins; the lifetime cap is enforced atomically in the accept
 * gate below.
 */
const multiUseAcceptVelocityLimiter = new FixedWindowLimiter({
  limit: 30,
  windowMs: 5 * 60 * 1000,
})

/**
 * Accept a multi-use link invitation (QR session or shared link). Unlike
 * single-use links, the invitation stays PENDING (until expiry / full / revoke)
 * so any number of accounts can join with the same token. Each joiner gets a
 * fresh ledger participant — the invitation carries no shared pending
 * participant to steal — and the join is counted in `useCount`.
 */
async function acceptMultiUseLinkInvitation(
  opts: {
    accountId: string
    tokenHash: string
  },
  now: () => Date,
) {
  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    // Compare against the row's current cap, including after a concurrent
    // editor releases its lock. A cap read before this write can be stale.
    const claimed = await tx.groupInvitation.updateMany({
      where: {
        tokenHash: opts.tokenHash,
        status: GroupInvitationStatus.PENDING,
        isMultiUse: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] },
          {
            OR: [
              { maxUses: null },
              { useCount: { lt: prisma.groupInvitation.fields.maxUses } },
            ],
          },
        ],
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
          maxUses: true,
          linkToken: true,
        },
      })
      if (
        existing?.isMultiUse &&
        existing.status === GroupInvitationStatus.PENDING &&
        (!existing.expiresAt || existing.expiresAt > now())
      ) {
        // `maxUses: null` means unlimited — the row's own value decides. A
        // *missing* row (deleted between the failed claim and this read) is
        // not a full room; it is a dead link.
        if (existing.maxUses != null && existing.useCount >= existing.maxUses) {
          throw new InviteLinkEndedError({
            reason: 'full',
            isShared: isSharedLinkRow({
              isMultiUse: existing.isMultiUse,
              linkToken: existing.linkToken,
            }),
          })
        }
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
        label: true,
        expiresAt: true,
        linkToken: true,
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
    if (invitation.expiresAt && invitation.expiresAt <= now()) {
      throw new InviteLinkEndedError({
        reason: 'expired',
        isShared: invitation.linkToken !== null,
      })
    }
    if (invitation.group.groupType === GroupType.FRIEND) {
      throw new InvitationError(
        'QR invitations are not supported for friend ledgers.',
      )
    }

    const velocity = multiUseAcceptVelocityLimiter.hit(
      `multi-use-accept:${invitation.groupId}`,
    )
    if (!velocity.allowed) {
      logRateLimitExceeded({
        policy: 'multi-use-accept',
        identity: `multi-use-accept:${invitation.groupId}`,
        retryAfterSeconds: velocity.retryAfterSeconds,
        path: 'invitations.acceptLink',
      })
      throw new InviteRateLimitedError({
        message: 'Too many joins at once. Please try again shortly.',
        retryAfterSeconds: velocity.retryAfterSeconds,
      })
    }

    // Re-check membership inside the transaction: the increment above
    // serializes concurrent accepts on the invitation row, so a racing
    // double-accept by the same account is visible here. Throwing rolls
    // back the increment — no phantom useCount or activity rows. A removed
    // or suspended member cannot bypass their removal through a live link;
    // a member who left may rejoin (consuming a use).
    const existingMembership = await tx.groupMember.findFirst({
      where: {
        groupId: invitation.groupId,
        accountId: opts.accountId,
      },
      select: { status: true },
    })
    if (existingMembership?.status === GroupMemberStatus.ACTIVE) {
      throw new InviteAlreadyMemberError({
        message:
          'You are already a member of this group. Open the group from your list instead.',
      })
    }
    if (
      existingMembership?.status === GroupMemberStatus.REMOVED ||
      existingMembership?.status === GroupMemberStatus.SUSPENDED
    ) {
      throw new InviteRejoinBlockedError({
        message:
          'You cannot rejoin this group with an invite link. Ask a group admin for help.',
      })
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
  const accounts = await prisma.user.findMany({
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

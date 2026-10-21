import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupType,
  prisma,
  type GroupRole,
} from '@spliit/db'

import { getApiBoss } from '../../../lib/api/boss'
import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  deriveCreateToken,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import {
  canCreateInvitationWithRole,
  canRevokeInvitation,
} from '../../../lib/api/resource-permissions'
import {
  getPlaceholderEmailDisplayName,
  isPlaceholderEmail,
} from '../../../lib/invitations/display'
import {
  endedReasonOf,
  isInviteError,
  isSharedLinkRow,
  type LinkEndedReason,
} from '../../../lib/invitations/effects'
import {
  acceptInvitation,
  declineInvitation,
} from '../../../lib/invitations/email-completion'
import {
  RevokeInvitationPreconditionError,
  createEmailInvitation,
  getUnusedInvitationParticipantIds,
  getRevokeInvitationPreview,
  isInvitationParticipantUnused,
  listGroupInvitations,
  listPendingEmailInvitationsForAccount,
  revokeInvitation,
  sendInvitationEmail,
} from '../../../lib/invitations/email-invitations'
import {
  acceptLinkInvitation,
  createLinkInvitation,
  getLinkInvitationPreview,
  listQrSessionJoiners,
  QR_INVITATION_DEFAULT_TTL_MS,
  SHARED_LINK_DEFAULT_MAX_USES,
  SHARED_LINK_DEFAULT_TTL_MS,
  SHARED_LINK_LABEL_MAX_LENGTH,
  SHARED_LINK_MAX_PENDING_PER_GROUP,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MIN_USES,
} from '../../../lib/invitations/link-invitations'
import {
  getSharedLinkUrl,
  regenerateLinkInvitation,
  updatePendingInvitation,
  validateSharedLinkLimits,
} from '../../../lib/invitations/manage-invitations'
import {
  createTRPCRouter,
  loadGroupMutationContext,
  protectedProcedure,
  publicProcedure,
} from '../../init'
import { mapInviteErrorToTRPC } from '../../invite-errors'
import { emptyOutputSchema } from '../../outputs/common'
import {
  accountInvitationsListOutputSchema,
  createLinkInvitationOutputSchema,
  invitationsListOutputSchema,
  linkInvitationPreviewSchema,
  regenerateLinkInvitationOutputSchema,
  revokeInvitationPreviewSchema,
  updatePendingInvitationOutputSchema,
} from '../../outputs/invitations'

const invitationProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next()
  if (!result.ok && isInviteError(result.error.cause)) {
    mapInviteErrorToTRPC(result.error.cause, ctx.resHeaders)
  }
  return result
})

// Only ADMIN and MEMBER roles are exposed in the invitation form. The
// group creator becomes an ADMIN at create time, so admins invite new
// admins or members; ownership transfers are not a separate flow.
const invitationRoleSchema = z.enum(['ADMIN', 'MEMBER'])

// Shared-link limits: either a concrete value or an explicit unlimited
// toggle. Free numeric entry within hard bounds. These mirror the domain
// bounds (`effects/limits`); the tRPC inputs stay zod (their transport
// contract), `validateSharedLinkLimits` is the authority every write runs
// through before touching the database.
const sharedLinkLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHARED_LINK_LABEL_MAX_LENGTH)
  .optional()
const sharedLinkMaxUsesSchema = z
  .number()
  .int()
  .min(SHARED_LINK_MIN_USES)
  .max(SHARED_LINK_MAX_USES_LIMIT)
  .nullable()
  .optional()
const sharedLinkTtlSchema = z
  .object({
    amount: z.number().int().min(1),
    unit: z.enum(['hours', 'days', 'weeks']),
  })
  .nullable()
  .optional()

/** Resolve a client-supplied shared-link duration to milliseconds. */
function resolveSharedLinkTtlMs(ttl: {
  amount: number
  unit: 'hours' | 'days' | 'weeks'
}): number {
  const unitMs =
    ttl.unit === 'hours'
      ? 60 * 60 * 1000
      : ttl.unit === 'days'
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000
  return ttl.amount * unitMs
}

/** Resolve a client-supplied duration to an absolute expiry computed now. */
function resolveSharedLinkExpiresAt(
  ttl: { amount: number; unit: 'hours' | 'days' | 'weeks' } | null | undefined,
): Date | null {
  if (ttl == null) return null
  const ttlMs = resolveSharedLinkTtlMs(ttl)
  // Reuse the backend validator for the bounds error (single source of
  // the "1 hour to 1 year" message); the label/maxUses defaults are
  // unused here. The validator throws the tagged failure, mapped through
  // the invite boundary like every other domain error on this path.
  try {
    validateSharedLinkLimits({ ttlMs })
  } catch (err) {
    throw mapInviteErrorToTRPC(err)
  }
  return new Date(Date.now() + ttlMs)
}

/** Validate a raw link-invitation token from `?invite=`. */
const invitationTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid invitation link')

export const invitationsRouter = createTRPCRouter({
  // this section "Pending invitations" / "Invitations awaiting
  // acceptance" and only acts on `PENDING` rows (revoke button), so
  // resolved invitations (accepted / declined / revoked) are
  // intentionally filtered out here. Resolved invitations still exist
  // in the database for audit purposes — see
  // `listGroupInvitations` for the unfiltered query.
  //
  // (Liveness vocabulary: `isSharedLinkRow` marks a row, `endedReasonOfRow`
  // derives it. Every other surface — accept gate, copy endpoint, preview —
  // uses the same two helpers from `../../../lib/invitations/effects`, so
  // the list can never disagree with them.)
  list: invitationProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .output(invitationsListOutputSchema)
    .query(async ({ input: { groupId }, ctx }) => {
      const [{ group, member }, allInvitations] = await Promise.all([
        loadGroupMutationContext({
          groupId,
          accountId: ctx.auth.user.id,
        }),
        listGroupInvitations(groupId),
      ])
      const now = new Date()
      const isSharedRow = (invitation: (typeof allInvitations)[number]) =>
        isSharedLinkRow(invitation)
      const isQrRow = (invitation: (typeof allInvitations)[number]) =>
        invitation.type === GroupInvitationType.LINK &&
        invitation.isMultiUse &&
        !isSharedRow(invitation)
      // A live QR session is a group-wide broadcast: every member sees it
      // (joiner names stay in-group) while revoke/manage stay gated by
      // canRevoke/canManage below. Shared links are also group-visible (any
      // active member may copy a live one). Expired or full QR sessions are
      // dead codes, not actionable invitations, so they are excluded for
      // every viewer — not just filtered in the UI — and carry no
      // credential in any case (random placeholder email). Shared links
      // stay listed when ended so members can revive or clean them up.
      //
      // Liveness is derived through the single shared helper
      // (`endedReasonOfRow`), not inline comparisons, so the list agrees
      // with the accept gate and the copy endpoint. The row's `maxUses` is
      // the cap; a missing (`null`) cap is unlimited and never reports
      // 'full'.
      const rowEndedReason = (
        invitation: (typeof allInvitations)[number],
      ): LinkEndedReason | null => endedReasonOfRow(invitation, now)
      const isDeadQrSession = (invitation: (typeof allInvitations)[number]) =>
        isQrRow(invitation) && rowEndedReason(invitation) !== null
      const isLiveQrSession = (invitation: (typeof allInvitations)[number]) =>
        isQrRow(invitation) && rowEndedReason(invitation) === null
      const invitations = allInvitations.filter(
        (invitation) =>
          invitation.status === GroupInvitationStatus.PENDING &&
          !isDeadQrSession(invitation) &&
          (member.role === 'ADMIN' ||
            invitation.invitedById === ctx.auth.user.id ||
            isLiveQrSession(invitation) ||
            isSharedRow(invitation)),
      )
      const [unusedParticipantIds, recipientProfiles] = await Promise.all([
        member.role === 'ADMIN'
          ? Promise.resolve(new Set<string>())
          : getUnusedInvitationParticipantIds({
              groupId,
              ledgerParticipantIds: invitations.map(
                (invitation) => invitation.ledgerParticipantId,
              ),
            }),
        resolveRecipientProfiles(invitations),
      ])
      // Joiner names for multi-use links come from the accept activity log.
      const joinersByInvitation = await listQrSessionJoiners(
        invitations
          .filter((invitation) => invitation.isMultiUse)
          .map((i) => i.id),
      )
      const canManageGroup =
        !group.archived && group.groupType !== GroupType.FRIEND
      return {
        invitations: invitations.map((invitation) => {
          const shared = isSharedLinkRow(invitation)
          const endedReason = rowEndedReason(invitation)
          const canManageInvitation =
            canManageGroup &&
            (member.role === 'ADMIN' ||
              invitation.invitedById === ctx.auth.user.id)
          return {
            ...invitation,
            // QR rows never serialize a label/maxUses to the client; shared
            // rows always do (already on the row). `linkToken` must never
            // leave the server except through `getLinkUrl`.
            linkToken: undefined,
            isShared: shared,
            endedReason,
            recentJoiners: joinersByInvitation.get(invitation.id) ?? [],
            canRevoke:
              !group.archived &&
              canRevokeInvitation({
                role: member.role,
                accountId: ctx.auth.user.id,
                invitedById: invitation.invitedById,
                isUnused:
                  member.role === 'ADMIN'
                    ? true
                    : shared
                      ? true
                      : invitation.ledgerParticipantId === null ||
                        unusedParticipantIds.has(
                          invitation.ledgerParticipantId,
                        ),
              }),
            canManage: canManageInvitation,
            // Any active member may copy a live shared link; editing stays
            // creator/admin-gated via canManage.
            canCopyLink: shared && endedReason === null && !group.archived,
            recipientProfile:
              recipientProfiles.get(invitation.email.toLowerCase()) ?? null,
          }
        }),
      }
    }),

  /** Create a shareable link invitation. Returns the full invite URL and expiry. */
  // Create a one-time link invitation (ADMIN only). The raw token is
  // returned exactly once; subsequent reads only see the hash. The
  // web client surfaces the URL in a copyable card right after
  // generation.
  //
  // Idempotency note: the token derives only from retry-stable inputs (the
  // account, the operation, the client `requestId`), and the minted URL is
  // persisted in the idempotency payload. An idempotent replay therefore
  // returns the *stored* URL verbatim — never a URL rebuilt from the
  // current token, which would point at a hash that is not in the database.
  createLink: invitationProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        requestId: createRequestIdSchema,
        role: invitationRoleSchema.default('MEMBER'),
        temporaryName: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe(
            'Pending-only label that overrides the email/name wherever the invitee is rendered.',
          )
          .optional(),
      }),
    )
    .output(createLinkInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupMutationContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (!canCreateInvitationWithRole(member.role, input.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Members can only invite other members',
        })
      }
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot create invitations',
        })
      }
      if (group.groupType === GroupType.FRIEND) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'friendLedgerFull',
        })
      }
      const token = deriveCreateToken({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.linkInvitation,
        requestId: input.requestId,
        discriminator: 'direct-link',
      })
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.linkInvitation,
        requestId: input.requestId,
        input: { ...input, requestId: undefined },
        prepare: getApiBoss,
        execute: async (tx, notificationBoss) => {
          const result = await createLinkInvitation({
            groupId: input.groupId,
            role: input.role as GroupRole,
            inviterAccountId: ctx.auth.user.id,
            temporaryName: input.temporaryName ?? null,
            notificationBoss,
            token,
            tx,
          })
          return {
            invitationId: result.invitation.id,
            inviteUrl: result.inviteUrl,
            expiresAt: result.invitation.expiresAt,
            temporaryName: result.invitation.temporaryName,
            role: result.invitation.role,
            isMultiUse: result.invitation.isMultiUse,
            useCount: result.invitation.useCount,
            maxUses: result.invitation.maxUses,
            label: result.invitation.label,
            isShared: result.invitation.isShared,
          }
        },
        encode: (result) => ({
          invitationId: result.invitationId,
          // Persist the minted URL so an idempotent replay returns the same
          // URL the first attempt minted (see the note on `createLink`).
          inviteUrl: result.inviteUrl,
          // One-time links and QR sessions always carry an expiry (stamped
          // server-side in createLinkInvitation).
          expiresAt: result.expiresAt!.toISOString(),
          temporaryName: result.temporaryName,
          role: result.role,
          isMultiUse: result.isMultiUse,
          useCount: result.useCount,
          maxUses: result.maxUses,
          label: result.label,
          isShared: result.isShared,
        }),
        decode: (stored) => {
          const result = stored as {
            invitationId: string
            inviteUrl: string
            expiresAt: string
            temporaryName: string | null
            role: GroupRole
            isMultiUse: boolean
            useCount: number
            maxUses: number | null
            label: string | null
            isShared: boolean
          }
          return {
            ...result,
            expiresAt: new Date(result.expiresAt),
          }
        },
      })
      return value
    }),

  /**
   * Create a general-purpose shared (multi-person) link invitation. The link
   * stays usable for any number of joins until its join cap, its expiry, or
   * revoke — whichever comes first. Shared links always grant MEMBER (a
   * forwardable link must never mint outside admins) and carry an optional
   * label so several live links can coexist and be revoked individually.
   *
   * The raw token is stored (`linkToken`) so any group member can copy the URL
   * again later via `getLinkUrl`.
   *
   * Idempotency has two halves. The _row_ half (the database write) is
   * deduplicated by `runIdempotentCreate` on `(account, operation, requestId)`.
   * The _token_ half (the URL that must equal the stored hash) is deduplicated
   * by deriving the token only from retry-stable inputs — never from wall-clock
   * timestamps — and by persisting the minted URL in the idempotency payload,
   * which the replay path returns verbatim.
   */
  createSharedLink: invitationProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        requestId: createRequestIdSchema,
        label: sharedLinkLabelSchema,
        // Null = unlimited. Defaults to SHARED_LINK_DEFAULT_MAX_USES when
        // the field is omitted entirely.
        maxUses: sharedLinkMaxUsesSchema,
        // Null = never expires. Defaults to SHARED_LINK_DEFAULT_TTL_MS when
        // the field is omitted entirely.
        expiresIn: sharedLinkTtlSchema,
      }),
    )
    .output(createLinkInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const { group } = await loadGroupMutationContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot create invitations',
        })
      }
      if (group.groupType === GroupType.FRIEND) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'friendLedgerFull',
        })
      }
      const { label, maxUses } = validateSharedLinkLimits({
        label: input.label ?? null,
        maxUses:
          input.maxUses === undefined
            ? SHARED_LINK_DEFAULT_MAX_USES
            : input.maxUses,
      })
      const expiresAt =
        input.expiresIn === undefined
          ? new Date(Date.now() + SHARED_LINK_DEFAULT_TTL_MS)
          : resolveSharedLinkExpiresAt(input.expiresIn)
      // Retry-stable token inputs only: the client `requestId` scopes the
      // mint to this creation, but two *genuinely different* creations must
      // never share a token — so the requestId participates in the
      // derivation. The absolute expiry timestamp is NOT an input: the same
      // logical request retried a millisecond later computes the same
      // absolute date through `expiresAt`, minting it inside the transaction
      // would derive a different token on replay.
      const token = deriveCreateToken({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.sharedLinkInvitation,
        requestId: input.requestId,
        discriminator: `shared-link:${input.groupId}:${label ?? ''}:${maxUses ?? 'unlimited'}`,
      })
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.sharedLinkInvitation,
        requestId: input.requestId,
        input: { ...input, requestId: undefined },
        prepare: getApiBoss,
        execute: async (tx, notificationBoss) => {
          // Serialize on the group row like the QR path does: the
          // pending-count check and the create below must not race with a
          // concurrent creation, or the per-group live-link cap can be
          // overshot.
          await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${input.groupId} FOR UPDATE`
          const pendingSharedCount = await tx.groupInvitation.count({
            where: {
              groupId: input.groupId,
              type: GroupInvitationType.LINK,
              status: GroupInvitationStatus.PENDING,
              isMultiUse: true,
              linkToken: { not: null },
            },
          })
          if (pendingSharedCount >= SHARED_LINK_MAX_PENDING_PER_GROUP) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `This group already has ${SHARED_LINK_MAX_PENDING_PER_GROUP} shared links. Revoke one before creating another.`,
            })
          }
          const result = await createLinkInvitation({
            groupId: input.groupId,
            role: 'MEMBER',
            inviterAccountId: ctx.auth.user.id,
            expiresAt,
            notificationBoss,
            token,
            tx,
            isShared: true,
            label,
            maxUses,
          })
          return {
            invitationId: result.invitation.id,
            inviteUrl: result.inviteUrl,
            expiresAt: result.invitation.expiresAt,
            temporaryName: result.invitation.temporaryName,
            role: result.invitation.role,
            isMultiUse: result.invitation.isMultiUse,
            useCount: result.invitation.useCount,
            maxUses: result.invitation.maxUses,
            label: result.invitation.label,
            isShared: result.invitation.isShared,
          }
        },
        encode: (result) => ({
          invitationId: result.invitationId,
          // A never-expiring shared link encodes a null expiry. The minted
          // URL is persisted so an idempotent replay returns the same URL
          // the first attempt minted — deriving it from the *current* token
          // would hand back a URL whose hash is not in the database.
          inviteUrl: result.inviteUrl,
          expiresAt: result.expiresAt?.toISOString() ?? null,
          temporaryName: result.temporaryName,
          role: result.role,
          isMultiUse: result.isMultiUse,
          useCount: result.useCount,
          maxUses: result.maxUses,
          label: result.label,
          isShared: result.isShared,
        }),
        decode: (stored) => {
          const result = stored as {
            invitationId: string
            inviteUrl: string
            expiresAt: string | null
            temporaryName: string | null
            role: GroupRole
            isShared: boolean
            isMultiUse: boolean
            useCount: number
            maxUses: number | null
            label: string | null
          }
          return {
            ...result,
            expiresAt:
              result.expiresAt == null ? null : new Date(result.expiresAt),
          }
        },
      })
      return value
    }),

  /**
   * Retrieve the shareable URL of a live shared link. This is a mutation, not a
   * query: it reads a stored secret and must never be cached or prefetched. Any
   * active member may call it — the list payload never carries the token, so
   * this endpoint is the only reader of the stored plaintext, and the list
   * `canCopyLink` flag gates it client-side. One-time links and QR sessions are
   * never retrievable: copy them at creation or rotate them.
   */
  // (The `Exit.match` inline responder maps the Effect failure; anything
  // else is a defect and rethrows as-is so the procedure never swallows a
  // database outage into a domain code.)
  getLinkUrl: invitationProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        invitationId: z.string().min(1),
      }),
    )
    .output(
      z.object({
        inviteUrl: z.url(),
        expiresAt: z.date().nullable(),
        useCount: z.number(),
        maxUses: z.number().int().positive().nullable(),
        label: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getSharedLinkUrl({ ...input, accountId: ctx.auth.user.id })
    }),

  /**
   * Create a multi-use QR / nearby session invitation. The link stays usable
   * for any number of joins until its short expiry (15 min) or revoke, so a
   * room of people can join from one displayed QR code. Sessions are always
   * MEMBER-level: a forwarded screenshot must never mint outside admins.
   */
  createQrLink: invitationProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        requestId: createRequestIdSchema,
        role: z.literal('MEMBER').default('MEMBER'),
      }),
    )
    .output(createLinkInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupMutationContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (!canCreateInvitationWithRole(member.role, input.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Members can only invite other members',
        })
      }
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot create invitations',
        })
      }
      if (group.groupType === GroupType.FRIEND) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'friendLedgerFull',
        })
      }
      const token = deriveCreateToken({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.qrInvitation,
        requestId: input.requestId,
        discriminator: 'qr-session',
      })
      const expiresAt = new Date(Date.now() + QR_INVITATION_DEFAULT_TTL_MS)
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.qrInvitation,
        requestId: input.requestId,
        input: { ...input, requestId: undefined },
        prepare: getApiBoss,
        execute: async (tx, notificationBoss) => {
          // One live QR session per group: the tab resumes the active
          // session instead of minting parallel codes. The row lock is held
          // until this interactive transaction commits, so concurrent
          // creators serialize here instead of both observing "no active".
          await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${input.groupId} FOR UPDATE`
          // A full session counts as dead: the host's tab falls back to the
          // empty state and may start a fresh room. Shared links are
          // copy-anytime links (`linkToken != null`), not QR sessions — they
          // never count as an active session. A full *QR* session is dead,
          // so the surviving candidates must be filtered per-row below
          // instead of a single blunt `useCount < cap` predicate (shared
          // rows and QR rows carry different caps).
          const candidates = await tx.groupInvitation.findMany({
            where: {
              groupId: input.groupId,
              status: GroupInvitationStatus.PENDING,
              isMultiUse: true,
              linkToken: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { id: true, useCount: true, maxUses: true },
          })
          const activeSession = candidates.find(
            (candidate) =>
              candidate.maxUses == null ||
              candidate.useCount < candidate.maxUses,
          )
          if (activeSession) {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'A QR session is already active for this group. Stop it before starting a new one.',
            })
          }
          const result = await createLinkInvitation({
            groupId: input.groupId,
            role: input.role as GroupRole,
            inviterAccountId: ctx.auth.user.id,
            notificationBoss,
            token,
            expiresAt,
            isMultiUse: true,
            tx,
          })
          return {
            invitationId: result.invitation.id,
            inviteUrl: result.inviteUrl,
            expiresAt: result.invitation.expiresAt,
            temporaryName: result.invitation.temporaryName,
            role: result.invitation.role,
            isMultiUse: result.invitation.isMultiUse,
            useCount: result.invitation.useCount,
          }
        },
        encode: (result) => ({
          invitationId: result.invitationId,
          // Persist the minted URL so an idempotent replay returns the same
          // URL the first attempt minted (see the note on `createLink`).
          inviteUrl: result.inviteUrl,
          // One-time links and QR sessions always carry an expiry (stamped
          // server-side in createLinkInvitation).
          expiresAt: result.expiresAt!.toISOString(),
          temporaryName: result.temporaryName,
          role: result.role,
          isMultiUse: result.isMultiUse,
          useCount: result.useCount,
        }),
        decode: (stored) => {
          const result = stored as {
            invitationId: string
            inviteUrl: string
            expiresAt: string
            temporaryName: string | null
            role: GroupRole
            isMultiUse: boolean
            useCount: number
          }
          return {
            ...result,
            expiresAt: new Date(result.expiresAt),
          }
        },
      })
      return value
    }),

  // Public: preview a link invitation by token (no auth). Shows group name and
  // role before accepting.
  //
  // (Public preview of a link invitation. The accept page calls this
  // before showing the Accept button so unauthenticated visitors can
  // see the group name and inviter (and a clear error message when the
  // link is no longer usable). No auth is required because the URL
  // itself is the credential — and the helper returns only redacted
  // fields, not the full invitation row.)
  previewLink: publicProcedure
    .input(z.object({ token: invitationTokenSchema }))
    .output(z.object({ preview: linkInvitationPreviewSchema.nullable() }))
    .query(async ({ input }) => {
      const preview = await getLinkInvitationPreview(input.token)
      return { preview }
    }),

  // Accept a link invitation by token. Joins the group with the invitation's
  // role.
  //
  // (The helper refuses expired / revoked / already-used tokens and the
  // double-active-member case through the tagged invite failures, mapped to
  // stable tRPC codes by the invite boundary.)
  acceptLink: invitationProcedure
    .input(
      z.object({
        token: invitationTokenSchema,
        expectedGroupId: z.string().min(1).optional(),
      }),
    )
    .output(
      z.object({ groupId: z.string(), role: z.enum(['ADMIN', 'MEMBER']) }),
    )
    .mutation(async ({ input: { token, expectedGroupId }, ctx }) => {
      // acceptLinkInvitation throws the tagged invite failures for every
      // dead link and membership case; the invite boundary below maps them
      // to the stable codes the banner copy keys off. Non-invite errors
      // (a Prisma outage) rethrow unwrapped.
      try {
        const result = await acceptLinkInvitation({
          token,
          expectedGroupId,
          accountId: ctx.auth.user.id,
        })
        return { groupId: result.groupId, role: result.role }
      } catch (err) {
        if (isInviteError(err)) return mapInviteErrorToTRPC(err)
        throw err
      }
    }),

  /** Send an email invitation. The invitee appears as pending until they accept. */
  // Create an email invitation (ADMIN only). Today this is the only
  // invite kind; a link-invite sibling will sit next to it later.
  create: invitationProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        requestId: createRequestIdSchema,
        email: z.email(),
        role: invitationRoleSchema.default('MEMBER'),
        // Pending-only label that wins over the email wherever a
        // pending invitee is rendered.
        temporaryName: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe(
            'Pending-only label that overrides the email/name wherever the invitee is rendered.',
          )
          .optional(),
      }),
    )
    .output(
      z.object({
        invitationId: z.string(),
        // False only when delivery was attempted but could not happen
        // (SMTP unconfigured, rate-limited, or a send failure). Existing
        // account and idempotent replay paths return true: no email is
        // expected for those, so the UI keeps its normal success copy.
        emailDelivered: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupMutationContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (!canCreateInvitationWithRole(member.role, input.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Members can only invite other members',
        })
      }
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot create invitations',
        })
      }
      if (group.groupType === GroupType.FRIEND) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'friendLedgerFull',
        })
      }
      // Differentiate the email body by whether the recipient already has an
      // account on this Spliit Cloud instance. The DB row is the source of
      // truth: the in-app UI will surface the invitation to existing users
      // regardless of email delivery, so we never fail the mutation on send.
      const existingAccount = await prisma.user.findFirst({
        where: {
          email: { equals: input.email.toLowerCase(), mode: 'insensitive' },
        },
        select: { id: true },
      })
      const { value, replayed } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.emailInvitation,
        requestId: input.requestId,
        input: { ...input, requestId: undefined },
        prepare: getApiBoss,
        execute: async (tx, notificationBoss) => {
          const invitation = await createEmailInvitation({
            groupId: input.groupId,
            email: input.email,
            role: input.role as GroupRole,
            inviterAccountId: ctx.auth.user.id,
            temporaryName: input.temporaryName ?? null,
            notificationBoss,
            tx,
          })
          return {
            invitationId: invitation.id,
            email: invitation.email,
            temporaryName: invitation.temporaryName,
          }
        },
      })
      if (!replayed && !existingAccount) {
        const emailDelivered = await sendInvitationEmail({
          invitationId: value.invitationId,
          groupId: group.id,
          groupName: group.name,
          inviterDisplayName:
            ctx.auth.user.name ||
            getPlaceholderEmailDisplayName(ctx.auth.user.email) ||
            ctx.auth.user.email,
          inviterRole: member.role,
          recipientEmail: value.email,
          senderAccountId: ctx.auth.user.id,
          recipientIsExistingUser: false,
          temporaryName: value.temporaryName,
        })
        return { invitationId: value.invitationId, emailDelivered }
      }
      return { invitationId: value.invitationId, emailDelivered: true }
    }),

  /** Preview the balance impact of revoking a pending invitation. */
  // Read-only summary the web client uses to render the admin
  // "revoke invitation" dialog. Mirrors `groups.members.removePreview`:
  // returns whether the invitation's ledger participant has unsettled
  // balances so the dialog can pick between the simple confirm and the
  // three-option variant (settle+revoke, revoke only, cancel).
  revokePreview: invitationProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        groupId: z.string().min(1),
      }),
    )
    .output(revokeInvitationPreviewSchema)
    .query(async ({ input: { invitationId, groupId }, ctx }) => {
      const { group, member } = await loadGroupMutationContext({
        groupId,
        accountId: ctx.auth.user.id,
      }).catch(() => {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not a member of this group',
        })
      })
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot revoke invitations',
        })
      }
      const invitation = await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
        select: {
          groupId: true,
          invitedById: true,
          ledgerParticipantId: true,
          status: true,
          isMultiUse: true,
          linkToken: true,
        },
      })
      if (!invitation || invitation.groupId !== groupId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
        })
      }
      await assertInvitationRevocationAllowed({
        groupId,
        accountId: ctx.auth.user.id,
        role: member.role,
        invitation,
      })
      try {
        return await getRevokeInvitationPreview({ invitationId, groupId })
      } catch (err) {
        throw mapRevokeError(err)
      }
    }),

  /**
   * Revoke a pending invitation. Requires `settleBalances: true` when the
   * invitee has unsettled balances.
   */
  // Revoke a pending invitation (ADMIN only).
  //
  // If the invitation's materialized ledger participant has unsettled
  // balances the caller MUST supply `settleBalances: true` (create
  // settlement expenses for the legs involving the invitee before
  // flipping the status). Anything else throws `PRECONDITION_FAILED` so
  // the web client can re-render the revoke dialog with the settle
  // checkbox. This is stricter than the member-remove flow because
  // revoking a non-member leaves the invitee's participant orphaned in
  // the ledger, which breaks the balances view.
  revoke: invitationProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        settleBalances: z
          .boolean()
          .describe(
            "When true, create settlement expenses for the invitee's balances before revoking.",
          )
          .optional(),
      }),
    )
    .output(emptyOutputSchema)
    .mutation(async ({ input: { invitationId, settleBalances }, ctx }) => {
      const existing = await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
        select: {
          groupId: true,
          invitedById: true,
          ledgerParticipantId: true,
          status: true,
          isMultiUse: true,
          linkToken: true,
          group: { select: { groupType: true } },
        },
      })
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
        })
      }
      if (existing.group.groupType === GroupType.FRIEND) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'friendLedgerNotRevocable',
        })
      }
      const { group, member } = await loadGroupMutationContext({
        groupId: existing.groupId,
        accountId: ctx.auth.user.id,
      })
      if (group.archived) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Archived groups cannot revoke invitations',
        })
      }
      await assertInvitationRevocationAllowed({
        groupId: existing.groupId,
        accountId: ctx.auth.user.id,
        role: member.role,
        invitation: existing,
      })
      try {
        await revokeInvitation({
          invitationId,
          groupId: existing.groupId,
          settleBalances,
          actor: { accountId: ctx.auth.user.id },
        })
      } catch (err) {
        throw mapRevokeError(err)
      }
      return {}
    }),

  // Accept an email invitation. Link-invite handoff will branch on
  // invitation type to swap the auth helper.
  accept: invitationProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        expectedGroupId: z.string().min(1).optional(),
      }),
    )
    .output(z.object({ groupId: z.string() }))
    .mutation(async ({ input: { invitationId, expectedGroupId }, ctx }) => {
      const account = ctx.auth.user
      const member = await acceptInvitation({
        invitationId,
        accountId: account.id,
        accountEmail: account.email,
        expectedGroupId,
      })
      return { groupId: member.groupId }
    }),

  // Decline a pending invitation. Only the invitee (the account whose email
  // matches the invitation) can mark their own invitation as declined.
  decline: invitationProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .output(emptyOutputSchema)
    .mutation(async ({ input: { invitationId }, ctx }) => {
      await declineInvitation({
        invitationId,
        accountEmail: ctx.auth.user.email,
        accountId: ctx.auth.user.id,
      })
      return {}
    }),

  // Pending email invitations for the current account.
  listForAccount: invitationProcedure
    .output(accountInvitationsListOutputSchema)
    .query(async ({ ctx }) => {
      const invitations = await listPendingEmailInvitationsForAccount(
        ctx.auth.user.email,
      )
      return { invitations }
    }),

  /**
   * Update a pending invitation in place: retarget the email, switch between
   * email and link delivery, or edit the pending name/role. The invitation row
   * and its materialized ledger participant are preserved.
   *
   * Admins can manage any listed invitation and assign ADMIN|MEMBER; members
   * can only manage invitations they created and only assign MEMBER. Archived
   * and FRIEND groups are read-only.
   */
  updatePending: invitationProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        role: invitationRoleSchema,
        temporaryName: z.string().trim().min(1).max(120).optional(),
        delivery: z.discriminatedUnion('type', [
          z.object({ type: z.literal('EMAIL'), email: z.email() }),
          z.object({ type: z.literal('LINK') }),
        ]),
        // Shared-link limit/label edits. `undefined` means "no change" per
        // field; only applies to shared rows with LINK delivery.
        shared: z
          .object({
            label: sharedLinkLabelSchema.nullable().optional(),
            maxUses: sharedLinkMaxUsesSchema,
            expiresIn: sharedLinkTtlSchema,
          })
          .optional(),
      }),
    )
    .output(updatePendingInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const invitation = await loadInvitationWithGroup(input.invitationId)
      const { group, member } = await loadGroupMutationContext({
        groupId: invitation.groupId,
        accountId: ctx.auth.user.id,
      })
      assertCanManagePendingInvitation({
        group,
        memberRole: member.role,
        accountId: ctx.auth.user.id,
        invitation,
        requestedRole: input.role,
      })
      // `expiresIn` is a fresh duration from save time; `undefined` means
      // the caller did not touch expiry and the row's `expiresAt` stays
      // untouched (the manage dialog sends `undefined` for untouched
      // fields, not `null`).
      const shared =
        input.shared === undefined
          ? undefined
          : {
              label: input.shared.label,
              maxUses: input.shared.maxUses,
              ttlMs:
                input.shared.expiresIn === undefined
                  ? undefined
                  : input.shared.expiresIn == null
                    ? null
                    : resolveSharedLinkTtlMs(input.shared.expiresIn),
            }
      const result = await updatePendingInvitation({
        invitationId: input.invitationId,
        groupId: group.id,
        role: input.role,
        temporaryName: input.temporaryName ?? null,
        delivery: input.delivery,
        shared,
        actorAccountId: ctx.auth.user.id,
        inviterDisplayName:
          ctx.auth.user.name ||
          getPlaceholderEmailDisplayName(ctx.auth.user.email) ||
          ctx.auth.user.email,
        inviterRole: member.role,
      })
      return {
        invitation: {
          ...result.invitation,
          createdAt: invitation.createdAt,
          isShared: isSharedLinkRow(result.invitation),
          endedReason: endedReasonOfRow(result.invitation),
          canCopyLink: canCopyLinkRow({
            invitation: result.invitation,
            archived: group.archived,
          }),
          canRevoke: await resolveCanRevoke({
            group,
            memberRole: member.role,
            accountId: ctx.auth.user.id,
            invitedById: invitation.invitedById,
            groupId: group.id,
            ledgerParticipantId: result.invitation.ledgerParticipantId,
            isShared: isSharedLinkRow(result.invitation),
          }),
          canManage: true,
          recipientProfile: await resolveSingleRecipientProfile(
            result.invitation,
          ),
        },
        inviteUrl: result.inviteUrl,
        emailDelivered: result.emailDelivered,
      }
    }),

  /**
   * Rotate a pending link invitation's credential. The old URL stops working
   * immediately; the new shareable URL is returned exactly once.
   */
  regenerateLink: invitationProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .output(regenerateLinkInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const invitation = await loadInvitationWithGroup(input.invitationId)
      const { group, member } = await loadGroupMutationContext({
        groupId: invitation.groupId,
        accountId: ctx.auth.user.id,
      })
      assertCanManagePendingInvitation({
        group,
        memberRole: member.role,
        accountId: ctx.auth.user.id,
        invitation,
        requestedRole: undefined,
      })
      const result = await regenerateLinkInvitation({
        invitationId: input.invitationId,
        groupId: group.id,
        actorAccountId: ctx.auth.user.id,
      })
      return {
        invitation: {
          ...result.invitation,
          createdAt: invitation.createdAt,
          isShared: isSharedLinkRow(result.invitation),
          endedReason: endedReasonOfRow(result.invitation),
          canCopyLink: canCopyLinkRow({
            invitation: result.invitation,
            archived: group.archived,
          }),
          canRevoke: await resolveCanRevoke({
            group,
            memberRole: member.role,
            accountId: ctx.auth.user.id,
            invitedById: invitation.invitedById,
            groupId: group.id,
            ledgerParticipantId: result.invitation.ledgerParticipantId,
            isShared: isSharedLinkRow(result.invitation),
          }),
          canManage: true,
          recipientProfile: await resolveSingleRecipientProfile(
            result.invitation,
          ),
        },
        inviteUrl: result.inviteUrl,
      }
    }),
})

// (The row predicate and liveness derivation live in
// `../../../lib/invitations/effects`: the list, update, regenerate, and copy
// responses agree with the accept gate by construction.)

/**
 * Derived liveness for a partial row. Non-multi-use LINK rows report null
 * unless expired; other types ignore the multi-use machinery entirely.
 */
function endedReasonOfRow(
  invitation: {
    status: GroupInvitationStatus
    type: GroupInvitationType
    isMultiUse: boolean
    expiresAt: Date | null
    useCount: number
    maxUses: number | null
  },
  now: Date = new Date(),
): LinkEndedReason | null {
  return endedReasonOf(
    {
      status: invitation.status,
      isMultiUse:
        invitation.type === GroupInvitationType.LINK && invitation.isMultiUse,
      expiresAt: invitation.expiresAt,
      useCount: invitation.useCount,
      maxUses: invitation.maxUses,
    },
    now,
  )
}

function canCopyLinkRow(args: {
  invitation: {
    isMultiUse: boolean
    linkToken: string | null
    status: GroupInvitationStatus
    expiresAt: Date | null
    useCount: number
    maxUses: number | null
    type: GroupInvitationType
  }
  archived: boolean
}): boolean {
  if (args.archived || !isSharedLinkRow(args.invitation)) return false
  if (args.invitation.status !== GroupInvitationStatus.PENDING) return false
  // Liveness through the single shared helper: a copyable link is exactly a
  // live shared one (no expiry past, no cap reached).
  return (
    endedReasonOfRow(args.invitation) === null &&
    args.invitation.type === GroupInvitationType.LINK
  )
}

async function loadInvitationWithGroup(invitationId: string) {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: invitationId },
    include: { group: { select: { archived: true, groupType: true } } },
  })
  if (!invitation) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Invitation not found',
    })
  }
  return invitation
}

function assertCanManagePendingInvitation(args: {
  group: { archived: boolean; groupType: GroupType }
  memberRole: GroupRole
  accountId: string
  invitation: {
    groupId: string
    invitedById: string | null
    status: GroupInvitationStatus
  }
  requestedRole?: GroupRole | undefined
}) {
  if (args.group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Archived groups cannot manage invitations',
    })
  }
  if (args.group.groupType === GroupType.FRIEND) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'friendLedgerNotEditable',
    })
  }
  if (args.invitation.status !== GroupInvitationStatus.PENDING) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only pending invitations can be managed',
    })
  }
  if (
    args.memberRole !== 'ADMIN' &&
    args.invitation.invitedById !== args.accountId
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can only manage invitations you created',
    })
  }
  if (args.memberRole !== 'ADMIN' && args.requestedRole === 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Members can only assign the member role',
    })
  }
}

async function resolveRecipientProfiles(
  invitations: Array<{ email: string }>,
): Promise<
  Map<string, { id: string; name: string | null; image: string | null }>
> {
  const realEmails = new Set<string>()
  for (const invitation of invitations) {
    const email = invitation.email.toLowerCase()
    if (!isPlaceholderEmail(email)) realEmails.add(email)
  }
  if (realEmails.size === 0) return new Map()
  const accounts = await prisma.user.findMany({
    where: { email: { in: [...realEmails], mode: 'insensitive' } },
    select: { id: true, name: true, image: true, email: true },
  })
  return new Map(
    accounts.map((account) => [
      account.email.toLowerCase(),
      { id: account.id, name: account.name, image: account.image },
    ]),
  )
}

async function resolveSingleRecipientProfile(args: {
  type: GroupInvitationType
  email: string
}): Promise<{ id: string; name: string | null; image: string | null } | null> {
  if (args.type === GroupInvitationType.LINK) return null
  if (isPlaceholderEmail(args.email)) return null
  const account = await prisma.user.findFirst({
    where: { email: { equals: args.email, mode: 'insensitive' } },
    select: { id: true, name: true, image: true },
  })
  return account
}

/**
 * Mirror the `list` procedure's canRevoke computation for mutation outputs so
 * the response never lies about revoke eligibility while the row is pending.
 * Shared links count as "used" for their creator's revoke purposes — the
 * creator keeps revoke rights after joins because there is no pending
 * participant to protect.
 */
async function resolveCanRevoke(args: {
  group: { archived: boolean }
  memberRole: GroupRole
  accountId: string
  invitedById: string | null
  groupId: string
  ledgerParticipantId: string | null
  isShared?: boolean
}): Promise<boolean> {
  if (args.group.archived) return false
  return canRevokeInvitation({
    role: args.memberRole,
    accountId: args.accountId,
    invitedById: args.invitedById,
    isUnused:
      args.memberRole === 'ADMIN' || args.isShared === true
        ? true
        : await isInvitationParticipantUnused({
            groupId: args.groupId,
            ledgerParticipantId: args.ledgerParticipantId,
          }),
  })
}

async function assertInvitationRevocationAllowed(args: {
  groupId: string
  accountId: string
  role: GroupRole
  invitation: {
    invitedById: string | null
    ledgerParticipantId: string | null
    status: GroupInvitationStatus
    isMultiUse?: boolean
    linkToken?: string | null
  }
}) {
  if (args.invitation.status !== GroupInvitationStatus.PENDING) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only pending invitations can be revoked',
    })
  }
  // Shared links have no pending participant to protect: the creator keeps
  // revoke rights after joins.
  const isShared =
    args.invitation.isMultiUse === true &&
    (args.invitation.linkToken ?? null) != null
  const isUnused =
    args.role === 'ADMIN' || isShared
      ? true
      : await isInvitationParticipantUnused({
          groupId: args.groupId,
          ledgerParticipantId: args.invitation.ledgerParticipantId,
        })
  if (
    !canRevokeInvitation({
      role: args.role,
      accountId: args.accountId,
      invitedById: args.invitation.invitedById,
      isUnused,
    })
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        args.invitation.invitedById !== args.accountId
          ? 'You can only revoke invitations you created'
          : 'Only an admin can revoke an invitation already used in expenses',
    })
  }
}

/**
 * Translate the helper errors into TRPC errors. The web client uses
 * `PRECONDITION_FAILED` to decide whether to re-render the revoke dialog with
 * the missing confirmation (e.g. unsettled balances without `settleBalances`).
 */
function mapRevokeError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err
  if (err instanceof RevokeInvitationPreconditionError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
  }
  const message =
    err instanceof Error ? err.message : 'Unable to revoke invitation'
  if (/not found in this group/i.test(message)) {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

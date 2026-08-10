import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupType,
  prisma,
  type GroupRole,
} from '@spliit/db'

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
import { getWebBaseUrl } from '../../../lib/auth/urls'
import {
  getPlaceholderEmailDisplayName,
  isPlaceholderEmail,
} from '../../../lib/invitations/display'
import {
  RevokeInvitationPreconditionError,
  InvitationError,
  acceptInvitation,
  createEmailInvitation,
  declineInvitation,
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
} from '../../../lib/invitations/link-invitations'
import {
  regenerateLinkInvitation,
  updatePendingInvitation,
} from '../../../lib/invitations/manage-invitations'
import {
  createTRPCRouter,
  loadGroupContext,
  protectedProcedure,
  publicProcedure,
} from '../../init'
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

// Only ADMIN and MEMBER roles are exposed in the invitation form. The
// group creator becomes an ADMIN at create time, so admins invite new
// admins or members; ownership transfers are not a separate flow.
const invitationRoleSchema = z.enum(['ADMIN', 'MEMBER'])

/** Validate a raw link-invite token. Same charset the generator emits. */
const linkTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid invitation token')

export const invitationsRouter = createTRPCRouter({
  // Admins see every pending invitation; members see only invitations they
  // created.
  // this section "Pending invitations" / "Invitations awaiting
  // acceptance" and only acts on `PENDING` rows (revoke button), so
  // resolved invitations (accepted / declined / revoked) are
  // intentionally filtered out here. Resolved invitations still exist
  // in the database for audit purposes — see
  // `listGroupInvitations` for the unfiltered query.
  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .output(invitationsListOutputSchema)
    .query(async ({ input: { groupId }, ctx }) => {
      const [{ group, member }, allInvitations] = await Promise.all([
        loadGroupContext({
          groupId,
          accountId: ctx.auth.user.id,
        }),
        listGroupInvitations(groupId),
      ])
      const invitations = allInvitations.filter(
        (invitation) =>
          invitation.status === GroupInvitationStatus.PENDING &&
          (member.role === 'ADMIN' ||
            invitation.invitedById === ctx.auth.user.id),
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
      const canManageGroup =
        !group.archived && group.groupType !== GroupType.FRIEND
      return {
        invitations: invitations.map((invitation) => ({
          ...invitation,
          canRevoke:
            !group.archived &&
            canRevokeInvitation({
              role: member.role,
              accountId: ctx.auth.user.id,
              invitedById: invitation.invitedById,
              isUnused:
                member.role === 'ADMIN'
                  ? true
                  : invitation.ledgerParticipantId === null ||
                    unusedParticipantIds.has(invitation.ledgerParticipantId),
            }),
          canManage:
            canManageGroup &&
            (member.role === 'ADMIN' ||
              invitation.invitedById === ctx.auth.user.id),
          recipientProfile:
            recipientProfiles.get(invitation.email.toLowerCase()) ?? null,
        })),
      }
    }),

  /** Create a shareable link invitation. Returns the full invite URL and expiry. */
  // Create a single-use link invitation (ADMIN only). The raw token is
  // returned exactly once; subsequent reads only see the hash. The
  // web client surfaces the URL in a copyable card right after
  // generation.
  createLink: protectedProcedure
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
      const { group, member } = await loadGroupContext({
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
        execute: async (tx) => {
          const result = await createLinkInvitation({
            groupId: input.groupId,
            role: input.role as GroupRole,
            inviterAccountId: ctx.auth.user.id,
            temporaryName: input.temporaryName ?? null,
            token,
            tx,
          })
          return {
            invitationId: result.invitation.id,
            inviteUrl: result.inviteUrl,
            expiresAt: result.invitation.expiresAt,
            temporaryName: result.invitation.temporaryName,
            role: result.invitation.role,
          }
        },
        encode: (result) => ({
          invitationId: result.invitationId,
          expiresAt: result.expiresAt.toISOString(),
          temporaryName: result.temporaryName,
          role: result.role,
        }),
        decode: (stored) => {
          const result = stored as {
            invitationId: string
            expiresAt: string
            temporaryName: string | null
            role: GroupRole
          }
          return {
            ...result,
            inviteUrl: `${getWebBaseUrl()}/groups/${input.groupId}?invite=${token}`,
            expiresAt: new Date(result.expiresAt),
          }
        },
      })
      return value
    }),

  /**
   * Public: preview a link invitation by token (no auth). Shows group name and
   * role before accepting.
   */
  // Public preview of a link invitation. The accept page calls this
  // before showing the Accept button so unauthenticated visitors can
  // see the group name and inviter (and a clear error message when the
  // link is no longer usable). No auth is required because the URL
  // itself is the credential — and the helper returns only redacted
  // fields, not the full invitation row.
  previewLink: publicProcedure
    .input(z.object({ token: linkTokenSchema }))
    .output(z.object({ preview: linkInvitationPreviewSchema.nullable() }))
    .query(async ({ input }) => {
      const preview = await getLinkInvitationPreview(input.token)
      return { preview }
    }),

  /**
   * Accept a link invitation by token. Joins the group with the invitation's
   * role.
   */
  // Accept a link invitation for the current account. The helper
  // refuses expired / revoked / already-used tokens and the
  // double-active-member case.
  acceptLink: protectedProcedure
    .input(z.object({ token: linkTokenSchema }))
    .output(
      z.object({ groupId: z.string(), role: z.enum(['ADMIN', 'MEMBER']) }),
    )
    .mutation(async ({ input: { token }, ctx }) => {
      const result = await acceptLinkInvitation({
        token,
        accountId: ctx.auth.user.id,
      })
      return { groupId: result.groupId, role: result.role }
    }),

  /** Send an email invitation. The invitee appears as pending until they accept. */
  // Create an email invitation (ADMIN only). Today this is the only
  // invite kind; a link-invite sibling will sit next to it later.
  create: protectedProcedure
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
    .output(z.object({ invitationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupContext({
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
      const existingAccount = await prisma.account.findFirst({
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
        execute: async (tx) => {
          const invitation = await createEmailInvitation({
            groupId: input.groupId,
            email: input.email,
            role: input.role as GroupRole,
            inviterAccountId: ctx.auth.user.id,
            temporaryName: input.temporaryName ?? null,
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
        await sendInvitationEmail({
          invitationId: value.invitationId,
          groupId: group.id,
          groupName: group.name,
          inviterDisplayName:
            ctx.auth.user.name ||
            getPlaceholderEmailDisplayName(ctx.auth.user.email) ||
            ctx.auth.user.email,
          inviterRole: member.role,
          recipientEmail: value.email,
          recipientIsExistingUser: false,
          temporaryName: value.temporaryName,
        })
      }
      return { invitationId: value.invitationId }
    }),

  /** Preview the balance impact of revoking a pending invitation. */
  // Read-only summary the web client uses to render the admin
  // "revoke invitation" dialog. Mirrors `groups.members.removePreview`:
  // returns whether the invitation's ledger participant has unsettled
  // balances so the dialog can pick between the simple confirm and the
  // three-option variant (settle+revoke, revoke only, cancel).
  revokePreview: protectedProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        groupId: z.string().min(1),
      }),
    )
    .output(revokeInvitationPreviewSchema)
    .query(async ({ input: { invitationId, groupId }, ctx }) => {
      const { group, member } = await loadGroupContext({
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
  revoke: protectedProcedure
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
      const { group, member } = await loadGroupContext({
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
  accept: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .output(z.object({ groupId: z.string() }))
    .mutation(async ({ input: { invitationId }, ctx }) => {
      const account = ctx.auth.user
      const member = await acceptInvitation({
        invitationId,
        accountId: account.id,
        accountEmail: account.email,
      })
      return { groupId: member.groupId }
    }),

  // Decline a pending invitation. Only the invitee (the account whose email
  // matches the invitation) can mark their own invitation as declined.
  decline: protectedProcedure
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
  listForAccount: protectedProcedure
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
  updatePending: protectedProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
        role: invitationRoleSchema,
        temporaryName: z.string().trim().min(1).max(120).optional(),
        delivery: z.discriminatedUnion('type', [
          z.object({ type: z.literal('EMAIL'), email: z.email() }),
          z.object({ type: z.literal('LINK') }),
        ]),
      }),
    )
    .output(updatePendingInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const invitation = await loadInvitationWithGroup(input.invitationId)
      const { group, member } = await loadGroupContext({
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
      try {
        const result = await updatePendingInvitation({
          invitationId: input.invitationId,
          groupId: group.id,
          role: input.role,
          temporaryName: input.temporaryName ?? null,
          delivery: input.delivery,
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
            canRevoke: await resolveCanRevoke({
              group,
              memberRole: member.role,
              accountId: ctx.auth.user.id,
              invitedById: invitation.invitedById,
              groupId: group.id,
              ledgerParticipantId: result.invitation.ledgerParticipantId,
            }),
            canManage: true,
            recipientProfile: await resolveSingleRecipientProfile(
              result.invitation,
            ),
          },
          inviteUrl: result.inviteUrl,
        }
      } catch (err) {
        throw mapUpdateError(err)
      }
    }),

  /**
   * Rotate a pending link invitation's credential. The old URL stops working
   * immediately; the new shareable URL is returned exactly once.
   */
  regenerateLink: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .output(regenerateLinkInvitationOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const invitation = await loadInvitationWithGroup(input.invitationId)
      const { group, member } = await loadGroupContext({
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
      try {
        const result = await regenerateLinkInvitation({
          invitationId: input.invitationId,
          groupId: group.id,
          actorAccountId: ctx.auth.user.id,
        })
        return {
          invitation: {
            ...result.invitation,
            createdAt: invitation.createdAt,
            canRevoke: await resolveCanRevoke({
              group,
              memberRole: member.role,
              accountId: ctx.auth.user.id,
              invitedById: invitation.invitedById,
              groupId: group.id,
              ledgerParticipantId: result.invitation.ledgerParticipantId,
            }),
            canManage: true,
            recipientProfile: await resolveSingleRecipientProfile(
              result.invitation,
            ),
          },
          inviteUrl: result.inviteUrl,
        }
      } catch (err) {
        throw mapUpdateError(err)
      }
    }),
})

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
    invitedById: string
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
  const accounts = await prisma.account.findMany({
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
  const account = await prisma.account.findFirst({
    where: { email: { equals: args.email, mode: 'insensitive' } },
    select: { id: true, name: true, image: true },
  })
  return account
}

/**
 * Mirror the `list` procedure's canRevoke computation for mutation outputs so
 * the response never lies about revoke eligibility while the row is pending.
 */
async function resolveCanRevoke(args: {
  group: { archived: boolean }
  memberRole: GroupRole
  accountId: string
  invitedById: string
  groupId: string
  ledgerParticipantId: string | null
}): Promise<boolean> {
  if (args.group.archived) return false
  return canRevokeInvitation({
    role: args.memberRole,
    accountId: args.accountId,
    invitedById: args.invitedById,
    isUnused:
      args.memberRole === 'ADMIN'
        ? true
        : await isInvitationParticipantUnused({
            groupId: args.groupId,
            ledgerParticipantId: args.ledgerParticipantId,
          }),
  })
}

function mapUpdateError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err
  if (err instanceof InvitationError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  const message =
    err instanceof Error ? err.message : 'Unable to update invitation'
  if (/not found/i.test(message)) {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

async function assertInvitationRevocationAllowed(args: {
  groupId: string
  accountId: string
  role: GroupRole
  invitation: {
    invitedById: string
    ledgerParticipantId: string | null
    status: GroupInvitationStatus
  }
}) {
  if (args.invitation.status !== GroupInvitationStatus.PENDING) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only pending invitations can be revoked',
    })
  }
  const isUnused =
    args.role === 'ADMIN'
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

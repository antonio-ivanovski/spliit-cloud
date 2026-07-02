import { GroupInvitationStatus, prisma, type GroupRole } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  RevokeInvitationPreconditionError,
  acceptInvitation,
  acceptLinkInvitation,
  createEmailInvitation,
  createLinkInvitation,
  declineInvitation,
  getLinkInvitationPreview,
  getRevokeInvitationPreview,
  listGroupInvitations,
  listPendingEmailInvitationsForAccount,
  revokeInvitation,
  sendInvitationEmail,
} from '../../../lib/invitations'
import {
  createTRPCRouter,
  loadGroupContext,
  protectedProcedure,
  publicProcedure,
} from '../../init'

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
  // List pending invitations for a group (ADMIN only). The UI labels
  // this section "Pending invitations" / "Invitations awaiting
  // acceptance" and only acts on `PENDING` rows (revoke button), so
  // resolved invitations (accepted / declined / revoked) are
  // intentionally filtered out here. Resolved invitations still exist
  // in the database for audit purposes — see
  // `listGroupInvitations` for the unfiltered query.
  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      const { member } = await loadGroupContext({
        groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' })
      }
      const allInvitations = await listGroupInvitations(groupId)
      const invitations = allInvitations.filter(
        (invitation) => invitation.status === GroupInvitationStatus.PENDING,
      )
      return { invitations }
    }),

  // Create a single-use link invitation (ADMIN only). The raw token is
  // returned exactly once; subsequent reads only see the hash. The
  // web client surfaces the URL in a copyable card right after
  // generation.
  createLink: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        role: invitationRoleSchema.default('MEMBER'),
        temporaryName: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { member } = await loadGroupContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' })
      }
      const result = await createLinkInvitation({
        groupId: input.groupId,
        role: input.role as GroupRole,
        inviterAccountId: ctx.auth.user.id,
        temporaryName: input.temporaryName ?? null,
      })

      return {
        invitationId: result.invitation.id,
        inviteUrl: result.inviteUrl,
        expiresAt: result.invitation.expiresAt,
        temporaryName: result.invitation.temporaryName,
        role: result.invitation.role,
      }
    }),

  // Public preview of a link invitation. The accept page calls this
  // before showing the Accept button so unauthenticated visitors can
  // see the group name and inviter (and a clear error message when the
  // link is no longer usable). No auth is required because the URL
  // itself is the credential — and the helper returns only redacted
  // fields, not the full invitation row.
  previewLink: publicProcedure
    .input(z.object({ token: linkTokenSchema }))
    .query(async ({ input }) => {
      const preview = await getLinkInvitationPreview(input.token)
      return { preview }
    }),

  // Accept a link invitation for the current account. The helper
  // refuses expired / revoked / already-used tokens and the
  // double-active-member case.
  acceptLink: protectedProcedure
    .input(z.object({ token: linkTokenSchema }))
    .mutation(async ({ input: { token }, ctx }) => {
      const result = await acceptLinkInvitation({
        token,
        accountId: ctx.auth.user.id,
      })
      return { groupId: result.groupId, role: result.role }
    }),

  // Create an email invitation (ADMIN only). Today this is the only
  // invite kind; a link-invite sibling will sit next to it later.
  create: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        email: z.string().email(),
        role: invitationRoleSchema.default('MEMBER'),
        // Pending-only label that wins over the email wherever a
        // pending invitee is rendered.
        temporaryName: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' })
      }
      const invitation = await createEmailInvitation({
        groupId: input.groupId,
        email: input.email,
        role: input.role as GroupRole,
        inviterAccountId: ctx.auth.user.id,
        temporaryName: input.temporaryName ?? null,
      })

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
      await sendInvitationEmail({
        invitationId: invitation.id,
        groupId: group.id,
        groupName: group.name,
        inviterDisplayName: ctx.auth.user.name || ctx.auth.user.email,
        inviterRole: member.role,
        recipientEmail: invitation.email,
        recipientIsExistingUser: !!existingAccount,
      })

      return { invitationId: invitation.id }
    }),

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
    .query(async ({ input: { invitationId, groupId }, ctx }) => {
      const { member } = await loadGroupContext({
        groupId,
        accountId: ctx.auth.user.id,
      }).catch(() => {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not a member of this group',
        })
      })
      if (member.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can revoke invitations',
        })
      }
      try {
        return await getRevokeInvitationPreview({ invitationId, groupId })
      } catch (err) {
        throw mapRevokeError(err)
      }
    }),

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
        settleBalances: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input: { invitationId, settleBalances }, ctx }) => {
      const existing = await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
      })
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
        })
      }
      const { member } = await loadGroupContext({
        groupId: existing.groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' })
      }
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
    .mutation(async ({ input: { invitationId }, ctx }) => {
      await declineInvitation({
        invitationId,
        accountEmail: ctx.auth.user.email,
        accountId: ctx.auth.user.id,
      })
      return {}
    }),

  // Pending email invitations for the current account.
  listForAccount: protectedProcedure.query(async ({ ctx }) => {
    const invitations = await listPendingEmailInvitationsForAccount(
      ctx.auth.user.email,
    )
    return { invitations }
  }),
})

/**
 * Translate the helper errors into TRPC errors. The web client uses
 * `PRECONDITION_FAILED` to decide whether to re-render the revoke
 * dialog with the missing confirmation (e.g. unsettled balances
 * without `settleBalances`).
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

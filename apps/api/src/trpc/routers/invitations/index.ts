import { GroupRole, prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  listGroupInvitations,
  listPendingInvitationsForAccount,
  revokeInvitation,
  sendInvitationEmail,
} from '../../../lib/invitations'
import {
  createTRPCRouter,
  loadGroupContext,
  protectedProcedure,
} from '../../init'

// Only ADMIN and MEMBER roles are exposed in the invitation form. OWNER is
// reserved for the group creator; ownership transfers are a separate flow.
const invitationRoleSchema = z.enum(['ADMIN', 'MEMBER'])

export const invitationsRouter = createTRPCRouter({
  // List pending + historical invitations for a group (OWNER/ADMIN only).
  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      const { member } = await loadGroupContext({
        groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner/admin only' })
      }
      const invitations = await listGroupInvitations(groupId)
      return { invitations }
    }),

  // Create a new invitation (OWNER/ADMIN only).
  create: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        email: z.string().email(),
        role: invitationRoleSchema.default('MEMBER'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { group, member } = await loadGroupContext({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner/admin only' })
      }
      const invitation = await createInvitation({
        groupId: input.groupId,
        email: input.email,
        role: input.role as GroupRole,
        inviterAccountId: ctx.auth.user.id,
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

  // Revoke a pending invitation (OWNER/ADMIN only).
  revoke: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .mutation(async ({ input: { invitationId }, ctx }) => {
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
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner/admin only' })
      }
      await revokeInvitation({ invitationId, groupId: existing.groupId })
      return {}
    }),

  // Accept an invitation by id. Email must match the authenticated account.
  accept: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .mutation(async ({ input: { invitationId }, ctx }) => {
      const account = ctx.auth.user
      const member = await acceptInvitation({
        invitationId,
        accountId: account.id,
        accountEmail: account.email,
        accountDisplayName: account.name,
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
      })
      return {}
    }),

  // Pending invitations for the current account.
  listForAccount: protectedProcedure.query(async ({ ctx }) => {
    const invitations = await listPendingInvitationsForAccount(
      ctx.auth.user.email,
    )
    return { invitations }
  }),
})

import { GroupRole, GroupType } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  linkUnlinkedParticipantToAccount,
  linkUnlinkedParticipantToPendingInvite,
  listUnlinkedParticipants,
} from '../../../../lib/api'
import {
  createTRPCRouter,
  loadGroupContext,
  protectedProcedure,
} from '../../../init'
import { candidatesProcedure } from './candidates.procedure'

/**
 * Post-import admin flow: list unlinked participants for a group and
 * migrate one to an account as a one-way move. After the link, the
 * historical and future balances of the `LedgerParticipant` are
 * associated with the account and appear in account-level views.
 *
 * Both procedures require the caller to be an ADMIN of the group.
 */
export const importLinksRouter = createTRPCRouter({
  /**
   * Accounts and pending invitations that could be linked to an
   * unlinked imported participant.
   */
  candidates: candidatesProcedure,

  /**
   * List imported participants that are not yet linked to an account
   * or pending invitation.
   */
  listUnlinked: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      await loadGroupContext({ groupId, accountId: ctx.auth.user.id })
      const unlinked = await listUnlinkedParticipants(groupId)
      return { unlinked }
    }),

  /**
   * Link an unlinked imported participant to an account, email, or
   * pending invitation (exactly one).
   */
  link: protectedProcedure
    .input(
      z
        .object({
          groupId: z.string().min(1),
          ledgerParticipantId: z.string().min(1),
          accountId: z
            .string()
            .min(1)
            .optional()
            .describe(
              'Exactly one of accountId, email, or pendingInvitationId must be set.',
            ),
          email: z.string().email().optional(),
          pendingInvitationId: z.string().min(1).optional(),
        })
        .superRefine((value, ctx) => {
          if (!value.accountId && !value.email && !value.pendingInvitationId) {
            ctx.addIssue({
              code: 'custom',
              message:
                'Either accountId, email, or pendingInvitationId is required',
              path: ['accountId'],
            })
          }
        }),
    )
    .mutation(
      async ({
        input: {
          groupId,
          ledgerParticipantId,
          accountId,
          email,
          pendingInvitationId,
        },
        ctx,
      }) => {
        const { group, member } = await loadGroupContext({
          groupId,
          accountId: ctx.auth.user.id,
        })
        if (member.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only admins can link unlinked participants',
          })
        }
        if (group.groupType === GroupType.FRIEND) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Friend ledger member management is not allowed',
          })
        }

        try {
          if (pendingInvitationId) {
            return await linkUnlinkedParticipantToPendingInvite({
              groupId,
              ledgerParticipantId,
              pendingInvitationId,
              actor: { accountId: ctx.auth.user.id },
            })
          }

          let resolvedAccountId = accountId
          if (!resolvedAccountId) {
            const account = await (
              await import('@spliit/db')
            ).prisma.account.findFirst({
              where: { email: email!.toLowerCase() },
              select: { id: true },
            })
            if (!account) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: `No account exists for ${email}. Invite them via the Members tab first, then link.`,
              })
            }
            resolvedAccountId = account.id
          }

          return await linkUnlinkedParticipantToAccount({
            groupId,
            ledgerParticipantId,
            accountId: resolvedAccountId,
            actor: { accountId: ctx.auth.user.id },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Link failed'
          throw new TRPCError({ code: 'BAD_REQUEST', message })
        }
      },
    ),
})

import { GroupRole } from '@spliit/db'
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
   * List the destination candidates (existing active members and
   * pending EMAIL-type invitations) for the "link unlinked
   * participant" picker. See `candidates.procedure.ts` for the
   * cross-check that excludes the unlinked LP itself and the LPs
   * on the opposite side of any expense leg.
   */
  candidates: candidatesProcedure,

  /**
   * List unlinked `LedgerParticipant` rows in the group. The web uses
   * this to render the post-import admin link list.
   */
  listUnlinked: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .query(async ({ input: { groupId }, ctx }) => {
      await loadGroupContext({ groupId, accountId: ctx.auth.user.id })
      const unlinked = await listUnlinkedParticipants(groupId)
      return { unlinked }
    }),

  /**
   * One-way admin link: migrate an unlinked `LedgerParticipant` to
   * an account, or merge it into a pending EMAIL or LINK-type
   * invitation's materialized `LedgerParticipant`. The destination
   * `GroupMember` is created or reactivated in the account case; the
   * participant's `kind` flips to `ACCOUNT_MEMBER` and the
   * `displayName` is cleared. In the pending-invite case the unlinked
   * LP is deleted and its references are rewritten onto the
   * invitee's LP.
   *
   * The caller must supply either `accountId` (a known account),
   * `email` (we look up the account server-side), or
   * `pendingInvitationId` (merge into the invitee's LP).
   * `pendingInvitationId` takes precedence: when it is present, the
   * account-resolution branch is skipped and the email field (if
   * also supplied, possibly as a synthetic `*.placeholder.local`
   * for LINK-type) is ignored. Email matching is case-insensitive.
   * When no account exists for the email, the mutation rejects with
   * `NOT_FOUND` so the admin can invite the person via the regular
   * invite flow first.
   */
  link: protectedProcedure
    .input(
      z
        .object({
          groupId: z.string().min(1),
          ledgerParticipantId: z.string().min(1),
          accountId: z.string().min(1).optional(),
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
        const { member } = await loadGroupContext({
          groupId,
          accountId: ctx.auth.user.id,
        })
        if (member.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only admins can link unlinked participants',
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

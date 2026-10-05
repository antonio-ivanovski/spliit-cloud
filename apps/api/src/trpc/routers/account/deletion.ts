import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import {
  AccountDeletionError,
  cancelAccountDeletion,
  getDeletionPreview,
  requestAccountDeletion,
} from '../../../lib/auth/account-deletion'
import { protectedProcedure } from '../../init'
import {
  cancelDeletionOutputSchema,
  deletionPreviewOutputSchema,
  deletionStatusOutputSchema,
  requestDeletionOutputSchema,
} from '../../outputs/account'

function mapDeletionError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error
  if (error instanceof AccountDeletionError) {
    switch (error.code) {
      case 'sessionNotFresh':
        return new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error.message,
        })
      case 'noPendingRequest':
        return new TRPCError({ code: 'NOT_FOUND', message: error.message })
      default:
        return new TRPCError({ code: 'BAD_REQUEST', message: error.message })
    }
  }
  if (
    error instanceof Error &&
    /background jobs are disabled/i.test(error.message)
  ) {
    return new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message:
        'Account deletion needs the background worker, which is disabled on this deployment.',
    })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message:
      error instanceof Error ? error.message : 'Unable to process the request',
  })
}

/**
 * Account deletion (right-to-erasure) procedures. Shared expense history is
 * preserved in an anonymized form so other members' balances keep working;
 * everything account-scoped is removed after a 48-hour cancellable grace
 * period. All sign-in methods are deleted together — there is intentionally no
 * "keep one method" path.
 */
export const accountDeletionProcedures = {
  /**
   * Read-only summary for the delete-account dialog: group consequences,
   * pending invites, sign-in methods, and any pending request.
   */
  deletionPreview: protectedProcedure
    .output(deletionPreviewOutputSchema)
    .query(async ({ ctx }) => {
      try {
        return await getDeletionPreview(ctx.auth.user.id)
      } catch (error) {
        throw mapDeletionError(error)
      }
    }),

  /**
   * Lightweight pending-request status for the settings banner. Separate from
   * the preview so every settings visit stays cheap.
   */
  deletionStatus: protectedProcedure
    .output(deletionStatusOutputSchema)
    .query(async ({ ctx }) => {
      const request = await prisma.accountDeletionRequest.findUnique({
        where: { accountId: ctx.auth.user.id },
        select: { executeAt: true, keepDisplayName: true, status: true },
      })
      return {
        request:
          request?.status === 'PENDING' || request?.status === 'EXECUTING'
            ? {
                executeAt: request.executeAt,
                keepDisplayName: request.keepDisplayName,
                status: request.status,
              }
            : null,
      }
    }),

  /**
   * Start the flow. The typed email must match the account email and the
   * session must be fresh; execution is scheduled after the grace period and
   * announced by email.
   */
  requestDeletion: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().min(1).max(254),
        keepDisplayName: z.boolean().default(false),
        // Validated in `requestAccountDeletion` (friendly error); kept loose
        // here so blank/overlong values reach that check instead of zod.
        displayName: z.string().optional(),
        settleBalances: z.boolean().default(false),
      }),
    )
    .output(requestDeletionOutputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestAccountDeletion({
          accountId: ctx.auth.user.id,
          email: input.email,
          keepDisplayName: input.keepDisplayName,
          displayName: input.displayName,
          settleBalances: input.settleBalances,
          sessionCreatedAt: new Date(ctx.auth.session.createdAt),
        })
      } catch (error) {
        throw mapDeletionError(error)
      }
    }),

  /**
   * Cancel a pending request. The executor re-checks status, so even a missed
   * job cancel cannot delete the account.
   */
  cancelDeletion: protectedProcedure
    .output(cancelDeletionOutputSchema)
    .mutation(async ({ ctx }) => {
      try {
        return await cancelAccountDeletion(ctx.auth.user.id)
      } catch (error) {
        throw mapDeletionError(error)
      }
    }),
}

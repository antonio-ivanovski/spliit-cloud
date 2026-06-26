import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  LeaveGroupPreconditionError,
  archiveGroupForSelf,
  getLeavePreview,
  leaveGroup,
} from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

/**
 * Read-only summary the web client uses to render the leave-group dialog.
 * Returns the data the dialog needs in a single query:
 *   - the caller's role on this group,
 *   - whether the caller is the last active member,
 *   - whether the caller is the last admin,
 *   - whether the caller has unsettled balances,
 *   - the list of remaining admins (so the dialog can show who keeps control),
 *   - the list of promotable members (for the last-admin promotion selector).
 *
 * The preview never throws on a missing precondition — those checks live in
 * the `leave` mutation so the dialog can render the appropriate copy.
 */
export const leavePreviewProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId }, ctx }) => {
    try {
      return await getLeavePreview({
        groupId,
        accountId: ctx.auth.user.id,
      })
    } catch (err) {
      // Surface not-a-member / archived-group as a normal forbidden so the
      // UI can hide the leave affordance instead of crashing.
      throw mapLeaveError(err)
    }
  })

/**
 * Leave a group as an active member. Used by the dedicated "leave group"
 * entry point in the members page.
 *
 * Business rules (enforced inside `leaveGroup`):
 *   - caller must be an active member,
 *   - the group must not be archived,
 *   - if the caller is the last active member, `confirmDelete: true` must be
 *     supplied (the group is deleted in a single transaction),
 *   - if the caller is the last admin and other active members exist,
 *     `promoteMemberId` must point at another active member of the group,
 *   - if the caller has unsettled balances and `force` is not `true`, the
 *     mutation throws `PRECONDITION_FAILED` so the UI can prompt for the
 *     forced settlement,
 *   - on `force`, one reimbursement-style settlement expense is created per
 *     leg involving the leaving user before flipping the membership to
 *     `LEFT`.
 */
export const leaveGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      force: z.boolean().optional(),
      promoteMemberId: z.string().min(1).optional(),
      confirmDelete: z.boolean().optional(),
    }),
  )
  .mutation(
    async ({
      input: { groupId, force, promoteMemberId, confirmDelete },
      ctx,
    }) => {
      // Authenticate the caller as an active member before we start
      // counting admins / checking balances. `loadGroupContext` already
      // throws `FORBIDDEN` for non-members, but the call also guarantees
      // `group` is non-null so downstream helpers don't have to re-check.
      await loadGroupContext({
        groupId,
        accountId: ctx.auth.user.id,
      }).catch((err) => {
        throw mapLeaveError(err)
      })

      try {
        const result = await leaveGroup({
          groupId,
          actor: { accountId: ctx.auth.user.id },
          force,
          promoteMemberId,
          confirmDelete,
        })
        return result
      } catch (err) {
        throw mapLeaveError(err)
      }
    },
  )

/**
 * Translate the helper errors into TRPC errors. The web client uses
 * `PRECONDITION_FAILED` to decide whether to re-render the leave dialog
 * with the missing confirmation (e.g. unchecked "I understand" for
 * last-member delete, missing admin promotion target, or unsettled
 * balances without `force`).
 */
function mapLeaveError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err

  if (err instanceof LeaveGroupPreconditionError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
  }

  const message = err instanceof Error ? err.message : 'Unable to leave group'

  if (/not an active member/i.test(message)) {
    return new TRPCError({ code: 'FORBIDDEN', message })
  }
  if (/archived/i.test(message)) {
    return new TRPCError({ code: 'FORBIDDEN', message })
  }
  if (/invalid group id/i.test(message)) {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  if (/cannot promote yourself/i.test(message)) {
    return new TRPCError({ code: 'BAD_REQUEST', message })
  }
  if (/must be an active member/i.test(message)) {
    return new TRPCError({ code: 'BAD_REQUEST', message })
  }
  if (/archive-for-self/i.test(message)) {
    return new TRPCError({ code: 'BAD_REQUEST', message })
  }

  return new TRPCError({ code: 'BAD_REQUEST', message })
}

/**
 * Non-destructive alternative to the last-member leave flow. The default
 * action when the last active member leaves is to permanently delete the
 * group; this procedure lets the same caller instead archive the group
 * for themselves (set `Group.archived = true` plus the caller's per-account
 * hide preference) and keep the membership intact. The group becomes
 * read-only and disappears from the caller's main list, but the ledger,
 * expenses, and activity history are preserved.
 *
 * Only valid as the last active member. Other callers must use the
 * regular `leave` mutation (which keeps the group around anyway when
 * other members exist) or the admin-only `archive` mutation.
 */
export const archiveGroupForSelfProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .mutation(async ({ input: { groupId }, ctx }) => {
    try {
      const result = await archiveGroupForSelf({
        groupId,
        accountId: ctx.auth.user.id,
      })
      return result
    } catch (err) {
      throw mapLeaveError(err)
    }
  })

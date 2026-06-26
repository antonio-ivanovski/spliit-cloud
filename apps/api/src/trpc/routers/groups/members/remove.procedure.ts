import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  RemoveMemberPreconditionError,
  getRemoveMemberPreview,
  removeMember,
} from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * Read-only summary the web client uses to render the admin "remove
 * member" dialog. Returns the target's display name and whether they
 * have unsettled balances so the dialog can decide between the simple
 * confirm and the three-option variant (settle+remove, remove only,
 * cancel).
 */
export const removeMemberPreviewProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }))
  .query(async ({ input: { groupId, memberId }, ctx }) => {
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
        message: 'Only admins can remove members',
      })
    }
    try {
      return await getRemoveMemberPreview({ groupId, memberId })
    } catch (err) {
      throw mapRemoveError(err)
    }
  })

/**
 * Remove an active member from a group. Ledger participants and
 * historical expenses are intentionally preserved (the membership row
 * is flipped to `REMOVED` and `leftAt` is set so the active roster
 * hides them but balances still resolve correctly).
 *
 * The caller cannot remove themselves — admins must use the dedicated
 * "leave group" flow. Removing the last admin is rejected so the
 * group always keeps at least one active admin.
 *
 * Archived groups are read-only and reject the mutation.
 *
 * If the target member has unsettled balances the caller must supply
 * `settleBalances: true` (create settlement expenses for the legs
 * involving the target before flipping the membership) or
 * `settleBalances: false` (remove without touching the ledger). When
 * the flag is missing the mutation throws `PRECONDITION_FAILED` so the
 * web client can re-render the remove dialog with the missing
 * decision.
 */
export const removeMemberProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      memberId: z.string().min(1),
      settleBalances: z.boolean().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, memberId, settleBalances }, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can remove members',
      })
    }
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived; member management is disabled',
      })
    }
    if (member.id === memberId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'You cannot remove yourself here; use the leave group flow instead',
      })
    }
    try {
      await removeMember({
        groupId,
        memberId,
        settleBalances,
        actor: { accountId: ctx.auth.user.id },
      })
    } catch (err) {
      throw mapRemoveError(err)
    }
    return { memberId }
  })

function mapRemoveError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err
  if (err instanceof RemoveMemberPreconditionError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message })
  }
  const message = err instanceof Error ? err.message : 'Unable to remove member'
  if (/at least one admin/i.test(message)) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message })
  }
  if (/not found in this group/i.test(message)) {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  if (/not active/i.test(message)) {
    return new TRPCError({ code: 'BAD_REQUEST', message })
  }
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

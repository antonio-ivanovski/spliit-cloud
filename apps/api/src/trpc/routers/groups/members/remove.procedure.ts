import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { removeMember } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

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
 */
export const removeMemberProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      memberId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId, memberId }, ctx }) => {
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
        actor: { accountId: ctx.auth.user.id },
      })
    } catch (err) {
      throw mapMemberError(err)
    }
    return { memberId }
  })

function mapMemberError(err: unknown): TRPCError {
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

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { updateMemberRole } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * Promote a member to admin or demote an admin to member. The caller
 * must be an active ADMIN of the group, the target must be an active
 * member of the same group, and the caller cannot change their own
 * role through this mutation (use the leave flow to step down).
 *
 * Rejects with `PRECONDITION_FAILED` when the mutation would leave
 * the group without any active ADMIN (e.g. demoting the last admin).
 */
export const updateMemberRoleProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      memberId: z.string().min(1),
      role: z.enum(['ADMIN', 'MEMBER']),
    }),
  )
  .mutation(async ({ input: { groupId, memberId, role }, ctx }) => {
    const { member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can change member roles',
      })
    }
    if (member.id === memberId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'You cannot change your own role here; use the leave group flow instead',
      })
    }
    try {
      await updateMemberRole({
        groupId,
        memberId,
        role,
        actor: { accountId: ctx.auth.user.id },
      })
    } catch (err) {
      throw mapMemberError(err)
    }
    return { memberId, role }
  })

/**
 * Convert domain-level errors raised by the lib helper into tRPC errors
 * with stable codes the FE can branch on.
 */
function mapMemberError(err: unknown): TRPCError {
  const message = err instanceof Error ? err.message : 'Unable to update role'
  if (/at least one admin/i.test(message)) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message })
  }
  if (/not found in this group/i.test(message)) {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }
  if (/Only active members/i.test(message)) {
    return new TRPCError({ code: 'BAD_REQUEST', message })
  }
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

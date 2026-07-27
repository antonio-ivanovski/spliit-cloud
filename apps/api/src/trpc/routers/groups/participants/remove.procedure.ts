import { GroupRole, GroupType } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { RemoveMemberPreconditionError } from '../../../../lib/api/members'
import {
  SoftRemoveParticipantPreconditionError,
  getSoftRemoveParticipantPreview,
  softRemoveParticipant,
} from '../../../../lib/api/soft-remove-participant'
import { RevokeInvitationPreconditionError } from '../../../../lib/invitations'
import { loadGroupContext, protectedProcedure } from '../../../init'
import {
  participantRemovalOutputSchema,
  participantRemovalPreviewOutputSchema,
} from '../../../outputs/members'

function assertParticipantManagementAllowed(
  groupType: GroupType,
  role: GroupRole,
) {
  if (role !== GroupRole.ADMIN) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can manage participants',
    })
  }
  if (groupType === GroupType.FRIEND) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Friend ledger participant management is not allowed',
    })
  }
}

function mapRemoveError(error: unknown): never {
  if (
    error instanceof SoftRemoveParticipantPreconditionError ||
    error instanceof RemoveMemberPreconditionError ||
    error instanceof RevokeInvitationPreconditionError
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: error.message,
    })
  }
  if (error instanceof Error) {
    if (error.message === 'Participant not found') {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
    }
    if (
      error.message === 'Member not found in this group' ||
      error.message === 'Member is not active' ||
      error.message.includes('cannot remove yourself') ||
      error.message === 'Group must keep at least one admin' ||
      error.message === 'Friend ledger participant management is not allowed'
    ) {
      throw new TRPCError({
        code:
          error.message ===
          'Friend ledger participant management is not allowed'
            ? 'FORBIDDEN'
            : 'BAD_REQUEST',
        message: error.message,
      })
    }
  }
  throw error
}

export const removeParticipantPreviewProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      ledgerParticipantId: z.string().min(1),
    }),
  )
  .output(participantRemovalPreviewOutputSchema)
  .query(async ({ input: { groupId, ledgerParticipantId }, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    assertParticipantManagementAllowed(group.groupType, member.role)

    try {
      return await getSoftRemoveParticipantPreview({
        groupId,
        ledgerId: group.ledgerId,
        ledgerParticipantId,
      })
    } catch (error) {
      mapRemoveError(error)
    }
  })

export const removeParticipantProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      ledgerParticipantId: z.string().min(1),
      settleBalances: z.boolean().optional(),
    }),
  )
  .output(participantRemovalOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    assertParticipantManagementAllowed(group.groupType, member.role)
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived; participant management is disabled',
      })
    }

    try {
      return await softRemoveParticipant({
        groupId: input.groupId,
        ledgerId: group.ledgerId,
        ledgerParticipantId: input.ledgerParticipantId,
        settleBalances: input.settleBalances,
        actor: { accountId: ctx.auth.user.id },
        groupType: group.groupType,
      })
    } catch (error) {
      mapRemoveError(error)
    }
  })

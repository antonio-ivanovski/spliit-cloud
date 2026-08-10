import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { GroupType, LedgerParticipantKind, prisma } from '@spliit/db'

import { randomId } from '../../../../lib/api/shared'
import { loadGroupContext, protectedProcedure } from '../../../init'
import { createParticipantOutputSchema } from '../../../outputs/members'

/**
 * Create a name-only participant. This is intentionally available to every
 * active member: it creates a ledger row, not a membership or invitation.
 */
export const createParticipantProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      displayName: z.string().trim().min(1).max(120),
    }),
  )
  .output(createParticipantOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })

    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Archived groups cannot add participants',
      })
    }
    if (group.groupType === GroupType.FRIEND) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Friend ledger participants cannot be added here',
      })
    }
    if (!group.ledgerId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This group has no ledger',
      })
    }

    const participant = await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: group.ledgerId,
        kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
        displayName: input.displayName,
      },
      select: { id: true, displayName: true },
    })

    return {
      ledgerParticipantId: participant.id,
      displayName: participant.displayName!,
    }
  })

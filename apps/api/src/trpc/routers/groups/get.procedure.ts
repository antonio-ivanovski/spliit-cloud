import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getGroup } from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

export const getGroupProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId }, ctx }) => {
    const account = ctx.auth.user

    // Active members get the full payload; PENDING email invitees get a
    // read-only view so they can accept or decline. Skipped when the
    // account has no email (forward-compat with email-less accounts).
    const memberLookup = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: account.id } },
      include: { ledgerParticipant: true },
    })
    const isActiveMember = !!memberLookup && memberLookup.status === 'ACTIVE'

    if (!isActiveMember) {
      const invitation = account.email
        ? await prisma.groupInvitation.findFirst({
            where: {
              groupId,
              type: GroupInvitationType.EMAIL,
              status: GroupInvitationStatus.PENDING,
              email: { equals: account.email, mode: 'insensitive' },
            },
            select: { id: true, role: true, type: true },
          })
        : null
      if (!invitation) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not an active member of this group',
        })
      }
      const group = await getGroup(groupId)
      return {
        group,
        currentLedgerParticipantId: null,
        currentMember: null,
        currentInvitation: {
          id: invitation.id,
          role: invitation.role,
          type: invitation.type,
        },
      }
    }

    const { member } = await loadGroupContext({
      groupId,
      accountId: account.id,
    })
    const group = await getGroup(groupId)
    return {
      group,
      currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
      currentMember: {
        id: member.id,
        role: member.role,
        status: member.status,
      },
      currentInvitation: null,
    }
  })

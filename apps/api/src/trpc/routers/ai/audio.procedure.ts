import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { extractExpenseInformationFromAudio } from '../../../lib/audio-expense'
import { env } from '../../../lib/env'
import { resolveParticipantDisplayName } from '../../../lib/invitations/display'
import {
  enforceAiRequestLimit,
  loadGroupContext,
  protectedProcedure,
} from '../../init'
import { extractExpenseInformationFromAudioOutputSchema } from '../../outputs/ai'

const audioInputSchema = z.object({
  audioDataUrl: z
    .string()
    .regex(/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/)
    .max(1_500_000),
  groupId: z.string().min(1),
  locale: z.string().optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
})

export const extractExpenseInformationFromAudioProcedure = protectedProcedure
  .input(audioInputSchema)
  .output(extractExpenseInformationFromAudioOutputSchema)
  .mutation(async ({ input, ctx }) => {
    if (!env.PUBLIC_ENABLE_VOICE_EXPENSE) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Voice expense is disabled',
      })
    }

    const group = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.group.archived) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Archived groups are read-only',
      })
    }

    const participants = await prisma.ledgerParticipant.findMany({
      where: {
        ledgerId: group.group.ledger.id,
        removedAt: null,
      },
      select: {
        id: true,
        displayName: true,
        groupMember: { select: { account: { select: { name: true } } } },
        invitations: {
          where: { status: 'PENDING' },
          take: 1,
          select: { email: true, temporaryName: true },
        },
      },
    })

    enforceAiRequestLimit(
      ctx.auth.user.id,
      'ai.extractExpenseInformationFromAudio',
      ctx.resHeaders,
    )

    try {
      return await extractExpenseInformationFromAudio({
        audioDataUrl: input.audioDataUrl,
        locale: input.locale,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        group: {
          id: group.group.id,
          name: group.group.name,
          currency: group.group.ledger.currency,
          currencyCode: group.group.ledger.currencyCode,
        },
        participants: participants.map((participant) => ({
          id: participant.id,
          name: resolveParticipantDisplayName(participant),
        })),
      })
    } catch (error) {
      console.error(error)
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'The configured voice model could not process the recording',
      })
    }
  })

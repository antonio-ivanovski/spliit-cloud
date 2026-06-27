import { GroupRole } from '@spliit/db'
import { expenseFormSchema, groupFormSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { importGroup } from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

const importParticipantMappingSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('LINK_ACCOUNT'),
    sourceName: z.string().min(1),
    linkedAccountId: z.string().min(1),
    destLedgerParticipantId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('INVITE_BY_EMAIL'),
    sourceName: z.string().min(1),
    email: z.string().email(),
    destLedgerParticipantId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('INVITE_BY_LINK'),
    sourceName: z.string().min(1),
    destLedgerParticipantId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('UNLINKED_PARTICIPANT'),
    sourceName: z.string().min(1),
    destLedgerParticipantId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('LINK_EXISTING_PARTICIPANT'),
    sourceName: z.string().min(1),
    destLedgerParticipantId: z.string().min(1),
  }),
])

const importSourceMetaSchema = z.object({
  provider: z.string().min(1),
  sourceGroupId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
})

export const importGroupProcedure = protectedProcedure
  .input(
    z
      .object({
        targetGroupId: z.string().min(1).optional(),
        groupFormValues: groupFormSchema.optional(),
        participants: z.array(importParticipantMappingSchema).min(1),
        expenses: z.array(expenseFormSchema).min(0).default([]),
        sourceMeta: importSourceMetaSchema.optional(),
      })
      .superRefine((value, ctx) => {
        if (!value.targetGroupId && !value.groupFormValues) {
          ctx.addIssue({
            code: 'custom',
            message: 'Either targetGroupId or groupFormValues is required',
            path: ['targetGroupId'],
          })
        }
        const seen = new Set<string>()
        for (const [i, mapping] of value.participants.entries()) {
          const key = mapping.sourceName.toLowerCase()
          if (seen.has(key)) {
            ctx.addIssue({
              code: 'custom',
              message: 'Duplicate source participant name',
              path: ['participants', i, 'sourceName'],
            })
          }
          seen.add(key)
        }
      }),
  )
  .mutation(async ({ input, ctx }) => {
    if (input.targetGroupId) {
      const { member } = await loadGroupContext({
        groupId: input.targetGroupId,
        accountId: ctx.auth.user.id,
      })
      if (member.role !== GroupRole.ADMIN) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can import into an existing group',
        })
      }
    }

    try {
      const result = await importGroup(input, {
        accountId: ctx.auth.user.id,
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      if (/archived/i.test(message)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
      if (/not found/i.test(message)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
      throw new TRPCError({ code: 'BAD_REQUEST', message })
    }
  })

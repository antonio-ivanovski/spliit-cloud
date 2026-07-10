import { GroupRole } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  CurrencyMigrationError,
  getCurrencyMigrationPreview,
  migrateGroupCurrency,
  migrationPairChoicesSchema,
} from '../../../lib/api/currency-migration'
import { loadGroupContext, protectedProcedure } from '../../init'

const destinationInput = z.object({
  groupId: z.string().min(1),
  destinationCurrencyCode: z.string().min(1),
})

function assertMigrationAdmin(member: { role: string }, archived: boolean) {
  if (member.role !== GroupRole.ADMIN) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only group admins can migrate the group currency',
    })
  }
  if (archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Archived groups cannot migrate their currency',
    })
  }
}

export const migrateCurrencyPreviewProcedure = protectedProcedure
  .input(destinationInput)
  .query(async ({ input, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    assertMigrationAdmin(member, group.archived)
    return getCurrencyMigrationPreview({
      ...input,
      ledger: { id: group.ledgerId, currencyCode: group.ledger.currencyCode },
    })
  })

export const migrateCurrencyProcedure = protectedProcedure
  .input(
    destinationInput.extend({
      pairChoices: migrationPairChoicesSchema,
    }),
  )
  .mutation(async ({ input, ctx }) => {
    try {
      return await migrateGroupCurrency(input, { accountId: ctx.auth.user.id })
    } catch (err) {
      if (err instanceof TRPCError) throw err
      if (err instanceof CurrencyMigrationError) {
        const code =
          err.kind === 'PROVIDER_UNAVAILABLE'
            ? 'BAD_GATEWAY'
            : err.kind === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : 'BAD_REQUEST'
        throw new TRPCError({ code, message: err.message })
      }
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          err instanceof Error ? err.message : 'Currency migration failed',
      })
    }
  })

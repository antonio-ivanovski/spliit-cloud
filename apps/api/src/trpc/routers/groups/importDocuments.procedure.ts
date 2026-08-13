import { z } from 'zod'

import { discoverSpliitDocuments } from '../../../lib/import-documents'
import { protectedProcedure } from '../../init'

export const discoverImportDocumentsProcedure = protectedProcedure
  .input(
    z.object({
      sessionId: z.uuid(),
      sourceGroupId: z.string().min(1),
      exportVersion: z.literal(3).nullable().optional(),
      expenses: z.array(
        z.object({
          sourceCreatedAt: z.iso.datetime().nullable().optional(),
          title: z.string().min(1),
          sourceDocuments: z
            .array(
              z.object({
                sourceId: z.string().min(1),
                sourceUrl: z.url(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              }),
            )
            .optional(),
        }),
      ),
    }),
  )
  .output(
    z.object({
      documents: z.array(
        z.object({
          expenseIndex: z.number().int().nonnegative(),
          expenseTitle: z.string(),
          sourceDocumentId: z.string(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          token: z.string(),
        }),
      ),
      failures: z.array(
        z.object({
          expenseTitle: z.string(),
          documentCount: z.number().int().positive(),
          message: z.string(),
        }),
      ),
    }),
  )
  .mutation(({ input, ctx }) =>
    discoverSpliitDocuments({
      accountId: ctx.auth.user.id,
      sessionId: input.sessionId,
      sourceGroupId: input.sourceGroupId,
      expenses: input.expenses,
      exportVersion: input.exportVersion,
    }),
  )

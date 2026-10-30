import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import {
  findPersonalFileImportDuplicates,
  importPersonalFile,
  PersonalFileImportDuplicateError,
  preparePersonalFileImport,
  type PersonalFileImportRow,
} from '../../../lib/personal/import'
import {
  ensurePersonalProfile,
  parseIsoDate,
} from '../../../lib/personal/profile'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  personalFileImportDuplicatesOutputSchema,
  personalFileImportOutputSchema,
} from '../../outputs/personal'

const personalFileSourceSchema = z.object({
  baseFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  originFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})

const personalFileImportEntrySchema = z.object({
  kind: z.enum(['EXPENSE', 'INCOME']),
  amount: z.number().int().positive().max(2_147_483_647),
  currencyCode: z
    .union([z.string().regex(/^[A-Z]{3,4}$/), z.literal('')])
    .nullish(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = parseIsoDate(value)
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      )
    }, 'invalidDate'),
  categoryId: categoryIdSchema,
  title: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(2_000).nullish(),
})

const personalFileImportRowSchema = z.object({
  rowId: z.string().trim().min(1).max(100),
  rowNumber: z.number().int().positive(),
  source: personalFileSourceSchema,
  externalId: z.string().trim().min(1).max(200).nullish(),
  sourceAccount: z.string().trim().min(1).max(200).nullish(),
  entry: personalFileImportEntrySchema,
  approvedDuplicateKeys: z.array(z.string().min(1).max(200)).optional(),
})

const personalFileImportRowsSchema = z
  .array(personalFileImportRowSchema)
  .min(1)
  .max(10_000)
  .superRefine((rows, context) => {
    const seenRowIds = new Map<string, number>()
    const seenRowNumbers = new Map<number, number>()
    const seenOrigins = new Map<string, number>()
    for (const [index, row] of rows.entries()) {
      const prevId = seenRowIds.get(row.rowId)
      if (prevId !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [index, 'rowId'],
          message: `Row ID is duplicated (also used by row ${prevId + 1})`,
        })
      } else {
        seenRowIds.set(row.rowId, index)
      }
      const prevNumber = seenRowNumbers.get(row.rowNumber)
      if (prevNumber !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [index, 'rowNumber'],
          message: `Source row number is duplicated (also used at payload row ${prevNumber + 1})`,
        })
      } else {
        seenRowNumbers.set(row.rowNumber, index)
      }
      const prevOrigin = seenOrigins.get(row.source.originFingerprint)
      if (prevOrigin !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [index, 'source', 'originFingerprint'],
          message: `Origin fingerprint is duplicated (also used at payload row ${prevOrigin + 1})`,
        })
      } else {
        seenOrigins.set(row.source.originFingerprint, index)
      }
    }
    const totalApproved = rows.reduce(
      (sum, row) => sum + (row.approvedDuplicateKeys?.length ?? 0),
      0,
    )
    if (totalApproved > 50_000) {
      context.addIssue({
        code: 'custom',
        message:
          'Total approved duplicate keys across rows exceeds the limit of 50_000',
      })
    }
  })

function rejectSettlement(rows: PersonalFileImportRow[]): void {
  for (const row of rows) {
    if (row.entry.categoryId === 'settlement') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${row.rowNumber}: settlements cannot be imported`,
      })
    }
  }
}

export const personalImportRouter = createTRPCRouter({
  preview: protectedProcedure
    .input(z.object({ rows: personalFileImportRowsSchema }))
    .output(personalFileImportDuplicatesOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const profile = await ensurePersonalProfile(accountId)
      rejectSettlement(input.rows as PersonalFileImportRow[])
      const { rows } = await findPersonalFileImportDuplicates(
        accountId,
        profile.currencyCode,
        input.rows as PersonalFileImportRow[],
      )
      return { rows }
    }),

  commit: protectedProcedure
    .input(
      z.object({
        requestId: createRequestIdSchema,
        rows: personalFileImportRowsSchema,
      }),
    )
    .output(personalFileImportOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      try {
        const { value } = await runIdempotentCreate({
          accountId,
          operation: CREATE_OPERATIONS.personalImport,
          requestId: input.requestId,
          input: { rows: input.rows },
          transaction: { timeout: 120_000, maxWait: 30_000 },
          prepare: () =>
            preparePersonalFileImport(
              accountId,
              input.rows as PersonalFileImportRow[],
            ),
          execute: (tx, prepared) =>
            importPersonalFile(
              { accountId, rows: input.rows as PersonalFileImportRow[] },
              { tx, prepared },
            ),
        })
        return value
      } catch (error) {
        if (error instanceof PersonalFileImportDuplicateError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message,
            cause: {
              code: 'PERSONAL_IMPORT_DUPLICATE_CONFLICT',
              params: {
                rows: error.conflicts
                  .map((conflict) => conflict.rowNumber)
                  .join(', '),
              },
              conflicts: error.conflicts,
            },
          })
        }
        throw error
      }
    }),
})

export const importPersonalFileProcedure = personalImportRouter.commit

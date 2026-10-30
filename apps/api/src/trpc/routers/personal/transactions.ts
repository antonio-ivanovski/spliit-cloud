import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma, type Prisma } from '@spliit/db'
import {
  categoryIdSchema,
  personalEntryFilterSchema,
  personalTransactionCreateSchema,
  personalTransactionUpdateSchema,
} from '@spliit/domain'

import { suggestExpenseCategory } from '../../../lib/api/expenses/suggest-category'
import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import { randomId } from '../../../lib/api/shared'
import { mapWithConcurrency } from '../../../lib/concurrency'
import { getPersonalExpenseContext } from '../../../lib/personal/category-suggest'
import {
  ensurePersonalProfile,
  parseIsoDate,
} from '../../../lib/personal/profile'
import {
  exportPersonalEntries,
  listPersonalEntries,
} from '../../../lib/personal/queries'
import { deleteS3Object } from '../../../routes/upload'
import {
  createTRPCRouter,
  enforceCategoryAiRequestLimit,
  protectedProcedure,
} from '../../init'
import {
  createPersonalTransactionOutputSchema,
  deletePersonalTransactionOutputSchema,
  listPersonalTransactionsOutputSchema,
  personalAutoCategorizeOutputSchema,
  personalExportOutputSchema,
  personalSuggestCategoryOutputSchema,
  updatePersonalTransactionOutputSchema,
} from '../../outputs/personal'
import { personalAttachmentsRouter } from './attachments'

function resolveCategory(
  kind: 'EXPENSE' | 'INCOME',
  categoryId: string,
): string {
  if (categoryId === 'settlement') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Settlements cannot be recorded as personal income or expenses',
    })
  }
  if (kind === 'INCOME') {
    return categoryId === 'general' ? 'income' : categoryId
  }
  if (categoryId === 'income') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The income category is only valid for income entries',
    })
  }
  return categoryId
}

type PersonalClient = Prisma.TransactionClient | typeof prisma

async function loadOwnedEntry(
  accountId: string,
  id: string,
  client: PersonalClient = prisma,
) {
  const row = await client.personalTransaction.findFirst({
    where: { id, accountId },
  })
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Personal entry not found',
    })
  }
  return row
}

export const personalTransactionsRouter = createTRPCRouter({
  attachments: personalAttachmentsRouter,

  list: protectedProcedure
    .input(personalEntryFilterSchema)
    .output(listPersonalTransactionsOutputSchema)
    .query(async ({ input, ctx }) => {
      return listPersonalEntries(ctx.auth.user.id, input)
    }),

  create: protectedProcedure
    .input(
      z.object({
        requestId: createRequestIdSchema,
        entry: personalTransactionCreateSchema,
      }),
    )
    .output(createPersonalTransactionOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const { value } = await runIdempotentCreate({
        accountId,
        operation: CREATE_OPERATIONS.personalExpense,
        requestId: input.requestId,
        input,
        prepare: async () => {
          const profile = await ensurePersonalProfile(accountId)
          if (
            input.entry.currencyCode &&
            input.entry.currencyCode !== profile.currencyCode
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Personal entries use the personal currency',
            })
          }
          return {
            profile,
            categoryId: resolveCategory(
              input.entry.kind,
              input.entry.categoryId,
            ),
          }
        },
        execute: async (tx, prepared) => {
          const row = await tx.personalTransaction.create({
            data: {
              id: randomId(),
              accountId,
              kind: input.entry.kind,
              amount: input.entry.amount,
              currencyCode: prepared.profile.currencyCode,
              date: parseIsoDate(input.entry.date),
              categoryId: prepared.categoryId,
              title: input.entry.title || null,
              note: input.entry.note || null,
              source: 'PERSONAL',
            },
            select: { id: true },
          })
          return { id: row.id }
        },
      })
      return value
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedVersion: z.number().int().positive().optional(),
        entry: personalTransactionUpdateSchema,
      }),
    )
    .output(updatePersonalTransactionOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await loadOwnedEntry(accountId, input.id)
      if (row.source !== 'PERSONAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Shared entries are edited in their group',
        })
      }
      if (
        input.entry.currencyCode &&
        input.entry.currencyCode !== row.currencyCode
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Personal entries use the personal currency',
        })
      }

      const nextKind = input.entry.kind ?? row.kind
      const nextCategory = input.entry.categoryId
        ? resolveCategory(nextKind, input.entry.categoryId)
        : input.entry.kind && input.entry.kind !== row.kind
          ? resolveCategory(nextKind, row.categoryId)
          : undefined

      const data: Prisma.PersonalTransactionUpdateManyMutationInput = {
        version: { increment: 1 },
        ...(input.entry.kind ? { kind: input.entry.kind } : {}),
        ...(input.entry.amount !== undefined
          ? { amount: input.entry.amount }
          : {}),
        ...(input.entry.date ? { date: parseIsoDate(input.entry.date) } : {}),
        ...(nextCategory ? { categoryId: nextCategory } : {}),
        ...(input.entry.title !== undefined
          ? { title: input.entry.title || null }
          : {}),
        ...(input.entry.note !== undefined
          ? { note: input.entry.note || null }
          : {}),
        // Overriding one materialized occurrence detaches it from its plan
        // so future occurrences keep following the series template.
        ...((row as { personalRecurringSeriesId?: string | null })
          .personalRecurringSeriesId
          ? { personalRecurringSeriesId: null, recurrenceSequence: null }
          : {}),
      }

      const result = await prisma.personalTransaction.updateMany({
        where: {
          id: input.id,
          accountId,
          source: 'PERSONAL',
          ...(input.expectedVersion ? { version: input.expectedVersion } : {}),
        },
        data,
      })
      if (result.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This entry changed. Refresh and try again.',
        })
      }
      return { id: input.id }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(deletePersonalTransactionOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await prisma.personalTransaction.findFirst({
        where: { id: input.id, accountId },
        include: { attachments: { select: { url: true } } },
      })
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Personal entry not found',
        })
      }
      if (row.source !== 'PERSONAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Exclude shared entries instead of deleting them',
        })
      }
      // The delete cascades to `PersonalAttachment` rows; S3 objects are
      // removed best-effort after the commit, but only when no other
      // attachment row still references the URL. Rows of this entry are
      // excluded so the check is correct even before the cascade is visible.
      const urls = [...new Set(row.attachments.map((item) => item.url))]
      await prisma.personalTransaction.delete({ where: { id: row.id } })
      for (const url of urls) {
        const remaining = await prisma.personalAttachment.count({
          where: {
            url,
            NOT: { personalTransactionId: row.id },
          },
        })
        if (remaining > 0) continue
        try {
          await deleteS3Object(url)
        } catch (error) {
          console.warn(
            '[personal-attachments] failed to delete S3 object:',
            error,
          )
        }
      }
      return { ok: true as const }
    }),

  setCategory: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        categoryId: categoryIdSchema,
        expectedVersion: z.number().int().positive().optional(),
      }),
    )
    .output(updatePersonalTransactionOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await loadOwnedEntry(accountId, input.id)
      if (input.categoryId === 'settlement') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Settlements cannot be personal categories',
        })
      }

      if (row.source === 'PERSONAL') {
        // Manual overrides detach a generated row from its plan so future
        // occurrences keep following the series template. This matches
        // `transactions.update`.
        const updated = await prisma.personalTransaction.updateMany({
          where: {
            id: row.id,
            accountId,
            source: 'PERSONAL',
            ...(input.expectedVersion
              ? { version: input.expectedVersion }
              : {}),
          },
          data: {
            categoryId: input.categoryId,
            version: { increment: 1 },
            ...((row as { personalRecurringSeriesId?: string | null })
              .personalRecurringSeriesId
              ? { personalRecurringSeriesId: null, recurrenceSequence: null }
              : {}),
          },
        })
        if (updated.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This entry changed. Refresh and try again.',
          })
        }
        return { id: row.id }
      }

      if (!row.sourceExpenseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This snapshot has no live group expense to override',
        })
      }

      const changed = await prisma.$transaction(async (tx) => {
        const updated = await tx.personalTransaction.updateMany({
          where: {
            id: row.id,
            accountId,
            source: 'GROUP',
            ...(input.expectedVersion
              ? { version: input.expectedVersion }
              : {}),
          },
          data: {
            categoryId: input.categoryId,
            version: { increment: 1 },
          },
        })
        if (updated.count === 0) return false
        await tx.personalExpenseOverride.upsert({
          where: {
            accountId_expenseId: {
              accountId,
              expenseId: row.sourceExpenseId!,
            },
          },
          create: {
            id: randomId(),
            accountId,
            expenseId: row.sourceExpenseId!,
            categoryId: input.categoryId,
          },
          update: { categoryId: input.categoryId },
        })
        return true
      })
      if (!changed) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This entry changed. Refresh and try again.',
        })
      }
      return { id: row.id }
    }),

  exportCsv: protectedProcedure
    .input(personalEntryFilterSchema)
    .output(personalExportOutputSchema)
    .query(async ({ input, ctx }) => {
      return exportPersonalEntries(ctx.auth.user.id, input)
    }),

  suggestCategory: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1),
        locale: z.string().optional(),
        allowAi: z.boolean().optional(),
      }),
    )
    .output(personalSuggestCategoryOutputSchema)
    .mutation(async ({ input, ctx }) => {
      return suggestExpenseCategory({
        loadContext: (limit) =>
          getPersonalExpenseContext(ctx.auth.user.id, limit),
        title: input.title,
        locale: input.locale,
        allowAi: input.allowAi,
        beforeAi: () =>
          enforceCategoryAiRequestLimit(
            ctx.auth.user.id,
            'personal.transactions.suggestCategory',
            ctx.resHeaders,
          ),
      })
    }),

  autoCategorize: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(25) }))
    .output(personalAutoCategorizeOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const rows = await prisma.personalTransaction.findMany({
        where: {
          accountId,
          kind: 'EXPENSE',
          categoryId: 'general',
          title: { not: null },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        select: {
          id: true,
          title: true,
          source: true,
          sourceExpenseId: true,
        },
      })
      const candidates = rows.filter(
        (row) => row.title && row.title.trim().length >= 3,
      )
      const suggestions = await mapWithConcurrency(candidates, 3, (row) =>
        suggestExpenseCategory({
          loadContext: (limit) => getPersonalExpenseContext(accountId, limit),
          title: row.title!,
          allowAi: true,
          // Charge the AI bucket only when the provider actually runs.
          beforeAi: () =>
            enforceCategoryAiRequestLimit(
              accountId,
              'personal.transactions.autoCategorize',
              ctx.resHeaders,
            ),
        }),
      )

      let applied = 0
      let skipped = 0
      for (let index = 0; index < candidates.length; index += 1) {
        const row = candidates[index]!
        const categoryId = suggestions[index]?.categoryId
        if (!categoryId || categoryId === 'general') {
          skipped += 1
          continue
        }

        if (row.source === 'PERSONAL') {
          // System-driven auto-categorization intentionally keeps the series
          // link: only explicit user edits (update/setCategory) detach a
          // generated row so future occurrences keep following the template.
          const result = await prisma.personalTransaction.updateMany({
            where: {
              id: row.id,
              accountId,
              source: 'PERSONAL',
              categoryId: 'general',
            },
            data: { categoryId, version: { increment: 1 } },
          })
          applied += result.count
          skipped += result.count === 0 ? 1 : 0
          continue
        }
        if (!row.sourceExpenseId) {
          skipped += 1
          continue
        }

        try {
          const changed = await prisma.$transaction(async (tx) => {
            const updated = await tx.personalTransaction.updateMany({
              where: {
                id: row.id,
                accountId,
                source: 'GROUP',
                categoryId: 'general',
              },
              data: { categoryId, version: { increment: 1 } },
            })
            if (updated.count === 0) return 0
            await tx.personalExpenseOverride.upsert({
              where: {
                accountId_expenseId: {
                  accountId,
                  expenseId: row.sourceExpenseId!,
                },
              },
              create: {
                id: randomId(),
                accountId,
                expenseId: row.sourceExpenseId!,
                categoryId,
              },
              update: { categoryId },
            })
            return 1
          })
          applied += changed
          skipped += changed === 0 ? 1 : 0
        } catch {
          skipped += 1
        }
      }

      return { scanned: candidates.length, applied, skipped }
    }),

  exclude: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(deletePersonalTransactionOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await loadOwnedEntry(accountId, input.id)
      if (row.source !== 'GROUP') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only shared entries can be excluded',
        })
      }

      if (row.sourceExpenseId) {
        await prisma.$transaction([
          prisma.personalExpenseOverride.upsert({
            where: {
              accountId_expenseId: {
                accountId,
                expenseId: row.sourceExpenseId,
              },
            },
            create: {
              id: randomId(),
              accountId,
              expenseId: row.sourceExpenseId,
              state: 'EXCLUDE',
            },
            update: { state: 'EXCLUDE' },
          }),
          prisma.personalTransaction.delete({ where: { id: row.id } }),
        ])
      } else {
        await prisma.personalTransaction.delete({ where: { id: row.id } })
      }
      return { ok: true as const }
    }),
})

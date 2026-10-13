import { Effect } from 'effect'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { getCurrency, swapPairBaseForExpense } from '@spliit/domain'

import {
  authorizeSwapAccess,
  mapSwapErrorToTRPC,
} from '../../../lib/currency-swap/access'
import {
  planSwapPreviewEffect,
  toSwapExpenseInput,
} from '../../../lib/currency-swap/pipeline'
import { FxLive } from '../../../lib/fx/service'
import { apiProcedure } from '../../init'
import {
  swapPreviewOutputSchema,
  swapRateModesSchema,
} from '../../outputs/currency-swap'

const PREVIEW_LIMIT = 500
const PREVIEW_TRUNCATE = 5000

export const swapPreviewProcedure = apiProcedure('spliit:groups:read')
  .input(
    z.object({
      groupId: z.string().min(1),
      targetCurrencyCode: z.string().min(3).max(4),
      modes: swapRateModesSchema,
      limit: z.number().int().min(1).max(PREVIEW_LIMIT).default(200),
      cursor: z.number().int().min(0).default(0),
      /**
       * Scope the plan to one conversion pair (BASE of `BASE|TARGET`). Only
       * that pair's rates are fetched, so retrying a failed pair stays cheap no
       * matter how many pairs the group has. Rows, counts and sums in the
       * response are pair-scoped; omit for the full preview.
       */
      pairBase: z.string().min(3).max(4).optional(),
    }),
  )
  .output(swapPreviewOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group, ledger, oldCode, newCode } = await authorizeSwapAccess({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      targetCurrencyCode: input.targetCurrencyCode,
      action: 'preview',
    })

    const total = await prisma.expense.count({
      where: { ledgerId: ledger.id },
    })
    const rows = await prisma.expense.findMany({
      where: { ledgerId: ledger.id },
      select: {
        id: true,
        title: true,
        expenseDate: true,
        amount: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
        conversionSource: true,
      },
      orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
      take: Math.min(total, PREVIEW_TRUNCATE) + 1,
    })
    const truncated = rows.length > PREVIEW_TRUNCATE
    const sliced = truncated ? rows.slice(0, PREVIEW_TRUNCATE) : rows
    const inputs = sliced.map(toSwapExpenseInput)
    // Single-pair scope: keep only expenses routed through the requested
    // pair base (same rule as the pair cards). Cleared rows belong to no
    // pair and drop out. The set below is a subset of the capped page
    // source, so no second truncation applies.
    const pairBase = input.pairBase?.toUpperCase() ?? null
    const scopedInputs = pairBase
      ? inputs.filter(
          (expense) =>
            swapPairBaseForExpense(expense, oldCode, newCode) === pairBase,
        )
      : inputs
    const scopedIds = pairBase
      ? new Set(scopedInputs.map((expense) => expense.id))
      : null

    const preview = await Effect.runPromise(
      Effect.provide(
        planSwapPreviewEffect(scopedInputs, {
          oldCode,
          newCode,
          modes: input.modes,
        }),
        FxLive,
      ),
    ).catch((cause) => mapSwapErrorToTRPC(cause))

    const byId = new Map(preview.rows.map((r) => [r.id, r]))
    const scopeRows = scopedIds
      ? sliced.filter((e) => scopedIds.has(e.id))
      : sliced
    const page = scopeRows.slice(input.cursor, input.cursor + input.limit)
    const [budgetCount, activeRecurringCount] = await Promise.all([
      prisma.groupBudget.count({ where: { groupId: group.id } }),
      prisma.recurringExpenseSeries.count({
        where: { ledgerId: ledger.id, status: 'ACTIVE' },
      }),
    ])
    const warnings: string[] = []
    const oldDigits = getCurrency(oldCode)?.decimal_digits ?? 2
    const newDigits = getCurrency(newCode)?.decimal_digits ?? 2
    if (oldDigits !== newDigits) {
      warnings.push('minor-units')
    }
    if (budgetCount > 0) warnings.push('budgets-stale')
    if (activeRecurringCount > 0) warnings.push('recurring-stale')
    if (preview.rows.some((r) => r.warning === 'exact-to-custom')) {
      warnings.push('exact-to-custom')
    }
    if (preview.rows.some((r) => r.warning === 'fixed-fallback')) {
      warnings.push('fixed-fallback')
    }
    return {
      oldCode: preview.oldCode,
      newCode: preview.newCode,
      expenseCount: scopedIds ? scopeRows.length : total,
      truncated,
      rows: page.map((e) => {
        const planned = byId.get(e.id)!
        return {
          id: `${e.id}`,
          expenseId: e.id,
          title: e.title,
          expenseDate: e.expenseDate.toISOString().slice(0, 10),
          kind: planned.kind,
          oldAmount: planned.oldAmount,
          newAmount: planned.newAmount,
          newOriginalAmount: planned.newOriginalAmount,
          newOriginalCurrency: planned.newOriginalCurrency,
          newConversionRate: planned.newConversionRate,
          newConversionSource: planned.newConversionSource,
          rateUsed: planned.rateUsed,
          rateDate: planned.rateDate,
          ...(planned.warning ? { warning: planned.warning } : {}),
        }
      }),
      missingRateCount: preview.missingRateCount,
      sumOld: preview.sumOld,
      sumNew: preview.sumNew,
      budgetCount,
      activeRecurringCount,
      warnings,
    }
  })

import { TRPCError } from '@trpc/server'
import { Effect } from 'effect'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import {
  computeSwapTemplateRateKeys,
  convertMinorUnitsByRate,
  planSwapTemplate,
} from '@spliit/domain'
import { getCurrency } from '@spliit/domain/currency'
import type { RecurringExpenseTemplate } from '@spliit/domain/recurring-expenses'

import {
  buildGroupActivityData,
  logActivity,
  planNotificationForActivity,
} from '../../../lib/api/activities'
import { getApiBoss } from '../../../lib/api/boss'
import {
  authorizeSwapAccess,
  mapSwapErrorToTRPC,
} from '../../../lib/currency-swap/access'
import {
  planSwapPreviewEffect,
  fetchSwapTemplateRatesEffect,
  toSwapExpenseInput,
} from '../../../lib/currency-swap/pipeline'
import { FxLive } from '../../../lib/fx/service'
import { apiProcedure } from '../../init'
import {
  swapExecuteOutputSchema,
  swapRateModesSchema,
} from '../../outputs/currency-swap'

const EXECUTE_LIMIT = 5000

function scaleLegsWithDrift(
  legs: Array<{ ledgerParticipantId: string; shares: number }>,
  rate: number,
  oldCode: string,
  newCode: string,
  targetTotal: number,
) {
  const scaled = legs.map((leg) => ({
    ...leg,
    shares: convertMinorUnitsByRate(leg.shares, rate, oldCode, newCode),
  }))
  const diff = targetTotal - scaled.reduce((sum, leg) => sum + leg.shares, 0)
  if (scaled.length > 0) scaled[0]!.shares += diff
  return scaled
}

type TemplateMoneyPlan = {
  kind: 'simple' | 'cleared' | 'fresh' | 'bridged'
  rate: number | null
  newAmount: number
  newOriginalAmount: number | null
  newOriginalCurrency: string | null
  newConversionRate: number | null
  newConversionSource: 'EXCHANGE' | 'CUSTOM' | 'EXACT' | null
  warning?: string
}

/**
 * Scale the BY_AMOUNT money legs stored inside a recurring template. The
 * template JSON mirrors the expense row shape (`paidByList`, `paidFor`,
 * `items[].paidFor`, `itemizedRemainder.paidFor`), so the same drift-to-
 * first-leg rule as materialized expenses applies. Only `simple`-lane templates
 * scale legs: cleared templates carry no conversion legs, and fresh/bridged
 * templates keep third-currency legs in original units (same as their
 * materialized counterparts, which the expense branch skips).
 */
function scaleTemplateMoneyLegs(
  template: RecurringExpenseTemplate,
  kind: 'simple' | 'cleared' | 'fresh' | 'bridged',
  rate: number,
  oldCode: string,
  newCode: string,
  newAmount: number,
): RecurringExpenseTemplate {
  // Cleared templates carry no conversion legs, and fresh/bridged templates
  // keep third-currency legs in original units — the same rows the expense
  // branch skips (`plan.kind === 'simple'`).
  if (kind !== 'simple') return template
  const scaled: RecurringExpenseTemplate = {
    ...template,
    paidByList:
      template.paidBySplitMode === 'BY_AMOUNT'
        ? scaleLegsWithDrift(
            template.paidByList,
            rate,
            oldCode,
            newCode,
            newAmount,
          )
        : template.paidByList,
    paidFor:
      template.splitMode === 'BY_AMOUNT' || template.splitMode === 'ITEMIZED'
        ? scaleLegsWithDrift(
            template.paidFor,
            rate,
            oldCode,
            newCode,
            newAmount,
          )
        : template.paidFor,
  }
  let itemsTotal = 0
  const items = template.items.map((item) => {
    const newUnitPrice = convertMinorUnitsByRate(
      item.unitPrice,
      rate,
      oldCode,
      newCode,
    )
    const newItemAmount = convertMinorUnitsByRate(
      item.amount,
      rate,
      oldCode,
      newCode,
    )
    itemsTotal += newItemAmount
    return {
      ...item,
      unitPrice: newUnitPrice,
      amount: newItemAmount,
      paidFor:
        item.splitMode === 'BY_AMOUNT'
          ? scaleLegsWithDrift(
              item.paidFor,
              rate,
              oldCode,
              newCode,
              newItemAmount,
            )
          : item.paidFor,
    }
  })
  const itemizedRemainder =
    template.itemizedRemainder &&
    template.itemizedRemainder.splitMode === 'BY_AMOUNT'
      ? {
          ...template.itemizedRemainder,
          paidFor: scaleLegsWithDrift(
            template.itemizedRemainder.paidFor,
            rate,
            oldCode,
            newCode,
            newAmount - itemsTotal,
          ),
        }
      : template.itemizedRemainder
  return { ...scaled, items, itemizedRemainder }
}

export const swapExecuteProcedure = apiProcedure('spliit:groups:manage')
  .input(
    z.object({
      groupId: z.string().min(1),
      targetCurrencyCode: z.string().min(3).max(4),
      modes: swapRateModesSchema,
    }),
  )
  .output(swapExecuteOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group, ledger, oldCode, newCode } = await authorizeSwapAccess({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      targetCurrencyCode: input.targetCurrencyCode,
      action: 'execute',
    })
    const targetCurrency = getCurrency(newCode)
    if (!targetCurrency) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported target currency: ${newCode}`,
      })
    }

    const expenses = await prisma.expense.findMany({
      where: { ledgerId: ledger.id },
      select: {
        id: true,
        expenseDate: true,
        amount: true,
        splitMode: true,
        paidBySplitMode: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
        conversionSource: true,
        paidByList: {
          select: { ledgerParticipantId: true, shares: true },
        },
        paidFor: { select: { ledgerParticipantId: true, shares: true } },
        items: {
          select: {
            id: true,
            unitPrice: true,
            amount: true,
            splitMode: true,
            paidFor: {
              select: { ledgerParticipantId: true, shares: true },
            },
          },
        },
        itemizedRemainder: {
          select: {
            splitMode: true,
            paidFor: {
              select: { ledgerParticipantId: true, shares: true },
            },
          },
        },
      },
      orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
      take: EXECUTE_LIMIT + 1,
    })
    if (expenses.length > EXECUTE_LIMIT) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Too many expenses for a currency swap (max ${EXECUTE_LIMIT})`,
      })
    }

    const preview = await Effect.runPromise(
      Effect.provide(
        planSwapPreviewEffect(expenses.map(toSwapExpenseInput), {
          oldCode,
          newCode,
          modes: input.modes,
        }),
        FxLive,
      ),
    ).catch((cause) => mapSwapErrorToTRPC(cause))
    if (preview.missingRateCount > 0) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `${preview.missingRateCount} expense(s) are missing a rate for this swap`,
      })
    }
    const planById = new Map(preview.rows.map((row) => [row.id, row]))
    // Templates resolve at the execution date (per-pair override still wins
    // via `planSwapTemplate`). Expense rows plan per occurrence date, so a
    // perDate pair with no occurrence on the execution date needs one extra
    // fetch — otherwise execute would block on a template missing-rate that
    // preview never promised. Missing template rates still block exactly
    // like missing expense rates.
    const executionDate = new Date().toISOString().slice(0, 10)
    const seriesRows = await prisma.recurringExpenseSeries.findMany({
      where: { ledgerId: ledger.id },
      select: { id: true, templateVersion: true, template: true },
    })
    const templateInputs = seriesRows.map((series) => {
      const template = series.template as unknown as RecurringExpenseTemplate
      return {
        id: series.id,
        amount: template.amount,
        originalAmount: template.originalAmount,
        originalCurrency: template.originalCurrency,
        conversionRate: template.conversionRate,
        conversionSource: template.conversionSource,
      }
    })
    const templateRateKeys = computeSwapTemplateRateKeys(
      templateInputs,
      oldCode,
      newCode,
      input.modes,
      executionDate,
    )
    const templateRates = await Effect.runPromise(
      Effect.provide(
        fetchSwapTemplateRatesEffect(
          templateRateKeys,
          Object.fromEntries(
            preview.rows
              .filter((row) => row.rateUsed != null && row.rateDate)
              .map((row) => [
                `${row.rateDate}|${oldCode}|${newCode}`,
                row.rateUsed as number,
              ]),
          ),
        ),
        FxLive,
      ),
    ).catch((cause) => mapSwapErrorToTRPC(cause))
    const templateFallbackKeys = templateRates.fallbackKeys
    // Merge template-date rates back into the pair namespaces so an override
    // and an execution-date fetch for the same pair agree (`planSwapTemplate`
    // prefers the override; perDate prefers the execution-date key).
    const ratesByKey: Record<string, number> = templateRates.ratesByKey
    const templatePlans = new Map<string, TemplateMoneyPlan>()
    for (const series of seriesRows) {
      const template = series.template as unknown as RecurringExpenseTemplate
      const planned = planSwapTemplate(
        {
          id: series.id,
          amount: template.amount,
          originalAmount: template.originalAmount,
          originalCurrency: template.originalCurrency,
          conversionRate: template.conversionRate,
          conversionSource: template.conversionSource,
        },
        oldCode,
        newCode,
        input.modes,
        ratesByKey,
        executionDate,
        templateFallbackKeys,
      )
      if (!planned || planned.rateUsed == null) {
        // Cleared templates already sit in the target currency (no rate);
        // plan as a no-rate conversion instead of blocking.
        const cleared =
          planned?.kind === 'cleared' ||
          ((template.originalCurrency?.toUpperCase() ?? null) ===
            newCode.toUpperCase() &&
            template.conversionSource != null)
        if (!cleared) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: `Recurring template ${series.id} is missing a rate for this swap`,
          })
        }
      }
      const clearedPlan: {
        kind: 'simple' | 'cleared' | 'fresh' | 'bridged'
        newAmount: number
        newOriginalAmount: number | null
        newOriginalCurrency: string | null
        newConversionRate: number | null
        newConversionSource: 'EXCHANGE' | 'CUSTOM' | 'EXACT' | null
        rateUsed: number | null
        warning?: string
      } =
        planned ??
        ({
          kind: 'cleared' as const,
          newAmount: template.originalAmount ?? template.amount,
          newOriginalAmount: null,
          newOriginalCurrency: null,
          newConversionRate: null,
          newConversionSource: null,
          rateUsed: null,
        } as const)
      templatePlans.set(series.id, {
        kind: clearedPlan.kind,
        rate: clearedPlan.rateUsed,
        newAmount: clearedPlan.newAmount,
        newOriginalAmount: clearedPlan.newOriginalAmount,
        newOriginalCurrency: clearedPlan.newOriginalCurrency,
        newConversionRate: clearedPlan.newConversionRate,
        newConversionSource: clearedPlan.newConversionSource,
        ...('warning' in clearedPlan && clearedPlan.warning
          ? { warning: clearedPlan.warning }
          : {}),
      })
    }
    const boss = await getApiBoss()

    let seriesTemplatesConverted = 0
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${group.id} FOR UPDATE`
      for (const expense of expenses) {
        const plan = planById.get(expense.id)
        if (!plan) continue
        await tx.expense.update({
          where: { id: expense.id },
          data: {
            amount: plan.newAmount,
            originalAmount: plan.newOriginalAmount,
            originalCurrency: plan.newOriginalCurrency,
            conversionRate: plan.newConversionRate,
            conversionSource: plan.newConversionSource,
            version: { increment: 1 },
          },
        })
        if (plan.kind === 'simple' && plan.rateUsed) {
          const rate = plan.rateUsed
          if (expense.paidBySplitMode === 'BY_AMOUNT') {
            for (const leg of scaleLegsWithDrift(
              expense.paidByList,
              rate,
              oldCode,
              newCode,
              plan.newAmount,
            )) {
              await tx.expensePaidBy.update({
                where: {
                  expenseId_ledgerParticipantId: {
                    expenseId: expense.id,
                    ledgerParticipantId: leg.ledgerParticipantId,
                  },
                },
                data: { shares: leg.shares },
              })
            }
          }
          if (
            expense.splitMode === 'BY_AMOUNT' ||
            expense.splitMode === 'ITEMIZED'
          ) {
            // ITEMIZED top-level paidFor is a stored aggregate of the items
            // (see create-expense); it must move with the new total.
            for (const leg of scaleLegsWithDrift(
              expense.paidFor,
              rate,
              oldCode,
              newCode,
              plan.newAmount,
            )) {
              await tx.expensePaidFor.update({
                where: {
                  expenseId_ledgerParticipantId: {
                    expenseId: expense.id,
                    ledgerParticipantId: leg.ledgerParticipantId,
                  },
                },
                data: { shares: leg.shares },
              })
            }
          }
          let newItemsTotal = 0
          for (const item of expense.items) {
            const newUnitPrice = convertMinorUnitsByRate(
              item.unitPrice,
              rate,
              oldCode,
              newCode,
            )
            const newItemAmount = convertMinorUnitsByRate(
              item.amount,
              rate,
              oldCode,
              newCode,
            )
            newItemsTotal += newItemAmount
            await tx.expenseItem.update({
              where: { id: item.id },
              data: { unitPrice: newUnitPrice, amount: newItemAmount },
            })
            if (item.splitMode === 'BY_AMOUNT') {
              for (const leg of scaleLegsWithDrift(
                item.paidFor,
                rate,
                oldCode,
                newCode,
                newItemAmount,
              )) {
                await tx.expenseItemPaidFor.update({
                  where: {
                    expenseItemId_ledgerParticipantId: {
                      expenseItemId: item.id,
                      ledgerParticipantId: leg.ledgerParticipantId,
                    },
                  },
                  data: { shares: leg.shares },
                })
              }
            }
          }
          if (
            expense.itemizedRemainder &&
            expense.itemizedRemainder.splitMode === 'BY_AMOUNT'
          ) {
            // Filler target moves with independent item rounding, so derive
            // it from the converted items rather than the converted total.
            const newFiller = plan.newAmount - newItemsTotal
            for (const leg of scaleLegsWithDrift(
              expense.itemizedRemainder.paidFor,
              rate,
              oldCode,
              newCode,
              newFiller,
            )) {
              await tx.expenseItemizedRemainderPaidFor.update({
                where: {
                  expenseId_ledgerParticipantId: {
                    expenseId: expense.id,
                    ledgerParticipantId: leg.ledgerParticipantId,
                  },
                },
                data: { shares: leg.shares },
              })
            }
          }
        }
      }
      await tx.ledger.update({
        where: { id: ledger.id },
        data: { currency: targetCurrency.symbol, currencyCode: newCode },
      })
      // Convert every series template in the same transaction so future
      // occurrences materialize in the new currency. Covers all statuses:
      // PAUSED series resume later, and COMPLETED/CANCELLED templates stay
      // queryable in the new currency. Scheduling fields are untouched —
      // conversion never revives a terminal series.
      for (const series of seriesRows) {
        const money = templatePlans.get(series.id)
        if (!money) continue
        await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${series.id} FOR UPDATE`
        // Re-read after the lock: the pre-transaction snapshot above is
        // stale if a single-expense edit landed between planning and this
        // write. The version guard below then fails instead of clobbering.
        const locked = await tx.recurringExpenseSeries.findUnique({
          where: { id: series.id },
          select: { templateVersion: true, template: true },
        })
        if (!locked) continue
        const template = locked.template as unknown as RecurringExpenseTemplate
        const rate = money.rate ?? 1
        const converted: RecurringExpenseTemplate = {
          ...scaleTemplateMoneyLegs(
            template,
            money.kind,
            rate,
            oldCode,
            newCode,
            money.newAmount,
          ),
          amount: money.newAmount,
          originalAmount: money.newOriginalAmount,
          originalCurrency: money.newOriginalCurrency,
          conversionRate: money.newConversionRate,
          conversionSource: money.newConversionSource,
          exactAmount:
            money.newConversionSource === 'EXACT'
              ? money.newAmount
              : money.kind === 'bridged' && money.warning === 'exact-to-custom'
                ? money.newAmount
                : (template.exactAmount ?? null),
        }
        const claimed = await tx.recurringExpenseSeries.updateMany({
          where: { id: series.id, templateVersion: locked.templateVersion },
          data: {
            template: converted,
            templateVersion: { increment: 1 },
            version: { increment: 1 },
          },
        })
        if (claimed.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'A recurring series changed while the swap was running; retry the swap',
          })
        }
        seriesTemplatesConverted += 1
      }
      await tx.group.update({
        where: { id: group.id },
        data: {
          defaultEntryCurrencyCode:
            group.defaultEntryCurrencyCode?.toUpperCase() === newCode
              ? null
              : group.defaultEntryCurrencyCode,
          offlineContentRevision: { increment: 1 },
        },
      })
      const activity = await logActivity(
        group.id,
        {
          type: 'GROUP_UPDATED',
          actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
          subject: { type: 'GROUP', id: group.id },
          data: buildGroupActivityData({
            summary: group.name,
            currencySwap: {
              fromCurrencyCode: oldCode,
              toCurrencyCode: newCode,
              expensesConverted: expenses.length,
              seriesTemplatesConverted,
            },
          }),
        },
        tx,
      )
      await planNotificationForActivity(tx, activity, {}, { boss })
    })

    return {
      updated: expenses.length,
      newCode,
      seriesTemplatesConverted,
    }
  })

import { TRPCError } from '@trpc/server'
import { Effect } from 'effect'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { convertMinorUnitsByRate } from '@spliit/domain'
import { getCurrency } from '@spliit/domain/currency'

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
    const boss = await getApiBoss()

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
          data: buildGroupActivityData({ summary: group.name }),
        },
        tx,
      )
      await planNotificationForActivity(tx, activity, {}, { boss })
    })

    return { updated: expenses.length, newCode }
  })

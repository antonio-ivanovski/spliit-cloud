import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getCurrency, type Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import type { SplitMode } from '@spliit/domain'

import {
  getBreakdownNames,
  getStoredItemBreakdown,
  ItemAssignees,
  type BreakdownParticipant,
  type BreakdownRow,
} from './expense-item-breakdown'
import { ExpenseItemsOverflowToggle } from './expense-items-overflow-toggle'

/**
 * Resolve the currency used for stored item amounts. Items are always persisted
 * in the expense's entered currency (which matches `originalCurrency` when a
 * conversion is stored). Unknown or missing expense currencies fall back to the
 * group currency to preserve the previous display behavior.
 */
export function resolveExpenseItemsCurrency(
  originalCurrencyCode: string | null | undefined,
  groupCurrency: Currency,
): Currency {
  if (!originalCurrencyCode) return groupCurrency
  return getCurrency(originalCurrencyCode) ?? groupCurrency
}

/**
 * Resolve the expense total denominated in the same currency as the stored item
 * amounts. Items are persisted in the expense's entered currency, so for
 * converted expenses the "Other (unaccounted)" filler must compare against
 * `originalAmount` — comparing against the ledger `amount` mixes currencies and
 * produces a spurious filler whenever the rate is not 1:1.
 */
export function resolveExpenseItemsAmount(
  originalAmount: number | null | undefined,
  amount: number,
): number {
  return originalAmount ?? amount
}

type Item = {
  id: string
  title: string
  amount: number
  /** Stored split (minor-unit shares). Absent for legacy callers. */
  splitMode?: string
  paidFor?: Array<{ ledgerParticipantId: string; shares: number }>
}

type ItemizedRemainder = {
  splitMode: string
  allocationMode: 'CUSTOM' | 'PROPORTIONAL'
  paidFor: Array<{ ledgerParticipantId: string; shares: number }>
} | null

function toBreakdownRows(
  paidFor: Array<{ ledgerParticipantId: string; shares: number }>,
  sharesByParticipant: Record<string, number>,
  participantMap: Map<string, string>,
): BreakdownRow[] {
  return paidFor.flatMap((row) => {
    const name = participantMap.get(row.ledgerParticipantId)
    if (!name) return []
    return [
      {
        participantId: row.ledgerParticipantId,
        name,
        amount: sharesByParticipant[row.ledgerParticipantId] ?? 0,
      },
    ]
  })
}

export function ExpenseItemsSummary({
  items,
  currency,
  locale,
  participants = [],
  itemizedRemainder = null,
  expenseAmount,
  otherLabel,
  proportionalText,
}: {
  items: Item[]
  currency: Currency
  locale: string
  participants?: BreakdownParticipant[]
  itemizedRemainder?: ItemizedRemainder
  /**
   * Expense total in the same currency as `items` (i.e. the entered-currency
   * total: `originalAmount ?? amount`). Enables the "Other (unaccounted)" row.
   * Must NOT be the ledger total for converted expenses — items are stored in
   * the entered currency, so a ledger total here mixes currencies. Prefer
   * `resolveExpenseItemsAmount` at the call site.
   */
  expenseAmount?: number
  /** Label for the filler row (defaults to the itemized remainder title). */
  otherLabel?: string
  /** Text shown when the remainder is allocated proportionally. */
  proportionalText?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const participantMap = new Map(participants.map((p) => [p.id, p.name]))
  const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0)
  const fillerAmount =
    itemizedRemainder && expenseAmount != null ? expenseAmount - itemsTotal : 0
  const showFiller = itemizedRemainder != null && fillerAmount !== 0
  const isProportionalRemainder =
    itemizedRemainder?.allocationMode === 'PROPORTIONAL'

  const maxPreview = 3
  const remaining = items.length - maxPreview
  const visibleItems =
    expanded || remaining <= 0 ? items : items.slice(0, maxPreview)

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('items.title')}
      </h3>
      <div className="space-y-1 text-sm">
        {visibleItems.map((item) => {
          const paidFor = item.paidFor
          const names =
            paidFor && item.splitMode
              ? getBreakdownNames(
                  paidFor.map((row) => ({
                    participant: row.ledgerParticipantId,
                    shares: row.shares,
                  })),
                  participantMap,
                )
              : []
          const rows =
            paidFor && item.splitMode && names.length > 0
              ? toBreakdownRows(
                  paidFor,
                  getStoredItemBreakdown({
                    amount: item.amount,
                    splitMode: item.splitMode as SplitMode,
                    paidFor: paidFor.map((row) => ({
                      participant: row.ledgerParticipantId,
                      shares: row.shares,
                    })),
                  }),
                  participantMap,
                )
              : []
          return (
            <div key={item.id}>
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatCurrency(currency, item.amount, locale)}
                </span>
              </div>
              {names.length > 0 && (
                <ItemAssignees
                  namesText={names.join(', ')}
                  rows={rows}
                  currency={currency}
                  locale={locale}
                />
              )}
            </div>
          )
        })}
        {showFiller && (
          <div>
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">
                {otherLabel ?? t('items.title')}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatCurrency(currency, fillerAmount, locale)}
              </span>
            </div>
            {isProportionalRemainder ? (
              proportionalText ? (
                <div className="min-w-0 truncate text-xs leading-5 text-muted-foreground">
                  {proportionalText}
                </div>
              ) : null
            ) : (
              (() => {
                const remainderPaidFor = itemizedRemainder!.paidFor
                const names = getBreakdownNames(
                  remainderPaidFor.map((row) => ({
                    participant: row.ledgerParticipantId,
                    shares: row.shares,
                  })),
                  participantMap,
                )
                if (names.length === 0) return null
                return (
                  <ItemAssignees
                    namesText={names.join(', ')}
                    rows={toBreakdownRows(
                      remainderPaidFor,
                      getStoredItemBreakdown({
                        amount: fillerAmount,
                        splitMode: itemizedRemainder!.splitMode as SplitMode,
                        paidFor: remainderPaidFor.map((row) => ({
                          participant: row.ledgerParticipantId,
                          shares: row.shares,
                        })),
                      }),
                      participantMap,
                    )}
                    currency={currency}
                    locale={locale}
                  />
                )
              })()
            )}
          </div>
        )}
        {remaining > 0 && (
          <ExpenseItemsOverflowToggle
            expanded={expanded}
            remaining={remaining}
            onToggle={() => setExpanded((open) => !open)}
          />
        )}
      </div>
    </section>
  )
}

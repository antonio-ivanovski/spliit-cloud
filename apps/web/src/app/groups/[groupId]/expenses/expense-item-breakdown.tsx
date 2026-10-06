import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { cn, formatCurrency } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import {
  amountAsMinorUnits,
  calculateExactShares,
  distributeRemainder,
  sharesAsFixedUnits,
} from '@spliit/domain'

export type BreakdownPaidForRow = {
  participant: string
  shares: number | string
}

export type BreakdownParticipant = {
  id: string
  name: string
}

export type BreakdownRow = {
  participantId: string
  name: string
  /** Integer minor units in the item currency. */
  amount: number
}

function toSafeNumber(value: number | string): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function toSafeFixedShares(value: number | string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  try {
    return sharesAsFixedUnits(numeric)
  } catch {
    return 0
  }
}

function toBasisPoints(value: number | string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const basisPoints = Math.round(numeric * 100)
  return Number.isSafeInteger(basisPoints) ? basisPoints : 0
}

/**
 * Per-participant integer shares for an item persisted by the API (shares are
 * already stored units: bps for BY_PERCENTAGE, fixed units for BY_SHARES, minor
 * units for BY_AMOUNT, markers for EVENLY). The result sums to `item.amount`.
 */
export function getStoredItemBreakdown(item: {
  amount: number
  splitMode: SplitMode
  paidFor: readonly BreakdownPaidForRow[]
}): Record<string, number> {
  if (item.paidFor.length === 0) return {}
  const exact = calculateExactShares({
    amount: item.amount,
    splitMode: item.splitMode === 'ITEMIZED' ? 'BY_AMOUNT' : item.splitMode,
    participants: item.paidFor.map((row) => ({
      id: row.participant,
      shares: toSafeNumber(row.shares),
    })),
  })
  return distributeRemainder(exact, item.amount)
}

/**
 * Per-participant integer shares for an item in expense-form display units
 * (major-unit prices, decimal shares, 0-100 percentages). The result is minor
 * units in `currency` and sums to the item total.
 */
export function getFormItemBreakdown(
  item: {
    unitPrice: number | string
    quantity: number | string
    splitMode: SplitMode
    paidFor: readonly BreakdownPaidForRow[]
  },
  currency: Currency,
): Record<string, number> {
  const totalMinor = amountAsMinorUnits(
    Number(item.unitPrice) * Number(item.quantity),
    currency,
  )
  if (!Number.isFinite(totalMinor) || totalMinor === 0) return {}
  if (item.paidFor.length === 0) return {}
  const mode = item.splitMode === 'ITEMIZED' ? 'BY_AMOUNT' : item.splitMode
  const participants = item.paidFor.map((row) => ({
    id: row.participant,
    shares:
      mode === 'BY_PERCENTAGE'
        ? toBasisPoints(row.shares)
        : mode === 'BY_SHARES'
          ? toSafeFixedShares(row.shares)
          : mode === 'BY_AMOUNT'
            ? amountAsMinorUnits(toSafeNumber(row.shares), currency)
            : 1,
  }))
  const exact = calculateExactShares({
    amount: totalMinor,
    splitMode: mode,
    participants,
  })
  return distributeRemainder(exact, totalMinor)
}

/** Join paidFor rows to participant names, dropping unknown ids. */
export function getBreakdownNames(
  paidFor: readonly BreakdownPaidForRow[] | undefined,
  participantMap: Map<string, string>,
): string[] {
  if (!paidFor) return []
  return paidFor.flatMap((row) => {
    const name = participantMap.get(row.participant)
    return name ? [name] : []
  })
}

/**
 * Shared names-below-item toggle. Collapsed it shows the (truncated) names;
 * expanding reveals one row per participant with their calculated amount. With
 * no rows it renders `emptyText` (or nothing) without a toggle.
 */
export function ItemAssignees({
  namesText,
  rows,
  currency,
  locale,
  emptyText,
  className,
}: {
  namesText: string
  rows: BreakdownRow[]
  currency: Currency
  locale: string
  emptyText?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) {
    if (!emptyText) return null
    return (
      <div
        className={cn(
          'min-w-0 truncate text-xs leading-5 text-muted-foreground',
          className,
        )}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-1 text-start text-xs leading-5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <span className="min-w-0 flex-1 truncate">{namesText}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-3 w-3 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {rows.map((row) => (
            <li
              key={row.participantId}
              className="flex items-center gap-3 text-xs leading-5"
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.name}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatCurrency(currency, row.amount, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

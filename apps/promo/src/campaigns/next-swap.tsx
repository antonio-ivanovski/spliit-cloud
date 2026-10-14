/* oxlint-disable jsx-a11y/prefer-tag-over-role -- faithful static copy of the real swap dialog radio filters. */
import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import { WizardProgress } from '@web/components/wizard'
import { formatCurrency } from '@web/lib/utils'
import { ArrowDown, ArrowRight, Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { getCurrency } from '@spliit/domain'
import { convertMinorUnitsByRate } from '@spliit/domain/utils'

import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas } from '../primitives'
import { PromoCurrencyIcon as CurrencyIcon } from './promo-currency-icon'

import './next-release.css'

/**
 * Fictional Lisbon group; real historical Frankfurter responses, fetched
 * 2026-10-14. Amounts are integer minor units; displayed totals derive from the
 * same fixture. Rendering never needs live rates.
 *
 * Illustration below is a static, pixel-faithful copy of the real swap UI:
 * `SwapFullListDialog` header/search/filters + `SwapReviewRow` rows (same
 * classNames, same `CurrencyIcon`, same `WizardProgress` steps). Static copy
 * (not direct import) because the real rows need i18n/TRPC hooks.
 */
export const nextSwapFixture = {
  group: 'Lisbon trip',
  from: 'EUR',
  to: 'USD',
  expenses: [
    {
      title: 'Dinner',
      amount: 6000,
      currency: 'EUR',
      date: '2025-06-10',
      rate: 1.1419,
    },
    {
      title: 'Groceries',
      amount: 2500,
      currency: 'GBP',
      date: '2025-06-11',
      rate: 1.3503,
    },
    {
      title: 'Transport',
      amount: 1500,
      currency: 'USD',
      date: '2025-06-12',
      rate: 1,
    },
  ],
}

function formatSwapAmount(code: string, minor: number) {
  const currency = getCurrency(code)
  if (!currency) return `${(minor / 100).toFixed(2)} ${code}`
  return formatCurrency(currency, minor, 'en-US')
}

/** Static copy of `SwapReviewRow` — identical DOM/classNames, fixed English. */
function FaithfulSwapRow({
  title,
  date,
  fromCode,
  fromAmount,
  rateFrom,
  rate,
  toCode,
  toAmount,
  badge,
}: {
  title: string
  date: string
  fromCode: string
  fromAmount: number
  rateFrom: string
  rate: number
  toCode: string
  toAmount: number
  badge?: 'cleared'
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
      <span className="flex w-full items-center justify-center gap-2 text-center sm:justify-between sm:text-left">
        <span className="min-w-0 truncate text-center font-medium sm:text-left">
          {title}
        </span>
        {badge === 'cleared' ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border border-border/70 px-2 py-0.5 text-[11px]',
              'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100',
            )}
          >
            Already {toCode}
          </span>
        ) : null}
      </span>
      <span className="block w-full text-center font-mono text-xs text-muted-foreground tabular-nums sm:text-left">
        {date}
      </span>
      <span className="flex w-full max-w-full min-w-0 flex-col gap-2 rounded-md bg-muted/40 px-3 py-2.5 sm:grid sm:w-full sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto_minmax(0,1fr)] sm:items-center sm:gap-2">
        <span className="flex min-w-0 flex-col items-center gap-0.5 text-center sm:items-start sm:text-left">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Was
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1.5 font-semibold tabular-nums sm:justify-start">
            <CurrencyIcon code={fromCode} />
            <span className="truncate">
              {formatSwapAmount(fromCode, fromAmount)}
            </span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className="self-center py-1 text-muted-foreground/70 sm:hidden"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col items-center gap-0.5 self-stretch px-2 text-center">
          {badge === 'cleared' ? null : (
            <>
              <span className="max-w-full overflow-hidden font-mono text-xs font-semibold text-ellipsis whitespace-nowrap tabular-nums">
                1 {rateFrom} = {rate.toFixed(4)} {toCode}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {date}
              </span>
            </>
          )}
        </span>
        <span
          aria-hidden="true"
          className="self-center py-1 text-muted-foreground/70 sm:self-auto sm:justify-self-center sm:py-0"
        >
          <ArrowDown className="size-4 sm:hidden" aria-hidden="true" />
          <ArrowRight className="hidden size-4 sm:block" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col items-center gap-0.5 text-center sm:items-end sm:text-right">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Becomes
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1.5 font-semibold tabular-nums sm:justify-end">
            <CurrencyIcon code={toCode} />
            <span className="truncate">
              {formatSwapAmount(toCode, toAmount)}
            </span>
          </span>
        </span>
      </span>
    </div>
  )
}

/** Static copy of the `SwapFullListDialog` body (header + search + filters). */
function SwapDialogPreview() {
  const { from, to } = nextSwapFixture
  const filters = [
    { id: 'all', label: 'All', active: true },
    { id: 'attention', label: 'Needs attention', active: false },
    { id: 'converted', label: 'Converted', active: false },
    { id: 'cleared', label: `Already ${to}`, active: false },
    { id: 'bridged', label: 'Manual rate', active: false },
  ]
  return (
    <section className="ui-frame next-swap-dialog">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">All expenses</h2>
        <X className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        3 expenses · {from} → {to}
      </p>
      <div className="relative mt-3 w-full">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value=""
          placeholder="Search by expense title…"
          aria-label="Search by expense title…"
          className="h-9 ps-8 pe-8 text-sm"
          readOnly
        />
      </div>
      <div
        role="radiogroup"
        aria-label="Filter preview by outcome"
        className="mt-2 flex flex-wrap gap-1"
      >
        {filters.map((filter) => (
          <Button
            key={filter.id}
            type="button"
            size="sm"
            variant={filter.active ? 'default' : 'outline'}
            role="radio"
            aria-checked={filter.active}
            className="h-9 min-w-11 shrink-0 px-3 text-xs"
          >
            {filter.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-md border border-border/60">
        <ul
          aria-label="Per-expense preview"
          className="w-full divide-y divide-border/60"
        >
          {nextSwapFixture.expenses.map((expense) => {
            const isCleared = expense.currency === to
            const converted = convertMinorUnitsByRate(
              expense.amount,
              expense.rate,
              expense.currency,
              to,
            )
            return (
              <li key={expense.title} className="bg-background px-3 py-2.5">
                <FaithfulSwapRow
                  title={expense.title}
                  date={expense.date}
                  fromCode={expense.currency}
                  fromAmount={expense.amount}
                  rateFrom={expense.currency}
                  rate={expense.rate}
                  toCode={to}
                  toAmount={converted}
                  badge={isCleared ? 'cleared' : undefined}
                />
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">Showing 3 of 3</p>
        <Button type="button" variant="ghost">
          Close
        </Button>
      </div>
    </section>
  )
}

export function NextSwapPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="next-promo next-swap">
      <BrandHeader />
      <div className="next-story">
        <h1>
          Change the group
          <br />
          <em>settlement currency anytime.</em>
        </h1>
        <p className="next-support">
          The currency swap tool takes care of every exchange rate — per-pair
          historic or fixed rates, with a per-row preview before anything
          changes.
        </p>
        <WizardProgress
          steps={[
            { id: 'target', label: 'Target' },
            { id: 'rates', label: 'Rates' },
            { id: 'review', label: 'Review' },
            { id: 'confirm', label: 'Confirm' },
          ]}
          currentStep="review"
          ariaLabel="Swap progress"
          className="next-wizard"
        />
        <p className="next-clarification">
          Groups also get a new default entry currency besides the ledger
          currency, so new expenses start in {nextSwapFixture.from} while
          settling in {nextSwapFixture.to}. Admins run it from Tools; it stays
          disabled offline or when archived.
        </p>
      </div>
      <div className="next-illustration">
        <div className="next-ledger">
          <span>{nextSwapFixture.group} · Settlement currency</span>
          <strong>
            {nextSwapFixture.from} <ArrowRight aria-hidden="true" />{' '}
            {nextSwapFixture.to}
          </strong>
        </div>
        <SwapDialogPreview />
        <p className="next-location">
          <strong>Group → Tools → Swap currency</strong>
          <br />
          Review step · per-row Was / rate / Becomes
        </p>
      </div>
    </Canvas>
  )
}

/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- faithful static copy of PairConversionCard OptionCard. */
import { Button } from '@web/components/ui/button'
import { Checkbox } from '@web/components/ui/checkbox'
import { Label } from '@web/components/ui/label'
import { formatCurrency } from '@web/lib/utils'
import { AlertTriangle, ArrowDown, ArrowRight, Calendar } from 'lucide-react'

import { cn } from '@/lib/utils'
import { getCurrency } from '@spliit/domain'

import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas } from '../primitives'
import { PromoCurrencyIcon as CurrencyIcon } from './promo-currency-icon'

import './next-release.css'

/**
 * Fictional Sofia group. BGN withdrew 2026-01-01 at 1 EUR = 1.95583 BGN.
 * Static, pixel-faithful copies of the real UI (`PairConversionCard` per-date
 * `OptionCard`, `CurrencyWithdrawnNotice`, `CurrencyRateWarning`,
 * `SwapReviewRow` warning line) — same classNames, fixed English from
 * en-US.json. Static copies because the real cards need TRPC/i18n hooks.
 */
const FIXED_BGN_PER_EUR = 1.95583
const bgnToEur = (bgnCents: number) => Math.round(bgnCents / FIXED_BGN_PER_EUR)

function formatAmount(code: string, minor: number) {
  const currency = getCurrency(code)
  if (!currency) return `${(minor / 100).toFixed(2)} ${code}`
  return formatCurrency(currency, minor, 'en-US')
}

/** Exact copy of `SectionLabel` from currency-pair-conversion-card.tsx. */
function FaithfulSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 rounded-full bg-primary/60"
      />
      <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {children}
      </p>
    </div>
  )
}

/** Exact copy of the selection dot inside `OptionCard`. */
function FaithfulSelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-all duration-150',
        selected
          ? 'border-primary bg-primary'
          : 'border-border bg-background group-hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-primary-foreground transition-opacity duration-150',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}

/**
 * Exact copy of `CurrencyWithdrawnNotice` compact state +
 * `WithdrawalDetailLine`.
 */
function FaithfulWithdrawnNotice() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5 text-xs leading-snug">
        <p className="font-medium">3 of 8 dates use the fixed conversion</p>
        <p className="text-amber-800 dark:text-amber-200">
          BGN was replaced by EUR on 2026-01-01 at a fixed rate of 1 EUR =
          1.95583 BGN.{' '}
          <span className="underline underline-offset-2">Reference</span>
        </p>
      </div>
    </div>
  )
}

/** Exact copy of `CurrencyRateWarning` statutory-fixed state. */
function FaithfulRateWarning() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5 text-xs leading-snug">
        <p className="font-medium">
          Fixed conversion rate — not a market quote
        </p>
        <p className="text-amber-800 dark:text-amber-200">
          BGN was replaced by EUR on 2026-01-01 at a fixed rate of 1 EUR =
          1.95583 BGN.{' '}
          <span className="underline underline-offset-2">Reference</span>
        </p>
      </div>
    </div>
  )
}

/** Static copy of one `SwapReviewRow` with the fixed-fallback warning. */
function FaithfulWithdrawnRow({
  title,
  date,
  amount,
}: {
  title: string
  date: string
  amount: number
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
      <span className="flex w-full items-center justify-center gap-2 text-center sm:justify-between sm:text-left">
        <span className="min-w-0 truncate text-center font-medium sm:text-left">
          {title}
        </span>
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
            <CurrencyIcon code="BGN" />
            <span className="truncate">{formatAmount('BGN', amount)}</span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className="self-center py-1 text-muted-foreground/70 sm:hidden"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col items-center gap-0.5 self-stretch px-2 text-center">
          <span className="max-w-full overflow-hidden font-mono text-xs font-semibold text-ellipsis whitespace-nowrap tabular-nums">
            1 BGN = 0.5113 EUR
          </span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {date}
          </span>
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
            <CurrencyIcon code="EUR" />
            <span className="truncate">
              {formatAmount('EUR', bgnToEur(amount))}
            </span>
          </span>
        </span>
      </span>
      <span className="flex w-full items-center justify-center gap-1 text-xs text-amber-800 sm:justify-start dark:text-amber-200">
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        Converted with the fixed conversion — no market rate was available.
      </span>
    </div>
  )
}

export function NextWithdrawnPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="next-promo next-withdrawn">
      <BrandHeader />
      <div className="next-story">
        <h1>
          Lev and kuna
          <br />
          <em>still work.</em>
        </h1>
        <p className="next-support">
          Add new expenses in old currencies — or import them from CSV and other
          apps — and they convert at fixed euro rates instead of failing.
        </p>
        <FaithfulRateWarning />
      </div>
      <div className="next-illustration">
        <section className="ui-frame next-pair-card">
          <div className="flex flex-col gap-3">
            <FaithfulSectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <CurrencyIcon code="BGN" className="w-4" />
                <span>BGN</span>
                <span aria-hidden="true">→</span>
                <CurrencyIcon code="EUR" className="w-4" />
                <span>EUR</span>
              </span>
            </FaithfulSectionLabel>
            <div className="group relative cursor-default overflow-hidden rounded-md border border-primary/60 bg-card bg-primary/4 transition-colors duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card">
              <button
                type="button"
                role="radio"
                aria-checked
                data-state="checked"
                className="flex w-full items-start gap-3 p-3 text-start focus-visible:outline-hidden"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors duration-150"
                >
                  <Calendar size={16} strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-tight font-medium">
                    Per-date conversion
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    More accurate — uses the exchange rate from each
                    expense&apos;s actual date.
                  </p>
                </div>
                <FaithfulSelectionDot selected />
              </button>
              <div
                onClick={(e) => e.stopPropagation()}
                className="border-t border-dashed border-border/60 px-3 py-3"
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      Uses the historical exchange rate for each expense&apos;s
                      date (Frankfurter API).
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <Checkbox id="fallback-BGN|EUR" checked />
                      <Label
                        htmlFor="fallback-BGN|EUR"
                        className="cursor-pointer text-xs font-normal"
                      >
                        Use the fixed conversion when a market rate is missing
                      </Label>
                    </div>
                    <FaithfulWithdrawnNotice />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-md border border-border/60">
            <ul className="w-full divide-y divide-border/60">
              <li className="bg-background px-3 py-2.5">
                <FaithfulWithdrawnRow
                  title="Dinner"
                  date="2026-09-10"
                  amount={4500}
                />
              </li>
            </ul>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Imported 1 of 1 · fixed conversion applied
            </p>
            <Button type="button" variant="ghost" size="sm">
              Close
            </Button>
          </div>
        </section>
        <p className="next-location">
          <strong>Expense form · CSV importer</strong>
          <br />
          Add or import lev & kuna · fixed euro rates
        </p>
      </div>
    </Canvas>
  )
}

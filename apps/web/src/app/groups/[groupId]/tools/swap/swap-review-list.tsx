/* oxlint-disable jsx-a11y/prefer-tag-over-role -- kind-filter pills are custom-styled button radios inside an explicit radiogroup. */
import { AlertTriangle, ArrowDown, ArrowRight, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatMinorAmount } from '@/app/groups/[groupId]/expenses/csv-import-review-model'
import { CurrencyIcon } from '@/components/currency-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useVirtualizedRows } from '@/components/use-virtualized-rows'
import { useLocale } from '@/i18n/react'
import { useMediaQuery } from '@/lib/hooks'
import { cn, formatCurrency } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import { getCurrency } from '@spliit/domain'

import { KIND_FILTERS, type KindFilter } from './swap-filters'

export type SwapPreviewRow =
  AppRouterOutput['groups']['swapPreview']['rows'][number]

// Only notable outcomes badge: plain conversions (simple + fresh) are the
// expected path and render no badge — the Was/Becomes grid already shows the
// original currency and the applied rate.
const KIND_BADGE: Record<'cleared' | 'bridged', string> = {
  cleared:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100',
  bridged:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
}

/**
 * Locale-aware money formatting for the review step. Falls back to the plain
 * `amount CODE` rendering for custom codes unknown to the currency catalog.
 */
function formatSwapAmount(code: string, minor: number, locale: string) {
  const currency = getCurrency(code)
  if (!currency) return formatMinorAmount(minor, code)
  return formatCurrency(currency, minor, locale)
}

/**
 * One per-expense conversion row. The caller owns the `<li>` wrapper so the
 * same content renders statically inline and virtualized inside the dialog.
 */
export function SwapReviewRow(props: {
  row: SwapPreviewRow
  oldCode: string
  newCode: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Swap' })
  const locale = useLocale()
  const { row, oldCode, newCode } = props
  const appliedRate = row.newConversionRate ?? row.rateUsed

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
      <span className="flex w-full items-center justify-center gap-2 text-center sm:justify-between sm:text-left">
        <span className="min-w-0 truncate text-center font-medium sm:text-left">
          {row.title}
        </span>
        {row.kind === 'cleared' || row.kind === 'bridged' ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border border-border/70 px-2 py-0.5 text-[11px]',
              KIND_BADGE[row.kind],
            )}
          >
            {t(`kind.${row.kind}`, { to: newCode })}
          </span>
        ) : null}
      </span>
      <span className="block w-full text-center font-mono text-xs text-muted-foreground tabular-nums sm:text-left">
        {row.expenseDate}
      </span>
      <span className="flex w-full max-w-full min-w-0 flex-col gap-2 rounded-md bg-muted/40 px-3 py-2.5 sm:grid sm:w-full sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto_minmax(0,1fr)] sm:items-center sm:gap-2">
        <span className="flex min-w-0 flex-col items-center gap-0.5 text-center sm:items-start sm:text-left">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {t('preview.wasLabel')}
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1.5 font-semibold tabular-nums sm:justify-start">
            <CurrencyIcon code={row.newOriginalCurrency ?? oldCode} />
            <span className="truncate">
              {formatSwapAmount(
                row.newOriginalCurrency ?? oldCode,
                row.newOriginalAmount ?? row.oldAmount,
                locale,
              )}
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
          {row.kind === 'bridged' &&
          row.rateUsed != null &&
          row.newConversionRate != null ? (
            <>
              <span className="max-w-full overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap text-muted-foreground tabular-nums">
                {t('preview.rateUnit', {
                  from: oldCode,
                  rate: row.rateUsed.toFixed(4),
                  to: newCode,
                })}
              </span>
              <span className="max-w-full overflow-hidden font-mono text-xs font-semibold text-ellipsis whitespace-nowrap tabular-nums">
                {t('preview.rateUnit', {
                  from: row.newOriginalCurrency ?? oldCode,
                  rate: row.newConversionRate.toFixed(4),
                  to: newCode,
                })}
              </span>
              {row.rateDate ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {row.rateDate}
                </span>
              ) : null}
            </>
          ) : appliedRate != null ? (
            <>
              <span className="max-w-full overflow-hidden font-mono text-xs font-semibold text-ellipsis whitespace-nowrap tabular-nums">
                {t('preview.rateUnit', {
                  from: row.newOriginalCurrency ?? oldCode,
                  rate: appliedRate.toFixed(4),
                  to: newCode,
                })}
              </span>
              {row.rateDate ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {row.rateDate}
                </span>
              ) : null}
            </>
          ) : null}
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
            {t('preview.becomesLabel')}
          </span>
          <span className="flex min-w-0 items-center justify-center gap-1.5 font-semibold tabular-nums sm:justify-end">
            <CurrencyIcon code={newCode} />
            <span className="truncate">
              {formatSwapAmount(newCode, row.newAmount, locale)}
            </span>
          </span>
        </span>
      </span>
      {row.warning ? (
        <span
          className={cn(
            'flex w-full items-center justify-center gap-1 text-xs sm:justify-start',
            row.warning === 'fixed-fallback'
              ? 'text-amber-800 dark:text-amber-200'
              : 'text-destructive',
          )}
        >
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          {t(
            `rowWarnings.${row.warning}` as
              | 'rowWarnings.missing-rate'
              | 'rowWarnings.exact-to-custom'
              | 'rowWarnings.fixed-fallback',
          )}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The full per-expense list, following the importer mapping dialog: the review
 * step stays short (attention rows only) while all rows remain one click away
 * with search, filters and a container-scrolled virtual list.
 */
// oxlint-disable react/refs -- TanStack Virtual exposes measurement refs through its virtualizer result.
export function SwapFullListDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: SwapPreviewRow[]
  totalCount: number
  oldCode: string
  newCode: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Swap' })
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const { rows, totalCount, oldCode, newCode, open, onOpenChange } = props
  // Mobile rows stack Was/rate/Becomes vertically (~270px); desktop rows use
  // the compact 5-column grid (~195px, more with a warning line). The estimate
  // must follow the breakpoint or the virtualizer clips rows after a
  // mobile<->desktop switch.
  const isMobile = useMediaQuery('(max-width: 639px)')

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (kindFilter === 'attention' && !row.warning) return false
      if (
        kindFilter === 'converted' &&
        row.kind !== 'simple' &&
        row.kind !== 'fresh'
      ) {
        return false
      }
      if (
        (kindFilter === 'cleared' || kindFilter === 'bridged') &&
        row.kind !== kindFilter
      ) {
        return false
      }
      if (q && !row.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, kindFilter, search])

  const virtualRows = useVirtualizedRows({
    count: filteredRows.length,
    estimateSize: () => (isMobile ? 255 : 195),
    enabled: open,
    getItemKey: (index) => filteredRows[index]!.id,
    scrollResetKey: `${kindFilter}:${search}`,
    remeasureKey: `${isMobile ? 'mobile' : 'desktop'}:${filteredRows.map((row) => row.id).join(',')}`,
    overscan: 8,
  })

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden overflow-x-hidden sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('preview.fullListTitle')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('preview.fullListDescription', {
              count: totalCount,
              from: oldCode,
              to: newCode,
            })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="min-h-0 w-full max-w-full space-y-3 overflow-hidden">
          <div className="relative w-full">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('preview.searchPlaceholder')}
              aria-label={t('preview.searchPlaceholder')}
              className="h-9 ps-8 pe-8 text-sm"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('preview.clearSearch')}
                className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div
            role="radiogroup"
            aria-label={t('preview.filterLabel')}
            className="flex flex-wrap gap-1"
          >
            {KIND_FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={kindFilter === filter ? 'default' : 'outline'}
                role="radio"
                aria-checked={kindFilter === filter}
                className="h-9 min-w-11 shrink-0 px-3 text-xs"
                onClick={() => setKindFilter(filter)}
              >
                {t(`filters.${filter}`, { to: newCode })}
              </Button>
            ))}
          </div>
          <div
            ref={virtualRows.setScrollRef}
            className="h-[min(60dvh,42rem)] min-h-56 overflow-auto rounded-md border border-border/60"
          >
            <ul
              aria-label={t('preview.title')}
              className="relative w-full divide-y divide-border/60"
              style={{ height: virtualRows.totalSize }}
            >
              {virtualRows.items.map((item) => {
                const row = filteredRows[item.index]!
                return (
                  <li
                    key={row.id}
                    ref={virtualRows.measureElement}
                    data-index={item.index}
                    className="absolute inset-x-0 top-0 bg-background px-3 py-2.5"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <SwapReviewRow
                      row={row}
                      oldCode={oldCode}
                      newCode={newCode}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
          {filteredRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('preview.noRows')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('preview.showingXofY', {
                filtered: filteredRows.length,
                count: totalCount,
              })}
            </p>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('preview.close')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

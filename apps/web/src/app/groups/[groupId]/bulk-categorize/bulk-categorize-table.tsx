import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import {
  formatMinorAmount,
  hashPreviewLens,
} from '@/app/groups/[groupId]/expenses/csv-import-review-model'
import {
  categoryFromId,
  categoryLabel,
} from '@/app/groups/[groupId]/stats/category-utils'
import { CategorySelector } from '@/components/category-selector'
import { Button } from '@/components/ui/button'
import { useVirtualizedRows } from '@/components/use-virtualized-rows'
import { useLocale } from '@/i18n/react'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  categoryConfidenceBand,
  type CategoryId,
} from '@spliit/domain'

export type CategorizeRow = {
  id: string
  title: string
  expenseDate: string
  amount: number
  currency: string
  categoryId: CategoryId
  initialCategoryId?: CategoryId
  choices: Array<{
    categoryId: CategoryId
    confidence: number | null
    source: 'local' | 'jev' | 'manual'
    matchScore?: number
    floor?: number
  }>
}

const CATEGORIES = DEFAULT_CATEGORIES.filter(
  (row) => row.id !== SETTLEMENT_CATEGORY_ID,
)

export function sortCategorizeRows(rows: CategorizeRow[]) {
  return [...rows].sort(
    (a, b) =>
      Number(a.categoryId !== DEFAULT_CATEGORY_ID) -
        Number(b.categoryId !== DEFAULT_CATEGORY_ID) ||
      String(b.expenseDate ?? '').localeCompare(String(a.expenseDate ?? '')) ||
      a.id.localeCompare(b.id),
  )
}

export function estimateCategorizeRowHeight(
  row: CategorizeRow,
  containerWidth: number,
) {
  const wide = containerWidth >= 760
  const alternatives = row.choices.filter(
    (choice) =>
      choice.categoryId !== DEFAULT_CATEGORY_ID &&
      choice.categoryId !== row.categoryId,
  ).length
  const titleWidth = wide
    ? (containerWidth * 1.4) / 3.65 - 32
    : containerWidth - 32
  const estimatedChars =
    containerWidth > 0
      ? Math.max(12, Math.floor(titleWidth / 7))
      : wide
        ? 42
        : 34
  const titleLines = Math.max(1, Math.ceil(row.title.length / estimatedChars))
  return wide
    ? Math.max(76 + (titleLines - 1) * 20, alternatives ? 104 : 76)
    : 142 + (titleLines - 1) * 20 + (alternatives ? 48 : 0)
}

function chipClass(
  choice: CategorizeRow['choices'][number],
  aiMinConfidence: number,
) {
  if (choice.source === 'manual')
    return 'border-violet-300 bg-violet-50 text-violet-900 hover:border-violet-400 hover:bg-violet-100 hover:text-violet-950 focus-visible:ring-violet-500 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900 dark:hover:text-violet-50'
  const band = categoryConfidenceBand(
    choice.source === 'local' ? choice.matchScore : choice.confidence,
    choice.floor ?? aiMinConfidence,
  )
  if (band === 'high')
    return 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-950 focus-visible:ring-emerald-500 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900 dark:hover:text-emerald-50'
  if (band === 'medium')
    return 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-950 focus-visible:ring-amber-500 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900 dark:hover:text-amber-50'
  if (band === 'low')
    return 'border-orange-300 bg-orange-50 text-orange-900 hover:border-orange-400 hover:bg-orange-100 hover:text-orange-950 focus-visible:ring-orange-500 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100 dark:hover:bg-orange-900 dark:hover:text-orange-50'
  return 'border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-50'
}

function CategoryPicker({
  row,
  disabled,
  aiMinConfidence,
  onChange,
}: {
  row: CategorizeRow
  disabled: boolean
  aiMinConfidence: number
  onChange: (id: string, categoryId: CategoryId) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const selectedChoice =
    row.categoryId === DEFAULT_CATEGORY_ID
      ? undefined
      : row.choices.find((choice) => choice.categoryId === row.categoryId)
  const localBand =
    selectedChoice?.source === 'local' && selectedChoice.matchScore != null
      ? categoryConfidenceBand(
          selectedChoice.matchScore,
          selectedChoice.floor ?? aiMinConfidence,
        )
      : null
  const jevConfidence =
    selectedChoice?.source === 'jev' ? selectedChoice.confidence : null
  const strengthLabel =
    localBand === 'high'
      ? t('highMatch')
      : localBand === 'medium'
        ? t('mediumMatch')
        : localBand === 'low'
          ? t('lowMatch')
          : localBand === 'none'
            ? t('belowMatchThreshold')
            : null
  const strengthClass =
    localBand === 'high'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100'
      : localBand === 'medium'
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
        : localBand === 'low'
          ? 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100'
          : 'border-border bg-muted text-muted-foreground'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-[10rem] flex-1">
        <CategorySelector
          categories={CATEGORIES}
          defaultValue={row.categoryId}
          isLoading={false}
          disabled={disabled}
          ariaLabel={`${t('categoryColumn')}: ${row.title} — ${categoryLabel(tCategories, row.categoryId)}`}
          onValueChange={(categoryId) => onChange(row.id, categoryId)}
        />
      </div>
      {jevConfidence !== null && (
        <span
          className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100"
          aria-label={t('jevConfidence', {
            confidence: Math.round(jevConfidence * 100),
          })}
        >
          {Math.round(jevConfidence * 100)}%
        </span>
      )}
      {strengthLabel && (
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${strengthClass}`}
        >
          {strengthLabel}
        </span>
      )}
    </div>
  )
}

function QuickChoices({
  row,
  disabled,
  aiMinConfidence,
  onChange,
}: {
  row: CategorizeRow
  disabled: boolean
  aiMinConfidence: number
  onChange: (id: string, categoryId: CategoryId) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const choices = row.choices
    .filter(
      (choice) =>
        choice.categoryId !== DEFAULT_CATEGORY_ID &&
        choice.categoryId !== row.categoryId,
    )
    .slice(0, 2)
  if (choices.length === 0) return null
  return (
    <fieldset className="flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
      <legend className="sr-only">
        {t('categoryChoices')}: {row.title}
      </legend>
      {choices.map((choice) => {
        const categoryId = choice.categoryId
        return (
          <Button
            key={categoryId}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={`min-h-9 max-w-full min-w-0 justify-start gap-1 rounded-full px-2.5 text-xs ${chipClass(choice, aiMinConfidence)}`}
            onClick={() => onChange(row.id, categoryId)}
          >
            <CategoryIcon
              category={categoryFromId(categoryId)}
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="max-w-40 min-w-0 truncate text-start">
              {categoryLabel(tCategories, categoryId)}
            </span>
            {choice.source === 'jev' && choice.confidence !== null && (
              <span className="opacity-70">
                {Math.round(choice.confidence * 100)}%
              </span>
            )}
          </Button>
        )
      })}
    </fieldset>
  )
}

export function BulkCategorizeTable({
  rows,
  disabled,
  aiMinConfidence,
  onChange,
}: {
  rows: CategorizeRow[]
  disabled: boolean
  aiMinConfidence: number
  onChange: (id: string, categoryId: CategoryId) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const locale = useLocale()
  const [containerWidth, setContainerWidth] = useState(0)
  const wide = containerWidth >= 760
  const ordered = useMemo(() => sortCategorizeRows(rows), [rows])
  const estimateRowHeight = useCallback(
    (index: number) =>
      estimateCategorizeRowHeight(ordered[index]!, containerWidth),
    [ordered, containerWidth],
  )
  const remeasureKey = useMemo(
    () =>
      hashPreviewLens(
        ordered.map(
          (row) =>
            `${row.id}:${row.title.length}:${row.categoryId}:${row.choices.length}`,
        ),
      ),
    [ordered],
  )
  const virtual = useVirtualizedRows({
    count: ordered.length,
    estimateSize: estimateRowHeight,
    getItemKey: (index) => ordered[index]!.id,
    remeasureKey: `${remeasureKey}:${containerWidth}`,
    resetScrollOnChange: false,
    overscan: 8,
  })
  const setScrollRef = virtual.setScrollRef
  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      setScrollRef(node)
      if (!node) return
      const observer = new ResizeObserver(([entry]) => {
        setContainerWidth(Math.round(entry?.contentRect.width ?? 0))
      })
      observer.observe(node)
      return () => {
        observer.disconnect()
        setScrollRef(null)
      }
    },
    [setScrollRef],
  )
  const displayDate = (value: string) => {
    const date = value ? new Date(value) : null
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
      : '—'
  }
  const displayAmount = (row: CategorizeRow) =>
    Number.isFinite(row.amount)
      ? row.currency.length === 3
        ? formatMinorAmount(row.amount, row.currency)
        : `${(row.amount / 100).toFixed(2)} ${row.currency}`
      : '—'
  return (
    <div
      ref={setContainer}
      className="h-[min(70dvh,46rem)] min-h-80 min-w-0 overflow-x-hidden overflow-y-auto"
    >
      {wide ? (
        <table
          aria-label={t('tableLabel')}
          className="block w-full text-left text-sm"
        >
          <caption className="sr-only">{t('tableLabel')}</caption>
          <thead className="block border-b bg-muted/40 text-xs text-muted-foreground">
            <tr className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
              <th className="px-4 py-3 font-medium">{t('expenseColumn')}</th>
              <th className="px-4 py-3 font-medium">{t('categoryColumn')}</th>
              <th className="px-4 py-3 font-medium">{t('categoryChoices')}</th>
            </tr>
          </thead>
          <tbody
            className="relative block"
            style={{ height: virtual.totalSize }}
          >
            {virtual.items.map((item) => {
              const row = ordered[item.index]!
              return (
                <tr
                  key={row.id}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  className="absolute inset-x-0 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.25fr)] border-b bg-background"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <td className="min-w-0 px-4 py-3">
                    <div className="font-medium break-words">{row.title}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{displayDate(row.expenseDate)}</span>
                      <span aria-hidden>·</span>
                      <span>{displayAmount(row)}</span>
                    </div>
                  </td>
                  <td className="min-w-0 px-4 py-3">
                    <CategoryPicker
                      row={row}
                      disabled={disabled}
                      aiMinConfidence={aiMinConfidence}
                      onChange={onChange}
                    />
                  </td>
                  <td className="min-w-0 px-4 py-3">
                    <QuickChoices
                      row={row}
                      disabled={disabled}
                      aiMinConfidence={aiMinConfidence}
                      onChange={onChange}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <ul
          aria-label={t('tableLabel')}
          className="relative"
          style={{ height: virtual.totalSize }}
        >
          {virtual.items.map((item) => {
            const row = ordered[item.index]!
            return (
              <li
                key={row.id}
                ref={virtual.measureElement}
                data-index={item.index}
                className="absolute inset-x-0 min-w-0 border-b bg-background p-4"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <h3 className="font-medium break-words">{row.title}</h3>
                <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{displayDate(row.expenseDate)}</span>
                  <span aria-hidden>·</span>
                  <span>{displayAmount(row)}</span>
                </div>
                <div className="mt-3 space-y-3">
                  <CategoryPicker
                    row={row}
                    disabled={disabled}
                    aiMinConfidence={aiMinConfidence}
                    onChange={onChange}
                  />
                  <QuickChoices
                    row={row}
                    disabled={disabled}
                    aiMinConfidence={aiMinConfidence}
                    onChange={onChange}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

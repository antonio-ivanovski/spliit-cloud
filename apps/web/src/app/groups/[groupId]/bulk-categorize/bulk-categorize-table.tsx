import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { formatMinorAmount } from '@/app/groups/[groupId]/expenses/csv-import-review-model'
import {
  categoryFromId,
  categoryLabel,
} from '@/app/groups/[groupId]/stats/category-utils'
import {
  CategorySelector,
  type CategorySelectorBadge,
} from '@/components/category-selector'
import { Button } from '@/components/ui/button'
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
    evidenceKind?:
      | 'heuristic'
      | 'model-confidence'
      | 'option-probability'
      | 'self-reported-confidence'
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
    ? (containerWidth * 1.45) / 3.45 - 64
    : containerWidth - 32
  const estimatedChars =
    containerWidth > 0
      ? Math.max(12, Math.floor(titleWidth / 7))
      : wide
        ? 42
        : 34
  const titleLines = Math.max(1, Math.ceil(row.title.length / estimatedChars))
  return wide
    ? Math.max(72 + (titleLines - 1) * 20, alternatives ? 76 : 72)
    : 180 + (titleLines - 1) * 20 + (alternatives ? 48 : 0)
}

function confidenceBadgeClass(band: 'high' | 'medium' | 'low' | 'jev') {
  if (band === 'jev')
    return 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100'
  if (band === 'high')
    return 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100'
  if (band === 'medium')
    return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
  return 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100'
}

function chipClass(
  choice: CategorizeRow['choices'][number],
  aiMinConfidence: number,
) {
  if (choice.source === 'manual')
    return 'border-violet-300 bg-violet-50 text-violet-900 hover:border-violet-400 hover:bg-violet-100 hover:text-violet-950 focus-visible:ring-violet-500 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900 dark:hover:text-violet-50'
  if (choice.source === 'jev' && choice.evidenceKind === 'option-probability')
    return 'border-sky-300 bg-sky-50 text-sky-900 hover:border-sky-400 hover:bg-sky-100 hover:text-sky-950 focus-visible:ring-sky-500 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900 dark:hover:text-sky-50'
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
  const categoryBadges = new Map<CategoryId, CategorySelectorBadge>()
  for (const choice of row.choices) {
    if (choice.categoryId === DEFAULT_CATEGORY_ID || choice.source === 'manual')
      continue
    if (choice.source === 'jev' && choice.confidence !== null) {
      const confidence = Math.round(choice.confidence * 100)
      categoryBadges.set(choice.categoryId, {
        text: `${confidence}%`,
        accessibleDescription:
          choice.evidenceKind === 'option-probability'
            ? t('jevOptionProbability', { probability: confidence })
            : t('jevConfidence', { confidence }),
        className: confidenceBadgeClass('jev'),
      })
      continue
    }
    if (choice.source !== 'local' || choice.matchScore == null) continue
    const band = categoryConfidenceBand(
      choice.matchScore,
      choice.floor ?? aiMinConfidence,
    )
    if (band === 'none') continue
    const label =
      band === 'high'
        ? t('highMatch')
        : band === 'medium'
          ? t('mediumMatch')
          : t('lowMatch')
    categoryBadges.set(choice.categoryId, {
      text: label,
      accessibleDescription: label,
      className: confidenceBadgeClass(band),
    })
  }
  return (
    <div className="min-w-0 flex-1">
      <CategorySelector
        categories={CATEGORIES}
        categoryBadges={categoryBadges}
        defaultValue={row.categoryId}
        isLoading={false}
        disabled={disabled}
        ariaLabel={`${t('categoryColumn')}: ${row.title} — ${categoryLabel(tCategories, row.categoryId)}`}
        onValueChange={(categoryId) => onChange(row.id, categoryId)}
      />
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
              <>
                <span className="opacity-70" aria-hidden>
                  {Math.round(choice.confidence * 100)}%
                </span>
                <span className="sr-only">
                  {choice.evidenceKind === 'option-probability'
                    ? t('jevOptionProbability', {
                        probability: Math.round(choice.confidence * 100),
                      })
                    : t('jevConfidence', {
                        confidence: Math.round(choice.confidence * 100),
                      })}
                </span>
              </>
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
  onViewExpense,
  preserveOrder = false,
}: {
  rows: CategorizeRow[]
  disabled: boolean
  aiMinConfidence: number
  onChange: (id: string, categoryId: CategoryId) => void
  onViewExpense?: (id: string) => void
  preserveOrder?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const locale = useLocale()
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  )
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(
    null,
  )
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const wide = containerWidth >= 760
  const ordered = useMemo(
    () => (preserveOrder ? rows : sortCategorizeRows(rows)),
    [rows, preserveOrder],
  )
  const virtualizer = useWindowVirtualizer({
    count: ordered.length,
    estimateSize: (index) =>
      estimateCategorizeRowHeight(ordered[index]!, containerWidth),
    getItemKey: (index) => ordered[index]!.id,
    overscan: 8,
    scrollMargin,
    initialRect: { width: 1024, height: 768 },
  })
  useLayoutEffect(() => {
    virtualizer.measure()
    containerNode
      ?.querySelectorAll<HTMLElement>('[data-index]')
      .forEach((row) => {
        virtualizer.measureElement(row)
      })
  }, [containerWidth, containerNode, virtualizer])
  useLayoutEffect(() => {
    if (!containerNode) return
    const update = () => {
      const rect = containerNode.getBoundingClientRect()
      setContainerWidth(Math.round(rect.width))
      setScrollMargin(rect.top + window.scrollY)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(containerNode)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerNode])
  const displayDate = (value: string) => {
    const date = value ? new Date(value) : null
    return date && Number.isFinite(date.getTime())
      ? dateFormatter.format(date)
      : '—'
  }
  const displayAmount = (row: CategorizeRow) =>
    Number.isFinite(row.amount)
      ? row.currency.length === 3
        ? formatMinorAmount(row.amount, row.currency)
        : `${(row.amount / 100).toFixed(2)} ${row.currency}`
      : '—'
  return (
    <div ref={setContainerNode} className="min-w-0">
      {containerWidth > 0 && (
        <ul
          aria-label={t('tableLabel')}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = ordered[item.index]!
            return (
              <li
                key={row.id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute inset-x-0 min-w-0 border-b bg-background px-4 py-4 text-sm transition-colors hover:bg-accent/40 sm:px-6"
                style={{
                  transform: `translateY(${item.start - scrollMargin}px)`,
                }}
              >
                <div
                  className={
                    wide
                      ? 'grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-5'
                      : 'space-y-3'
                  }
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <CategoryIcon
                      category={categoryFromId(row.categoryId)}
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      {onViewExpense ? (
                        <button
                          type="button"
                          className="group inline-flex max-w-full items-start gap-1 text-start font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
                          onClick={() => onViewExpense(row.id)}
                          aria-label={`${t('viewExpenseDetails')}: ${row.title}`}
                        >
                          <span className="min-w-0 break-words">
                            {row.title}
                          </span>
                          <ChevronRight
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground rtl:rotate-180"
                            aria-hidden
                          />
                        </button>
                      ) : (
                        <h3 className="font-medium break-words">{row.title}</h3>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{displayDate(row.expenseDate)}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">
                          {displayAmount(row)}
                        </span>
                      </div>
                    </div>
                  </div>
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

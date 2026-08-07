/* oxlint-disable jsx-a11y/prefer-tag-over-role -- grouped toggle buttons use an explicit accessible label. */
import { X } from 'lucide-react'
import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { CategorySelector } from '@/components/category-selector'
import { CurrencySelector } from '@/components/currency-selector'
import { ParticipantSelector } from '@/components/participant-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/i18n/react'
import { type DisplayCurrency } from '@/lib/currency'
import {
  enforceCurrencyPattern,
  localizeCurrencyInput,
} from '@/lib/currency-input'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import {
  DEFAULT_CATEGORIES,
  toggleCategorySelection,
  type CategoryId,
} from '@spliit/domain'

import {
  DEFAULT_FILTERS,
  type ExpenseFilters,
  type ExpenseMatchMode,
} from './use-expense-filters'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type CommonCurrencies = { currencies: string[] }

export type ExpenseFiltersContentProps = {
  group: Group
  commonCurrencies: CommonCurrencies | undefined
  /**
   * Working (uncommitted) state seeded from the currently applied filters when
   * the panel opens. The parent owns updating this so changes don't leak into
   * the URL until the user clicks Apply.
   */
  draft: ExpenseFilters
  onDraftChange: (next: ExpenseFilters) => void
  /**
   * Apply = commit `draft` to the URL and close the panel. Cancel = reset
   * `draft` to `initialDraft` and close without touching the URL.
   */
  onApply: () => void
  onCancel: () => void
  onResetDraft: () => void
  /** Render the footer with Apply/Cancel buttons. Mobile uses a sticky footer. */
  showFooter?: boolean
  className?: string
}

function toggleArrayMember(arr: string[], value: string): string[] {
  return arr.includes(value)
    ? arr.filter((entry) => entry !== value)
    : [...arr, value]
}

function FilterRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <span className="shrink-0 text-sm font-medium sm:w-28 sm:pt-1.5">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  )
}

function FilterChips({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses.filters' })
  if (selected.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {selected.map((id) => {
        const opt = options.find((o) => o.value === id)
        if (!opt) return null
        return (
          <Badge
            key={id}
            variant="secondary"
            className="gap-1 py-0 pe-1 text-xs"
          >
            {opt.label}
            <button
              type="button"
              onClick={() => onToggle(id)}
              aria-label={t('removeFilter')}
              className="ms-0.5 rounded-sm hover:bg-muted-foreground/20"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )
      })}
    </div>
  )
}

function MatchModeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: ExpenseMatchMode
  onChange: (next: ExpenseMatchMode) => void
  ariaLabel: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses.filters' })
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const options = [
    { value: 'any' as const, label: t('matchModeAny') },
    { value: 'all' as const, label: t('matchModeAll') },
    { value: 'exact' as const, label: t('matchModeExact') },
  ]

  if (!isDesktop) {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex min-w-0 rounded-md border bg-background p-0.5"
      >
        {options.map((option) => {
          const isActive = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
              className={cn(
                'min-h-8 flex-1 rounded px-2 text-xs font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ExpenseMatchMode)}
    >
      <SelectTrigger className="h-9 w-[130px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ExpenseFiltersContent({
  group,
  commonCurrencies,
  draft,
  onDraftChange,
  onApply,
  onCancel,
  onResetDraft,
  showFooter = true,
  className,
}: ExpenseFiltersContentProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses.filters' })
  const locale = useLocale()
  const { t: tExpenses } = useTranslation(undefined, {
    keyPrefix: 'Expenses',
  })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })

  const participantOptions = group.participants.map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const categoryOptions = DEFAULT_CATEGORIES.map((category) => ({
    value: category.id,
    label: categoryLabel(tCategories, category.id),
  }))

  const currencyOptions = (commonCurrencies?.currencies ?? []).map((code) => ({
    value: code,
    label: code,
  }))

  const displayCurrencies: DisplayCurrency[] = (
    commonCurrencies?.currencies ?? []
  ).map((code) => ({
    code,
    symbol: '',
    name: code,
    rounding: 0,
    decimal_digits: 2,
  }))

  const participants = group.participants.map((p) => ({
    id: p.id,
    name: p.name,
    account: p.account,
    pending: p.pending,
  }))

  const updateDraft = (patch: Partial<ExpenseFilters>) =>
    onDraftChange({ ...draft, ...patch })

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <FilterRow label={t('category')}>
        <CategorySelector
          mode="multi"
          categories={DEFAULT_CATEGORIES}
          isLoading={false}
          defaultValue="general"
          onValueChange={() => {
            /* multi mode uses onValueToggle; no-op to satisfy the type */
          }}
          selectedValues={draft.categories as CategoryId[]}
          onValueToggle={(id) =>
            updateDraft({
              categories: toggleCategorySelection(
                draft.categories as CategoryId[],
                id,
              ),
            })
          }
          multiPlaceholder={t('allCategories')}
          mobileTitle={t('category')}
        />
        <FilterChips
          options={categoryOptions}
          selected={draft.categories}
          onToggle={(id) =>
            updateDraft({
              categories: toggleCategorySelection(
                draft.categories as CategoryId[],
                id as CategoryId,
              ),
            })
          }
        />
      </FilterRow>

      <FilterRow label={t('paidBy')}>
        <ParticipantSelector
          mode="multi"
          participants={participants}
          selectedValues={draft.paidBy}
          onValueToggle={(id) =>
            updateDraft({ paidBy: toggleArrayMember(draft.paidBy, id) })
          }
          multiPlaceholder={t('allParticipants')}
          mobileTitle={t('paidBy')}
        />
        {draft.paidBy.length >= 1 && (
          <MatchModeSelect
            value={draft.paidByMatch}
            onChange={(paidByMatch) => updateDraft({ paidByMatch })}
            ariaLabel={t('paidBy')}
          />
        )}
        <FilterChips
          options={participantOptions}
          selected={draft.paidBy}
          onToggle={(id) =>
            updateDraft({ paidBy: toggleArrayMember(draft.paidBy, id) })
          }
        />
      </FilterRow>

      <FilterRow label={t('paidFor')}>
        <ParticipantSelector
          mode="multi"
          participants={participants}
          selectedValues={draft.paidFor}
          onValueToggle={(id) =>
            updateDraft({ paidFor: toggleArrayMember(draft.paidFor, id) })
          }
          multiPlaceholder={t('allParticipants')}
          mobileTitle={t('paidFor')}
        />
        {draft.paidFor.length >= 1 && (
          <MatchModeSelect
            value={draft.paidForMatch}
            onChange={(paidForMatch) => updateDraft({ paidForMatch })}
            ariaLabel={t('paidFor')}
          />
        )}
        <FilterChips
          options={participantOptions}
          selected={draft.paidFor}
          onToggle={(id) =>
            updateDraft({ paidFor: toggleArrayMember(draft.paidFor, id) })
          }
        />
      </FilterRow>

      <FilterRow label={t('dateRange')}>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <DateInput
            pickerTitle={t('dateFrom')}
            value={draft.dateFrom ?? ''}
            onValueChange={(value) =>
              updateDraft({ dateFrom: value || undefined })
            }
            aria-label={t('dateFrom')}
          />
          <DateInput
            pickerTitle={t('dateTo')}
            value={draft.dateTo ?? ''}
            onValueChange={(value) =>
              updateDraft({ dateTo: value || undefined })
            }
            aria-label={t('dateTo')}
          />
        </div>
      </FilterRow>

      <FilterRow label={t('amountRange')}>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Input
            type="text"
            inputMode="decimal"
            placeholder={t('minAmount')}
            value={localizeCurrencyInput(draft.minAmount ?? '', locale)}
            onChange={(e) =>
              updateDraft({
                minAmount:
                  enforceCurrencyPattern(e.target.value, undefined, locale) ||
                  undefined,
              })
            }
            aria-label={t('minAmount')}
          />
          <Input
            type="text"
            inputMode="decimal"
            placeholder={t('maxAmount')}
            value={localizeCurrencyInput(draft.maxAmount ?? '', locale)}
            onChange={(e) =>
              updateDraft({
                maxAmount:
                  enforceCurrencyPattern(e.target.value, undefined, locale) ||
                  undefined,
              })
            }
            aria-label={t('maxAmount')}
          />
        </div>
      </FilterRow>

      {currencyOptions.length > 0 && (
        <FilterRow label={t('currency')}>
          <CurrencySelector
            mode="multi"
            currencies={displayCurrencies}
            isLoading={false}
            defaultValue=""
            onValueChange={() => {
              /* multi mode uses onValueToggle; no-op to satisfy the type */
            }}
            selectedValues={draft.currencies}
            onValueToggle={(code) =>
              updateDraft({
                currencies: toggleArrayMember(draft.currencies, code),
              })
            }
            multiPlaceholder={t('allCurrencies')}
            mobileTitle={t('currency')}
          />
          <FilterChips
            options={currencyOptions}
            selected={draft.currencies}
            onToggle={(code) =>
              updateDraft({
                currencies: toggleArrayMember(draft.currencies, code),
              })
            }
          />
        </FilterRow>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          checked={draft.showSettlements}
          onCheckedChange={(checked) =>
            updateDraft({ showSettlements: checked === true })
          }
          aria-label={tExpenses('showSettlements')}
          id="show-settlements-toggle"
        />
        <label
          htmlFor="show-settlements-toggle"
          className="cursor-pointer text-sm font-medium select-none"
        >
          {tExpenses('showSettlements')}
        </label>
      </div>

      {showFooter && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetDraft}
          >
            {t('clearAll')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              {t('cancel')}
            </Button>
            <Button type="button" size="sm" onClick={onApply}>
              {t('apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { DEFAULT_FILTERS }

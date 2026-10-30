import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput } from '@/app/groups/[groupId]/expenses/expense-form/amount-input'
import {
  amountPlaceholder,
  enforceCurrencyPattern,
} from '@/app/groups/[groupId]/expenses/expense-form/currency-utils'
import { CategorySelector } from '@/components/category-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { localizeCurrencyInput } from '@/lib/currency-input'
import {
  DEFAULT_CATEGORIES,
  amountAsDecimal,
  amountAsMinorUnits,
  expandCategorySelection,
  toggleCategorySelection,
  type CategoryId,
} from '@spliit/domain'

import { usePersonalTranslation } from './personal-i18n'
import type { PersonalBudget } from './types'

export type PersonalBudgetFormValue = {
  name: string
  /** Positive minor units. */
  amount: number
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
}

type Props = {
  currencyCode: string
  initial?: PersonalBudget | null
  existingBudgets: PersonalBudget[]
  pending?: boolean
  onSubmit: (value: PersonalBudgetFormValue) => void | Promise<void>
}

/**
 * Create/edit form for a monthly personal budget. Category scope is ALL or a
 * hand-picked set; overlapping scopes with another budget surface a
 * non-blocking warning (spending would count twice).
 */
export function PersonalBudgetForm({
  currencyCode,
  initial = null,
  existingBudgets,
  pending = false,
  onSubmit,
}: Props) {
  const { t } = usePersonalTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  void tCategories
  const locale = useLocale()
  const currency = getCurrency(currencyCode) ?? {
    code: currencyCode,
    symbol: currencyCode,
    rounding: 0,
    decimal_digits: 2,
  }

  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState(() =>
    initial
      ? amountAsDecimal(initial.amount, currency).toFixed(
          currency.decimal_digits,
        )
      : '',
  )
  const [scope, setScope] = useState<'ALL' | 'SELECTED'>(
    initial?.categoryScope ?? 'ALL',
  )
  const [categoryIds, setCategoryIds] = useState<CategoryId[]>(
    (initial?.categoryIds ?? []) as CategoryId[],
  )
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Number(amount)
  const validationMessage =
    name.trim().length === 0
      ? t('budgets.validationName')
      : amount.trim() === '' ||
          !Number.isFinite(parsedAmount) ||
          parsedAmount <= 0
        ? t('budgets.validationAmount')
        : scope === 'SELECTED' && categoryIds.length === 0
          ? t('budgets.validationCategories')
          : null

  const overlapWarning = findOverlapWarning(
    existingBudgets,
    initial?.id ?? null,
    scope,
    categoryIds,
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (validationMessage) {
      setError(validationMessage)
      return
    }
    setError(null)
    await onSubmit({
      name: name.trim(),
      amount: amountAsMinorUnits(parsedAmount, currency),
      categoryScope: scope,
      categoryIds: scope === 'SELECTED' ? [...categoryIds] : [],
    })
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-2">
          <Label htmlFor="personal-budget-name">{t('budgets.name')}</Label>
          <Input
            id="personal-budget-name"
            value={name}
            maxLength={80}
            placeholder={t('budgets.namePlaceholder')}
            onChange={(event) => {
              setName(event.target.value)
              if (error) setError(null)
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="personal-budget-amount">{t('budgets.amount')}</Label>
          <AmountInput
            id="personal-budget-amount"
            currency={currency}
            containerClassName="w-full"
            className="text-lg font-semibold"
            type="text"
            inputMode="decimal"
            placeholder={amountPlaceholder(currency.decimal_digits, locale)}
            value={localizeCurrencyInput(amount, locale)}
            onChange={(event) => {
              setAmount(
                enforceCurrencyPattern(
                  event.target.value,
                  currency.decimal_digits,
                  locale,
                ),
              )
              if (error) setError(null)
            }}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t('budgets.scope')}</legend>
        <RadioGroup
          value={scope}
          onValueChange={(value) => {
            setScope(value as 'ALL' | 'SELECTED')
            if (error) setError(null)
          }}
          className="grid gap-2"
        >
          <RadioGroupItem value="ALL" card>
            <span className="text-sm font-medium">{t('budgets.scopeAll')}</span>
          </RadioGroupItem>
          <RadioGroupItem
            value="SELECTED"
            card
            content={
              scope === 'SELECTED' ? (
                <CategorySelector
                  categories={DEFAULT_CATEGORIES}
                  defaultValue="general"
                  isLoading={false}
                  mode="multi"
                  onValueChange={() => undefined}
                  selectedValues={categoryIds}
                  onValueToggle={(id) => {
                    setCategoryIds((current) =>
                      toggleCategorySelection(current, id),
                    )
                    if (error) setError(null)
                  }}
                  multiPlaceholder={t('budgets.chooseCategories')}
                  mobileTitle={t('budgets.scope')}
                />
              ) : undefined
            }
          >
            <span className="text-sm font-medium">
              {t('budgets.scopeSelected')}
            </span>
          </RadioGroupItem>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          {t('budgets.periodHint')}
        </p>
      </fieldset>

      {overlapWarning && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          {t('budgets.overlapWarning', { name: overlapWarning })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? (
            <>
              <Loader2
                className="me-2 size-4 animate-spin"
                aria-hidden="true"
              />
              {t('budgets.saving')}
            </>
          ) : (
            <>
              <Save className="me-2 size-4" aria-hidden="true" />
              {t('budgets.save')}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

/**
 * Non-blocking overlap hint: another budget already covers the same spending.
 * ALL collides with everything; SELECTED collides on shared categories.
 */
export function findOverlapWarning(
  budgets: PersonalBudget[],
  selfId: string | null,
  scope: 'ALL' | 'SELECTED',
  categoryIds: ReadonlyArray<string>,
): string | null {
  const categorySet = new Set(expandCategorySelection(categoryIds))
  for (const budget of budgets) {
    if (budget.id === selfId) continue
    if (scope === 'ALL' || budget.categoryScope === 'ALL') {
      return budget.name
    }
    const existing = expandCategorySelection(budget.categoryIds)
    if (existing.some((id) => categorySet.has(id))) {
      return budget.name
    }
  }
  return null
}

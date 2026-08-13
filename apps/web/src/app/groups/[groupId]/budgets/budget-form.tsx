import { Link } from '@tanstack/react-router'
import { Layers, Loader2, Save, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput } from '@/app/groups/[groupId]/expenses/expense-form/amount-input'
import {
  amountPlaceholder,
  enforceCurrencyPattern,
} from '@/app/groups/[groupId]/expenses/expense-form/currency-utils'
import { CategorySelector } from '@/components/category-selector'
import { CurrencyIcon } from '@/components/currency-icon'
import { FixedActionBar } from '@/components/fixed-action-bar'
import { ParticipantSelector } from '@/components/participant-selector'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/i18n/react'
import { getCurrencyFromGroup } from '@/lib/currency'
import { localizeCurrencyInput } from '@/lib/currency-input'
import { formatDateOnly } from '@/lib/utils'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  DEFAULT_CATEGORIES,
  formatBudgetPeriodRange,
  getBudgetPeriodBounds,
  getCategoryById,
  getChildCategoryIds,
  isParentCategory,
  toggleCategorySelection,
  type CategoryId,
} from '@spliit/domain'

import { useBudgetTranslation } from './budget-i18n'
import {
  CategoryChipVisual,
  IconChipVisual,
  ParticipantChipVisual,
  ScopeChipList,
  categoryScopeLabel,
} from './budget-scope'
import type {
  BudgetDetail,
  BudgetMutationInput,
  BudgetPeriodType,
  BudgetScope,
} from './budget-types'

type Group = {
  currency: string
  currencyCode: string | null
  participants: Array<{
    id: string
    name: string
    account?: { id: string; name?: string | null; image?: string | null } | null
    pending?: boolean
  }>
}

type Props = {
  groupId: string
  group: Group
  budget?: BudgetDetail
  pending?: boolean
  onSubmit: (
    input: Omit<BudgetMutationInput, 'groupId' | 'budgetId'>,
  ) => void | Promise<void>
}

const periodValues: BudgetPeriodType[] = [
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
  'CUSTOM',
]
const periodTranslationKeys = {
  WEEKLY: 'period.weekly',
  MONTHLY: 'period.monthly',
  YEARLY: 'period.yearly',
  CUSTOM: 'period.custom',
} as const

function toDateInput(value: Date | string | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

export function BudgetForm({
  groupId,
  group,
  budget,
  pending = false,
  onSubmit,
}: Props) {
  const t = useBudgetTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const currency = getCurrencyFromGroup(group)
  const [name, setName] = useState(budget?.name ?? '')
  const [amount, setAmount] = useState(
    budget
      ? amountAsDecimal(budget.amount, currency).toFixed(
          currency.decimal_digits,
        )
      : '',
  )
  const [periodType, setPeriodType] = useState<BudgetPeriodType>(
    budget?.periodType ?? 'MONTHLY',
  )
  const [customStart, setCustomStart] = useState(
    toDateInput(budget?.customStart),
  )
  const [customEnd, setCustomEnd] = useState(toDateInput(budget?.customEnd))
  const [categoryScope, setCategoryScope] = useState<BudgetScope>(
    budget?.categoryScope ?? 'ALL',
  )
  const [categoryNodeIds, setCategoryNodeIds] = useState<CategoryId[]>(
    (budget?.categoryNodeIds ?? []) as CategoryId[],
  )
  const [participantScope, setParticipantScope] = useState<BudgetScope>(
    budget?.participantScope ?? 'ALL',
  )
  const [participantIds, setParticipantIds] = useState<string[]>(
    budget?.participantIds ?? [],
  )
  const [notifyTrending, setNotifyTrending] = useState(
    budget?.notifyTrending ?? true,
  )
  const [notifyOver, setNotifyOver] = useState(budget?.notifyOver ?? true)
  const [error, setError] = useState<string | null>(null)

  // The edit dialog is intentionally re-seeded when a different budget is selected.
  useEffect(() => {
    if (!budget) return
    const groupCurrency = getCurrencyFromGroup(group)
    // oxlint-disable-next-line react/react-compiler
    setName(budget.name)
    setAmount(
      amountAsDecimal(budget.amount, groupCurrency).toFixed(
        groupCurrency.decimal_digits,
      ),
    )
    setPeriodType(budget.periodType)
    setCustomStart(toDateInput(budget.customStart))
    setCustomEnd(toDateInput(budget.customEnd))
    setCategoryScope(budget.categoryScope)
    setCategoryNodeIds(budget.categoryNodeIds as CategoryId[])
    setParticipantScope(budget.participantScope)
    setParticipantIds(budget.participantIds)
    setNotifyTrending(budget.notifyTrending)
    setNotifyOver(budget.notifyOver)
  }, [budget, group])

  const participantOptions = useMemo(
    () =>
      group.participants.map((participant) => ({
        ...participant,
        name: participant.name,
      })),
    [group.participants],
  )
  const [timeZone] = useState(() =>
    typeof Intl === 'undefined'
      ? 'UTC'
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const periodBounds = useMemo(() => {
    try {
      return getBudgetPeriodBounds({
        period: periodType,
        amount: 0,
        timeZone,
        customStartDate: periodType === 'CUSTOM' ? customStart || null : null,
        customEndDate: periodType === 'CUSTOM' ? customEnd || null : null,
        categoryScope,
        categoryNodeIds,
        participantScope,
        participantIds,
      })
    } catch {
      return null
    }
  }, [
    periodType,
    customStart,
    customEnd,
    timeZone,
    categoryScope,
    categoryNodeIds,
    participantScope,
    participantIds,
  ])
  const selectedCategoryIds = categoryNodeIds
  const allCategoryChips = [
    {
      id: 'all',
      label: t('allCategories'),
      leading: <IconChipVisual icon={Layers} />,
    },
  ]
  const selectedCategoryChips = categoryNodeIds.map((id) => {
    const category = getCategoryById(id)
    const label = categoryScopeLabel(tCategories, id)
    return {
      id,
      label:
        category &&
        isParentCategory(category) &&
        getChildCategoryIds(category.id).length > 0
          ? `${label} (${t('form.allSubcategories')})`
          : label,
      leading: category ? (
        <CategoryChipVisual category={category} />
      ) : undefined,
    }
  })
  const allParticipantChips = [
    {
      id: 'all',
      label: t('allParticipants'),
      leading: <IconChipVisual icon={Users} />,
    },
  ]
  const selectedParticipantChips = participantIds.map((id) => {
    const participant = group.participants.find((p) => p.id === id)
    return {
      id,
      label: participant?.name ?? id,
      leading: participant ? (
        <ParticipantChipVisual participant={participant} />
      ) : undefined,
    }
  })
  const canSubmit =
    name.trim().length > 0 &&
    Number(amount) > 0 &&
    (periodType !== 'CUSTOM' ||
      (customStart !== '' && customEnd !== '' && customStart <= customEnd)) &&
    (categoryScope === 'ALL' || categoryNodeIds.length > 0) &&
    (participantScope === 'ALL' || participantIds.length > 0)

  const validationMessage =
    name.trim().length === 0
      ? t('validationName')
      : Number(amount) <= 0
        ? t('validationAmount')
        : periodType === 'CUSTOM' &&
            (customStart === '' || customEnd === '' || customStart > customEnd)
          ? t('validationDates')
          : categoryScope === 'SELECTED' && categoryNodeIds.length === 0
            ? t('validationCategories')
            : participantScope === 'SELECTED' && participantIds.length === 0
              ? t('validationParticipants')
              : null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      setError(validationMessage ?? t('validation'))
      return
    }
    setError(null)
    await onSubmit({
      name: name.trim(),
      amount: amountAsMinorUnits(Number(amount) || 0, currency),
      periodType,
      customStart: periodType === 'CUSTOM' ? customStart : null,
      customEnd: periodType === 'CUSTOM' ? customEnd : null,
      categoryScope,
      categoryNodeIds,
      participantScope,
      participantIds,
      notifyTrending,
      notifyOver,
    })
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-6 pb-24 sm:pb-20"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
        <div className="space-y-2">
          <Label htmlFor="budget-name">{t('form.name')}</Label>
          <Input
            id="budget-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('form.namePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="budget-amount">{t('form.amount')}</Label>
          <div className="flex min-h-10 w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <div
              className="flex h-10 shrink-0 items-center gap-2 border-e border-input px-3"
              aria-label={currency.code}
            >
              <CurrencyIcon
                code={currency.code || 'un'}
                className="w-4 shrink-0"
              />
              <span className="text-sm font-medium">{currency.code}</span>
            </div>
            <AmountInput
              id="budget-amount"
              containerClassName="min-w-0 flex-1"
              className="h-10 w-full rounded-none border-0 text-lg font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              type="text"
              inputMode="decimal"
              placeholder={amountPlaceholder(currency.decimal_digits, locale)}
              value={localizeCurrencyInput(amount, locale)}
              onChange={(event) =>
                setAmount(
                  enforceCurrencyPattern(
                    event.target.value,
                    currency.decimal_digits,
                    locale,
                  ),
                )
              }
              onFocus={(event) => {
                const el = event.currentTarget
                setTimeout(() => el.select(), 1)
              }}
            />
          </div>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t('form.period')}</legend>
        <Select
          value={periodType}
          onValueChange={(value) => setPeriodType(value as BudgetPeriodType)}
        >
          <SelectTrigger aria-label={t('form.period')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodValues.map((period) => (
              <SelectItem key={period} value={period}>
                {t(periodTranslationKeys[period])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {periodBounds && (
          <p className="text-xs text-muted-foreground">
            {t('form.periodHint', {
              range: formatBudgetPeriodRange(
                periodType,
                periodBounds.start,
                periodBounds.end,
                (date) => formatDateOnly(date, locale, { dateStyle: 'medium' }),
              ),
            })}
          </p>
        )}
        {periodType === 'CUSTOM' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="budget-start">{t('form.startDate')}</Label>
              <DateInput
                id="budget-start"
                pickerTitle={t('form.startDate')}
                value={customStart}
                onValueChange={setCustomStart}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-end">{t('form.endDate')}</Label>
              <DateInput
                id="budget-end"
                pickerTitle={t('form.endDate')}
                value={customEnd}
                onValueChange={setCustomEnd}
              />
            </div>
          </div>
        )}
      </fieldset>

      <ScopeFieldset
        label={t('form.categories')}
        scope={categoryScope}
        onScopeChange={setCategoryScope}
        allLabel={t('allCategories')}
        selectedLabel={t('selectedCategories')}
        allChips={<ScopeChipList items={allCategoryChips} />}
        selectedChips={
          <ScopeChipList
            items={selectedCategoryChips}
            onRemove={(id) =>
              setCategoryNodeIds((current) =>
                current.filter((value) => value !== id),
              )
            }
            removeLabel={t('remove')}
          />
        }
      >
        <>
          <p className="text-xs text-muted-foreground">
            {t('form.categoryScopeHint')}
          </p>
          <CategorySelector
            categories={DEFAULT_CATEGORIES}
            defaultValue="general"
            isLoading={false}
            mode="multi"
            onValueChange={() => undefined}
            selectedValues={selectedCategoryIds}
            onValueToggle={(id) =>
              setCategoryNodeIds((current) =>
                toggleCategorySelection(current, id),
              )
            }
            multiPlaceholder={t('form.chooseCategories')}
            mobileTitle={t('form.categories')}
          />
        </>
      </ScopeFieldset>

      <ScopeFieldset
        label={t('form.participants')}
        scope={participantScope}
        onScopeChange={setParticipantScope}
        allLabel={t('allParticipants')}
        selectedLabel={t('selectedParticipants')}
        allChips={<ScopeChipList items={allParticipantChips} />}
        selectedChips={
          <ScopeChipList
            items={selectedParticipantChips}
            onRemove={(id) =>
              setParticipantIds((current) =>
                current.filter((value) => value !== id),
              )
            }
            removeLabel={t('remove')}
          />
        }
      >
        <>
          <p className="text-xs text-muted-foreground">
            {t('form.participantScopeHint')}
          </p>
          <ParticipantSelector
            participants={participantOptions}
            mode="multi"
            selectedValues={participantIds}
            onValueToggle={(id) =>
              setParticipantIds((current) =>
                current.includes(id)
                  ? current.filter((value) => value !== id)
                  : [...current, id],
              )
            }
            multiPlaceholder={t('form.chooseParticipants')}
            mobileTitle={t('form.participants')}
            className="w-full"
          />
        </>
      </ScopeFieldset>

      <p className="-mt-3 text-xs text-muted-foreground">
        {t('form.overlapHint')}
      </p>

      {/*
       * The notification audience follows participant scope. Keep this note
       * close to the controls because name-only participants cannot receive
       * account notifications.
       */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          {t('form.notifications')}
        </legend>
        <div className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
          <Checkbox
            id="budget-notify-trending"
            checked={notifyTrending}
            onCheckedChange={(checked) => setNotifyTrending(checked === true)}
          />
          <Label htmlFor="budget-notify-trending" className="cursor-pointer">
            <span className="block text-sm font-medium">
              {t('form.notifyTrending')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('form.notifyTrendingDescription')}
            </span>
          </Label>
        </div>
        <div className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
          <Checkbox
            id="budget-notify-over"
            checked={notifyOver}
            onCheckedChange={(checked) => setNotifyOver(checked === true)}
          />
          <Label htmlFor="budget-notify-over" className="cursor-pointer">
            <span className="block text-sm font-medium">
              {t('form.notifyOver')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('form.notifyOverDescription')}
            </span>
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('form.notificationRecipients')}
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <FixedActionBar>
        <Button
          variant="ghost"
          render={<Link to="/groups/$groupId/budgets" params={{ groupId }} />}
        >
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t('saving')}
            </>
          ) : (
            <>
              <Save className="me-2 h-4 w-4" />
              {t('save')}
            </>
          )}
        </Button>
      </FixedActionBar>
    </form>
  )
}

function ScopeFieldset({
  label,
  scope,
  onScopeChange,
  allLabel,
  selectedLabel,
  allChips,
  selectedChips,
  children,
}: {
  label: string
  scope: BudgetScope
  onScopeChange: (scope: BudgetScope) => void
  allLabel: string
  selectedLabel: string
  allChips: React.ReactNode
  selectedChips: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      <RadioGroup
        value={scope}
        onValueChange={(value) => onScopeChange(value as BudgetScope)}
        className="grid gap-2"
      >
        <RadioGroupItem
          value="ALL"
          card
          content={scope === 'ALL' ? allChips : undefined}
        >
          <span className="text-sm font-medium">{allLabel}</span>
        </RadioGroupItem>
        <RadioGroupItem
          value="SELECTED"
          card
          content={
            scope === 'SELECTED' ? (
              <div className="space-y-3">
                {selectedChips}
                {children}
              </div>
            ) : undefined
          }
        >
          <span className="text-sm font-medium">{selectedLabel}</span>
        </RadioGroupItem>
      </RadioGroup>
    </fieldset>
  )
}

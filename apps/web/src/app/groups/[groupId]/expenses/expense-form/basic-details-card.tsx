import { CategorySelector } from '@/components/category-selector'
import { CurrencySelector } from '@/components/currency-selector'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLocale } from '@/i18n/react'
import type { Locale } from '@/i18n/request'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { formatCurrency } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  RecurrenceRule,
} from '@spliit/domain'
import { DEFAULT_CATEGORIES } from '@spliit/domain'
import { ArrowLeft } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { AmountInput } from './amount-input'
import { enforceCurrencyPattern, formatDate } from './currency-utils'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function BasicDetailsCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  isIncome: boolean
  setIsIncome: Dispatch<SetStateAction<boolean>>
  isCreate: boolean
  extractCategoryMutation: ReturnType<
    typeof import('@/trpc/client').trpc.ai.extractCategoryFromTitle.useMutation
  >
  runtimeFeatureFlags: RuntimeFeatureFlags
  originalCurrency: Currency
  conversionRequired: boolean
  convertedAmountPreview: number | undefined
  exchangeRate: {
    data: number | undefined
    error: Error | null
    isLoading: boolean
    refresh: () => void
  }
  usingCustomConversionRate: boolean
  setUsingCustomConversionRate: Dispatch<SetStateAction<boolean>>
  conversionRateMessage: string
  originalCurrencies: {
    code: string
    symbol: string
    rounding: number
    decimal_digits: number
    name: string
  }[]
}) {
  const {
    form,
    group,
    groupCurrency,
    readOnly,
    sExpense,
    isIncome,
    setIsIncome,
    isCreate,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale() as Locale
  const [isCategoryLoading, setCategoryLoading] = useState(false)

  const getSelectedRecurrenceRule = (field?: { value: string }) => {
    return field?.value as RecurrenceRule
  }

  // The single editable amount always lives in the selected expense
  // currency. The converted preview (Ledger currency) is read-only.
  const inputCurrency = props.originalCurrency
  const previewFormatted =
    props.convertedAmountPreview != null
      ? formatCurrency(
          groupCurrency,
          props.convertedAmountPreview,
          locale,
          true,
        )
      : ''

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link
            href={`/groups/${group.id}/expenses`}
            title={tGroups('backToExpenses')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <CardTitle>
          {t(`${sExpense}.${isCreate ? 'create' : 'edit'}`)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="">
              <FormLabel>{t(`${sExpense}.TitleField.label`)}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t(`${sExpense}.TitleField.placeholder`)}
                  className="text-base"
                  disabled={readOnly}
                  {...field}
                  onBlur={async () => {
                    field.onBlur()
                    if (
                      !readOnly &&
                      props.runtimeFeatureFlags.enableCategoryExtract
                    ) {
                      setCategoryLoading(true)
                      const { categoryId } =
                        await props.extractCategoryMutation.mutateAsync({
                          description: field.value,
                        })
                      form.setValue('category', categoryId)
                      setCategoryLoading(false)
                    }
                  }}
                />
              </FormControl>
              <FormDescription>
                {t(`${sExpense}.TitleField.description`)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="expenseDate"
          render={({ field }) => (
            <FormItem className="sm:order-1">
              <FormLabel>{t(`${sExpense}.DateField.label`)}</FormLabel>
              <FormControl>
                <Input
                  className="date-base"
                  type="date"
                  defaultValue={formatDate(field.value)}
                  disabled={readOnly}
                  onChange={(event) => {
                    return field.onChange(new Date(event.target.value))
                  }}
                />
              </FormControl>
              <FormDescription>
                {t(`${sExpense}.DateField.description`)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="originalCurrency"
          render={({ field: { onChange, ...field } }) => (
            <FormItem className="sm:order-3">
              <FormLabel>{t(`${sExpense}.currencyField.label`)}</FormLabel>
              <FormControl>
                {group.currencyCode ? (
                  <CurrencySelector
                    currencies={props.originalCurrencies}
                    defaultValue={form.watch(field.name) ?? ''}
                    isLoading={false}
                    disabled={readOnly}
                    onValueChange={(v) => onChange(v)}
                  />
                ) : (
                  <Input
                    className="text-base"
                    disabled={true}
                    {...field}
                    placeholder={group.currency}
                  />
                )}
              </FormControl>
              <FormDescription>
                {t(`${sExpense}.currencyField.description`)}{' '}
                {!group.currencyCode && t('conversionUnavailable')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="amount"
          render={({ field: { onChange, ...field } }) => (
            <FormItem className="sm:order-4 col-span-2 md:col-span-1 space-y-2">
              <FormLabel>{t('amountField.label')}</FormLabel>
              <FormControl>
                <AmountInput
                  currency={inputCurrency}
                  className="max-w-[132px] text-base"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={readOnly}
                  onChange={(event) => {
                    const v = enforceCurrencyPattern(event.target.value)
                    const income = Number(v) < 0
                    setIsIncome(income)
                    if (income) form.setValue('isReimbursement', false)
                    onChange(v)
                  }}
                  onFocus={(e) => {
                    const target = e.currentTarget
                    setTimeout(() => target.select(), 1)
                  }}
                  {...field}
                />
              </FormControl>
              <FormMessage />

              {props.conversionRequired && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground text-xs">
                      {t('convertedAmountField.label')} ({group.currency})
                    </span>
                    <span
                      className="text-sm font-medium tabular-nums"
                      aria-readonly="true"
                      data-testid="converted-amount-preview"
                    >
                      {previewFormatted || '—'}
                    </span>
                  </div>
                  <FormDescription className="text-xs">
                    {isNaN(form.getValues('expenseDate').getTime()) ? (
                      t('conversionRateState.noDate')
                    ) : form.getValues('expenseDate') &&
                      !props.usingCustomConversionRate ? (
                      <>
                        {props.conversionRateMessage}
                        {!props.exchangeRate.isLoading &&
                          props.exchangeRate.error && (
                            <Button
                              type="button"
                              className="h-auto py-0"
                              variant="link"
                              onClick={() => props.exchangeRate.refresh()}
                              disabled={readOnly}
                            >
                              {t('conversionRateState.refresh')}
                            </Button>
                          )}
                      </>
                    ) : (
                      t('conversionRateState.customRate')
                    )}
                  </FormDescription>
                  <Collapsible
                    open={props.usingCustomConversionRate}
                    onOpenChange={props.setUsingCustomConversionRate}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="link"
                        className="-mx-4 h-auto py-0"
                        disabled={readOnly}
                      >
                        {props.usingCustomConversionRate
                          ? t('conversionRateField.useApi')
                          : t('conversionRateField.useCustom')}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <FormField
                        control={form.control}
                        name="conversionRate"
                        render={({ field: { onChange, ...field } }) => (
                          <FormItem className="pt-1">
                            <FormLabel>
                              {t('conversionRateField.label')}
                            </FormLabel>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs text-muted-foreground">
                                {inputCurrency.symbol} 1 = {group.currency}
                              </span>
                              <FormControl>
                                <Input
                                  className="text-base max-w-[120px]"
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  disabled={readOnly}
                                  onChange={(event) => {
                                    const v = enforceCurrencyPattern(
                                      event.target.value,
                                    )
                                    onChange(v)
                                  }}
                                  {...field}
                                  onFocus={(e) => {
                                    const target = e.currentTarget
                                    setTimeout(() => target.select(), 1)
                                  }}
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem className="order-3 sm:order-2">
              <FormLabel>{t('categoryField.label')}</FormLabel>
              <CategorySelector
                categories={DEFAULT_CATEGORIES}
                defaultValue={form.watch(field.name)}
                onValueChange={field.onChange}
                isLoading={isCategoryLoading}
                disabled={readOnly}
              />
              <FormDescription>
                {t(`${sExpense}.categoryFieldDescription`)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="sm:order-6">
          {!isIncome && (
            <FormField
              control={form.control}
              name="isReimbursement"
              render={({ field }) => (
                <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readOnly}
                    />
                  </FormControl>
                  <div>
                    <FormLabel>{t('isReimbursementField.label')}</FormLabel>
                  </div>
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:order-7">
              <FormLabel>{t('notesField.label')}</FormLabel>
              <FormControl>
                <Textarea
                  className="text-base"
                  disabled={readOnly}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="recurrenceRule"
          render={({ field }) => (
            <FormItem className="sm:order-8">
              <FormLabel>{t('Expense.recurrenceRule.label')}</FormLabel>
              <Select
                onValueChange={(value) => {
                  form.setValue('recurrenceRule', value as RecurrenceRule)
                }}
                defaultValue={getSelectedRecurrenceRule(field)}
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue placeholder="NONE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">
                    {t('Expense.recurrenceRule.none')}
                  </SelectItem>
                  <SelectItem value="DAILY">
                    {t('Expense.recurrenceRule.daily')}
                  </SelectItem>
                  <SelectItem value="WEEKLY">
                    {t('Expense.recurrenceRule.weekly')}
                  </SelectItem>
                  <SelectItem value="MONTHLY">
                    {t('Expense.recurrenceRule.monthly')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {t('Expense.recurrenceRule.description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  )
}

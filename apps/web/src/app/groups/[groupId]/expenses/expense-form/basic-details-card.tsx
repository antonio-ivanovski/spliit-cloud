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
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
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
import type { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  RecurrenceRule,
} from '@spliit/domain'
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID } from '@spliit/domain'
import {
  formatCalculatorAmount,
  type CalculatorItem,
} from '@spliit/domain/calculator'
import { ArrowLeft, Calculator, FileInput } from 'lucide-react'
import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { AmountCalculatorDialog } from './amount-calculator-dialog'
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
  heading?: string
  onMakeCopy?: () => void
  /** Link-invite token carried in the URL for pending invitees. */
  linkInviteToken?: string
  extractCategoryMutation: ReturnType<
    typeof trpc.ai.extractCategoryFromTitle.useMutation
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
  pinnedCurrencyCode?: string
  recommendedCurrencyCodes?: string[]
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
    heading,
    onMakeCopy,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale() as Locale
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const categoryRequestRef = useRef(0)
  const categorySourceRef = useRef<'default' | 'manual' | 'ai'>(
    form.getValues('category') === DEFAULT_CATEGORY_ID ? 'default' : 'manual',
  )
  const lastCategorizedTitleRef = useRef<string | null>(null)
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calculatorExpression, setCalculatorExpression] = useState<
    string | null
  >(null)
  const [pendingCalculatorItems, setPendingCalculatorItems] = useState<
    CalculatorItem[] | null
  >(null)
  const watchedItems = useWatch({ control: form.control, name: 'items' }) ?? []

  const getSelectedRecurrenceRule = (field?: { value: string }) => {
    return field?.value as RecurrenceRule
  }

  const inputCurrency = props.originalCurrency
  const hasExistingItems = watchedItems.some(
    (item) =>
      item.title.trim().length > 0 ||
      Number(item.unitPrice) > 0 ||
      Number(item.quantity) > 1,
  )
  const previewFormatted =
    props.convertedAmountPreview != null
      ? formatCurrency(
          groupCurrency,
          props.convertedAmountPreview,
          locale,
          true,
        )
      : ''

  const applyCalculatorItems = (items: CalculatorItem[]) => {
    const formItems: ExpenseFormItemValues[] = items.map((item) => ({
      id: crypto.randomUUID(),
      title: '',
      unitPrice: Number(formatCalculatorAmount(item.unitPrice, inputCurrency)),
      quantity: item.quantity,
      paidFor: group.participants.map((participant) => ({
        participant: participant.id,
        shares: 1,
      })),
      splitMode: 'EVENLY',
    }))
    const total = formItems.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    )

    form.setValue('splitMode', 'ITEMIZED', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('items', formItems, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue(
      'amount',
      Number(formatCalculatorAmount(total, inputCurrency)),
      {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      },
    )
    setIsIncome(false)
    window.setTimeout(() => form.setFocus('items.0.title'), 0)
  }

  const handleCalculatorItems = (items: CalculatorItem[]) => {
    if (hasExistingItems) {
      setPendingCalculatorItems(items)
      return
    }

    applyCalculatorItems(items)
  }

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
        <CardTitle className="flex-1">
          {heading ?? t(`${sExpense}.${isCreate ? 'create' : 'edit'}`)}
        </CardTitle>
        {onMakeCopy && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onMakeCopy}
            disabled={readOnly}
            data-testid="expense-make-copy"
          >
            <FileInput className="w-4 h-4 min-[420px]:mr-2" />
            <span className="hidden min-[420px]:inline">{t('makeCopy')}</span>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="order-1">
              <FormLabel>{t(`${sExpense}.TitleField.label`)}</FormLabel>
              <div className="flex min-h-10 w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field: categoryField }) => (
                    <CategorySelector
                      categories={DEFAULT_CATEGORIES}
                      defaultValue={categoryField.value}
                      compact
                      onValueChange={(categoryId) => {
                        categoryRequestRef.current += 1
                        categorySourceRef.current = 'manual'
                        setCategoryLoading(false)
                        props.extractCategoryMutation.reset?.()
                        categoryField.onChange(categoryId)
                      }}
                      isLoading={isCategoryLoading}
                      disabled={readOnly}
                    />
                  )}
                />
                <div className="min-w-0 flex-1 border-l border-input">
                  <FormControl>
                    <Input
                      placeholder={t(`${sExpense}.TitleField.placeholder`)}
                      className="h-10 w-full rounded-none border-0 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      disabled={readOnly}
                      {...field}
                      onBlur={() => {
                        field.onBlur()
                        const title = field.value.trim()
                        const canSuggest =
                          !readOnly &&
                          props.runtimeFeatureFlags.enableCategoryExtract &&
                          title.length > 0 &&
                          (categorySourceRef.current === 'default' ||
                            categorySourceRef.current === 'ai') &&
                          lastCategorizedTitleRef.current !== title

                        if (!canSuggest) return

                        const requestId = ++categoryRequestRef.current
                        setCategoryLoading(true)

                        void props.extractCategoryMutation
                          .mutateAsync({
                            description: title,
                            groupId: group.id,
                            locale,
                            linkInviteToken: props.linkInviteToken,
                          })
                          .then(({ categoryId }) => {
                            if (
                              requestId !== categoryRequestRef.current ||
                              form.getValues('title').trim() !== title ||
                              (categorySourceRef.current !== 'default' &&
                                categorySourceRef.current !== 'ai')
                            ) {
                              return
                            }

                            lastCategorizedTitleRef.current = title
                            categorySourceRef.current = 'ai'
                            form.setValue('category', categoryId, {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            })
                          })
                          .catch(() => undefined)
                          .finally(() => {
                            if (requestId === categoryRequestRef.current) {
                              setCategoryLoading(false)
                            }
                          })
                      }}
                    />
                  </FormControl>
                </div>
              </div>
              <FormDescription className="hidden sm:block">
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
            <FormItem className="order-5">
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
              <FormDescription className="hidden sm:block">
                {t(`${sExpense}.DateField.description`)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="amount"
          render={({ field: { onChange, ...field } }) => (
            <FormItem className="order-2 col-span-2 md:col-span-1 space-y-2">
              <FormLabel>{t('amountField.label')}</FormLabel>
              <div className="flex min-h-10 w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                {group.currencyCode ? (
                  <CurrencySelector
                    currencies={props.originalCurrencies}
                    defaultValue={form.watch('originalCurrency') ?? ''}
                    isLoading={false}
                    disabled={readOnly}
                    compact
                    onValueChange={(value) =>
                      form.setValue('originalCurrency', value, {
                        shouldDirty: true,
                        shouldTouch: true,
                        shouldValidate: true,
                      })
                    }
                    pinnedCurrencyCode={props.pinnedCurrencyCode}
                    recommendedCurrencyCodes={props.recommendedCurrencyCodes}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    className="h-10 shrink-0 gap-2 rounded-none border-0 border-r border-input px-3"
                    aria-label={group.currency}
                  >
                    <span className="text-sm font-medium">
                      {group.currency}
                    </span>
                  </Button>
                )}
                <div className="min-w-0 flex-1 border-l border-input">
                  <FormControl>
                    <AmountInput
                      containerClassName="min-w-0 flex-1"
                      className="h-10 w-full rounded-none border-0 text-lg font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      disabled={readOnly}
                      onChange={(event) => {
                        const v = enforceCurrencyPattern(event.target.value)
                        setCalculatorExpression(v)
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
                </div>
                {!readOnly && (
                  <Button
                    aria-label={t('amountField.calculator.buttonLabel')}
                    size="icon"
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0 rounded-none border-0 border-l border-input"
                    onClick={() => {
                      setCalculatorExpression(
                        (expression) =>
                          expression ?? String(form.getValues('amount') ?? ''),
                      )
                      setCalculatorOpen(true)
                    }}
                  >
                    <Calculator className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <AmountCalculatorDialog
                currency={inputCurrency}
                expression={calculatorExpression ?? String(field.value ?? '')}
                hasExistingItems={hasExistingItems}
                open={calculatorOpen}
                onOpenChange={setCalculatorOpen}
                onExpressionChange={setCalculatorExpression}
                onTransferAmount={(value) => {
                  const sanitizedValue = enforceCurrencyPattern(value)
                  const income = Number(sanitizedValue) < 0
                  setIsIncome(income)
                  if (income) form.setValue('isReimbursement', false)
                  onChange(sanitizedValue)
                }}
                onTransferItems={handleCalculatorItems}
              />
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
                  {!props.usingCustomConversionRate && (
                    <p className="text-xs text-muted-foreground">
                      {t('conversionRateField.providerNote')}
                    </p>
                  )}
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

        <div className="order-7">
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
            <FormItem className="order-8 sm:col-span-2">
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
            <FormItem className="order-9 sm:col-span-2">
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
              <FormDescription className="hidden sm:block">
                {t('Expense.recurrenceRule.description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
      <ResponsiveDialog
        open={!!pendingCalculatorItems}
        onOpenChange={(open) => {
          if (!open) setPendingCalculatorItems(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('amountField.calculator.replaceItemsTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('amountField.calculator.replaceItemsDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingCalculatorItems(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingCalculatorItems) {
                  applyCalculatorItems(pendingCalculatorItems)
                }
                setPendingCalculatorItems(null)
              }}
            >
              {t('amountField.calculator.replaceItemsConfirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  )
}

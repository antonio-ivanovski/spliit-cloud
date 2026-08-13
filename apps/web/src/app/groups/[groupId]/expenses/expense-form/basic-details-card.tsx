import { Link } from '@tanstack/react-router'
import { ArrowLeft, Calculator } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { CategorySelector } from '@/components/category-selector'
import { CurrencyRateProviderAttribution } from '@/components/currency-rate-provider-attribution'
import { CurrencySelector } from '@/components/currency-selector'
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
import { Textarea } from '@/components/ui/textarea'
import { useLocale } from '@/i18n/react'
import type { Locale } from '@/i18n/request'
import { localizeCurrencyInput } from '@/lib/currency-input'
import type { ExpenseCancelLink } from '@/lib/expense-navigation'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { formatCurrency, formatNumber } from '@/lib/utils'
import type { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { DEFAULT_CATEGORIES } from '@spliit/domain'
import {
  formatCalculatorAmount,
  type CalculatorItem,
} from '@spliit/domain/calculator'

import type {
  ReceiptDocument,
  ReceiptExtractedInfo,
  ReceiptScanContext,
} from '../create-from-receipt-button'
import { AmountCalculatorDialog } from './amount-calculator-dialog'
import { AmountInput } from './amount-input'
import {
  enforceCurrencyPattern,
  amountPlaceholder,
  parseCurrencyPaste,
} from './currency-utils'
import { applySplitToAll } from './default-item-split'
import type { SavedSplit } from './default-split/split-equal'
import {
  getNeutralDefaultSplit,
  savedDefaultToFormValues,
} from './default-values'
import { ExpenseDateTimeField } from './expense-date-time-field'
import { expenseTabPriority } from './focus-navigation'
import { RecurrenceSection } from './recurrence-section'
import { useSuggestCategoryFromTitle } from './use-suggest-category-from-title'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive expense form section, shared form state
export function BasicDetailsCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  accountTimeZone: string
  groupCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  isIncome: boolean
  isCreate: boolean
  isCopy?: boolean
  recurrenceSequence?: number
  editScope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' | null
  initialRecurrence?: ExpenseFormInputValues['recurrence']
  heading?: string
  cancelLink?: ExpenseCancelLink
  /** Link-invite token carried in the URL for pending invitees. */
  linkInviteToken?: string
  suggestCategoryMutation: ReturnType<
    typeof trpc.groups.expenses.suggestCategory.useMutation
  >
  runtimeFeatureFlags: RuntimeFeatureFlags
  originalCurrency: Currency
  conversionRequired: boolean
  convertedAmountPreview: number | undefined
  exchangeRate: {
    data: number | undefined
    via: string[] | undefined
    sources: Array<{
      provider: 'frankfurter' | 'coinbase'
      base: string
      target: string
    }>
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
  receiptDocuments: ReceiptDocument[]
  receiptScanContext: ReceiptScanContext
  onReceiptAccepted: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
  /**
   * Persisted per-user-per-group default split, used to seed new items created
   * by the calculator flow when switching to itemized.
   */
  savedDefault?: SavedSplit | null
}) {
  const {
    form,
    group,
    groupCurrency,
    readOnly,
    sExpense,
    isIncome,
    isCreate,
    heading,
    savedDefault,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale() as Locale
  const { isCategoryLoading, onManualCategory } = useSuggestCategoryFromTitle({
    form,
    groupId: group.id,
    locale,
    readOnly,
    enableCategoryExtract: props.runtimeFeatureFlags.enableCategoryExtract,
    linkInviteToken: props.linkInviteToken,
    suggestCategoryMutation: props.suggestCategoryMutation,
  })
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calculatorExpression, setCalculatorExpression] = useState<
    string | null
  >(null)
  const [pendingCalculatorItems, setPendingCalculatorItems] = useState<
    CalculatorItem[] | null
  >(null)
  const watchedItems = useWatch({ control: form.control, name: 'items' }) ?? []

  const inputCurrency = props.originalCurrency
  const hasExistingItems = watchedItems.some(
    (item) =>
      item.title.trim().length > 0 ||
      Number(item.unitPrice) !== 0 ||
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
    const seed = (savedDefaultToFormValues(
      savedDefault ?? null,
      group,
      groupCurrency,
    ) ?? getNeutralDefaultSplit(group)) as {
      splitMode: ExpenseFormItemValues['splitMode']
      paidFor: ExpenseFormItemValues['paidFor']
    }
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
    const totalDisplay = Number(formatCalculatorAmount(total, inputCurrency))

    form.setValue('splitMode', 'ITEMIZED', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    const seeded = applySplitToAll({
      items: formItems,
      split: seed,
      expenseAmount: totalDisplay,
      groupCurrency,
    })
    form.setValue('items', seeded.items, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('itemizedRemainder', seeded.itemizedRemainder, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('amount', totalDisplay, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
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
    <Card className="mobile-surface">
      <CardHeader className="hidden flex-row items-center gap-2 space-y-0 sm:flex">
        <Button
          variant="ghost"
          size="icon"
          className="-ms-2 hidden shrink-0 sm:inline-flex"
          render={
            <Link
              data-expense-tab-after-secondary
              {...(props.cancelLink ?? {
                to: '/groups/$groupId/expenses' as const,
                params: { groupId: group.id },
              })}
              title={tGroups('backToExpenses')}
            />
          }
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <CardTitle className="hidden min-w-0 flex-1 truncate sm:block">
          {heading ?? t(`${sExpense}.${isCreate ? 'create' : 'edit'}`)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="order-1 col-span-1 min-w-0">
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
                        onManualCategory()
                        categoryField.onChange(categoryId)
                      }}
                      isLoading={isCategoryLoading}
                      loadingAppearance={
                        props.runtimeFeatureFlags.enableCategoryExtract
                          ? 'ai'
                          : 'spinner'
                      }
                      disabled={readOnly}
                    />
                  )}
                />
                <div className="min-w-0 flex-1 border-s border-input">
                  <FormControl>
                    <Input
                      data-expense-tab-priority={expenseTabPriority.title}
                      placeholder={t(`${sExpense}.TitleField.placeholder`)}
                      className="h-10 w-full rounded-none border-0 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      disabled={readOnly}
                      {...field}
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
          name="amount"
          render={({ field: { onChange, ...field } }) => (
            <FormItem className="order-2 col-span-1 min-w-0 space-y-2">
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
                    className="h-10 shrink-0 gap-2 rounded-none border-0 border-e border-input px-3"
                    aria-label={group.currency}
                  >
                    <span className="text-sm font-medium">
                      {group.currency}
                    </span>
                  </Button>
                )}
                <div className="min-w-0 flex-1 border-s border-input">
                  <FormControl>
                    <AmountInput
                      {...field}
                      data-expense-tab-priority={expenseTabPriority.amount}
                      containerClassName="min-w-0 flex-1"
                      className="h-10 w-full rounded-none border-0 text-lg font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      type="text"
                      inputMode="decimal"
                      placeholder={amountPlaceholder(
                        inputCurrency.decimal_digits,
                        locale,
                      )}
                      disabled={readOnly}
                      value={localizeCurrencyInput(
                        String(field.value ?? ''),
                        locale,
                      )}
                      onChange={(event) => {
                        const v = enforceCurrencyPattern(
                          event.target.value,
                          inputCurrency.decimal_digits,
                          locale,
                        )
                        setCalculatorExpression(v)
                        onChange(v)
                      }}
                      onPaste={(event) => {
                        const parsed = parseCurrencyPaste(
                          event.clipboardData.getData('text'),
                          props.originalCurrencies,
                        )
                        if (!parsed) return
                        event.preventDefault()
                        setCalculatorExpression(parsed.amount)
                        onChange(parsed.amount)
                        if (parsed.currencyCode && group.currencyCode) {
                          form.setValue(
                            'originalCurrency',
                            parsed.currencyCode,
                            {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            },
                          )
                        }
                      }}
                      onFocus={(e) => {
                        const target = e.currentTarget
                        setTimeout(() => target.select(), 1)
                      }}
                    />
                  </FormControl>
                </div>
                {!readOnly && (
                  <Button
                    aria-label={t('amountField.calculator.buttonLabel')}
                    size="icon"
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0 rounded-none border-0 border-s border-input"
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
                  const sanitizedValue = enforceCurrencyPattern(
                    value,
                    inputCurrency.decimal_digits,
                    locale,
                  )
                  onChange(sanitizedValue)
                }}
                onTransferItems={handleCalculatorItems}
              />
              <FormMessage />

              {props.conversionRequired && (
                <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted-foreground">
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
                    {!form.getValues('expenseDay') ? (
                      t('conversionRateState.noDate')
                    ) : !props.usingCustomConversionRate ? (
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
                    <CurrencyRateProviderAttribution
                      sources={props.exchangeRate.sources}
                      via={props.exchangeRate.via}
                    />
                  )}
                  <Collapsible
                    open={props.usingCustomConversionRate}
                    onOpenChange={props.setUsingCustomConversionRate}
                  >
                    <CollapsibleTrigger
                      render={
                        <Button
                          type="button"
                          variant="link"
                          className="-mx-4 h-auto py-0"
                          disabled={readOnly}
                        />
                      }
                    >
                      {props.usingCustomConversionRate
                        ? t('conversionRateField.useApi')
                        : t('conversionRateField.useCustom')}
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
                                  {...field}
                                  className="max-w-[120px] text-base"
                                  type="text"
                                  inputMode="decimal"
                                  placeholder={formatNumber(0, locale, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  disabled={readOnly}
                                  value={localizeCurrencyInput(
                                    String(field.value ?? ''),
                                    locale,
                                  )}
                                  onChange={(event) => {
                                    const v = enforceCurrencyPattern(
                                      event.target.value,
                                      undefined,
                                      locale,
                                    )
                                    onChange(v)
                                  }}
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

        <section className="order-3 col-span-full grid min-w-0 gap-6">
          <div className="min-w-0">
            <ExpenseDateTimeField
              form={form}
              readOnly={readOnly}
              sExpense={sExpense}
            />
          </div>
          <div className="min-w-0">
            <RecurrenceSection
              form={form}
              readOnly={readOnly}
              isCopy={props.isCopy}
              currentSequence={props.recurrenceSequence}
              editScope={props.editScope}
              initialRecurrence={props.initialRecurrence}
            />
          </div>
        </section>

        <section className="order-5 col-span-full grid min-w-0 gap-4">
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('notesField.label')}</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-24 resize-y text-base"
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {!isIncome && (
            <FormField
              control={form.control}
              name="isReimbursement"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0 py-1">
                  <FormControl>
                    <Checkbox
                      id="is-reimbursement"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readOnly}
                    />
                  </FormControl>
                  <FormLabel
                    htmlFor="is-reimbursement"
                    className="cursor-pointer leading-5"
                  >
                    {t('isReimbursementField.label')}
                  </FormLabel>
                </FormItem>
              )}
            />
          )}
        </section>
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

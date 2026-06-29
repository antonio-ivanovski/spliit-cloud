import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { getCurrency } from '@/lib/currency'
import { calculateShare } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormValues } from '@spliit/domain'
import { ChevronRight } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'
import { enforceCurrencyPattern } from './currency-utils'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function PaidForCard(props: {
  form: UseFormReturn<ExpenseFormValues, any, ExpenseFormValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
}) {
  const { form, group, groupCurrency, payerCurrency, readOnly, sExpense } =
    props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const originalCurrencyCode = form.watch('originalCurrency')
  const originalCurrency = originalCurrencyCode
    ? (getCurrency(originalCurrencyCode) ?? {
        code: '',
        symbol: 'Custom',
        rounding: 0,
        decimal_digits: 2,
      })
    : { code: '', symbol: 'Custom', rounding: 0, decimal_digits: 2 }
  const conversionRequired = !!(
    group.currencyCode &&
    group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== group.currencyCode
  )
  const exchangeRate = form.watch('conversionRate')

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidFor.title`)}</span>
          <Button
            variant="link"
            type="button"
            className="-my-2 -mx-4"
            disabled={readOnly}
            onClick={() => {
              const paidFor = form.getValues().paidFor
              const allSelected = paidFor.length === group.participants.length
              const newPaidFor = allSelected
                ? []
                : group.participants.map((p) => ({
                    participant: p.id,
                    shares: (paidFor.find((pfor) => pfor.participant === p.id)
                      ?.shares ?? '1') as any,
                  }))
              form.setValue('paidFor', newPaidFor as any, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              })
            }}
          >
            {form.getValues().paidFor.length === group.participants.length ? (
              <>{t('selectNone')}</>
            ) : (
              <>{t('selectAll')}</>
            )}
          </Button>
        </CardTitle>
        <CardDescription>
          {t(`${sExpense}.paidFor.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="paidFor"
          render={() => (
            <FormItem className="sm:order-4 row-span-2 space-y-0">
              {group.participants.map((participant) => (
                <FormField
                  key={participant.id}
                  control={form.control}
                  name="paidFor"
                  render={({ field }) => {
                    const { id, name, pending } = participant
                    return (
                      <ParticipantShareRow
                        key={id}
                        dataId={`${id}/${form.getValues().splitMode}/${group.currency}`}
                        participant={participant}
                        checked={field.value?.some(
                          ({ participant }) => participant === id,
                        )}
                        onCheckedChange={(checked) => {
                          if (readOnly) return
                          const options = {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          }
                          checked
                            ? form.setValue(
                                'paidFor',
                                [
                                  ...field.value,
                                  {
                                    participant: id,
                                    shares: '1',
                                  },
                                ] as any,
                                options,
                              )
                            : form.setValue(
                                'paidFor',
                                field.value?.filter(
                                  (value) => value.participant !== id,
                                ),
                                options,
                              )
                        }}
                        disabled={readOnly}
                        pendingLabel={
                          pending ? (
                            <ParticipantPendingLabel
                              text={t('participant.pending')}
                            />
                          ) : undefined
                        }
                        preview={
                          field.value?.some(
                            ({ participant }) => participant === id,
                          ) &&
                          !form.watch('isReimbursement') && (
                            <ParticipantRowAmountPreview
                              amount={calculateShare(id, {
                                amount: amountAsMinorUnits(
                                  Number(form.watch('amount')),
                                  groupCurrency,
                                ),
                                paidFor: field.value.map(
                                  ({ participant, shares }) => ({
                                    participant: {
                                      id: participant,
                                      name: '',
                                      groupId: '',
                                    },
                                    shares:
                                      form.watch('splitMode') ===
                                      'BY_PERCENTAGE'
                                        ? Number(shares) * 100
                                        : form.watch('splitMode') ===
                                            'BY_AMOUNT'
                                          ? amountAsMinorUnits(
                                              shares,
                                              groupCurrency,
                                            )
                                          : shares,
                                    expenseId: '',
                                    participantId: '',
                                  }),
                                ),
                                splitMode: form.watch('splitMode'),
                                isReimbursement: form.watch('isReimbursement'),
                              })}
                              currency={groupCurrency}
                            />
                          )
                        }
                        shareInput={
                          <>
                            {form.getValues().splitMode === 'BY_AMOUNT' &&
                              !!conversionRequired && (
                                <FormField
                                  name={`paidFor[${field.value.findIndex(
                                    ({ participant }) => participant === id,
                                  )}].originalAmount`}
                                  render={() => {
                                    const sharesLabel = (
                                      <span
                                        className={cn('text-sm', {
                                          'text-muted': !field.value?.some(
                                            ({ participant }) =>
                                              participant === id,
                                          ),
                                        })}
                                      >
                                        {originalCurrency.symbol}
                                      </span>
                                    )
                                    return (
                                      <div>
                                        <div className="flex gap-1 items-center">
                                          {sharesLabel}
                                          <FormControl>
                                            <Input
                                              key={String(
                                                !field.value?.some(
                                                  ({ participant }) =>
                                                    participant === id,
                                                ),
                                              )}
                                              className="text-base w-[80px] -my-2"
                                              type="text"
                                              inputMode="decimal"
                                              disabled={
                                                readOnly ||
                                                !field.value?.some(
                                                  ({ participant }) =>
                                                    participant === id,
                                                )
                                              }
                                              value={
                                                field.value.find(
                                                  ({ participant }) =>
                                                    participant === id,
                                                )?.originalAmount ?? ''
                                              }
                                              onChange={(event) => {
                                                const originalAmount = Number(
                                                  event.target.value,
                                                )
                                                let convertedAmount = ''
                                                if (
                                                  !Number.isNaN(
                                                    originalAmount,
                                                  ) &&
                                                  exchangeRate
                                                ) {
                                                  convertedAmount = (
                                                    originalAmount *
                                                    exchangeRate
                                                  ).toFixed(
                                                    groupCurrency.decimal_digits,
                                                  )
                                                }
                                                field.onChange(
                                                  field.value.map((p) =>
                                                    p.participant === id
                                                      ? {
                                                          participant: id,
                                                          originalAmount:
                                                            event.target.value,
                                                          shares:
                                                            enforceCurrencyPattern(
                                                              convertedAmount,
                                                            ),
                                                        }
                                                      : p,
                                                  ),
                                                )
                                                props.setManuallyEditedParticipants(
                                                  (prev) =>
                                                    new Set(prev).add(id),
                                                )
                                              }}
                                              step={
                                                10 **
                                                -originalCurrency.decimal_digits
                                              }
                                            />
                                          </FormControl>
                                          <ChevronRight className="h-4 w-4 mx-1 opacity-50" />
                                        </div>
                                      </div>
                                    )
                                  }}
                                />
                              )}
                            {form.getValues().splitMode !== 'EVENLY' && (
                              <FormField
                                name={`paidFor[${field.value.findIndex(
                                  ({ participant }) => participant === id,
                                )}].shares`}
                                render={() => {
                                  const sharesLabel = (
                                    <span
                                      className={cn('text-sm', {
                                        'text-muted': !field.value?.some(
                                          ({ participant }) =>
                                            participant === id,
                                        ),
                                      })}
                                    >
                                      {match(form.getValues().splitMode)
                                        .with('BY_SHARES', () => (
                                          <>{t('shares')}</>
                                        ))
                                        .with('BY_PERCENTAGE', () => <>%</>)
                                        .with('BY_AMOUNT', () => (
                                          <>{group.currency}</>
                                        ))
                                        .otherwise(() => (
                                          <></>
                                        ))}
                                    </span>
                                  )
                                  return (
                                    <div>
                                      <div className="flex gap-1 items-center">
                                        {form.getValues().splitMode ===
                                          'BY_AMOUNT' && sharesLabel}
                                        <FormControl>
                                          <Input
                                            key={String(
                                              !field.value?.some(
                                                ({ participant }) =>
                                                  participant === id,
                                              ),
                                            )}
                                            className="text-base w-[80px] -my-2"
                                            type="text"
                                            disabled={
                                              readOnly ||
                                              !field.value?.some(
                                                ({ participant }) =>
                                                  participant === id,
                                              )
                                            }
                                            value={
                                              field.value?.find(
                                                ({ participant }) =>
                                                  participant === id,
                                              )?.shares
                                            }
                                            onChange={(event) => {
                                              field.onChange(
                                                field.value.map((p) =>
                                                  p.participant === id
                                                    ? {
                                                        participant: id,
                                                        shares:
                                                          enforceCurrencyPattern(
                                                            event.target.value,
                                                          ),
                                                      }
                                                    : p,
                                                ),
                                              )
                                              props.setManuallyEditedParticipants(
                                                (prev) => new Set(prev).add(id),
                                              )
                                            }}
                                            inputMode={
                                              form.getValues().splitMode ===
                                              'BY_AMOUNT'
                                                ? 'decimal'
                                                : 'numeric'
                                            }
                                            step={
                                              form.getValues().splitMode ===
                                              'BY_AMOUNT'
                                                ? 10 **
                                                  -groupCurrency.decimal_digits
                                                : 1
                                            }
                                          />
                                        </FormControl>
                                        {[
                                          'BY_SHARES',
                                          'BY_PERCENTAGE',
                                        ].includes(
                                          form.getValues().splitMode,
                                        ) && sharesLabel}
                                      </div>
                                      <FormMessage className="float-right" />
                                    </div>
                                  )
                                }}
                              />
                            )}
                          </>
                        }
                      />
                    )
                  }}
                />
              ))}
              <FormMessage />
            </FormItem>
          )}
        />

        <ParticipantDistributionFooter
          splitMode={form.watch('splitMode')}
          targetAmount={
            form.watch('splitMode') === 'BY_PERCENTAGE'
              ? 100
              : amountAsMinorUnits(
                  Number(form.watch('amount')) || 0,
                  groupCurrency,
                )
          }
          shares={
            form.watch('splitMode') === 'BY_AMOUNT'
              ? form
                  .watch('paidFor')
                  .map((p) =>
                    amountAsMinorUnits(Number(p.shares) || 0, groupCurrency),
                  )
              : form.watch('paidFor').map((p) => Number(p.shares) || 0)
          }
          currency={payerCurrency}
          paidByCount={form.watch('paidFor').length}
          dataTestId="paid-for-distribution-footer"
        />

        <Collapsible
          className="mt-5"
          defaultOpen={form.getValues().splitMode !== 'EVENLY'}
        >
          <CollapsibleTrigger asChild>
            <Button variant="link" className="-mx-4" disabled={readOnly}>
              {t('advancedOptions')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid sm:grid-cols-2 gap-6 pt-3">
              <FormField
                control={form.control}
                name="splitMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('SplitModeField.label')}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={(value) => {
                          form.setValue('splitMode', value as any, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          })
                        }}
                        defaultValue={field.value}
                        disabled={readOnly}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EVENLY">
                            {t('SplitModeField.evenly')}
                          </SelectItem>
                          <SelectItem value="BY_SHARES">
                            {t('SplitModeField.byShares')}
                          </SelectItem>
                          <SelectItem value="BY_PERCENTAGE">
                            {t('SplitModeField.byPercentage')}
                          </SelectItem>
                          <SelectItem value="BY_AMOUNT">
                            {t('SplitModeField.byAmount')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t(`${sExpense}.splitModeDescription`)}
                    </FormDescription>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="saveDefaultSplittingOptions"
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
                      <FormLabel>{t('SplitModeField.saveAsDefault')}</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

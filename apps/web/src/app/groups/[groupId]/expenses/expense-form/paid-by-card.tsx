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
import { calculatePaidByShare } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormValues } from '@spliit/domain'
import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'
import { enforceCurrencyPattern } from './currency-utils'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function PaidByCard(props: {
  form: UseFormReturn<ExpenseFormValues, any, ExpenseFormValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedPayers: Dispatch<SetStateAction<Set<string>>>
}) {
  const { form, group, groupCurrency, payerCurrency, readOnly, sExpense } =
    props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidByField.label`)}</span>
          {form.watch('isMultiPayer') && (
            <Button
              variant="link"
              type="button"
              className="-my-2 -mx-4"
              disabled={readOnly}
              onClick={() => {
                const paidByList = form.getValues().paidByList
                const allSelected =
                  paidByList.length === group.participants.length
                const newPaidByList = allSelected
                  ? []
                  : group.participants.map((p) => ({
                      participant: p.id,
                      shares: (paidByList.find((pb) => pb.participant === p.id)
                        ?.shares ?? '1') as any,
                    }))
                form.setValue('paidByList', newPaidByList as any, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
              }}
            >
              {form.getValues().paidByList.length ===
              group.participants.length ? (
                <>{t('selectNone')}</>
              ) : (
                <>{t('selectAll')}</>
              )}
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {t(`${sExpense}.paidByField.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {form.watch('isMultiPayer') ? (
          (() => {
            const isOriginalPayer = payerCurrency.code !== groupCurrency.code
            const targetAmount = isOriginalPayer
              ? Number(form.watch('originalAmount')) || 0
              : Number(form.watch('amount')) || 0

            const pbSplitMode = form.watch('paidBySplitMode')
            const pbList = form.watch('paidByList')
            const paidByListForCalc = pbList.map((p) => {
              const rawShares = Number(p.shares) || 0
              const shares =
                pbSplitMode === 'BY_PERCENTAGE'
                  ? rawShares * 100
                  : pbSplitMode === 'BY_AMOUNT'
                    ? amountAsMinorUnits(rawShares, payerCurrency)
                    : rawShares
              return { participant: { id: p.participant }, shares }
            })
            const paidByExpenseForCalc = {
              amount: amountAsMinorUnits(targetAmount, payerCurrency),
              paidByList: paidByListForCalc,
              paidBySplitMode: pbSplitMode,
              isReimbursement: false,
            }
            return (
              <>
                <FormField
                  control={form.control}
                  name="paidByList"
                  render={() => (
                    <FormItem className="sm:order-4 row-span-2 space-y-0">
                      {group.participants.map((participant) => (
                        <FormField
                          key={participant.id}
                          control={form.control}
                          name="paidByList"
                          render={({ field }) => {
                            const { id, name, pending } = participant
                            return (
                              <ParticipantShareRow
                                key={id}
                                dataId={`${id}/${form.getValues().paidBySplitMode}/${payerCurrency.code}`}
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
                                        'paidByList',
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
                                        'paidByList',
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
                                      amount={calculatePaidByShare(
                                        id,
                                        paidByExpenseForCalc,
                                      )}
                                      currency={payerCurrency}
                                    />
                                  )
                                }
                                shareInput={
                                  form.getValues().paidBySplitMode !==
                                    'EVENLY' && (
                                    <FormField
                                      name={`paidByList[${field.value.findIndex(({ participant }) => participant === id)}].shares`}
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
                                            {match(
                                              form.getValues().paidBySplitMode,
                                            )
                                              .with('BY_SHARES', () => (
                                                <>{t('shares')}</>
                                              ))
                                              .with('BY_PERCENTAGE', () => (
                                                <>%</>
                                              ))
                                              .with('BY_AMOUNT', () => (
                                                <>{payerCurrency.symbol}</>
                                              ))
                                              .otherwise(() => (
                                                <></>
                                              ))}
                                          </span>
                                        )
                                        return (
                                          <div>
                                            <div className="flex gap-1 items-center">
                                              {form.getValues()
                                                .paidBySplitMode ===
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
                                                                  event.target
                                                                    .value,
                                                                ),
                                                            }
                                                          : p,
                                                      ),
                                                    )
                                                    props.setManuallyEditedPayers(
                                                      (prev) =>
                                                        new Set(prev).add(id),
                                                    )
                                                  }}
                                                  inputMode={
                                                    form.getValues()
                                                      .paidBySplitMode ===
                                                    'BY_AMOUNT'
                                                      ? 'decimal'
                                                      : 'numeric'
                                                  }
                                                  step={
                                                    form.getValues()
                                                      .paidBySplitMode ===
                                                    'BY_AMOUNT'
                                                      ? 10 **
                                                        -payerCurrency.decimal_digits
                                                      : 1
                                                  }
                                                />
                                              </FormControl>
                                              {[
                                                'BY_SHARES',
                                                'BY_PERCENTAGE',
                                              ].includes(
                                                form.getValues()
                                                  .paidBySplitMode,
                                              ) && sharesLabel}
                                            </div>
                                            <FormMessage className="float-right" />
                                          </div>
                                        )
                                      }}
                                    />
                                  )
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

                {(() => {
                  const pbSplitMode = form.watch('paidBySplitMode')
                  const pbList = form.watch('paidByList')
                  const paidByCount = pbList.length
                  const sharesForFooter =
                    pbSplitMode === 'BY_AMOUNT'
                      ? pbList.map((p) =>
                          amountAsMinorUnits(
                            Number(p.shares) || 0,
                            payerCurrency,
                          ),
                        )
                      : pbSplitMode === 'BY_PERCENTAGE'
                        ? pbList.map((p) => Number(p.shares) || 0)
                        : pbList.map((p) => Number(p.shares) || 0)
                  const targetForFooter =
                    pbSplitMode === 'BY_PERCENTAGE'
                      ? 100
                      : amountAsMinorUnits(
                          Number(targetAmount) || 0,
                          payerCurrency,
                        )
                  return (
                    <ParticipantDistributionFooter
                      splitMode={pbSplitMode}
                      targetAmount={targetForFooter}
                      shares={sharesForFooter}
                      currency={payerCurrency}
                      paidByCount={paidByCount}
                      dataTestId="paid-by-distribution-footer"
                    />
                  )
                })()}

                <Collapsible
                  className="mt-5"
                  defaultOpen={form.getValues().paidBySplitMode !== 'EVENLY'}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="link"
                      className="-mx-4"
                      disabled={readOnly}
                    >
                      {t('paidByAdvancedOptions')}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid sm:grid-cols-2 gap-6 pt-3">
                      <FormField
                        control={form.control}
                        name="paidBySplitMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t('PaidBySplitModeField.label')}
                            </FormLabel>
                            <FormControl>
                              <Select
                                onValueChange={(value) => {
                                  form.setValue(
                                    'paidBySplitMode',
                                    value as any,
                                    {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                      shouldValidate: true,
                                    },
                                  )
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
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )
          })()
        ) : (
          <FormField
            control={form.control}
            name="paidByList"
            render={() => {
              const paidByList = form.watch('paidByList')
              const selectedPayer = paidByList[0]?.participant ?? ''
              const amount = String(Number(form.watch('amount')) || 0)
              return (
                <FormItem>
                  <Select
                    value={selectedPayer}
                    onValueChange={(value) => {
                      form.setValue(
                        'paidByList',
                        [{ participant: value, shares: amount }] as any,
                        {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        },
                      )
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          t('Expense.paidByField.placeholder') as string
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {group.participants.map(({ id, name, pending }) => (
                        <SelectItem key={id} value={id}>
                          {name}
                          {pending && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t('participant.pending')}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        )}

        <FormField
          control={form.control}
          name="isMultiPayer"
          render={({ field }) => (
            <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    const currentList = form.getValues().paidByList
                    const amount = String(Number(form.watch('amount')) || 0)
                    const firstParticipant =
                      currentList[0]?.participant ?? group.participants[0]?.id
                    if (firstParticipant) {
                      form.setValue(
                        'paidByList',
                        [
                          {
                            participant: firstParticipant,
                            shares: amount,
                          },
                        ] as any,
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      )
                    }
                    field.onChange(checked)
                  }}
                  disabled={readOnly}
                />
              </FormControl>
              <div>
                <FormLabel>{t('paidByAdvancedOptions')}</FormLabel>
              </div>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  )
}

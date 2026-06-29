import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { type SplitMode } from '@spliit/domain'
import { SetStateAction, useEffect, type Dispatch } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { PaidByRow } from './paid-by-row'
import { convertParticipantShares } from './split-mode-conversions'
import { PaidBySplitOptionCards } from './split-option-cards'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function PaidByCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
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

  const isMultiPayer = useWatch({ control: form.control, name: 'isMultiPayer' })
  const paidBySplitMode = useWatch({
    control: form.control,
    name: 'paidBySplitMode',
  })
  const paidByList = useWatch({ control: form.control, name: 'paidByList' })
  const amount = useWatch({ control: form.control, name: 'amount' })
  const originalAmount = useWatch({
    control: form.control,
    name: 'originalAmount',
  })
  const isReimbursement = useWatch({
    control: form.control,
    name: 'isReimbursement',
  })

  const isOriginalPayer = payerCurrency.code !== groupCurrency.code
  const singlePayerTargetAmount = isOriginalPayer
    ? Number(originalAmount) || 0
    : Number(amount) || 0
  const singlePayerPaidByList = (
    participant: string,
  ): ExpenseFormInputValues['paidByList'] => [
    { participant, shares: singlePayerTargetAmount },
  ]
  const initialMultiPayerShare = (splitMode: SplitMode) =>
    splitMode === 'BY_AMOUNT' ? singlePayerTargetAmount : 1

  const handlePaidBySplitModeChange = (nextMode: SplitMode) => {
    const currentMode = form.getValues('paidBySplitMode')
    if (currentMode === nextMode) return
    const currentPaidByList = form.getValues('paidByList')
    const targetAmount = isOriginalPayer
      ? Number(form.getValues('originalAmount')) || 0
      : Number(form.getValues('amount')) || 0
    const converted = convertParticipantShares({
      rows: currentPaidByList,
      fromMode: currentMode,
      toMode: nextMode,
      targetAmount,
      currency: payerCurrency,
    })
    form.setValue('paidBySplitMode', nextMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidByList', converted, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
  }

  // Single-payer BY_AMOUNT shares are entered in payer currency.
  useEffect(() => {
    if (isMultiPayer) return
    const list = form.getValues('paidByList')
    if (list.length !== 1 || !list[0]?.participant) return
    if (Number(list[0].shares) === singlePayerTargetAmount) return
    form.setValue('paidByList', singlePayerPaidByList(list[0].participant), {
      shouldValidate: true,
    })
  }, [singlePayerTargetAmount, isMultiPayer])

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidByField.label`)}</span>
          {isMultiPayer && (
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
                      shares:
                        paidByList.find((pb) => pb.participant === p.id)
                          ?.shares ?? 1,
                    }))
                form.setValue('paidByList', newPaidByList, {
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
        <div className="mb-4">
          <PaidBySplitOptionCards
            value={{
              isMultiPayer: isMultiPayer ?? false,
              splitMode: paidBySplitMode,
            }}
            onChange={(next) => {
              const currentIsMultiPayer = form.getValues('isMultiPayer')

              if (next.isMultiPayer && currentIsMultiPayer) {
                handlePaidBySplitModeChange(next.splitMode)
                return
              }

              if (!next.isMultiPayer && currentIsMultiPayer) {
                const currentPaidByList = form.getValues('paidByList')
                const firstSelected =
                  currentPaidByList[0]?.participant ??
                  group.participants[0]?.id ??
                  ''
                form.setValue(
                  'paidByList',
                  singlePayerPaidByList(firstSelected),
                  {
                    shouldDirty: true,
                    shouldValidate: true,
                  },
                )
                form.setValue('paidBySplitMode', 'BY_AMOUNT', {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
                form.setValue('isMultiPayer', false, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
                return
              }

              if (next.isMultiPayer && !currentIsMultiPayer) {
                const currentList = form.getValues('paidByList')
                const firstParticipant =
                  currentList[0]?.participant ?? group.participants[0]?.id
                if (firstParticipant) {
                  form.setValue(
                    'paidByList',
                    [
                      {
                        participant: firstParticipant,
                        shares: initialMultiPayerShare(next.splitMode),
                      },
                    ],
                    {
                      shouldDirty: true,
                      shouldValidate: true,
                    },
                  )
                }
                form.setValue('isMultiPayer', true, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
                handlePaidBySplitModeChange(next.splitMode)
              }
            }}
            readOnly={readOnly}
            t={t}
          />
        </div>
        {isMultiPayer ? (
          <>
            <FormField
              control={form.control}
              name="paidByList"
              render={() => (
                <FormItem className="sm:order-4 row-span-2 space-y-0">
                  {group.participants.map((participant) => (
                    <PaidByRow
                      key={participant.id}
                      form={form}
                      participant={participant}
                      payerCurrency={payerCurrency}
                      groupCurrency={groupCurrency}
                      readOnly={readOnly}
                      setManuallyEditedPayers={props.setManuallyEditedPayers}
                      t={t}
                    />
                  ))}
                  <FormMessage />
                </FormItem>
              )}
            />

            {(() => {
              const paidByCount = paidByList.length
              const sharesForFooter =
                paidBySplitMode === 'BY_AMOUNT'
                  ? paidByList.map((p) =>
                      amountAsMinorUnits(Number(p.shares) || 0, payerCurrency),
                    )
                  : paidByList.map((p) => Number(p.shares) || 0)
              const isOriginalPayer = payerCurrency.code !== groupCurrency.code
              const targetAmount = isOriginalPayer
                ? Number(originalAmount) || 0
                : Number(amount) || 0
              const targetForFooter =
                paidBySplitMode === 'BY_PERCENTAGE'
                  ? 100
                  : amountAsMinorUnits(Number(targetAmount) || 0, payerCurrency)
              return (
                <ParticipantDistributionFooter
                  splitMode={paidBySplitMode}
                  targetAmount={targetForFooter}
                  shares={sharesForFooter}
                  currency={payerCurrency}
                  paidByCount={paidByCount}
                  dataTestId="paid-by-distribution-footer"
                />
              )
            })()}
          </>
        ) : (
          <FormField
            control={form.control}
            name="paidByList"
            render={() => {
              const selectedPayer = paidByList[0]?.participant ?? ''
              return (
                <FormItem>
                  <Select
                    value={selectedPayer}
                    onValueChange={(value) => {
                      form.setValue(
                        'paidByList',
                        singlePayerPaidByList(value),
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
      </CardContent>
    </Card>
  )
}

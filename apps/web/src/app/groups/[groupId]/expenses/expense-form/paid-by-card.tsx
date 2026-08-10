import type { SetStateAction } from 'react'
import { useCallback, useEffect, type Dispatch } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { ParticipantSelector } from '@/components/participant-selector'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { type SplitMode } from '@spliit/domain'

import { expenseTabPriority } from './focus-navigation'
import { getRowShareErrors } from './get-row-share-errors'
import { PaidByRow } from './paid-by-row'
import { RowErrorSummary } from './row-error-summary'
import type { ShareInputRefs } from './share-row-input'
import {
  buildEqualParticipantRows,
  convertParticipantShares,
} from './split-mode-conversions'
import {
  PaidBySplitOptionCards,
  type PaidBySplitOption,
} from './split-option-cards'
import { useShowRowErrors } from './use-show-row-errors'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function PaidByCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedPayers: Dispatch<SetStateAction<Set<string>>>
  /** Participant-keyed share input registry, owned by the expense form. */
  inputRefs: ShareInputRefs
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

  const singlePayerTargetAmount = Number(amount) || 0
  const singlePayerPaidByList = useCallback(
    (participant: string): ExpenseFormInputValues['paidByList'] => [
      { participant, shares: singlePayerTargetAmount },
    ],
    [singlePayerTargetAmount],
  )

  // The row summary recomputes errors from live values, so without a gate it
  // would announce itself on every keystroke. Show it only once the card has
  // been interacted with (a share row blurred) or the form was submitted.
  const showRowErrors = useShowRowErrors(form, 'paidByList')

  // The single-payer path emits the expense amount directly as a BY_AMOUNT
  // share (the form's single-payer mode forces paidBySplitMode = BY_AMOUNT
  // — see PaidBySplitOptionCards) so the BY_SHARES scaling is only
  // applied in the multi-payer paid-by list preview.
  const initialMultiPayerShare = (splitMode: SplitMode) =>
    splitMode === 'BY_AMOUNT' ? singlePayerTargetAmount : 1

  const handlePaidBySplitModeChange = (nextMode: SplitMode) => {
    const currentMode = form.getValues('paidBySplitMode')
    if (currentMode === nextMode) return
    const currentPaidByList = form.getValues('paidByList')
    const targetAmount = Number(form.getValues('amount')) || 0
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
  }, [singlePayerTargetAmount, isMultiPayer, form, singlePayerPaidByList])

  // Select all adds missing participants without overwriting edited values;
  // Select none clears every row.
  const handleSelectPaidByParticipants = () => {
    const currentPaidByList = form.getValues().paidByList
    const options = {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    }
    if (currentPaidByList.length === group.participants.length) {
      form.setValue('paidByList', [], options)
      return
    }
    const equalRows = buildEqualParticipantRows({
      participantIds: group.participants.map((p) => p.id),
      splitMode: paidBySplitMode as Exclude<SplitMode, 'ITEMIZED'>,
      targetAmount: Number(amount) || 0,
      currency: payerCurrency,
    })
    const existing = new Set(currentPaidByList.map((p) => p.participant))
    form.setValue(
      'paidByList',
      [
        ...currentPaidByList,
        ...equalRows.filter((row) => !existing.has(row.participant)),
      ],
      options,
    )
  }

  // Reset rebuilds the current distribution equally for the mode; unlike
  // Select all it overwrites every value, so edited payers become automatic
  // again.
  const handleResetPaidByDistribution = () => {
    form.setValue(
      'paidByList',
      buildEqualParticipantRows({
        participantIds: group.participants.map((p) => p.id),
        splitMode: paidBySplitMode as Exclude<SplitMode, 'ITEMIZED'>,
        targetAmount: Number(amount) || 0,
        currency: payerCurrency,
      }),
      { shouldDirty: true, shouldTouch: true, shouldValidate: true },
    )
    props.setManuallyEditedPayers(new Set())
  }

  const renderPaidByContent = (option: PaidBySplitOption) => {
    if (!option.isMultiPayer) {
      return (
        <FormField
          control={form.control}
          name="paidByList"
          render={() => {
            const selectedPayer = paidByList[0]?.participant ?? ''
            return (
              <FormItem data-expense-tab-priority={expenseTabPriority.paidBy}>
                <ParticipantSelector
                  participants={group.participants}
                  mode="single"
                  defaultValue={selectedPayer}
                  onValueChange={(value) => {
                    form.setValue('paidByList', singlePayerPaidByList(value), {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })
                  }}
                  disabled={readOnly}
                  className="w-full"
                  singlePlaceholder={t('Expense.paidByField.placeholder')}
                  mobileTitle={t(`${sExpense}.paidByField.label`)}
                />
                <FormMessage />
              </FormItem>
            )
          }}
        />
      )
    }

    const sharesForFooter =
      option.splitMode === 'BY_AMOUNT'
        ? paidByList.map((p) =>
            amountAsMinorUnits(Number(p.shares) || 0, payerCurrency),
          )
        : paidByList.map((p) => Number(p.shares) || 0)
    const targetForFooter =
      option.splitMode === 'BY_PERCENTAGE'
        ? 100
        : amountAsMinorUnits(Number(amount) || 0, payerCurrency)

    return (
      <>
        <div className="mb-2 flex justify-end gap-1">
          <Button
            variant="link"
            type="button"
            className="-my-2 -me-2"
            disabled={readOnly}
            onClick={handleResetPaidByDistribution}
          >
            {t('resetDistribution')}
          </Button>
          <Button
            variant="link"
            type="button"
            className="-my-2 -me-2"
            disabled={readOnly}
            onClick={handleSelectPaidByParticipants}
          >
            {paidByList.length === group.participants.length
              ? t('selectNone')
              : t('selectAll')}
          </Button>
        </div>
        <RowErrorSummary
          errors={
            showRowErrors
              ? getRowShareErrors({
                  rows: paidByList,
                  splitMode: option.splitMode,
                  amount: Number(amount) || 0,
                  // Paid-by shares may be signed (negative income expenses).
                  allowNegative: true,
                })
              : []
          }
          participantName={(id) =>
            group.participants.find((p) => p.id === id)?.name ?? id
          }
        />
        <FormField
          control={form.control}
          name="paidByList"
          render={() => (
            <FormItem className="w-full min-w-0 space-y-0">
              {group.participants.map((participant) => (
                <PaidByRow
                  key={participant.id}
                  form={form}
                  participant={participant}
                  payerCurrency={payerCurrency}
                  groupCurrency={groupCurrency}
                  readOnly={readOnly}
                  inputRefs={props.inputRefs}
                  setManuallyEditedPayers={props.setManuallyEditedPayers}
                />
              ))}
              <FormMessage />
            </FormItem>
          )}
        />
        <ParticipantDistributionFooter
          splitMode={option.splitMode}
          targetAmount={targetForFooter}
          shares={sharesForFooter}
          currency={payerCurrency}
          paidByCount={paidByList.length}
          dataTestId="paid-by-distribution-footer"
        />
      </>
    )
  }

  return (
    <Card className="mobile-surface mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidByField.label`)}</span>
        </CardTitle>
        <CardDescription>
          {t(`${sExpense}.paidByField.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <PaidBySplitOptionCards
            focusPriority={expenseTabPriority.paidBy}
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
            renderContent={renderPaidByContent}
            readOnly={readOnly}
          />
        </div>
      </CardContent>
    </Card>
  )
}

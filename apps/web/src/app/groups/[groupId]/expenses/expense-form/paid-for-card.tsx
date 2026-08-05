import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import { getCurrency } from '@/lib/currency'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { computePaidForFromItems, type SplitMode } from '@spliit/domain'

import { safeSharesToFixedUnits } from './currency-utils'
import { DefaultSplitActions } from './default-split/default-split-actions'
import type { SavedSplit } from './default-split/split-equal'
import { getRowShareErrors } from './get-row-share-errors'
import { LeaveItemizedDialog } from './leave-itemized-dialog'
import { PaidForRow } from './paid-for-row'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import { RowErrorSummary } from './row-error-summary'
import type { ShareInputRefs } from './share-row-input'
import {
  buildEqualParticipantRows,
  convertParticipantShares,
  roundTo,
} from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'
import { useShowRowErrors } from './use-show-row-errors'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

const paidForOptionKeys = {
  EVENLY: 'paidForOptionEvenly',
  BY_SHARES: 'paidForOptionByShares',
  BY_PERCENTAGE: 'paidForOptionByPercentage',
  BY_AMOUNT: 'paidForOptionByAmount',
  ITEMIZED: 'paidForOptionItemized',
} as const satisfies Record<SplitMode, string>

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive split-method card, shared form state
export function PaidForCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
  /** Persisted default split for this user+group, if any. */
  savedDefault: SavedSplit | null
  /** True for fresh-create + copy flows; false for editing an existing expense. */
  isCreate: boolean
  /** Participant-keyed share input registry, owned by the expense form. */
  inputRefs: ShareInputRefs
}) {
  const {
    form,
    group,
    groupCurrency,
    payerCurrency: _payerCurrency,
    readOnly,
    sExpense,
    savedDefault,
    isCreate: _isCreate,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const originalCurrencyCode = useWatch({
    control: form.control,
    name: 'originalCurrency',
  })
  const exchangeRate = useWatch({
    control: form.control,
    name: 'conversionRate',
  })
  const splitMode = useWatch({ control: form.control, name: 'splitMode' })
  const amount = useWatch({ control: form.control, name: 'amount' })
  const paidFor = useWatch({ control: form.control, name: 'paidFor' })
  const items = useWatch({ control: form.control, name: 'items' }) ?? []

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

  const [pendingModeChange, setPendingModeChange] = useState<{
    from: SplitMode
    to: SplitMode
  } | null>(null)

  // The row summary recomputes errors from live values, so without a gate it
  // would announce itself on every keystroke. Show it only once the card has
  // been interacted with (a share row blurred) or the form was submitted.
  const showRowErrors = useShowRowErrors(form, 'paidFor')

  const applyPaidForSplitModeChange = (from: SplitMode, to: SplitMode) => {
    const resetItemParticipants = (mode: SplitMode) => {
      if (mode === 'ITEMIZED') return
      const itemMode = mode as ItemSplitMode
      const buildRows = (targetAmount: number) => {
        const count = group.participants.length
        if (itemMode === 'BY_AMOUNT') {
          const raw = count > 0 ? targetAmount / count : 0
          const precision = originalCurrency.decimal_digits
          const values = Array.from({ length: count }, () =>
            roundTo(raw, precision),
          )
          const sum = values.reduce((a, b) => a + b, 0)
          const diff = roundTo(targetAmount - sum, precision)
          if (diff !== 0 && values.length > 0) {
            values[values.length - 1] = roundTo(
              values[values.length - 1] + diff,
              precision,
            )
          }
          return group.participants.map((p, i) => ({
            participant: p.id,
            shares: values[i] ?? 0,
          }))
        }
        if (itemMode === 'BY_PERCENTAGE') {
          const raw = count > 0 ? 100 / count : 0
          const values = Array.from({ length: count }, () => roundTo(raw, 2))
          const sum = values.reduce((a, b) => a + b, 0)
          const diff = roundTo(100 - sum, 2)
          if (diff !== 0 && values.length > 0) {
            values[values.length - 1] = roundTo(
              values[values.length - 1] + diff,
              2,
            )
          }
          return group.participants.map((p, i) => ({
            participant: p.id,
            shares: values[i] ?? 0,
          }))
        }
        return group.participants.map((p) => ({
          participant: p.id,
          shares: 1,
        }))
      }

      const nextItems = (form.getValues('items') ?? []).map((item) => ({
        ...item,
        splitMode: itemMode,
        paidFor: buildRows(Number(item.unitPrice) * Number(item.quantity)),
      }))
      form.setValue('items', nextItems, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })

      const itemTotal = nextItems.reduce(
        (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
        0,
      )
      const remainderAmount = Math.max(0, (Number(amount) || 0) - itemTotal)
      form.setValue(
        'itemizedRemainder',
        {
          splitMode: itemMode,
          paidFor: buildRows(remainderAmount),
        },
        {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        },
      )
    }

    if (from === 'ITEMIZED') {
      if (to !== 'ITEMIZED') {
        const targetAmount = Number(form.getValues('amount')) || 0
        const count = group.participants.length
        if (to === 'BY_AMOUNT') {
          const precision = (
            conversionRequired ? originalCurrency : groupCurrency
          ).decimal_digits
          const raw = targetAmount / count
          const values = Array.from({ length: count }, () =>
            roundTo(raw, precision),
          )
          const sum = values.reduce((a, b) => a + b, 0)
          const diff = roundTo(targetAmount - sum, precision)
          if (diff !== 0)
            values[values.length - 1] = roundTo(
              values[values.length - 1] + diff,
              precision,
            )
          form.setValue(
            'paidFor',
            group.participants.map((p, i) => ({
              participant: p.id,
              shares: values[i],
            })),
            { shouldDirty: true, shouldTouch: true, shouldValidate: true },
          )
        } else if (to === 'BY_PERCENTAGE') {
          const raw = 100 / count
          const values = Array.from({ length: count }, () => roundTo(raw, 2))
          const sum = values.reduce((a, b) => a + b, 0)
          const diff = roundTo(100 - sum, 2)
          if (diff !== 0)
            values[values.length - 1] = roundTo(
              values[values.length - 1] + diff,
              2,
            )
          form.setValue(
            'paidFor',
            group.participants.map((p, i) => ({
              participant: p.id,
              shares: values[i],
            })),
            { shouldDirty: true, shouldTouch: true, shouldValidate: true },
          )
        } else {
          form.setValue(
            'paidFor',
            group.participants.map((p) => ({
              participant: p.id,
              shares: 1,
            })),
            { shouldDirty: true, shouldTouch: true, shouldValidate: true },
          )
        }
      }
      form.setValue('splitMode', to, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
      resetItemParticipants(to)
      return
    }

    const currentPaidFor = form.getValues('paidFor')
    const targetAmount = Number(form.getValues('amount')) || 0
    const shareCurrency = conversionRequired ? originalCurrency : groupCurrency
    const converted = convertParticipantShares({
      rows: currentPaidFor,
      fromMode: from,
      toMode: to,
      targetAmount,
      currency: shareCurrency,
    })
    form.setValue('splitMode', to, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidFor', converted, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    if (from === 'BY_AMOUNT' && to !== 'BY_AMOUNT') {
      const stripped = converted.map(({ participant, shares }) => ({
        participant,
        shares,
      }))
      form.setValue('paidFor', stripped, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    }
    resetItemParticipants(to)
  }

  const itemizedPaidForResult = (() => {
    if (splitMode !== 'ITEMIZED') return { paidFor: [], hasError: false }
    try {
      const inputCurrency = conversionRequired
        ? originalCurrency
        : groupCurrency
      const itemizedRemainder = form.getValues('itemizedRemainder')
      const toApiRows = (
        rows: ExpenseFormItemValues['paidFor'],
        mode: ExpenseFormItemValues['splitMode'],
      ) =>
        rows.map(({ participant, shares }) => ({
          participant,
          shares:
            mode === 'BY_AMOUNT'
              ? amountAsMinorUnits(Number(shares) || 0, inputCurrency)
              : mode === 'BY_PERCENTAGE'
                ? Math.round((Number(shares) || 0) * 100)
                : mode === 'BY_SHARES'
                  ? safeSharesToFixedUnits(shares)
                  : Math.round(Number(shares) || 0),
        }))
      return {
        paidFor: computePaidForFromItems(
          items.map((item) => {
            const unitPrice = amountAsMinorUnits(
              Number(item.unitPrice) || 0,
              inputCurrency,
            )
            const quantity = Math.max(1, Math.round(Number(item.quantity) || 1))
            return {
              id: item.id,
              title: item.title,
              unitPrice,
              quantity,
              amount: unitPrice * quantity,
              splitMode: item.splitMode,
              paidFor: toApiRows(item.paidFor, item.splitMode),
            }
          }),
          group.participants.map((participant) => participant.id),
          amountAsMinorUnits(Number(amount) || 0, inputCurrency),
          itemizedRemainder
            ? {
                splitMode: itemizedRemainder.splitMode,
                paidFor: toApiRows(
                  itemizedRemainder.paidFor,
                  itemizedRemainder.splitMode,
                ),
              }
            : undefined,
        ).paidFor,
        hasError: false,
      }
    } catch (error) {
      console.error('Unable to calculate itemized paid-for shares', error)
      return { paidFor: [], hasError: true }
    }
  })()
  const itemizedPaidFor = itemizedPaidForResult.paidFor

  const handlePaidForSplitModeChange = (nextMode: SplitMode) => {
    const currentMode = form.getValues('splitMode')
    if (currentMode === nextMode) return

    const leavingItemized = currentMode === 'ITEMIZED'
    const anyItemHasParticipants = items.some((it) => it.paidFor.length > 0)

    if (leavingItemized && anyItemHasParticipants) {
      setPendingModeChange({ from: currentMode, to: nextMode })
      return
    }

    applyPaidForSplitModeChange(currentMode, nextMode)
  }

  // Select all adds missing participants without overwriting edited values;
  // Select none clears every row.
  const handleSelectPaidForParticipants = () => {
    const currentPaidFor = form.getValues().paidFor
    const options = {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    }
    if (currentPaidFor.length === group.participants.length) {
      form.setValue('paidFor', [], options)
      return
    }
    const equalRows = buildEqualParticipantRows({
      participantIds: group.participants.map((p) => p.id),
      splitMode: splitMode as ItemSplitMode,
      targetAmount: Number(amount) || 0,
      currency: conversionRequired ? originalCurrency : groupCurrency,
    })
    const existing = new Set(currentPaidFor.map((p) => p.participant))
    form.setValue(
      'paidFor',
      [
        ...currentPaidFor,
        ...equalRows.filter((row) => !existing.has(row.participant)),
      ],
      options,
    )
  }

  // Reset rebuilds the current distribution equally for the mode; unlike
  // Select all it overwrites every value, so edited participants become
  // automatic again.
  const handleResetPaidForDistribution = () => {
    form.setValue(
      'paidFor',
      buildEqualParticipantRows({
        participantIds: group.participants.map((p) => p.id),
        splitMode: splitMode as ItemSplitMode,
        targetAmount: Number(amount) || 0,
        currency: conversionRequired ? originalCurrency : groupCurrency,
      }),
      { shouldDirty: true, shouldTouch: true, shouldValidate: true },
    )
    props.setManuallyEditedParticipants(new Set())
  }

  const renderPaidForContent = (mode: ItemSplitMode) => (
    <>
      <div className="mb-2 flex justify-end gap-1">
        <Button
          variant="link"
          type="button"
          className="-my-2 -mr-2"
          disabled={readOnly}
          onClick={handleResetPaidForDistribution}
        >
          {t('resetDistribution')}
        </Button>
        <Button
          variant="link"
          type="button"
          className="-my-2 -mr-2"
          disabled={readOnly}
          onClick={handleSelectPaidForParticipants}
        >
          {paidFor.length === group.participants.length
            ? t('selectNone')
            : t('selectAll')}
        </Button>
      </div>
      <RowErrorSummary
        errors={
          showRowErrors
            ? getRowShareErrors({
                rows: paidFor,
                splitMode: mode,
                amount: Number(amount) || 0,
              })
            : []
        }
        participantName={(id) =>
          group.participants.find((p) => p.id === id)?.name ?? id
        }
      />
      <FormField
        control={form.control}
        name="paidFor"
        render={() => (
          <FormItem className="w-full min-w-0 space-y-0">
            {group.participants.map((participant) => (
              <PaidForRow
                key={participant.id}
                form={form}
                participant={participant}
                groupCurrency={groupCurrency}
                originalCurrency={originalCurrency}
                conversionRequired={conversionRequired}
                exchangeRate={exchangeRate}
                readOnly={readOnly}
                inputRefs={props.inputRefs}
                setManuallyEditedParticipants={
                  props.setManuallyEditedParticipants
                }
              />
            ))}
            <FormMessage />
          </FormItem>
        )}
      />
      <ParticipantDistributionFooter
        splitMode={mode}
        targetAmount={
          mode === 'BY_PERCENTAGE'
            ? 100
            : amountAsMinorUnits(
                Number(amount) || 0,
                conversionRequired ? originalCurrency : groupCurrency,
              )
        }
        shares={
          mode === 'BY_AMOUNT'
            ? paidFor.map((p) =>
                amountAsMinorUnits(
                  p.shares || 0,
                  conversionRequired ? originalCurrency : groupCurrency,
                ),
              )
            : paidFor.map((p) => p.shares || 0)
        }
        currency={conversionRequired ? originalCurrency : groupCurrency}
        paidByCount={paidFor.length}
        dataTestId="paid-for-distribution-footer"
      />
    </>
  )

  return (
    <Card className="mobile-surface mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between gap-2">
          <span>{t(`${sExpense}.paidFor.title`)}</span>
        </CardTitle>
        {/* Default-split actions live in their own row, visually
            separated from the title by a top border. In non-ITEMIZED
            modes there's a "Select all/None" toggle above, so the
            border separates the two action rows; in ITEMIZED mode the
            actions slot in flush with the title (no border needed).
            Hidden entirely in read-only mode and when nothing is
            actionable — see `DefaultSplitActions` for visibility. */}
        <div
          className={cn(
            'mt-2 flex items-center justify-end gap-1 pt-3',
            splitMode !== 'ITEMIZED' && 'border-t',
          )}
        >
          <DefaultSplitActions
            form={form}
            group={group}
            groupCurrency={groupCurrency}
            savedDefault={savedDefault}
            readOnly={readOnly}
          />
        </div>
        <CardDescription>
          {t(`${sExpense}.paidFor.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <PaidForSplitOptionCards
            value={splitMode}
            onChange={handlePaidForSplitModeChange}
            renderContent={renderPaidForContent}
            readOnly={readOnly}
          />
        </div>

        {splitMode === 'ITEMIZED' && (
          <div className="space-y-0">
            {itemizedPaidForResult.hasError && (
              <p className="mb-3 text-sm text-red-600" role="alert">
                {t('items.calculationError')}
              </p>
            )}
            {group.participants.map((participant) => {
              const row = itemizedPaidFor.find(
                (paidFor) => paidFor.participant === participant.id,
              )
              return (
                <ParticipantShareRow
                  key={participant.id}
                  participant={participant}
                  checked={!!row}
                  onCheckedChange={() => {}}
                  disabled
                  pendingLabel={
                    participant.pending ? (
                      <ParticipantPendingLabel
                        text={t('participant.pending')}
                      />
                    ) : undefined
                  }
                  preview={
                    row ? (
                      <ParticipantRowAmountPreview
                        amount={row.shares}
                        currency={
                          conversionRequired ? originalCurrency : groupCurrency
                        }
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </div>
        )}
      </CardContent>

      <LeaveItemizedDialog
        open={!!pendingModeChange}
        targetModeLabel={
          pendingModeChange ? t(paidForOptionKeys[pendingModeChange.to]) : ''
        }
        onCancel={() => setPendingModeChange(null)}
        onConfirm={() => {
          if (!pendingModeChange) return
          const clearedItems = items.map((it) => ({ ...it, paidFor: [] }))
          form.setValue('items', clearedItems, { shouldDirty: true })
          applyPaidForSplitModeChange(
            pendingModeChange.from,
            pendingModeChange.to,
          )
          setPendingModeChange(null)
        }}
      />
    </Card>
  )
}

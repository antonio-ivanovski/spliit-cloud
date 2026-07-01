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
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { getCurrency } from '@/lib/currency'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { computePaidForFromItems, type SplitMode } from '@spliit/domain'
import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { LeaveItemizedDialog } from './leave-itemized-dialog'
import { PaidForRow } from './paid-for-row'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import { convertParticipantShares, roundTo } from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

const paidForOptionKeys = {
  EVENLY: 'paidForOptionEvenly',
  BY_SHARES: 'paidForOptionByShares',
  BY_PERCENTAGE: 'paidForOptionByPercentage',
  BY_AMOUNT: 'paidForOptionByAmount',
  ITEMIZED: 'paidForOptionItemized',
} as const satisfies Record<SplitMode, string>

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>

export function PaidForCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
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

  const applyPaidForSplitModeChange = (from: SplitMode, to: SplitMode) => {
    const resetItemParticipants = (mode: SplitMode) => {
      if (mode === 'ITEMIZED') return
      const itemMode = mode as ItemSplitMode
      const buildRows = (targetAmount: number) => {
        const count = group.participants.length
        if (itemMode === 'BY_AMOUNT') {
          const raw = count > 0 ? targetAmount / count : 0
          const precision = originalCurrency.decimal_digits
          const values = new Array(count)
            .fill(null)
            .map(() => roundTo(raw, precision))
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
          const values = new Array(count).fill(null).map(() => roundTo(raw, 2))
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
          const values = new Array(count)
            .fill(null)
            .map(() => roundTo(raw, precision))
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
          const values = new Array(count).fill(null).map(() => roundTo(raw, 2))
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

  const itemizedPaidFor = (() => {
    if (splitMode !== 'ITEMIZED') return []
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
                : Math.round(Number(shares) || 0),
        }))
      return computePaidForFromItems(
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
      ).paidFor
    } catch {
      return []
    }
  })()

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

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidFor.title`)}</span>
          {splitMode !== 'ITEMIZED' && (
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
                      shares:
                        paidFor.find((pfor) => pfor.participant === p.id)
                          ?.shares ?? 1,
                    }))
                form.setValue('paidFor', newPaidFor, {
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
          )}
        </CardTitle>
        <CardDescription>
          {t(`${sExpense}.paidFor.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <PaidForSplitOptionCards
            value={splitMode}
            onChange={handlePaidForSplitModeChange}
            readOnly={readOnly}
          />
          <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
            {splitMode === 'ITEMIZED'
              ? t('paidForItemizedActiveHint')
              : t('paidForItemizedEntryHint')}
          </p>
        </div>

        {splitMode !== 'ITEMIZED' && (
          <FormField
            control={form.control}
            name="paidFor"
            render={() => (
              <FormItem className="sm:order-4 row-span-2 space-y-0">
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
                    setManuallyEditedParticipants={
                      props.setManuallyEditedParticipants
                    }
                  />
                ))}
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {splitMode === 'ITEMIZED' && (
          <div className="space-y-0">
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
                  showCheckbox={false}
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

        {splitMode !== 'ITEMIZED' && (
          <ParticipantDistributionFooter
            splitMode={splitMode}
            targetAmount={
              splitMode === 'BY_PERCENTAGE'
                ? 100
                : amountAsMinorUnits(
                    Number(amount) || 0,
                    conversionRequired ? originalCurrency : groupCurrency,
                  )
            }
            shares={
              splitMode === 'BY_AMOUNT'
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
        )}

        {splitMode !== 'ITEMIZED' && (
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
        )}
      </CardContent>

      <LeaveItemizedDialog
        open={!!pendingModeChange}
        targetModeLabel={
          pendingModeChange
            ? t(paidForOptionKeys[pendingModeChange.to])
            : ''
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

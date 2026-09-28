import type { Dispatch, SetStateAction } from 'react'
import { useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import { getCurrency } from '@/lib/currency'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { computePaidForFromItems, type SplitMode } from '@spliit/domain'

import { safeSharesToFixedUnits } from './currency-utils'
import { expenseTabPriority } from './focus-navigation'
import { getRowShareErrors } from './get-row-share-errors'
import { LeaveItemizedDialog } from './leave-itemized-dialog'
import { PaidForRow } from './paid-for-row'
import { ParticipantPendingLabel } from './participant-pending-label'
import type { ShareInputRefs } from './share-row-input'
import { SplitDistributionEditor } from './split-distribution-editor'
import {
  buildEqualParticipantRows,
  convertParticipantShares,
  roundTo,
} from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'
import {
  SavePresetButton,
  SplitPresetPicker,
  presetToFormSplit,
  sameParticipantDistribution,
  type LoadedPresetSource,
  type SplitPreset,
} from './split-presets'
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

type ItemizedPaidForRow = { participant: string; shares: number }

/**
 * Derived itemized totals in expense-currency minor units, converted from the
 * form's display values the same way ExpenseItemsCard does so the PaidFor
 * preview matches the persisted split. Calculation failures surface as
 * `hasError` instead of throwing into the render path. The returned
 * `inputCurrency` is the currency the minor-unit shares are denominated in.
 */
function getItemizedPaidForResult({
  splitMode,
  items,
  participantIds,
  amount,
  remainder,
  conversionRequired,
  originalCurrency,
  groupCurrency,
}: {
  splitMode: SplitMode
  items: ExpenseFormItemValues[]
  participantIds: string[]
  amount: number
  remainder: ExpenseFormInputValues['itemizedRemainder']
  conversionRequired: boolean
  originalCurrency: Currency
  groupCurrency: Currency
}): {
  paidFor: ItemizedPaidForRow[]
  hasError: boolean
  inputCurrency: Currency
} {
  const inputCurrency = conversionRequired ? originalCurrency : groupCurrency
  if (splitMode !== 'ITEMIZED')
    return { paidFor: [], hasError: false, inputCurrency }
  try {
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
        participantIds,
        amountAsMinorUnits(Number(amount) || 0, inputCurrency),
        remainder
          ? {
              splitMode: remainder.splitMode,
              allocationMode: remainder.allocationMode ?? 'CUSTOM',
              paidFor: toApiRows(remainder.paidFor, remainder.splitMode),
            }
          : undefined,
      ).paidFor,
      hasError: false,
      inputCurrency,
    }
  } catch (error) {
    console.error('Unable to calculate itemized paid-for shares', error)
    return { paidFor: [], hasError: true, inputCurrency }
  }
}

/**
 * Compact derived totals for the selected Itemized split option: plain-text
 * participant names and amounts for nonzero shares, in group order. No
 * checkboxes — shares come from the items, edited in the Items card.
 */
function ItemizedPaidForTotals({
  hasError,
  participants,
  paidFor,
  currency,
}: {
  hasError: boolean
  participants: Group['participants']
  paidFor: ItemizedPaidForRow[]
  currency: Currency
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  if (hasError) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {t('items.calculationError')}
      </p>
    )
  }

  const rows = participants.flatMap((participant) => {
    const row = paidFor.find(
      (paidFor) => paidFor.participant === participant.id,
    )
    return row && row.shares !== 0 ? [{ participant, shares: row.shares }] : []
  })

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('paidForItemizedEmptyHint')}
      </p>
    )
  }

  return (
    <div className="divide-y">
      {rows.map(({ participant, shares }) => (
        <div
          key={participant.id}
          className="flex min-w-0 items-center justify-between gap-2 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {participant.name}
            {participant.pending ? (
              <ParticipantPendingLabel text={t('participant.pending')} />
            ) : null}
          </span>
          <ParticipantRowAmountPreview amount={shares} currency={currency} />
        </div>
      ))}
    </div>
  )
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive split-method card, shared form state
export function PaidForCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
  presets: SplitPreset[]
  presetsLoading?: boolean
  canManage?: boolean
  canManageShared?: boolean
  canManagePersonal?: boolean
  initialLoadedPreset?: SplitPreset | null
  initialLoadedSource?: LoadedPresetSource | null
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
    presets,
    presetsLoading,
    canManage,
    canManageShared,
    canManagePersonal,
    initialLoadedPreset,
    initialLoadedSource,
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
  const itemizedRemainder = useWatch({
    control: form.control,
    name: 'itemizedRemainder',
  })

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
  const [pendingPreset, setPendingPreset] = useState<SplitPreset | null>(null)
  const [loadedPresetState, setLoadedPreset] = useState<
    SplitPreset | null | undefined
  >(undefined)
  const [loadedSourceState, setLoadedSource] = useState<
    LoadedPresetSource | null | undefined
  >(undefined)
  const saveChangesRef = useRef<() => void>(() => {})
  const saveAsRef = useRef<() => void>(() => {})
  const loadedPreset =
    loadedPresetState === undefined
      ? (initialLoadedPreset ?? null)
      : loadedPresetState
  const loadedSource =
    loadedSourceState === undefined
      ? loadedPreset
        ? (initialLoadedSource ?? 'MANUAL')
        : null
      : loadedSourceState

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
      const remainderAmount = (Number(amount) || 0) - itemTotal
      form.setValue(
        'itemizedRemainder',
        {
          allocationMode: 'CUSTOM' as const,
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

  const itemizedPaidForResult = getItemizedPaidForResult({
    splitMode,
    items,
    participantIds: group.participants.map((participant) => participant.id),
    amount,
    remainder: itemizedRemainder,
    conversionRequired,
    originalCurrency,
    groupCurrency,
  })

  const renderItemizedContent = (
    <ItemizedPaidForTotals
      hasError={itemizedPaidForResult.hasError}
      participants={group.participants}
      paidFor={itemizedPaidForResult.paidFor}
      currency={itemizedPaidForResult.inputCurrency}
    />
  )

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

  const applyPreset = (preset: SplitPreset) => {
    const next = presetToFormSplit(preset)
    const currentMode = form.getValues('splitMode')
    const hasItemParticipants = items.some((item) => item.paidFor.length > 0)
    if (currentMode === 'ITEMIZED' && hasItemParticipants) {
      setPendingPreset(preset)
      return
    }
    form.setValue('splitMode', next.splitMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidFor', next.paidFor, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    setLoadedPreset(preset)
    setLoadedSource('MANUAL')
  }

  const confirmPreset = () => {
    if (!pendingPreset) return
    const next = presetToFormSplit(pendingPreset)
    form.setValue(
      'items',
      items.map((item) => ({ ...item, paidFor: [] })),
      { shouldDirty: true, shouldTouch: true, shouldValidate: true },
    )
    applyPaidForSplitModeChange('ITEMIZED', next.splitMode)
    form.setValue('paidFor', next.paidFor, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    setLoadedPreset(pendingPreset)
    setLoadedSource('MANUAL')
    setPendingPreset(null)
  }

  const loadedSplit = loadedPreset ? presetToFormSplit(loadedPreset) : null
  const paidForModified =
    !!loadedSplit &&
    (splitMode !== loadedSplit.splitMode ||
      !sameParticipantDistribution(paidFor, loadedSplit.paidFor))
  const modified = paidForModified
  const canCreatePreset =
    !!canManageShared || !!canManagePersonal || !!canManage

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

  const renderPaidForContent = (mode: ItemSplitMode) => {
    const inputCurrency = conversionRequired ? originalCurrency : groupCurrency
    const targetAmount =
      mode === 'BY_PERCENTAGE'
        ? 100
        : amountAsMinorUnits(Number(amount) || 0, inputCurrency)
    const shares =
      mode === 'BY_AMOUNT'
        ? paidFor.map((row) =>
            amountAsMinorUnits(row.shares || 0, inputCurrency),
          )
        : paidFor.map((row) => row.shares || 0)

    return (
      <FormField
        control={form.control}
        name="paidFor"
        render={() => (
          <FormItem
            data-expense-error-anchor="paidFor"
            className="w-full min-w-0 space-y-0"
          >
            <SplitDistributionEditor
              participants={group.participants}
              selectedCount={paidFor.length}
              mode={mode}
              targetAmount={targetAmount}
              shares={shares}
              currency={inputCurrency}
              readOnly={readOnly}
              errors={
                showRowErrors
                  ? getRowShareErrors({
                      rows: paidFor,
                      splitMode: mode,
                      amount: Number(amount) || 0,
                    })
                  : []
              }
              onReset={handleResetPaidForDistribution}
              onToggleAll={handleSelectPaidForParticipants}
              renderRow={(participant) => (
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
              )}
              afterRows={<FormMessage />}
              dataTestId="paid-for-distribution-footer"
            />
          </FormItem>
        )}
      />
    )
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between gap-2">
          <span>{t(`${sExpense}.paidFor.title`)}</span>
        </CardTitle>
        {/* Presets are input shortcuts; they are never retained on the expense. */}
        <div className="mt-2 w-full">
          {!readOnly && (
            <>
              <SplitPresetPicker
                presets={presets}
                loading={presetsLoading}
                group={group}
                amount={Number(amount) || 0}
                currency={conversionRequired ? originalCurrency : groupCurrency}
                loadedPreset={loadedPreset}
                loadedSource={loadedSource}
                modified={modified}
                onSaveAsNew={
                  canCreatePreset &&
                  splitMode !== 'BY_AMOUNT' &&
                  splitMode !== 'ITEMIZED'
                    ? () => saveAsRef.current()
                    : undefined
                }
                canSaveChanges={
                  !!loadedPreset &&
                  splitMode !== 'BY_AMOUNT' &&
                  splitMode !== 'ITEMIZED' &&
                  'scope' in loadedPreset &&
                  ((loadedPreset.scope === 'SHARED' && canManageShared) ||
                    (loadedPreset.scope === 'PERSONAL' && canManagePersonal))
                }
                onSaveChanges={() => {
                  saveChangesRef.current()
                }}
                onSelect={applyPreset}
              />
              {canCreatePreset &&
                splitMode !== 'BY_AMOUNT' &&
                splitMode !== 'ITEMIZED' && (
                  <SavePresetButton
                    group={group}
                    groupCurrency={groupCurrency}
                    target="PAID_FOR"
                    splitMode={splitMode}
                    paidFor={paidFor}
                    modified={modified}
                    existingPreset={loadedPreset}
                    onSaved={() => {
                      setLoadedPreset(null)
                      setLoadedSource(null)
                    }}
                    onSaveChangesReady={(save) => {
                      saveChangesRef.current = save
                    }}
                    onSaveAsReady={(saveAs) => {
                      saveAsRef.current = saveAs
                    }}
                    onUpdated={(preset) => setLoadedPreset(preset)}
                    hideTrigger
                    canManage={canManage}
                    canManageShared={canManageShared}
                    canManagePersonal={canManagePersonal}
                  />
                )}
            </>
          )}
        </div>
        <CardDescription>
          {t(`${sExpense}.paidFor.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PaidForSplitOptionCards
          focusPriority={expenseTabPriority.paidFor}
          value={splitMode}
          onChange={handlePaidForSplitModeChange}
          renderContent={renderPaidForContent}
          renderItemizedContent={renderItemizedContent}
          readOnly={readOnly}
        />
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
      <LeaveItemizedDialog
        open={!!pendingPreset}
        targetModeLabel={
          pendingPreset
            ? t(paidForOptionKeys[presetToFormSplit(pendingPreset).splitMode])
            : ''
        }
        onCancel={() => setPendingPreset(null)}
        onConfirm={confirmPreset}
      />
    </Card>
  )
}

import type { SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import type { ShareInputRefs } from './share-row-input'
import {
  SinglePayerDistributionEditor,
  SplitDistributionEditor,
} from './split-distribution-editor'
import {
  buildEqualParticipantRows,
  convertParticipantShares,
} from './split-mode-conversions'
import {
  PaidBySplitOptionCards,
  type PaidBySplitOption,
} from './split-option-cards'
import {
  SavePresetButton,
  SplitPresetPicker,
  presetToFormPaidBySplit,
  sameParticipantDistribution,
  type LoadedPresetSource,
  type SplitPreset,
} from './split-presets'
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
  presets: SplitPreset[]
  presetsLoading?: boolean
  canManageShared?: boolean
  canManagePersonal?: boolean
  initialLoadedPreset?: SplitPreset | null
  initialLoadedSource?: LoadedPresetSource | null
  /** Participant-keyed share input registry, owned by the expense form. */
  inputRefs: ShareInputRefs
}) {
  const {
    form,
    group,
    groupCurrency,
    payerCurrency,
    readOnly,
    sExpense,
    presets,
    presetsLoading,
    canManageShared,
    canManagePersonal,
    initialLoadedPreset,
    initialLoadedSource,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const isMultiPayer = useWatch({ control: form.control, name: 'isMultiPayer' })
  const paidBySplitMode = useWatch({
    control: form.control,
    name: 'paidBySplitMode',
  })
  const paidByList = useWatch({ control: form.control, name: 'paidByList' })
  const amount = useWatch({ control: form.control, name: 'amount' })
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

  const applyPaidByPreset = (preset: SplitPreset) => {
    const next = presetToFormPaidBySplit(preset)
    if (!next) return
    form.setValue('isMultiPayer', next.isMultiPayer, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidBySplitMode', next.paidBySplitMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidByList', next.paidByList, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    setLoadedPreset(preset)
    setLoadedSource('MANUAL')
  }

  const loadedPaidBy = loadedPreset
    ? presetToFormPaidBySplit(loadedPreset)
    : null
  const comparableLoadedPaidBy =
    loadedPaidBy && !loadedPaidBy.isMultiPayer && loadedPaidBy.paidByList[0]
      ? {
          ...loadedPaidBy,
          paidByList: singlePayerPaidByList(
            loadedPaidBy.paidByList[0].participant,
          ),
        }
      : loadedPaidBy
  const paidByModified =
    !!comparableLoadedPaidBy &&
    (isMultiPayer !== comparableLoadedPaidBy.isMultiPayer ||
      paidBySplitMode !== comparableLoadedPaidBy.paidBySplitMode ||
      !sameParticipantDistribution(
        paidByList,
        comparableLoadedPaidBy.paidByList,
      ))

  const canSaveCurrentPaidBy = isMultiPayer
    ? paidBySplitMode !== 'BY_AMOUNT' && paidBySplitMode !== 'ITEMIZED'
    : paidByList.length === 1 && !!paidByList[0]?.participant
  const canCreatePreset = !!canManageShared || !!canManagePersonal
  const savePaidBySplitMode = isMultiPayer
    ? paidBySplitMode === 'BY_AMOUNT' || paidBySplitMode === 'ITEMIZED'
      ? undefined
      : paidBySplitMode
    : 'EVENLY'
  const savePaidBy = isMultiPayer
    ? paidByList
    : paidByList.map(({ participant }) => ({ participant, shares: 1 }))

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
                <SinglePayerDistributionEditor
                  participants={group.participants}
                  value={selectedPayer}
                  onValueChange={(value) => {
                    form.setValue('paidByList', singlePayerPaidByList(value), {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })
                  }}
                  disabled={readOnly}
                  className="w-full"
                  placeholder={t('Expense.paidByField.placeholder')}
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
      <FormField
        control={form.control}
        name="paidByList"
        render={() => (
          <FormItem className="w-full min-w-0 space-y-0">
            <SplitDistributionEditor
              participants={group.participants}
              selectedCount={paidByList.length}
              mode={option.splitMode}
              targetAmount={targetForFooter}
              shares={sharesForFooter}
              currency={payerCurrency}
              readOnly={readOnly}
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
              onReset={handleResetPaidByDistribution}
              onToggleAll={handleSelectPaidByParticipants}
              renderRow={(participant) => (
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
              )}
              afterRows={<FormMessage />}
              dataTestId="paid-by-distribution-footer"
            />
          </FormItem>
        )}
      />
    )
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidByField.label`)}</span>
        </CardTitle>
        {!readOnly && (
          <div className="mt-2 w-full">
            <SplitPresetPicker
              presets={presets}
              group={group}
              target="paidBy"
              amount={Number(amount) || 0}
              currency={payerCurrency}
              loading={presetsLoading}
              loadedPreset={loadedPreset}
              loadedSource={loadedSource}
              modified={paidByModified}
              onSaveAsNew={
                canSaveCurrentPaidBy && canCreatePreset
                  ? () => saveAsRef.current()
                  : undefined
              }
              canSaveChanges={
                !!loadedPreset &&
                canSaveCurrentPaidBy &&
                ((loadedPreset.scope === 'SHARED' && canManageShared) ||
                  (loadedPreset.scope === 'PERSONAL' && canManagePersonal))
              }
              onSaveChanges={() => saveChangesRef.current()}
              onSelect={applyPaidByPreset}
            />
            {canSaveCurrentPaidBy && canCreatePreset && (
              <SavePresetButton
                group={group}
                groupCurrency={groupCurrency}
                target="PAID_BY"
                paidBy={savePaidBy}
                splitMode={savePaidBySplitMode}
                existingPreset={loadedPreset}
                modified={paidByModified}
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
                canManageShared={canManageShared}
                canManagePersonal={canManagePersonal}
              />
            )}
          </div>
        )}
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

import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'

import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { calculateShare, percentageToBasisPoints } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  SplitMode,
} from '@spliit/domain'

import {
  enforceCurrencyPattern,
  enforceIntegerPattern,
  enforcePercentagePattern,
} from './currency-utils'
import type { SavedSplit } from './default-split/split-equal'
import { splitEqual } from './default-split/split-equal'
import { savedDefaultToFormValues } from './default-values'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import {
  buildEqualParticipantRows,
  convertParticipantShares,
} from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'

type GroupShape = NonNullable<AppRouterOutput['groups']['get']['group']>

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>

export function ItemParticipantsModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: UseFormReturn<ExpenseFormInputValues>
  itemIndex: number
  group: GroupShape
  groupCurrency: Currency
  item: ExpenseFormItemValues
  onSaveItem?: (item: ExpenseFormItemValues) => void
  readOnly?: boolean
  /**
   * Optional override for the modal header title (used by the expense-level
   * "default items split" editor).
   */
  titleOverride?: string
  /** Hide the "qty × unitPrice" description under the title. */
  hideAmountDescription?: boolean
  /**
   * Hide the BY_AMOUNT split card. Used by the "default items split" editor,
   * where amounts are relative to each item's total.
   */
  hideAmountMode?: boolean
  /**
   * Persisted per-user-per-group default split. When present, the modal renders
   * a "Load default" link above the radio cards that resets the local `draft`
   * to this default (visible regardless of whether the draft already matches).
   */
  savedDefault?: SavedSplit | null
}) {
  const {
    open,
    onOpenChange,
    form,
    itemIndex,
    group,
    groupCurrency,
    item,
    onSaveItem,
    readOnly,
    titleOverride,
    hideAmountDescription,
    hideAmountMode,
    savedDefault,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const [draft, setDraft] = useState<ExpenseFormItemValues>(() => {
    const shouldPopulate =
      item.paidFor.length === 0 && item.splitMode === 'EVENLY'
    return {
      ...item,
      paidFor: shouldPopulate
        ? group.participants.map((p) => ({
            participant: p.id,
            shares: 1,
          }))
        : item.paidFor,
    }
  })

  const itemTotal = Number(draft.unitPrice) * Number(draft.quantity)

  const handleSplitModeChange = (nextMode: SplitMode) => {
    if (nextMode === 'ITEMIZED' || draft.splitMode === nextMode) return
    if (hideAmountMode && nextMode === 'BY_AMOUNT') return
    const converted = convertParticipantShares({
      rows: draft.paidFor,
      fromMode: draft.splitMode,
      toMode: nextMode,
      targetAmount: itemTotal,
      currency: groupCurrency,
    })
    setDraft((prev) => ({
      ...prev,
      splitMode: nextMode as ItemSplitMode,
      paidFor: converted,
    }))
  }

  const handleLoadDefault = () => {
    if (!savedDefault) return
    const restored = savedDefaultToFormValues(
      savedDefault,
      group,
      groupCurrency,
    )
    if (!restored) return
    setDraft((prev) => ({
      ...prev,
      splitMode: restored.splitMode as ItemSplitMode,
      paidFor: restored.paidFor,
    }))
  }

  const isCurrentEqualSaved = splitEqual(
    draft.splitMode,
    draft.paidFor,
    savedDefault ?? null,
    groupCurrency,
  )

  const handleSave = () => {
    if (onSaveItem) {
      onSaveItem(draft)
    } else {
      form.setValue(`items.${itemIndex}`, draft, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    }
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const allSelected = draft.paidFor.length === group.participants.length
  const selectLabel = allSelected ? t('selectNone') : t('selectAll')

  const handleSelectAll = () => {
    setDraft((prev) => ({
      ...prev,
      paidFor: allSelected
        ? []
        : buildEqualParticipantRows({
            participantIds: group.participants.map((p) => p.id),
            splitMode: prev.splitMode,
            targetAmount: itemTotal,
            currency: groupCurrency,
          }),
    }))
  }

  const handleCheckedChange = (participantId: string, checked: boolean) => {
    setDraft((prev) => ({
      ...prev,
      paidFor: checked
        ? [...prev.paidFor, { participant: participantId, shares: 1 }]
        : prev.paidFor.filter((p) => p.participant !== participantId),
    }))
  }

  const handleShareChange = (participantId: string, rawValue: string) => {
    const mode = draft.splitMode
    const sanitizer = match(mode)
      .with('BY_AMOUNT', () => enforceCurrencyPattern)
      .with('BY_PERCENTAGE', () => enforcePercentagePattern)
      .with('BY_SHARES', () => enforceIntegerPattern)
      .otherwise(() => enforceCurrencyPattern)
    const sanitized = sanitizer(rawValue)
    // BY_AMOUNT keeps the raw sanitized string so in-progress decimals
    // like "10." or "0," survive the controlled-input round-trip.
    // Other modes coerce to number as before.
    const shares =
      mode === 'BY_AMOUNT'
        ? (sanitized as unknown as number)
        : Number(sanitized)
    const keepInList =
      mode === 'BY_AMOUNT'
        ? sanitized !== '' && sanitized !== '0'
        : Number(sanitized) > 0
    setDraft((prev) => ({
      ...prev,
      paidFor: keepInList
        ? [
            ...prev.paidFor.filter((p) => p.participant !== participantId),
            { participant: participantId, shares },
          ]
        : prev.paidFor.filter((p) => p.participant !== participantId),
    }))
  }

  const renderItemParticipants = (mode: ItemSplitMode) => {
    const distributionShares = draft.paidFor.map((p) => p.shares || 0)

    return (
      <>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t('items.modalTitle')}</span>
          <Button
            variant="link"
            type="button"
            className="-my-2 -mr-2"
            disabled={readOnly}
            onClick={handleSelectAll}
          >
            {selectLabel}
          </Button>
        </div>

        {group.participants.map((participant) => {
          const checked = draft.paidFor.some(
            (p) => p.participant === participant.id,
          )
          const row = draft.paidFor.find(
            (p) => p.participant === participant.id,
          )

          const previewAmount =
            checked && mode !== 'BY_AMOUNT'
              ? calculateShare(participant.id, {
                  amount: amountAsMinorUnits(itemTotal, groupCurrency),
                  paidFor: draft.paidFor.map((p) => ({
                    participant: {
                      id: p.participant,
                      name: '',
                      groupId: '',
                    },
                    shares:
                      mode === 'BY_PERCENTAGE'
                        ? percentageToBasisPoints(p.shares)
                        : p.shares,
                    expenseId: '',
                    participantId: '',
                  })),
                  splitMode: mode,
                  isReimbursement: false,
                })
              : null

          return (
            <ParticipantShareRow
              key={participant.id}
              dataId={`${participant.id}/${mode}/${groupCurrency.code}`}
              participant={participant}
              checked={checked}
              onCheckedChange={(next) =>
                handleCheckedChange(participant.id, next)
              }
              disabled={readOnly}
              pendingLabel={
                participant.pending ? (
                  <ParticipantPendingLabel text={t('participant.pending')} />
                ) : undefined
              }
              preview={
                previewAmount != null ? (
                  <ParticipantRowAmountPreview
                    amount={previewAmount}
                    currency={groupCurrency}
                  />
                ) : undefined
              }
              shareInput={
                mode !== 'EVENLY' ? (
                  <div className="flex items-center justify-end gap-0.5">
                    {mode === 'BY_SHARES' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={readOnly || !checked}
                        aria-label={t('decreaseShares', {
                          name: participant.name,
                        })}
                        onClick={() =>
                          handleShareChange(
                            participant.id,
                            String(Math.max(0, Number(row?.shares ?? 0) - 1)),
                          )
                        }
                      >
                        <Minus className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                    <span className="text-sm">
                      {mode === 'BY_AMOUNT' && groupCurrency.symbol}
                    </span>
                    <div className="relative">
                      <Input
                        className={cn(
                          '-my-2 w-[72px] shrink-0 px-2 text-right text-base tabular-nums',
                          mode === 'BY_PERCENTAGE' && 'pr-5',
                        )}
                        type="text"
                        disabled={readOnly}
                        value={String(row?.shares ?? '')}
                        aria-label={t('items.participantValueLabel', {
                          name: participant.name,
                        })}
                        onChange={(e) =>
                          handleShareChange(participant.id, e.target.value)
                        }
                        inputMode={match(mode)
                          .with('BY_PERCENTAGE', () => 'decimal' as const)
                          .with('BY_SHARES', () => 'numeric' as const)
                          .otherwise(() => 'decimal' as const)}
                        step={match(mode)
                          .with('BY_PERCENTAGE', () => 0.01)
                          .with('BY_SHARES', () => 1)
                          .otherwise(() => 10 ** -groupCurrency.decimal_digits)}
                      />
                      {mode === 'BY_PERCENTAGE' && (
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                          %
                        </span>
                      )}
                    </div>
                    {mode === 'BY_SHARES' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={readOnly}
                        aria-label={t('increaseShares', {
                          name: participant.name,
                        })}
                        onClick={() =>
                          handleShareChange(
                            participant.id,
                            String(Number(row?.shares ?? 0) + 1),
                          )
                        }
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            />
          )
        })}

        <ParticipantDistributionFooter
          splitMode={mode}
          targetAmount={
            mode === 'BY_PERCENTAGE'
              ? 100
              : amountAsMinorUnits(itemTotal, groupCurrency)
          }
          shares={
            mode === 'BY_AMOUNT'
              ? distributionShares.map((s) =>
                  amountAsMinorUnits(s, groupCurrency),
                )
              : distributionShares
          }
          currency={groupCurrency}
          paidByCount={draft.paidFor.length}
          dataTestId="item-participants-distribution-footer"
        />
      </>
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {titleOverride ?? (item.title || '(unnamed item)')}
          </ResponsiveDialogTitle>
          {!hideAmountDescription && (
            <ResponsiveDialogDescription>
              {itemTotal.toFixed(2)}
              {' · '}
              {draft.quantity}
              {' × '}
              {Number(draft.unitPrice).toFixed(2)}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <div>
            {savedDefault &&
              !isCurrentEqualSaved &&
              !readOnly && (
                // Default-split action row, mirrors PaidForCard's header
                // strip: heading label + Load link, separated from the
                // radio cards by a top border.
                <div className="mb-3 flex items-center justify-end gap-3 border-b pb-3 text-xs text-muted-foreground">
                  <span className="tracking-wide uppercase">
                    {t('DefaultSplit.heading')}
                  </span>
                  <Button
                    variant="link"
                    type="button"
                    className="-mx-4 -my-2"
                    onClick={handleLoadDefault}
                  >
                    {t('DefaultSplit.load')}
                  </Button>
                </div>
              )}
            <div className="mb-4">
              <PaidForSplitOptionCards
                value={draft.splitMode}
                onChange={handleSplitModeChange}
                renderContent={renderItemParticipants}
                readOnly={readOnly}
                hiddenModes={hideAmountMode ? ['BY_AMOUNT'] : undefined}
              />
            </div>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          {!readOnly && (
            <>
              <Button variant="outline" type="button" onClick={handleCancel}>
                {t('cancel')}
              </Button>
              <Button type="button" onClick={handleSave}>
                {t('save')}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { calculateShare } from '@/lib/totals'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  SplitMode,
} from '@spliit/domain'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'
import {
  enforceCurrencyPattern,
  enforceIntegerPattern,
  enforcePercentagePattern,
} from './currency-utils'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import { convertParticipantShares } from './split-mode-conversions'
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

  const itemTotal = draft.unitPrice * draft.quantity

  const handleSplitModeChange = (nextMode: SplitMode) => {
    if (nextMode === 'ITEMIZED' || draft.splitMode === nextMode) return
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
        : group.participants.map((p) => ({
            participant: p.id,
            shares:
              prev.paidFor.find((f) => f.participant === p.id)?.shares ?? 1,
          })),
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
    const sanitizer = match(draft.splitMode)
      .with('BY_AMOUNT', () => enforceCurrencyPattern)
      .with('BY_PERCENTAGE', () => enforcePercentagePattern)
      .with('BY_SHARES', () => enforceIntegerPattern)
      .otherwise(() => enforceCurrencyPattern)
    const sanitized = sanitizer(rawValue)
    setDraft((prev) => ({
      ...prev,
      paidFor: prev.paidFor.map((p) =>
        p.participant === participantId
          ? { ...p, shares: Number(sanitized) || 0 }
          : p,
      ),
    }))
  }

  const distributionShares = draft.paidFor.map((p) => p.shares || 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.title || '(unnamed item)'}</DialogTitle>
          <DialogDescription>
            {itemTotal.toFixed(2)}
            {' · '}
            {draft.quantity}
            {' × '}
            {draft.unitPrice.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="mb-4">
            <PaidForSplitOptionCards
              value={draft.splitMode}
              onChange={handleSplitModeChange}
              readOnly={readOnly}
            />
          </div>

          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium">Participants</span>
            <Button
              variant="link"
              type="button"
              className="-my-2 -mx-4"
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
              checked && draft.splitMode !== 'BY_AMOUNT'
                ? calculateShare(participant.id, {
                    amount: amountAsMinorUnits(itemTotal, groupCurrency),
                    paidFor: draft.paidFor.map((p) => ({
                      participant: {
                        id: p.participant,
                        name: '',
                        groupId: '',
                      },
                      shares:
                        draft.splitMode === 'BY_PERCENTAGE'
                          ? p.shares * 100
                          : p.shares,
                      expenseId: '',
                      participantId: '',
                    })),
                    splitMode: draft.splitMode,
                    isReimbursement: false,
                  })
                : null

            return (
              <ParticipantShareRow
                key={participant.id}
                dataId={`${participant.id}/${draft.splitMode}/${groupCurrency.code}`}
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
                  draft.splitMode !== 'EVENLY' && checked ? (
                    <div>
                      <div className="flex gap-1 items-center">
                        <span className="text-sm">
                          {draft.splitMode === 'BY_AMOUNT' &&
                            groupCurrency.symbol}
                        </span>
                        <Input
                          className="text-base w-[80px] -my-2"
                          type="text"
                          disabled={readOnly}
                          value={String(row?.shares ?? '')}
                          onChange={(e) =>
                            handleShareChange(participant.id, e.target.value)
                          }
                          inputMode={match(draft.splitMode)
                            .with('BY_PERCENTAGE', () => 'decimal' as const)
                            .with('BY_SHARES', () => 'numeric' as const)
                            .otherwise(() => 'decimal' as const)}
                          step={match(draft.splitMode)
                            .with('BY_PERCENTAGE', () => 0.01)
                            .with('BY_SHARES', () => 1)
                            .otherwise(
                              () => 10 ** -groupCurrency.decimal_digits,
                            )}
                        />
                        <span className="text-sm">
                          {match(draft.splitMode)
                            .with('BY_SHARES', () => t('shares'))
                            .with('BY_PERCENTAGE', () => '%')
                            .otherwise(() => '')}
                        </span>
                      </div>
                    </div>
                  ) : undefined
                }
              />
            )
          })}

          <ParticipantDistributionFooter
            splitMode={draft.splitMode}
            targetAmount={
              draft.splitMode === 'BY_PERCENTAGE'
                ? 100
                : amountAsMinorUnits(itemTotal, groupCurrency)
            }
            shares={
              draft.splitMode === 'BY_AMOUNT'
                ? distributionShares.map((s) =>
                    amountAsMinorUnits(s, groupCurrency),
                  )
                : distributionShares
            }
            currency={groupCurrency}
            paidByCount={draft.paidFor.length}
            dataTestId="item-participants-distribution-footer"
          />
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

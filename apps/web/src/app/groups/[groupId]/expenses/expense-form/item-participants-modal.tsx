import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
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
import { percentageToBasisPoints } from './allocation-engine'
import { convertParticipantShares } from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'
import { VisualSplitEditor } from './visual-split-editor'

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

  const itemTotal = Number(draft.unitPrice) * Number(draft.quantity)

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

  const renderItemParticipants = (mode: ItemSplitMode) => {
    return (
      <VisualSplitEditor
        key={`${mode}/${groupCurrency.code}`}
        mode={mode}
        participants={group.participants}
        rows={draft.paidFor}
        targetAmount={itemTotal}
        currency={groupCurrency}
        readOnly={readOnly}
        pendingLabel={t('participant.pending')}
        onRowsChange={(next) =>
          setDraft((previous) => ({ ...previous, paidFor: next }))
        }
        amountPreview={(participantId, nextRows) => {
          if (mode === 'BY_AMOUNT') return null
          return (
            <ParticipantRowAmountPreview
              amount={calculateShare(participantId, {
                amount: amountAsMinorUnits(itemTotal, groupCurrency),
                paidFor: nextRows.map((row) => ({
                  participant: { id: row.participant, name: '', groupId: '' },
                  shares:
                    mode === 'BY_PERCENTAGE'
                      ? percentageToBasisPoints(row.shares)
                      : row.shares,
                  expenseId: '',
                  participantId: '',
                })),
                splitMode: mode,
                isReimbursement: false,
              })}
              currency={groupCurrency}
            />
          )
        }}
      />
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {item.title || '(unnamed item)'}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {itemTotal.toFixed(2)}
            {' · '}
            {draft.quantity}
            {' × '}
            {Number(draft.unitPrice).toFixed(2)}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <div>
            <div className="mb-4">
              <PaidForSplitOptionCards
                value={draft.splitMode}
                onChange={handleSplitModeChange}
                renderContent={renderItemParticipants}
                readOnly={readOnly}
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

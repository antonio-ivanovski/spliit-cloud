import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { FormField } from '@/components/ui/form'
import { calculatePaidByShare, percentageToBasisPoints } from '@/lib/totals'
import { amountAsMinorUnits } from '@/lib/utils'
import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'

import { safeSharesToFixedUnits } from './currency-utils'
import { expenseTabPriority } from './focus-navigation'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import { ShareRowInput, type ShareInputRefs } from './share-row-input'

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>

export function PaidByRow({
  form,
  participant,
  payerCurrency,
  groupCurrency,
  readOnly,
  inputRefs,
  setManuallyEditedPayers,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
    account?: { id: string; name?: string | null; image?: string | null } | null
  }
  payerCurrency: Currency
  groupCurrency: Currency
  readOnly: boolean
  inputRefs: ShareInputRefs
  setManuallyEditedPayers: Dispatch<SetStateAction<Set<string>>>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const paidBySplitMode = useWatch({
    control: form.control,
    name: 'paidBySplitMode',
  })
  const isReimbursement = useWatch({
    control: form.control,
    name: 'isReimbursement',
  })
  const amount = useWatch({ control: form.control, name: 'amount' })
  const paidByList = useWatch({ control: form.control, name: 'paidByList' })
  const conversionRate = useWatch({
    control: form.control,
    name: 'conversionRate',
  })

  const { id } = participant
  const isOriginalPayer = payerCurrency.code !== groupCurrency.code
  // paidBy shares are entered in the payer currency, which matches the
  // typed `amount` (the selected expense currency). For non-converted
  // expenses this equals the groupCurrency.
  const targetAmount = Number(amount) || 0

  const paidByListForCalc = paidByList.map((p) => {
    const rawShares = p.shares || 0
    const shares =
      paidBySplitMode === 'BY_PERCENTAGE'
        ? percentageToBasisPoints(rawShares)
        : paidBySplitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(rawShares, payerCurrency)
          : paidBySplitMode === 'BY_SHARES'
            ? safeSharesToFixedUnits(rawShares)
            : rawShares
    return { participant: { id: p.participant }, shares }
  })
  const paidByExpenseForCalc = {
    amount: amountAsMinorUnits(targetAmount, payerCurrency),
    paidByList: paidByListForCalc,
    paidBySplitMode: paidBySplitMode,
    isReimbursement: false,
  }

  return (
    <FormField
      control={form.control}
      name="paidByList"
      render={({ field }) => {
        const checked = field.value?.some(
          ({ participant }: { participant: string }) => participant === id,
        )
        const row = field.value?.find(
          ({ participant }: { participant: string }) => participant === id,
        )
        const inputValue = String(row?.shares ?? '')
        return (
          <ParticipantShareRow
            focusPriority={expenseTabPriority.paidBy}
            key={id}
            dataId={`${id}/${paidBySplitMode}/${payerCurrency.code}`}
            participant={participant}
            checked={checked}
            onCheckedChange={(checked) => {
              if (readOnly) return
              const options = {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              }
              if (checked) {
                form.setValue(
                  'paidByList',
                  [
                    ...field.value,
                    {
                      participant: id,
                      shares: 1,
                    },
                  ],
                  options,
                )
              } else {
                form.setValue(
                  'paidByList',
                  field.value?.filter((value) => value.participant !== id),
                  options,
                )
              }
            }}
            disabled={readOnly}
            pendingLabel={
              participant.pending ? (
                <ParticipantPendingLabel text={t('participant.pending')} />
              ) : undefined
            }
            preview={
              checked &&
              !isReimbursement &&
              (paidBySplitMode === 'BY_AMOUNT'
                ? isOriginalPayer &&
                  inputValue && (
                    <ParticipantRowAmountPreview
                      amount={amountAsMinorUnits(
                        Number(inputValue) * Number(conversionRate || 1),
                        groupCurrency,
                      )}
                      currency={groupCurrency}
                    />
                  )
                : paidBySplitMode !== 'EVENLY' && (
                    <ParticipantRowAmountPreview
                      amount={calculatePaidByShare(id, paidByExpenseForCalc)}
                      currency={payerCurrency}
                    />
                  ))
            }
            shareInput={
              paidBySplitMode !== 'EVENLY' && (
                <ShareRowInput
                  form={form}
                  arrayName="paidByList"
                  rows={field.value}
                  participantId={id}
                  participantName={participant.name}
                  splitMode={paidBySplitMode as ItemSplitMode}
                  currency={payerCurrency}
                  readOnly={readOnly}
                  inputRefs={inputRefs}
                  // Paid-by shares may be signed (negative income expenses).
                  allowNegative
                  markManuallyEdited={(participantId) =>
                    setManuallyEditedPayers((prev) =>
                      new Set(prev).add(participantId),
                    )
                  }
                />
              )
            }
          />
        )
      }}
    />
  )
}

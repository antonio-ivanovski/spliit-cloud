import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { FormField } from '@/components/ui/form'
import { calculateShare, percentageToBasisPoints } from '@/lib/totals'
import { amountAsMinorUnits } from '@/lib/utils'
import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'

import { safeSharesToFixedUnits } from './currency-utils'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'
import { ShareRowInput, type ShareInputRefs } from './share-row-input'

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>

export function PaidForRow({
  form,
  participant,
  groupCurrency,
  originalCurrency,
  conversionRequired,
  exchangeRate,
  readOnly,
  inputRefs,
  setManuallyEditedParticipants,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
    account?: { id: string; name?: string | null; image?: string | null } | null
  }
  groupCurrency: Currency
  originalCurrency: Currency
  conversionRequired: boolean
  exchangeRate: ExpenseFormInputValues['conversionRate']
  readOnly: boolean
  inputRefs: ShareInputRefs
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const splitMode = useWatch({ control: form.control, name: 'splitMode' })
  const isReimbursement = useWatch({
    control: form.control,
    name: 'isReimbursement',
  })
  const amount = useWatch({ control: form.control, name: 'amount' })

  const { id } = participant

  const inputCurrency = conversionRequired ? originalCurrency : groupCurrency

  return (
    <FormField
      control={form.control}
      name="paidFor"
      render={({ field }) => {
        const checked = field.value?.some(
          ({ participant }: { participant: string }) => participant === id,
        )
        const row = field.value?.find(
          ({ participant }: { participant: string }) => participant === id,
        )
        return (
          <ParticipantShareRow
            key={id}
            dataId={`${id}/${splitMode}/${groupCurrency.code}`}
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
                  'paidFor',
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
                  'paidFor',
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
              (splitMode === 'BY_AMOUNT' ? (
                (() => {
                  const shareValue = Number(row?.shares ?? 0)
                  const previewConvertedAmount =
                    conversionRequired && shareValue
                      ? shareValue * Number(exchangeRate || 1)
                      : null
                  return previewConvertedAmount != null ? (
                    <ParticipantRowAmountPreview
                      amount={amountAsMinorUnits(
                        previewConvertedAmount,
                        groupCurrency,
                      )}
                      currency={groupCurrency}
                    />
                  ) : null
                })()
              ) : (
                <ParticipantRowAmountPreview
                  amount={calculateShare(id, {
                    amount: amountAsMinorUnits(
                      Number(amount) || 0,
                      inputCurrency,
                    ),
                    paidFor: field.value.map(
                      ({ participant: pid, shares }) => ({
                        participant: {
                          id: pid,
                          name: '',
                          groupId: '',
                        },
                        // BY_SHARES preview must use stored fixed units so
                        // `calculateShare` sees the same ratio the
                        // server-side calculation will. Display form
                        // values get scaled once here.
                        shares:
                          splitMode === 'BY_PERCENTAGE'
                            ? percentageToBasisPoints(shares)
                            : splitMode === 'BY_SHARES'
                              ? safeSharesToFixedUnits(shares)
                              : shares,
                        expenseId: '',
                        participantId: '',
                      }),
                    ),
                    splitMode: splitMode,
                    isReimbursement: isReimbursement,
                  })}
                  currency={inputCurrency}
                />
              ))
            }
            shareInput={
              splitMode !== 'EVENLY' && (
                <ShareRowInput
                  form={form}
                  arrayName="paidFor"
                  rows={field.value}
                  participantId={id}
                  participantName={participant.name}
                  splitMode={splitMode as ItemSplitMode}
                  currency={inputCurrency}
                  readOnly={readOnly}
                  inputRefs={inputRefs}
                  markManuallyEdited={(participantId) =>
                    setManuallyEditedParticipants((prev) =>
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

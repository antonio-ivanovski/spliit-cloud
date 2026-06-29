import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { FormControl, FormField, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { calculatePaidByShare } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { match } from 'ts-pattern'
import {
  enforceCurrencyPattern,
  enforceIntegerPattern,
  enforcePercentagePattern,
} from './currency-utils'
import { ParticipantPendingLabel } from './participant-pending-label'
import { ParticipantShareRow } from './participant-share-row'

export function PaidByRow({
  form,
  participant,
  payerCurrency,
  groupCurrency,
  readOnly,
  setManuallyEditedPayers,
  t,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
  }
  payerCurrency: Currency
  groupCurrency: Currency
  readOnly: boolean
  setManuallyEditedPayers: Dispatch<SetStateAction<Set<string>>>
  t: (key: string) => string
}) {
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
        ? rawShares * 100
        : paidBySplitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(rawShares, payerCurrency)
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
                <FormField
                  name={`paidByList[${field.value.findIndex(({ participant }: { participant: string }) => participant === id)}].shares`}
                  render={() => {
                    const row = field.value?.find(
                      ({ participant }: { participant: string }) =>
                        participant === id,
                    )
                    const isSelected = row != null

                    if (paidBySplitMode === 'BY_AMOUNT') {
                      return (
                        <div>
                          <div className="flex gap-1 items-center">
                            <span className="text-sm">
                              {payerCurrency.symbol}
                            </span>
                            <FormControl>
                              <Input
                                key={String(!isSelected)}
                                className="text-base w-[80px] -my-2"
                                type="text"
                                disabled={readOnly || !isSelected}
                                value={String(row?.shares ?? '')}
                                onChange={(event) => {
                                  field.onChange(
                                    field.value.map((p) =>
                                      p.participant === id
                                        ? {
                                            participant: id,
                                            shares:
                                              Number(
                                                enforceCurrencyPattern(
                                                  event.target.value,
                                                ),
                                              ) || 0,
                                          }
                                        : p,
                                    ),
                                  )
                                  setManuallyEditedPayers((prev) =>
                                    new Set(prev).add(id),
                                  )
                                }}
                                inputMode="decimal"
                                step={10 ** -payerCurrency.decimal_digits}
                              />
                            </FormControl>
                          </div>
                          <FormMessage className="float-right" />
                        </div>
                      )
                    }

                    const modeProps = match(paidBySplitMode)
                      .with('BY_PERCENTAGE', () => ({
                        sanitizer: enforcePercentagePattern,
                        inputMode: 'decimal' as const,
                        step: 0.01,
                      }))
                      .with('BY_SHARES', () => ({
                        sanitizer: enforceIntegerPattern,
                        inputMode: 'numeric' as const,
                        step: 1,
                      }))
                      .otherwise(() => null)
                    const sharesLabel = (
                      <span
                        className={cn('text-sm', {
                          'text-muted': !isSelected,
                        })}
                      >
                        {match(paidBySplitMode)
                          .with('BY_SHARES', () => <>{t('shares')}</>)
                          .with('BY_PERCENTAGE', () => <>%</>)
                          .otherwise(() => (
                            <></>
                          ))}
                      </span>
                    )
                    return (
                      <div>
                        <div className="flex gap-1 items-center">
                          <FormControl>
                            <Input
                              key={String(!isSelected)}
                              className="text-base w-[80px] -my-2"
                              type="text"
                              disabled={readOnly || !isSelected}
                              value={String(row?.shares ?? '')}
                              onChange={(event) => {
                                field.onChange(
                                  field.value.map((p) =>
                                    p.participant === id
                                      ? {
                                          participant: id,
                                          shares:
                                            Number(
                                              (
                                                modeProps?.sanitizer ??
                                                enforceCurrencyPattern
                                              )(event.target.value),
                                            ) || 0,
                                        }
                                      : p,
                                  ),
                                )
                                setManuallyEditedPayers((prev) =>
                                  new Set(prev).add(id),
                                )
                              }}
                              inputMode={modeProps?.inputMode ?? 'decimal'}
                              step={
                                modeProps?.step ??
                                10 ** -payerCurrency.decimal_digits
                              }
                            />
                          </FormControl>
                          {sharesLabel}
                        </div>
                        <FormMessage className="float-right" />
                      </div>
                    )
                  }}
                />
              )
            }
          />
        )
      }}
    />
  )
}

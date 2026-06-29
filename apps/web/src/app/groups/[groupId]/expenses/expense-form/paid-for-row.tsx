import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { FormControl, FormField, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { calculateShare } from '@/lib/totals'
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

export function PaidForRow({
  form,
  participant,
  groupCurrency,
  originalCurrency,
  conversionRequired,
  exchangeRate,
  readOnly,
  setManuallyEditedParticipants,
  t,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  participant: {
    id: string
    name: string
    pending?: boolean
    unlinked?: boolean
  }
  groupCurrency: Currency
  originalCurrency: Currency
  conversionRequired: boolean
  exchangeRate: any
  readOnly: boolean
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
  t: (key: string) => string
}) {
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
                    amount: amountAsMinorUnits(Number(amount), inputCurrency),
                    paidFor: field.value.map(
                      ({ participant: pid, shares }) => ({
                        participant: {
                          id: pid,
                          name: '',
                          groupId: '',
                        },
                        shares:
                          splitMode === 'BY_PERCENTAGE' ? shares * 100 : shares,
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
                <FormField
                  name={`paidFor[${field.value.findIndex(({ participant }: { participant: string }) => participant === id)}].shares`}
                  render={() => {
                    const row = field.value?.find(
                      ({ participant }: { participant: string }) =>
                        participant === id,
                    )
                    const isSelected = row != null

                    if (splitMode === 'BY_AMOUNT') {
                      return (
                        <div>
                          <div className="flex gap-1 items-center">
                            <span className="text-sm">
                              {inputCurrency.symbol}
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
                                  setManuallyEditedParticipants((prev) =>
                                    new Set(prev).add(id),
                                  )
                                }}
                                inputMode="decimal"
                                step={10 ** -inputCurrency.decimal_digits}
                              />
                            </FormControl>
                          </div>
                          <FormMessage className="float-right" />
                        </div>
                      )
                    }

                    const modeProps = match(splitMode)
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
                        {match(splitMode)
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
                                setManuallyEditedParticipants((prev) =>
                                  new Set(prev).add(id),
                                )
                              }}
                              inputMode={modeProps?.inputMode ?? 'decimal'}
                              step={
                                modeProps?.step ??
                                10 ** -groupCurrency.decimal_digits
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

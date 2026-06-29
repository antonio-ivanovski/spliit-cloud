import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { FormControl, FormField, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { calculateShare } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { Currency, ExpenseFormValues } from '@spliit/domain'
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
  form: UseFormReturn<ExpenseFormValues, any, ExpenseFormValues>
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
  const paidFor = useWatch({ control: form.control, name: 'paidFor' })

  const { id } = participant

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
                      shares: '1',
                    },
                  ] as any,
                  options,
                )
              } else {
                form.setValue(
                  'paidFor',
                  field.value?.filter((value: any) => value.participant !== id),
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
                  const previewInputValue = conversionRequired
                    ? (row?.originalAmount ?? '')
                    : String(row?.shares ?? '')
                  const previewConvertedAmount =
                    conversionRequired && previewInputValue
                      ? Number(previewInputValue) * Number(exchangeRate || 1)
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
                    amount: amountAsMinorUnits(Number(amount), groupCurrency),
                    paidFor: field.value.map(
                      ({
                        participant: pid,
                        shares,
                      }: {
                        participant: string
                        shares: any
                      }) => ({
                        participant: {
                          id: pid,
                          name: '',
                          groupId: '',
                        },
                        shares:
                          splitMode === 'BY_PERCENTAGE'
                            ? Number(shares) * 100
                            : Number(shares),
                        expenseId: '',
                        participantId: '',
                      }),
                    ),
                    splitMode: splitMode,
                    isReimbursement: isReimbursement,
                  })}
                  currency={groupCurrency}
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
                      const inputValue = conversionRequired
                        ? (row?.originalAmount ?? '')
                        : String(row?.shares ?? '')

                      const handleChange = (next: string) => {
                        const rate = Number(exchangeRate)
                        const converted =
                          conversionRequired && !Number.isNaN(rate) && rate > 0
                            ? enforceCurrencyPattern(
                                (Number(next || '0') * rate).toFixed(
                                  groupCurrency.decimal_digits,
                                ),
                              )
                            : next
                        field.onChange(
                          field.value.map((p: any) =>
                            p.participant === id
                              ? conversionRequired
                                ? {
                                    participant: id,
                                    shares: converted,
                                    originalAmount: next,
                                  }
                                : { participant: id, shares: next }
                              : p,
                          ),
                        )
                        setManuallyEditedParticipants((prev) =>
                          new Set(prev).add(id),
                        )
                      }

                      const inputCurrency = conversionRequired
                        ? originalCurrency
                        : groupCurrency

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
                                value={inputValue}
                                onChange={(event) =>
                                  handleChange(event.target.value)
                                }
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
                                  field.value.map((p: any) =>
                                    p.participant === id
                                      ? {
                                          participant: id,
                                          shares: (
                                            modeProps?.sanitizer ??
                                            enforceCurrencyPattern
                                          )(event.target.value),
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

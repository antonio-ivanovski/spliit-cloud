import { ParticipantRowAmountPreview } from '@/components/participant-row-amount-preview'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { calculateShare } from '@/lib/totals'
import { amountAsMinorUnits, cn } from '@/lib/utils'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { Minus, Plus } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
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
                          <div className="flex items-center justify-end gap-0.5">
                            <span className="text-sm">
                              {inputCurrency.symbol}
                            </span>
                            <FormControl>
                              <Input
                                className="-my-2 w-[72px] shrink-0 px-2 text-right text-base tabular-nums"
                                type="text"
                                disabled={readOnly}
                                aria-label={t('participantAmountLabel', {
                                  name: participant.name,
                                })}
                                value={String(row?.shares ?? '')}
                                onChange={(event) => {
                                  const sanitized = enforceCurrencyPattern(
                                    event.target.value,
                                  )
                                  const next = field.value.filter(
                                    (p) => p.participant !== id,
                                  )
                                  // Keep in-progress decimals like "0." or
                                  // "10." in the list so the user can finish
                                  // typing; remove on explicit "" or "0".
                                  if (sanitized !== '' && sanitized !== '0') {
                                    next.push({
                                      participant: id,
                                      shares: sanitized as unknown as number,
                                    })
                                  }
                                  form.setValue('paidFor', next, {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                    shouldValidate: true,
                                  })
                                  if (sanitized !== '' && sanitized !== '0')
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
                        labelKey: 'participantPercentageLabel' as const,
                      }))
                      .with('BY_SHARES', () => ({
                        sanitizer: enforceIntegerPattern,
                        inputMode: 'numeric' as const,
                        step: 1,
                        labelKey: 'participantSharesLabel' as const,
                      }))
                      .otherwise(() => null)
                    return (
                      <div>
                        <div className="flex items-center justify-end gap-0.5">
                          {splitMode === 'BY_SHARES' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0"
                              disabled={readOnly || !isSelected}
                              aria-label={t('decreaseShares', {
                                name: participant.name,
                              })}
                              onClick={() => {
                                const nextValue = Math.max(
                                  0,
                                  Number(row?.shares ?? 0) - 1,
                                )
                                const next = field.value.filter(
                                  (p) => p.participant !== id,
                                )
                                if (nextValue > 0)
                                  next.push({
                                    participant: id,
                                    shares: nextValue,
                                  })
                                form.setValue('paidFor', next, {
                                  shouldDirty: true,
                                  shouldTouch: true,
                                  shouldValidate: true,
                                })
                              }}
                            >
                              <Minus className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                          <FormControl>
                            <div className="relative">
                              <Input
                                className={cn(
                                  '-my-2 w-[72px] shrink-0 px-2 text-right text-base tabular-nums',
                                  splitMode === 'BY_PERCENTAGE' && 'pr-5',
                                )}
                                type="text"
                                disabled={readOnly}
                                aria-label={t(
                                  modeProps?.labelKey ??
                                    'participantAmountLabel',
                                  { name: participant.name },
                                )}
                                value={String(row?.shares ?? '')}
                                onChange={(event) => {
                                  const shares = Number(
                                    (
                                      modeProps?.sanitizer ??
                                      enforceCurrencyPattern
                                    )(event.target.value),
                                  )
                                  const next = field.value.filter(
                                    (p) => p.participant !== id,
                                  )
                                  if (shares > 0)
                                    next.push({ participant: id, shares })
                                  form.setValue('paidFor', next, {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                    shouldValidate: true,
                                  })
                                  if (shares > 0)
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
                              {splitMode === 'BY_PERCENTAGE' && (
                                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                                  %
                                </span>
                              )}
                            </div>
                          </FormControl>
                          {splitMode === 'BY_SHARES' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0"
                              disabled={readOnly}
                              aria-label={t('increaseShares', {
                                name: participant.name,
                              })}
                              onClick={() => {
                                const nextValue = Number(row?.shares ?? 0) + 1
                                const next = field.value.filter(
                                  (p) => p.participant !== id,
                                )
                                next.push({
                                  participant: id,
                                  shares: nextValue,
                                })
                                form.setValue('paidFor', next, {
                                  shouldDirty: true,
                                  shouldTouch: true,
                                  shouldValidate: true,
                                })
                              }}
                            >
                              <Plus className="size-4" aria-hidden="true" />
                            </Button>
                          )}
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

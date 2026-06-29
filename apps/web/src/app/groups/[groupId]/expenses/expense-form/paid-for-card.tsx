import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { getCurrency } from '@/lib/currency'
import { amountAsMinorUnits } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { type SplitMode } from '@spliit/domain'
import type { Dispatch, SetStateAction } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { PaidForRow } from './paid-for-row'
import { convertParticipantShares } from './split-mode-conversions'
import { PaidForSplitOptionCards } from './split-option-cards'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function PaidForCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  payerCurrency: Currency
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  setManuallyEditedParticipants: Dispatch<SetStateAction<Set<string>>>
}) {
  const { form, group, groupCurrency, payerCurrency, readOnly, sExpense } =
    props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const originalCurrencyCode = useWatch({
    control: form.control,
    name: 'originalCurrency',
  })
  const exchangeRate = useWatch({
    control: form.control,
    name: 'conversionRate',
  })
  const splitMode = useWatch({ control: form.control, name: 'splitMode' })
  const amount = useWatch({ control: form.control, name: 'amount' })
  const paidFor = useWatch({ control: form.control, name: 'paidFor' })

  const originalCurrency = originalCurrencyCode
    ? (getCurrency(originalCurrencyCode) ?? {
        code: '',
        symbol: 'Custom',
        rounding: 0,
        decimal_digits: 2,
      })
    : { code: '', symbol: 'Custom', rounding: 0, decimal_digits: 2 }
  const conversionRequired = !!(
    group.currencyCode &&
    group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== group.currencyCode
  )

  const handlePaidForSplitModeChange = (nextMode: SplitMode) => {
    const currentMode = form.getValues('splitMode')
    if (currentMode === nextMode) return
    const currentPaidFor = form.getValues('paidFor')
    const targetAmount = Number(form.getValues('amount')) || 0
    const converted = convertParticipantShares({
      rows: currentPaidFor,
      fromMode: currentMode,
      toMode: nextMode,
      targetAmount,
      currency: groupCurrency,
    })
    form.setValue('splitMode', nextMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidFor', converted, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    if (currentMode === 'BY_AMOUNT' && nextMode !== 'BY_AMOUNT') {
      const stripped = converted.map(({ participant, shares }) => ({
        participant,
        shares,
      }))
      form.setValue('paidFor', stripped, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t(`${sExpense}.paidFor.title`)}</span>
          <Button
            variant="link"
            type="button"
            className="-my-2 -mx-4"
            disabled={readOnly}
            onClick={() => {
              const paidFor = form.getValues().paidFor
              const allSelected = paidFor.length === group.participants.length
              const newPaidFor = allSelected
                ? []
                : group.participants.map((p) => ({
                    participant: p.id,
                    shares:
                      paidFor.find((pfor) => pfor.participant === p.id)
                        ?.shares ?? 1,
                  }))
              form.setValue('paidFor', newPaidFor, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              })
            }}
          >
            {form.getValues().paidFor.length === group.participants.length ? (
              <>{t('selectNone')}</>
            ) : (
              <>{t('selectAll')}</>
            )}
          </Button>
        </CardTitle>
        <CardDescription>
          {t(`${sExpense}.paidFor.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <PaidForSplitOptionCards
            value={splitMode}
            onChange={handlePaidForSplitModeChange}
            readOnly={readOnly}
            t={t}
          />
        </div>

        <FormField
          control={form.control}
          name="paidFor"
          render={() => (
            <FormItem className="sm:order-4 row-span-2 space-y-0">
              {group.participants.map((participant) => (
                <PaidForRow
                  key={participant.id}
                  form={form}
                  participant={participant}
                  groupCurrency={groupCurrency}
                  originalCurrency={originalCurrency}
                  conversionRequired={conversionRequired}
                  exchangeRate={exchangeRate}
                  readOnly={readOnly}
                  setManuallyEditedParticipants={
                    props.setManuallyEditedParticipants
                  }
                  t={t}
                />
              ))}
              <FormMessage />
            </FormItem>
          )}
        />

        <ParticipantDistributionFooter
          splitMode={splitMode}
          targetAmount={
            splitMode === 'BY_PERCENTAGE'
              ? 100
              : amountAsMinorUnits(Number(amount) || 0, groupCurrency)
          }
          shares={
            splitMode === 'BY_AMOUNT'
              ? paidFor.map((p) =>
                  amountAsMinorUnits(p.shares || 0, groupCurrency),
                )
              : paidFor.map((p) => p.shares || 0)
          }
          currency={groupCurrency}
          paidByCount={paidFor.length}
          dataTestId="paid-for-distribution-footer"
        />

        <FormField
          control={form.control}
          name="saveDefaultSplittingOptions"
          render={({ field }) => (
            <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={readOnly}
                />
              </FormControl>
              <div>
                <FormLabel>{t('SplitModeField.saveAsDefault')}</FormLabel>
              </div>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  )
}

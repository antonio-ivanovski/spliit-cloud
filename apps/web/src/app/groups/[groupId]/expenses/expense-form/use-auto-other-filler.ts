import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { amountAsMinorUnits } from '@spliit/domain'
import type { Control } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

export function withAutoOtherFiller(
  items: ExpenseFormItemValues[],
  expenseAmountMajor: number,
  groupCurrency: Currency,
  itemizedRemainder?: ExpenseFormInputValues['itemizedRemainder'],
): (ExpenseFormItemValues & { isFiller?: boolean })[] {
  const itemsSumMajor = items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
    0,
  )
  const itemsSumMinor = amountAsMinorUnits(itemsSumMajor, groupCurrency)
  const amountMinor = amountAsMinorUnits(expenseAmountMajor, groupCurrency)

  if (itemsSumMinor >= amountMinor) {
    return items
  }

  const gapMajor = Number(
    (expenseAmountMajor - itemsSumMajor).toFixed(groupCurrency.decimal_digits),
  )

  return [
    ...items,
    {
      title: '',
      unitPrice: gapMajor,
      quantity: 1,
      paidFor: itemizedRemainder?.paidFor ?? [],
      splitMode: itemizedRemainder?.splitMode ?? 'EVENLY',
      isFiller: true,
    } as ExpenseFormItemValues & { isFiller?: boolean },
  ]
}

export function useAutoOtherFiller(
  control: Control<ExpenseFormInputValues>,
  groupCurrency: Currency,
): (ExpenseFormItemValues & { isFiller?: boolean })[] {
  const items = useWatch({ control, name: 'items' }) ?? []
  const amount = useWatch({ control, name: 'amount' })
  const itemizedRemainder = useWatch({ control, name: 'itemizedRemainder' })
  return withAutoOtherFiller(
    items,
    Number(amount) || 0,
    groupCurrency,
    itemizedRemainder,
  )
}

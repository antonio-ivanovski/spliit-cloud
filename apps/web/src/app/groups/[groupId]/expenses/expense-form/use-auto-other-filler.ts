import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { amountAsMinorUnits } from '@spliit/domain'
import type { Control } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

export type ExpenseFormDisplayItem = ExpenseFormItemValues & {
  isFiller?: boolean
}

export function isFillerItem(
  item: ExpenseFormDisplayItem,
): item is ExpenseFormDisplayItem & { isFiller: true } {
  return item.isFiller === true
}

export function withAutoOtherFiller(
  items: ExpenseFormItemValues[],
  expenseAmountMajor: number,
  groupCurrency: Currency,
  itemizedRemainder?: ExpenseFormInputValues['itemizedRemainder'],
): ExpenseFormDisplayItem[] {
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
    },
  ]
}

export function useAutoOtherFiller(
  control: Control<ExpenseFormInputValues>,
  groupCurrency: Currency,
): ExpenseFormDisplayItem[] {
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

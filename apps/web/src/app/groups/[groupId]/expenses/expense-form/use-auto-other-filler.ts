import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { amountAsMinorUnits, itemsExceedExpenseAmount } from '@spliit/domain'

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

  if (
    itemsSumMinor === amountMinor ||
    itemsExceedExpenseAmount(itemsSumMinor, amountMinor)
  ) {
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

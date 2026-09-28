import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import {
  gapMinorAsMajor,
  getItemizedFormMinorTotals,
  itemsExceedExpenseAmount,
} from '@spliit/domain'

export type ExpenseFormDisplayItem = ExpenseFormItemValues & {
  isFiller?: boolean
  allocationMode?: 'CUSTOM' | 'PROPORTIONAL'
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
  const { itemsMinor, amountMinor, gapMinor } = getItemizedFormMinorTotals(
    items,
    expenseAmountMajor,
    groupCurrency,
  )

  if (
    itemsMinor === amountMinor ||
    itemsExceedExpenseAmount(itemsMinor, amountMinor)
  ) {
    return items
  }

  const gapMajor = gapMinorAsMajor(gapMinor, groupCurrency)

  return [
    ...items,
    {
      title: '',
      unitPrice: gapMajor,
      quantity: 1,
      paidFor: itemizedRemainder?.paidFor ?? [],
      splitMode: itemizedRemainder?.splitMode ?? 'EVENLY',
      allocationMode: itemizedRemainder?.allocationMode ?? 'CUSTOM',
      isFiller: true,
    },
  ]
}

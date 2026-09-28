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

/**
 * Append a synthetic "Other" filler item when the item subtotal does not cover
 * the expense total. All amounts are denominated in the expense's _input_
 * currency (the currency the amount field is entered in) — never the ledger
 * currency, which differs for converted expenses.
 */
export function withAutoOtherFiller(
  items: ExpenseFormItemValues[],
  expenseAmountMajor: number,
  inputCurrency: Currency,
  itemizedRemainder?: ExpenseFormInputValues['itemizedRemainder'],
): ExpenseFormDisplayItem[] {
  const { itemsMinor, amountMinor, gapMinor } = getItemizedFormMinorTotals(
    items,
    expenseAmountMajor,
    inputCurrency,
  )

  if (
    itemsMinor === amountMinor ||
    itemsExceedExpenseAmount(itemsMinor, amountMinor)
  ) {
    return items
  }

  const gapMajor = gapMinorAsMajor(gapMinor, inputCurrency)

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

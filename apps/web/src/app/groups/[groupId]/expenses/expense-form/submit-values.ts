import type { Currency, Expense, ExpenseFormInputValues } from '@spliit/domain'
import {
  amountAsMinorUnits,
  getCurrency,
  parseTimeMinutes,
  serializePaidBy,
  serializePaidFor,
  wallTimeToUtc,
} from '@spliit/domain'

// Convert user-facing form values (decimal major units in the selected
// expense currency, display percentages) to the storage units the API
// expects (integer minor units, basis points).
//
// Contract (server-authoritative conversion):
// - `values.amount` is always the user-typed amount in the selected
//   expense currency (`originalCurrency ?? groupCurrency`).
// - Shares/items are in that same expense currency.
// - `conversion` is a discriminated union (`none` | `custom` | `exchange`).
//   The server resolves rates and computes the ledger total.
export function buildSubmitValues(
  values: ExpenseFormInputValues,
  args: {
    groupCurrency: Currency
    conversionRequired: boolean
  },
): Expense {
  const { groupCurrency, conversionRequired } = args

  const inputCurrency = values.originalCurrency
    ? (getCurrency(values.originalCurrency) ?? groupCurrency)
    : groupCurrency
  const typedAmount = Number(values.amount) || 0

  const rate =
    values.conversionType === 'CUSTOM' && values.conversionRate
      ? Number(values.conversionRate)
      : undefined
  const exactAmount =
    values.conversionType === 'EXACT' && values.exactAmount != null
      ? Number(values.exactAmount)
      : undefined
  if (
    conversionRequired &&
    values.conversionType === 'CUSTOM' &&
    (!rate || Number.isNaN(rate) || rate <= 0)
  ) {
    throw new Error('A positive conversion rate is required.')
  }
  if (
    conversionRequired &&
    values.conversionType === 'EXACT' &&
    (!exactAmount ||
      Number.isNaN(exactAmount) ||
      Math.sign(exactAmount) !== Math.sign(typedAmount))
  ) {
    throw new Error('Exact amounts must be nonzero and have matching signs.')
  }

  const amountInExpenseCurrency = amountAsMinorUnits(typedAmount, inputCurrency)

  // Absent conversion = same currency as the group (matches nullable DB).
  const conversion: Expense['conversion'] = !conversionRequired
    ? undefined
    : values.conversionType === 'EXACT' && exactAmount
      ? {
          type: 'exact',
          currency: values.originalCurrency || inputCurrency.code,
          amount: amountAsMinorUnits(exactAmount, groupCurrency),
        }
      : values.conversionType === 'CUSTOM' && rate
        ? {
            type: 'custom',
            currency: values.originalCurrency || inputCurrency.code,
            rate,
          }
        : {
            type: 'exchange',
            currency: values.originalCurrency || inputCurrency.code,
          }

  const paidFor = serializePaidFor({
    splitMode: values.splitMode,
    amount: amountInExpenseCurrency,
    currency: inputCurrency,
    conversionRate: undefined,
    paidFor: values.paidFor,
  })

  const paidByList = serializePaidBy({
    paidBySplitMode: values.paidBySplitMode,
    amount: amountInExpenseCurrency,
    inputCurrency,
    conversionRate: undefined,
    paidByList: values.paidByList,
  })

  const expenseTimeZone = values.expenseTimeZone
  const rawTime = values.expenseTime.trim()
  const expenseDate = wallTimeToUtc(
    values.expenseDay,
    parseTimeMinutes(rawTime),
    expenseTimeZone,
  )

  const base = {
    expenseDate,
    expenseTimeZone,
    title: values.title,
    category: values.category,
    amount: amountInExpenseCurrency,
    ...(conversion ? { conversion } : {}),
    paidBySplitMode: values.paidBySplitMode,
    paidByList,
    splitMode: values.splitMode,
    paidFor,
    isMultiPayer: values.isMultiPayer,
    documents: values.documents,
    notes: values.notes,
    recurrenceRule: 'NONE' as const,
    recurrence: values.recurrence ?? null,
  }

  const items: Expense['items'] = (values.items ?? []).map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity))
    const unitPriceMinor = amountAsMinorUnits(item.unitPrice, inputCurrency)
    const lineAmountMinor = unitPriceMinor * quantity
    const paidFor = serializePaidFor({
      splitMode: item.splitMode,
      amount: lineAmountMinor,
      currency: inputCurrency,
      paidFor: item.paidFor,
    })
    return {
      id: item.id,
      title: item.title,
      unitPrice: unitPriceMinor,
      quantity,
      amount: lineAmountMinor,
      paidFor,
      splitMode: item.splitMode,
    }
  })

  const itemizedRemainder: Expense['itemizedRemainder'] =
    values.splitMode === 'ITEMIZED' && values.itemizedRemainder
      ? values.itemizedRemainder.allocationMode === 'PROPORTIONAL'
        ? {
            // Canonical proportional payload: derived weights are never
            // persisted; the server recomputes them from item subtotals.
            allocationMode: 'PROPORTIONAL',
            splitMode: 'EVENLY',
            paidFor: [],
          }
        : {
            allocationMode: 'CUSTOM',
            splitMode: values.itemizedRemainder.splitMode,
            paidFor: serializePaidFor({
              splitMode: values.itemizedRemainder.splitMode,
              amount: 0,
              currency: inputCurrency,
              paidFor: values.itemizedRemainder.paidFor,
            }),
          }
      : undefined

  return {
    ...base,
    ...(items.length > 0 ? { items } : {}),
    ...(itemizedRemainder ? { itemizedRemainder } : {}),
  }
}

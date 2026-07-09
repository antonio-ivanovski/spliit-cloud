import type { Currency, Expense, ExpenseFormInputValues } from '@spliit/domain'
import {
  amountAsMinorUnits,
  getCurrency,
  serializePaidBy,
  serializePaidFor,
} from '@spliit/domain'

// Convert user-facing form values (decimal major units in the selected
// expense currency, display percentages) to the storage units the API
// expects (integer minor units, basis points).
//
// Contract:
// - `values.amount` is always the user-typed amount in the selected
//   expense currency (`originalCurrency ?? groupCurrency`).
// - When conversion is required, the persisted Ledger amount is computed
//   client-side as `amount * conversionRate` (rounded to Ledger minor
//   units), and `originalAmount` carries the typed amount in
//   originalCurrency minor units. paidFor shares are converted the same
//   way before being persisted as Ledger-currency minor units. paidBy
//   shares are entered in originalCurrency display units and are
//   persisted as originalCurrency minor units.
// - When no conversion is required, `amount` and both share lists are
//   treated as groupCurrency values.
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
    conversionRequired && values.conversionRate
      ? Number(values.conversionRate)
      : undefined
  if (conversionRequired && (!rate || Number.isNaN(rate) || rate <= 0)) {
    throw new Error('A positive conversion rate is required.')
  }

  // Persisted Ledger amount: same as typed amount when no conversion,
  // otherwise `amount * rate` rounded to Ledger minor units.
  const ledgerAmount = conversionRequired
    ? amountAsMinorUnits(rate ? typedAmount * rate : typedAmount, groupCurrency)
    : amountAsMinorUnits(typedAmount, groupCurrency)

  // paidFor BY_AMOUNT shares are entered in the selected expense currency
  // and persisted as Ledger-currency minor units.
  const paidFor = serializePaidFor({
    splitMode: values.splitMode,
    amount: ledgerAmount,
    currency: groupCurrency,
    conversionRate: conversionRequired ? rate : undefined,
    paidFor: values.paidFor,
  })

  // paidBy shares stay in input-currency minor units (original when converted).
  const paidByList = serializePaidBy({
    paidBySplitMode: values.paidBySplitMode,
    amount: conversionRequired
      ? amountAsMinorUnits(typedAmount, inputCurrency)
      : ledgerAmount,
    inputCurrency,
    conversionRate: conversionRequired ? rate : undefined,
    paidByList: values.paidByList,
  })

  const base = {
    expenseDate: values.expenseDate,
    title: values.title,
    category: values.category,
    amount: ledgerAmount,
    paidBySplitMode: values.paidBySplitMode,
    paidByList,
    splitMode: values.splitMode,
    paidFor,
    isMultiPayer: values.isMultiPayer,
    isReimbursement: values.isReimbursement,
    documents: values.documents,
    notes: values.notes,
    recurrenceRule: values.recurrenceRule,
    conversionRate: conversionRequired ? rate : undefined,
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

  // Only persist `itemizedRemainder` for ITEMIZED expenses. For other
  // split modes it is semantically meaningless and the form fabricates
  // a default value, so sending it through would create orphan DB rows
  // and trip a false-positive activity-log diff on the first edit.
  const itemizedRemainder: Expense['itemizedRemainder'] =
    values.splitMode === 'ITEMIZED' && values.itemizedRemainder
      ? {
          splitMode: values.itemizedRemainder.splitMode,
          paidFor: serializePaidFor({
            splitMode: values.itemizedRemainder.splitMode,
            amount: 0,
            currency: inputCurrency,
            paidFor: values.itemizedRemainder.paidFor,
          }),
        }
      : undefined

  // Currency should be blank if same as group currency. The client only
  // persists `originalAmount`/`originalCurrency` metadata when a
  // conversion is genuinely required.
  const payload: Expense = {
    ...base,
    ...(items.length > 0 ? { items } : {}),
    ...(itemizedRemainder ? { itemizedRemainder } : {}),
    ...(conversionRequired
      ? {
          originalAmount: amountAsMinorUnits(typedAmount, inputCurrency),
          originalCurrency: values.originalCurrency ?? undefined,
        }
      : {}),
  }
  return payload
}

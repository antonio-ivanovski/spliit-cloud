import type { Currency, Expense, ExpenseFormInputValues } from '@spliit/domain'
import { amountAsMinorUnits, getCurrency } from '@spliit/domain'

// Convert user-facing form values (decimal major units, display
// percentages) to the storage units the API expects (integer minor
// units, basis points). Mirrors the body of the previous submit()
// handler in expense-form.tsx.
export function buildSubmitValues(
  values: ExpenseFormInputValues,
  args: {
    groupCurrency: Currency
    conversionRequired: boolean
  },
): Expense {
  const { groupCurrency, conversionRequired } = args

  const amount = amountAsMinorUnits(values.amount, groupCurrency)
  const paidFor = values.paidFor.map(({ participant, shares }) => ({
    participant,
    shares:
      values.splitMode === 'BY_AMOUNT'
        ? amountAsMinorUnits(shares, groupCurrency)
        : values.splitMode === 'BY_PERCENTAGE'
          ? Math.round(shares * 100)
          : Math.round(shares),
  }))

  // paidByList.shares are entered in originalCurrency when set, so
  // the minor-units conversion must use that currency, not the group
  // currency — otherwise a EUR-group expense paid in USD would be
  // stored as cents-of-EUR-denominated-dollars.
  const payerCurrency =
    values.originalCurrency && getCurrency(values.originalCurrency)
      ? getCurrency(values.originalCurrency)!
      : groupCurrency
  const paidByList = values.paidByList.map(({ participant, shares }) => ({
    participant,
    shares:
      values.paidBySplitMode === 'BY_AMOUNT'
        ? amountAsMinorUnits(shares, payerCurrency)
        : values.paidBySplitMode === 'BY_PERCENTAGE'
          ? Math.round(shares * 100)
          : Math.round(shares),
  }))

  // Convert originalAmount back to minor units for storage.
  const originalAmount =
    values.originalAmount != null && values.originalCurrency
      ? amountAsMinorUnits(
          values.originalAmount,
          getCurrency(values.originalCurrency) ?? groupCurrency,
        )
      : undefined

  const base = {
    expenseDate: values.expenseDate,
    title: values.title,
    category: values.category,
    amount,
    paidBySplitMode: values.paidBySplitMode,
    paidByList,
    splitMode: values.splitMode,
    paidFor,
    isMultiPayer: values.isMultiPayer,
    saveDefaultSplittingOptions: values.saveDefaultSplittingOptions,
    isReimbursement: values.isReimbursement,
    documents: values.documents,
    notes: values.notes,
    recurrenceRule: values.recurrenceRule,
    conversionRate: values.conversionRate,
  }

  // Currency should be blank if same as group currency.
  // Explicit construction avoids `as Expense` casts that paper
  // over loose optional-field inference from the `base` object spread.
  const payload: Expense = {
    ...base,
    ...(conversionRequired
      ? {
          originalAmount,
          originalCurrency: values.originalCurrency ?? undefined,
        }
      : {}),
  }
  return payload
}

import type { Currency, ExpenseFormValues } from '@spliit/domain'
import { amountAsMinorUnits, getCurrency } from '@spliit/domain'

// Convert form values to minor units (cents) for storage and normalise.
// Mirrors the body of the existing submit() handler in expense-form.tsx.
//
// `values` is mutated and returned for chaining.
export function buildSubmitValues(
  values: ExpenseFormValues,
  args: {
    groupCurrency: Currency
    conversionRequired: boolean
  },
): ExpenseFormValues {
  const { groupCurrency, conversionRequired } = args

  // Store monetary amounts in minor units (cents)
  values.amount = amountAsMinorUnits(values.amount, groupCurrency)
  values.paidFor = values.paidFor.map(({ participant, shares }) => ({
    participant,
    shares:
      values.splitMode === 'BY_AMOUNT'
        ? amountAsMinorUnits(shares, groupCurrency)
        : shares,
  }))
  values.paidByList = values.paidByList.map(({ participant, shares }) => {
    // paidByList.shares are entered in originalCurrency when set, so
    // the minor-units conversion must use that currency, not the group
    // currency — otherwise a EUR-group expense paid in USD would be
    // stored as cents-of-EUR-denominated-dollars.
    const payerCurrency =
      values.originalCurrency && getCurrency(values.originalCurrency)
        ? getCurrency(values.originalCurrency)!
        : groupCurrency
    return {
      participant,
      shares:
        values.paidBySplitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(shares, payerCurrency)
          : shares,
    }
  })

  // Convert originalAmount back to minor units for storage
  if (values.originalAmount != null && values.originalCurrency) {
    const origCurrency = getCurrency(values.originalCurrency) ?? groupCurrency
    values.originalAmount = amountAsMinorUnits(
      values.originalAmount,
      origCurrency,
    )
  }

  // Currency should be blank if same as group currency
  if (!conversionRequired) {
    delete values.originalAmount
    delete values.originalCurrency
  }
  return values
}

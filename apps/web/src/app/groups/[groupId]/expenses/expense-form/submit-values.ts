import type { Currency, Expense, ExpenseFormInputValues } from '@spliit/domain'
import { amountAsMinorUnits, getCurrency } from '@spliit/domain'

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

  // Persisted Ledger amount: same as typed amount when no conversion,
  // otherwise `amount * rate` rounded to Ledger minor units.
  const ledgerAmount = conversionRequired
    ? amountAsMinorUnits(rate ? typedAmount * rate : typedAmount, groupCurrency)
    : amountAsMinorUnits(typedAmount, groupCurrency)

  // paidFor BY_AMOUNT shares are entered in the selected expense currency
  // and persisted as Ledger-currency minor units. Converting per-share
  // before persisting (with largest-remainder happening server-side)
  // keeps the per-share semantics intuitive for cross-currency BY_AMOUNT.
  const paidFor = values.paidFor.map(({ participant, shares }) => ({
    participant,
    shares:
      values.splitMode === 'BY_AMOUNT'
        ? amountAsMinorUnits(
            conversionRequired && rate ? shares * rate : shares,
            groupCurrency,
          )
        : values.splitMode === 'BY_PERCENTAGE'
          ? Math.round(shares * 100)
          : Math.round(shares),
  }))

  // paidBy shares are entered in the input currency display units
  // (which is `originalCurrency` when conversion is required,
  // groupCurrency otherwise), and are persisted in their input
  // currency's minor units. This keeps the API invariant that
  // `Σ paidByList.shares == originalAmount` for converted expenses.
  const paidByList = values.paidByList.map(({ participant, shares }) => ({
    participant,
    shares:
      values.paidBySplitMode === 'BY_AMOUNT'
        ? amountAsMinorUnits(shares, inputCurrency)
        : values.paidBySplitMode === 'BY_PERCENTAGE'
          ? Math.round(shares * 100)
          : Math.round(shares),
  }))

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
    saveDefaultSplittingOptions:
      values.splitMode === 'ITEMIZED'
        ? false
        : values.saveDefaultSplittingOptions,
    isReimbursement: values.isReimbursement,
    documents: values.documents,
    notes: values.notes,
    recurrenceRule: values.recurrenceRule,
    conversionRate: values.conversionRate,
  }

  const items: Expense['items'] = (values.items ?? []).map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity))
    const unitPriceMinor = amountAsMinorUnits(item.unitPrice, inputCurrency)
    const lineAmountMinor = unitPriceMinor * quantity
    const paidFor = item.paidFor.map(({ participant, shares }) => ({
      participant,
      shares:
        item.splitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(shares, inputCurrency)
          : item.splitMode === 'BY_PERCENTAGE'
            ? Math.round(shares * 100)
            : Math.round(shares),
    }))
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
    values.itemizedRemainder
      ? {
          splitMode: values.itemizedRemainder.splitMode,
          paidFor: values.itemizedRemainder.paidFor.map(
            ({ participant, shares }) => ({
              participant,
              shares:
                values.itemizedRemainder?.splitMode === 'BY_AMOUNT'
                  ? amountAsMinorUnits(shares, inputCurrency)
                  : values.itemizedRemainder?.splitMode === 'BY_PERCENTAGE'
                    ? Math.round(shares * 100)
                    : Math.round(shares),
            }),
          ),
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

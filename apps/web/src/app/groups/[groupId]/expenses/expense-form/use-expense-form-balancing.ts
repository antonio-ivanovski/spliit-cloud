import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'

/**
 * Compatibility seam for callers that still pass the former manual-edit
 * callbacks. Visual split editors now commit a complete, balanced allocation
 * atomically, so no effect-driven rebalancing is needed.
 */
export function useExpenseFormBalancing(_args: {
  form: UseFormReturn<ExpenseFormInputValues>
  payerCurrency: Currency
}): {
  setManuallyEditedParticipants: React.Dispatch<
    React.SetStateAction<Set<string>>
  >
  setManuallyEditedPayers: React.Dispatch<React.SetStateAction<Set<string>>>
} {
  const noOp = useCallback<
    React.Dispatch<React.SetStateAction<Set<string>>>
  >(() => {}, [])
  return {
    setManuallyEditedParticipants: noOp,
    setManuallyEditedPayers: noOp,
  }
}

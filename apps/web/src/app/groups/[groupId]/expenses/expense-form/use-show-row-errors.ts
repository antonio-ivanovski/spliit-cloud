import { useFormState, type UseFormReturn } from 'react-hook-form'

import type { ExpenseFormInputValues } from '@spliit/domain'

/**
 * Gate for the row-error summary: the summary recomputes errors from live
 * values, so without a gate it would announce errors on every keystroke. It
 * shows only once the card has been interacted with (a share row blurred) or
 * the form was submitted.
 *
 * Scoped `useFormState` is RHF's supported isolated UI-subscription pattern —
 * `form.subscribe()` is meant for non-rendering side effects, and the explicit
 * state + effect pair it replaced can race render timing. `touchedFields` for
 * an array field arrives in two shapes:
 *
 * - `true` — a whole-array `setValue(..., { shouldTouch: true })` (mode switches,
 *   select all/none, balancing): programmatic, not a share-row edit.
 * - An array (`[{ shares: true }, …]`) — a nested share input blurred.
 *
 * "Touched" deliberately means a blur: per-row `FormMessage`s already surface
 * errors while typing, and the all-rows summary should not flash
 * mid-keystroke.
 */
export function useShowRowErrors(
  form: UseFormReturn<ExpenseFormInputValues>,
  fieldName: 'paidFor' | 'paidByList',
): boolean {
  const { isSubmitted, touchedFields } = useFormState({
    control: form.control,
    name: fieldName,
  })
  const touchedRows = touchedFields[fieldName]
  const anyRowTouched =
    Array.isArray(touchedRows) &&
    touchedRows.some((row) => !!row && (row as { shares?: boolean }).shares)
  return !!isSubmitted || anyRowTouched
}

import { Button } from '@/components/ui/button'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { GroupShape } from '../default-values'
import { savedDefaultToFormValues } from '../default-values'
import type { SavedSplit } from './split-equal'

/**
 * Renders a "Load default split" link button. Visible when a saved
 * default exists and the live form state differs from it. Clicking
 * replaces the form's `splitMode` + `paidFor` with the saved values
 * (already converted to display units by `savedDefaultToFormValues`),
 * and marks the form dirty so the surrounding Submit button activates.
 *
 * The button is intentionally a single `Button variant="link"` so it
 * sits next to "Select all/None" without competing for vertical space
 * inside the card header.
 */
export function LoadDefaultButton(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: GroupShape
  groupCurrency: Currency
  savedDefault: SavedSplit
}) {
  const { form, group, groupCurrency, savedDefault } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const onClick = () => {
    const restored = savedDefaultToFormValues(
      savedDefault,
      group,
      groupCurrency,
    )
    if (!restored) return
    form.setValue('splitMode', restored.splitMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidFor', restored.paidFor, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
  }

  return (
    <Button
      variant="link"
      type="button"
      className="-my-2 -mx-4"
      onClick={onClick}
    >
      {t('DefaultSplit.load')}
    </Button>
  )
}

import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { GroupShape } from '../default-values'
import { LoadDefaultButton } from './load-default-button'
import { SaveDefaultButton } from './save-default-button'
import { splitEqual, type SavedSplit } from './split-equal'

/**
 * Renders the Load / Save default-split affordances for the PaidFor
 * card. Both buttons live in the card header — together they form a
 * small pair of link-style actions next to "Select all/None".
 *
 * Visibility rules:
 * - `readOnly` → nothing renders.
 * - `splitMode === 'ITEMIZED'` → nothing renders (itemized splits
 *   cannot be saved as defaults and "loading" one would lose the
 *   items array anyway).
 * - Load button renders only when a `savedDefault` exists and the
 *   current form split diverges from it.
 * - Save button renders when the current split is not itemized and
 *   diverges from the saved default (or no saved default exists).
 */
export function DefaultSplitActions(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: GroupShape
  groupCurrency: Currency
  savedDefault: SavedSplit | null
  readOnly: boolean
}) {
  const { form, group, groupCurrency, savedDefault, readOnly } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const splitMode = useWatch({
    control: form.control,
    name: 'splitMode',
  }) as SplitMode
  const paidFor = useWatch({
    control: form.control,
    name: 'paidFor',
  })

  if (readOnly) return null
  if (splitMode === 'ITEMIZED') return null

  const current = splitEqual(splitMode, paidFor, savedDefault, groupCurrency)

  // Save is hidden when the live state already matches the saved
  // default — the affordance is redundant in that case. It is also
  // hidden when there is no saved default and the current split is
  // the neutral default (EVENLY over all participants) so users do
  // not see "Save default" against the empty initial state of a
  // brand-new group.
  const showSave = !current

  // Load is only useful when a saved default exists and the live
  // state has diverged from it.
  const showLoad = !!savedDefault && !current

  if (!showSave && !showLoad) return null

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide">
        {t('DefaultSplit.heading')}
      </span>
      <div className="flex items-center gap-1">
        {showLoad && (
          <LoadDefaultButton
            form={form}
            group={group}
            groupCurrency={groupCurrency}
            savedDefault={savedDefault}
          />
        )}
        {showLoad && showSave && (
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
        )}
        {showSave && (
          <SaveDefaultButton
            form={form}
            group={group}
            groupCurrency={groupCurrency}
          />
        )}
      </div>
    </div>
  )
}

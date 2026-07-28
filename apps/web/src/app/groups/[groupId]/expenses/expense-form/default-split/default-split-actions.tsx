import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'

import type { GroupShape } from '../default-values'
import { LoadDefaultButton } from './load-default-button'
import { SaveDefaultButton } from './save-default-button'
import { splitEqual, type SavedSplit } from './split-equal'

/**
 * Renders the Load / Save default-split affordances for the PaidFor card. Both
 * buttons live in the card header — together they form a small pair of
 * link-style actions next to "Select all/None".
 *
 * Visibility rules: - `readOnly` → nothing renders. - Load button renders
 * whenever a `savedDefault` exists. In ITEMIZED mode this is the only available
 * action (Save is disallowed for itemized splits at the API level). - Save
 * button renders when the current split is not itemized and diverges from the
 * saved default (or no saved default exists).
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

  const current = splitEqual(splitMode, paidFor, savedDefault, groupCurrency)

  // Save is hidden when the live state already matches the saved
  // default — the affordance is redundant in that case. It is also
  // hidden in ITEMIZED mode (the API rejects itemized defaults).
  const showSave = splitMode !== 'ITEMIZED' && !current

  // Load is only useful when a saved default exists. Shown even in
  // ITEMIZED mode so users can pull a non-itemized default back in.
  const showLoad = !!savedDefault && !current

  if (!showSave && !showLoad) return null

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="tracking-wide uppercase">
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

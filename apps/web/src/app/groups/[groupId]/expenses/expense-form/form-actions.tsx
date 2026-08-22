import { Link } from '@tanstack/react-router'
import { Save } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { DeletePopup } from '@/components/delete-popup'
import { FixedActionBar } from '@/components/fixed-action-bar'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import type { ExpenseCancelLink } from '@/lib/expense-navigation'

import { expenseTabPriority } from './focus-navigation'

/**
 * Memoized: the action bar must not re-render on every form value change; only
 * `SubmitButton` subscribes to the submitting state (via useFormState).
 */
export const FormActions = memo(function FormActions(props: {
  isCreate: boolean
  readOnly: boolean
  onDelete?: () => Promise<void>
  expenseTitle?: string
  cancelLink: ExpenseCancelLink
  /**
   * Persisted terminal state: the expense already exists, so the submit action
   * must be disabled to prevent a duplicate save.
   */
  submitDisabled?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  if (props.readOnly) {
    return (
      <FixedActionBar>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link {...props.cancelLink} />}
        >
          {t('cancel')}
        </Button>
      </FixedActionBar>
    )
  }

  return (
    <FixedActionBar>
      {!props.isCreate && props.onDelete && (
        <DeletePopup
          onDelete={() => props.onDelete!()}
          confirmationTarget={props.expenseTitle}
          className="me-auto"
        />
      )}
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link {...props.cancelLink} />}
      >
        {t('cancel')}
      </Button>
      <SubmitButton
        data-expense-tab-priority={expenseTabPriority.submit}
        disabled={props.submitDisabled}
        loadingContent={t(props.isCreate ? 'creating' : 'saving')}
      >
        <Save className="me-2 h-4 w-4" />
        {t(props.isCreate ? 'create' : 'save')}
      </SubmitButton>
    </FixedActionBar>
  )
})

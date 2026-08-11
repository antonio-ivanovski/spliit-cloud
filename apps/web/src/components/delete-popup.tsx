import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isTypedConfirmationMatch,
  TypedDestructiveConfirmation,
  useTypedConfirmationValue,
} from '@/components/typed-destructive-confirmation'
import { cn } from '@/lib/utils'

import { AsyncButton } from './async-button'
import { Button } from './ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './ui/responsive-dialog'

type Props = {
  onDelete: () => Promise<void>
  className?: string
  /**
   * Customize every visible string. Defaults match the legacy
   * `ExpenseForm.DeletePopup` strings so existing callers keep working.
   */
  labels?: {
    label?: string
    title?: string
    description?: string
    yes?: string
    deleting?: string
    cancel?: string
  }
  /** When provided, the destructive action requires typing this exact name. */
  confirmationTarget?: string
}

export function DeletePopup({
  onDelete,
  className,
  labels,
  confirmationTarget,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.DeletePopup',
  })
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationValue, setConfirmationValue] = useTypedConfirmationValue(
    `${open}:${confirmationTarget ?? ''}`,
  )
  const requiresConfirmation = confirmationTarget != null
  const canDelete =
    !requiresConfirmation ||
    isTypedConfirmationMatch(confirmationValue, confirmationTarget)

  async function confirmDelete() {
    if (!canDelete || submitting) return
    setSubmitting(true)
    try {
      await onDelete()
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return
        setOpen(nextOpen)
      }}
    >
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              'border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive',
              className,
            )}
          >
            <Trash2 className="h-4 w-4 min-[420px]:me-2" />
            <span className="hidden min-[420px]:inline">
              {labels?.label ?? t('label')}
            </span>
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {labels?.title ?? t('title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {labels?.description ?? t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {requiresConfirmation && confirmationTarget ? (
          <ResponsiveDialogBody>
            <TypedDestructiveConfirmation
              kind="deleteExpense"
              targetName={confirmationTarget}
              value={confirmationValue}
              onValueChange={setConfirmationValue}
              disabled={submitting}
              onConfirm={confirmDelete}
            />
          </ResponsiveDialogBody>
        ) : null}
        <ResponsiveDialogFooter className="flex flex-col gap-2">
          <AsyncButton
            type="button"
            variant="destructive"
            loadingContent={labels?.deleting ?? t('deleting')}
            action={confirmDelete}
            disabled={!canDelete || submitting}
          >
            {labels?.yes ?? t(requiresConfirmation ? 'delete' : 'yes')}
          </AsyncButton>
          <ResponsiveDialogClose
            render={
              <Button variant={'secondary'}>
                {labels?.cancel ?? t('cancel')}
              </Button>
            }
          />
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

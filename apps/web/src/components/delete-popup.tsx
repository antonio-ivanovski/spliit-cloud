import { Trash } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import {
  DestructiveConfirmationSettingsNote,
  isTypedConfirmationMatch,
  TypedDestructiveConfirmation,
  useTypedConfirmationValue,
} from '@/components/typed-destructive-confirmation'
import {
  requiresTypedConfirmation,
  resolveDestructiveConfirmationLevel,
} from '@/lib/account-preferences'
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
  /**
   * When provided, the dialog participates in the typing system: the
   * destructive action requires typing this exact name unless the account's
   * `destructiveConfirmationLevel` is `standard`.
   */
  confirmationTarget?: string
  /**
   * Controlled open state for callers whose trigger lives outside the popup
   * (e.g. a dropdown menu item). When omitted, the popup manages its own
   * trigger and open state.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DeletePopup({
  onDelete,
  className,
  labels,
  confirmationTarget,
  open,
  onOpenChange,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.DeletePopup',
  })
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = open !== undefined
  const dialogOpen = controlled ? open : internalOpen
  const setDialogOpen = (next: boolean) => {
    if (!controlled) setInternalOpen(next)
    onOpenChange?.(next)
  }
  const [submitting, setSubmitting] = useState(false)
  const [confirmationValue, setConfirmationValue] = useTypedConfirmationValue(
    `${dialogOpen}:${confirmationTarget ?? ''}`,
  )
  const preferences = useSyncedAccountPreferences()
  const confirmationLevel = resolveDestructiveConfirmationLevel(
    preferences?.destructiveConfirmationLevel,
  )
  // `confirmationTarget` marks dialogs that participate in the typing system
  // (single-expense deletes). Webhook/budget deletes pass no target and stay
  // a simple confirm with no settings footnote.
  const participatesInTyping = confirmationTarget != null
  const requiresConfirmation =
    participatesInTyping &&
    requiresTypedConfirmation(confirmationLevel, 'deleteExpense')
  const canDelete =
    !requiresConfirmation ||
    isTypedConfirmationMatch(confirmationValue, confirmationTarget)

  async function confirmDelete() {
    if (!canDelete || submitting) return
    setSubmitting(true)
    try {
      await onDelete()
      setDialogOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResponsiveDialog
      open={dialogOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return
        setDialogOpen(nextOpen)
      }}
    >
      {controlled ? null : (
        <ResponsiveDialogTrigger
          render={
            <Button
              variant="outline"
              className={cn(
                'border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive',
                className,
              )}
            >
              <Trash className="h-4 w-4 min-[420px]:me-2" />
              <span className="hidden min-[420px]:inline">
                {labels?.label ?? t('label')}
              </span>
            </Button>
          }
        />
      )}
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
            <div className="mt-3">
              <DestructiveConfirmationSettingsNote />
            </div>
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

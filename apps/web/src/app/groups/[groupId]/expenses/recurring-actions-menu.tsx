import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { cn } from '@/lib/utils'
import { MoreHorizontal, Pencil, Repeat2, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SeriesMutationScope } from './series-scope-dialog'

export type RecurringDeleteOption =
  'OCCURRENCE' | 'THIS_AND_FUTURE' | 'THIS_AND_FUTURE_STOP'

type Action =
  | { kind: 'edit'; scope: SeriesMutationScope }
  | { kind: 'delete'; option: RecurringDeleteOption }
  | { kind: 'stop' }

export function RecurringActionsMenu({
  onEdit,
  onDelete,
  onStop,
  className,
}: {
  onEdit: (scope: SeriesMutationScope) => void
  onDelete: (option: RecurringDeleteOption) => Promise<void>
  onStop?: () => Promise<void>
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Action | null>(null)
  const [confirming, setConfirming] = useState(false)

  const close = () => {
    setOpen(false)
    setPending(null)
    setConfirming(false)
  }

  const choose = (action: Action) => {
    if (action.kind === 'edit') {
      close()
      onEdit(action.scope)
      return
    }
    setPending(action)
  }

  const confirm = async () => {
    if (!pending || confirming) return
    setConfirming(true)
    try {
      if (pending.kind === 'delete') {
        await onDelete(pending.option)
      } else if (onStop) {
        await onStop()
      }
      close()
    } finally {
      setConfirming(false)
    }
  }

  const isDelete = pending?.kind === 'delete'
  const title = pending
    ? isDelete
      ? t('deleteConfirmTitle')
      : t('stopConfirmTitle')
    : t('actionsTitle')
  const description = pending
    ? isDelete
      ? t(`deleteConfirm.${pending.option}`)
      : t('stopConfirmDescription')
    : t('actionsDescription')

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPending(null)
      }}
    >
      <Button
        type="button"
        variant="outline"
        className={cn('sm:min-w-36', className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <MoreHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('actions')}
      </Button>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Repeat2
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            {title}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {!pending ? (
          <ResponsiveDialogBody className="space-y-5">
            <section aria-labelledby="recurring-edit-actions">
              <h3
                id="recurring-edit-actions"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t('editActions')}
              </h3>
              <div className="grid gap-2">
                <ActionButton
                  icon={<Pencil aria-hidden="true" />}
                  label={t('editOccurrence')}
                  description={t('editOccurrenceDescription')}
                  onClick={() => choose({ kind: 'edit', scope: 'OCCURRENCE' })}
                />
                <ActionButton
                  icon={<Pencil aria-hidden="true" />}
                  label={t('editThisAndFuture')}
                  description={t('editThisAndFutureDescription')}
                  onClick={() =>
                    choose({ kind: 'edit', scope: 'THIS_AND_FUTURE' })
                  }
                />
              </div>
            </section>

            <section aria-labelledby="recurring-delete-actions">
              <h3
                id="recurring-delete-actions"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t('deleteActions')}
              </h3>
              <div className="grid gap-2">
                <ActionButton
                  destructive
                  icon={<Trash2 aria-hidden="true" />}
                  label={t('deleteOccurrence')}
                  description={t('deleteOccurrenceDescription')}
                  onClick={() =>
                    choose({ kind: 'delete', option: 'OCCURRENCE' })
                  }
                />
                <ActionButton
                  destructive
                  icon={<Trash2 aria-hidden="true" />}
                  label={t('deleteThisAndFuture')}
                  description={t('deleteThisAndFutureDescription')}
                  onClick={() =>
                    choose({ kind: 'delete', option: 'THIS_AND_FUTURE' })
                  }
                />
                <ActionButton
                  destructive
                  icon={<Trash2 aria-hidden="true" />}
                  label={t('deleteThisAndFutureStop')}
                  description={t('deleteThisAndFutureStopDescription')}
                  onClick={() =>
                    choose({ kind: 'delete', option: 'THIS_AND_FUTURE_STOP' })
                  }
                />
              </div>
            </section>

            {onStop && (
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => choose({ kind: 'stop' })}
              >
                <Repeat2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('stopRecurrence')}
              </Button>
            )}
          </ResponsiveDialogBody>
        ) : (
          <ResponsiveDialogBody className="rounded-md bg-muted/40 px-4 py-3 text-sm">
            {isDelete ? t('deleteConfirmHint') : t('stopConfirmHint')}
          </ResponsiveDialogBody>
        )}

        <ResponsiveDialogFooter className="flex-row gap-2">
          {pending ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="flex-1 sm:flex-none"
                onClick={() => setPending(null)}
              >
                {t('back')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 sm:flex-none"
                onClick={() => void confirm()}
                disabled={confirming}
                aria-busy={confirming}
              >
                {confirming
                  ? t('working')
                  : t(isDelete ? 'confirmDelete' : 'confirmStop')}
              </Button>
            </>
          ) : (
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="secondary" className="w-full">
                {t('cancel')}
              </Button>
            </ResponsiveDialogClose>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ActionButton({
  icon,
  label,
  description,
  destructive,
  onClick,
}: {
  icon: ReactNode
  label: string
  description: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'h-auto min-h-12 items-start justify-start gap-3 whitespace-normal px-3 py-2.5 text-left',
        destructive &&
          'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
      )}
      onClick={onClick}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </Button>
  )
}

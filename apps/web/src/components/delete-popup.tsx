import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { AsyncButton } from './async-button'
import { Button } from './ui/button'
import {
  ResponsiveDialog,
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
}

export function DeletePopup({ onDelete, className, labels }: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.DeletePopup',
  })
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive',
            className,
          )}
        >
          <Trash2 className="h-4 w-4 min-[420px]:mr-2" />
          <span className="hidden min-[420px]:inline">
            {labels?.label ?? t('label')}
          </span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {labels?.title ?? t('title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {labels?.description ?? t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className="flex flex-col gap-2">
          <AsyncButton
            type="button"
            variant="destructive"
            loadingContent={labels?.deleting ?? t('deleting')}
            action={onDelete}
          >
            {labels?.yes ?? t('yes')}
          </AsyncButton>
          <ResponsiveDialogClose asChild>
            <Button variant={'secondary'}>
              {labels?.cancel ?? t('cancel')}
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

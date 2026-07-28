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

export function DeletePopup({
  onDelete,
  className,
}: {
  onDelete: () => Promise<void>
  className?: string
}) {
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
          <span className="hidden min-[420px]:inline">{t('label')}</span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className="flex flex-col gap-2">
          <AsyncButton
            type="button"
            variant="destructive"
            loadingContent={t('deleting')}
            action={onDelete}
          >
            {t('yes')}
          </AsyncButton>
          <ResponsiveDialogClose asChild>
            <Button variant={'secondary'}>{t('cancel')}</Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

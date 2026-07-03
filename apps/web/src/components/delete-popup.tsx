import { cn } from '@/lib/utils'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AsyncButton } from './async-button'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

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
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive',
            className,
          )}
        >
          <Trash2 className="w-4 h-4 min-[420px]:mr-2" />
          <span className="hidden min-[420px]:inline">{t('label')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <DialogFooter className="flex flex-col gap-2">
          <AsyncButton
            type="button"
            variant="destructive"
            loadingContent="Deleting…"
            action={onDelete}
          >
            {t('yes')}
          </AsyncButton>
          <DialogClose asChild>
            <Button variant={'secondary'}>{t('cancel')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

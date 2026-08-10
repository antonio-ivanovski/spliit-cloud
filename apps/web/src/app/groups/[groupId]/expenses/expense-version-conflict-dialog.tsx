import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'

export function ExpenseVersionConflictDialog({
  open,
  onKeepDraft,
  onReload,
}: {
  open: boolean
  onKeepDraft: () => void
  onReload: () => void | Promise<void>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm.Expense' })
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onKeepDraft()}
    >
      <ResponsiveDialogContent showCloseButton={false}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('conflictTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('conflictDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onKeepDraft}>
            {t('conflictKeepDraft')}
          </Button>
          <Button onClick={onReload}>{t('conflictReload')}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

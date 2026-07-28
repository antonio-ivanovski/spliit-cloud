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

export function LeaveItemizedDialog(props: {
  open: boolean
  targetModeLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { open, targetModeLabel, onCancel, onConfirm } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('leaveItemized.title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('leaveItemized.description', { mode: targetModeLabel })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t('leaveItemized.cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('leaveItemized.confirm')}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

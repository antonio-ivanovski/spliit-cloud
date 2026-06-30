import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'

export function LeaveItemizedDialog(props: {
  open: boolean
  targetModeLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { open, targetModeLabel, onCancel, onConfirm } = props
  const { t: _t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const t = (key: string, opts?: Record<string, unknown>) =>
    _t(key as any, opts) as string

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaveItemized.title')}</DialogTitle>
          <DialogDescription>
            {t('leaveItemized.description', { mode: targetModeLabel })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t('leaveItemized.cancel')}
          </Button>
          <Button onClick={onConfirm}>
            {t('leaveItemized.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

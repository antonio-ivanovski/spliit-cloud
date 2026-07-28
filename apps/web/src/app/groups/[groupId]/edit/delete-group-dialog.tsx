import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'

export function DeleteGroupDialog({
  open,
  groupName,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  groupName: string
  deleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const [confirmChecked, setConfirmChecked] = useState(false)

  if (!open && confirmChecked) {
    setConfirmChecked(false)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && deleting) return
        onOpenChange(next)
      }}
    >
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('delete.dialog.title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('delete.dialog.description', { name: groupName })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <div className="flex flex-col gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <div className="flex items-start gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('delete.dialog.warningTitle')}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('delete.dialog.warningDescription')}
            </p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              <li>{t('delete.dialog.warningList.expenses')}</li>
              <li>{t('delete.dialog.warningList.activity')}</li>
              <li>{t('delete.dialog.warningList.invitations')}</li>
              <li>{t('delete.dialog.warningList.receipts')}</li>
            </ul>
            <label className="flex cursor-pointer items-start gap-2 pt-1 text-sm">
              <Checkbox
                checked={confirmChecked}
                onCheckedChange={(checked) =>
                  setConfirmChecked(checked === true)
                }
                disabled={deleting}
                className="mt-0.5"
              />
              <span>{t('delete.dialog.checkbox')}</span>
            </label>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t('delete.dialog.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!confirmChecked || deleting}
          >
            {deleting
              ? t('delete.dialog.deleting')
              : t('delete.dialog.confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

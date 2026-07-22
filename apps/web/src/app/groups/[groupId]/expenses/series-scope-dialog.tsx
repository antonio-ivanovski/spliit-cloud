import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SeriesMutationScope = 'OCCURRENCE' | 'THIS_AND_FUTURE'

export function SeriesScopeDialog({
  open,
  mode,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  mode: 'update' | 'delete'
  onOpenChange: (open: boolean) => void
  onConfirm: (scope: SeriesMutationScope) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const [scope, setScope] = useState<SeriesMutationScope>('OCCURRENCE')
  const isDelete = mode === 'delete'

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t(isDelete ? 'deleteScopeTitle' : 'scopeTitle')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t(isDelete ? 'deleteScopeDescription' : 'scopeDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <RadioGroup
          value={scope}
          onValueChange={(value) => setScope(value as SeriesMutationScope)}
          aria-label={t(isDelete ? 'deleteScopeTitle' : 'scopeTitle')}
        >
          <RadioGroupItem value="OCCURRENCE" card>
            <div>
              <div className="font-medium">
                {t(isDelete ? 'deleteOccurrence' : 'occurrenceOnly')}
              </div>
            </div>
          </RadioGroupItem>
          <RadioGroupItem value="THIS_AND_FUTURE" card>
            <div>
              <div className="font-medium">
                {t(isDelete ? 'deleteThisAndFuture' : 'thisAndFuture')}
              </div>
            </div>
          </RadioGroupItem>
        </RadioGroup>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            variant={isDelete ? 'destructive' : 'default'}
            onClick={() => onConfirm(scope)}
          >
            {t('confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

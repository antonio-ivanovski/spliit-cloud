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
export type SeriesDeleteOption =
  'OCCURRENCE' | 'THIS_AND_FUTURE' | 'THIS_AND_FUTURE_STOP'

export function SeriesScopeDialog({
  open,
  mode,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  mode: 'update' | 'delete'
  onOpenChange: (open: boolean) => void
  onConfirm: (scope: SeriesMutationScope, stopRecurrence?: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const [scope, setScope] = useState<SeriesDeleteOption>('OCCURRENCE')
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
          onValueChange={(value) => setScope(value as SeriesDeleteOption)}
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
          {isDelete && (
            <RadioGroupItem value="THIS_AND_FUTURE_STOP" card>
              <div>
                <div className="font-medium">
                  {t('deleteThisAndFutureStop')}
                </div>
              </div>
            </RadioGroupItem>
          )}
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
            onClick={() =>
              onConfirm(
                scope === 'THIS_AND_FUTURE_STOP' ? 'THIS_AND_FUTURE' : scope,
                scope === 'THIS_AND_FUTURE_STOP',
              )
            }
          >
            {t('confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

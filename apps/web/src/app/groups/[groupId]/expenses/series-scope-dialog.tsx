import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isTypedConfirmationMatch,
  TypedDestructiveConfirmation,
  useTypedConfirmationValue,
} from '@/components/typed-destructive-confirmation'
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

export type SeriesMutationScope = 'OCCURRENCE' | 'THIS_AND_FUTURE'
export type SeriesDeleteOption =
  | 'OCCURRENCE'
  | 'THIS_AND_FUTURE'
  | 'THIS_AND_FUTURE_STOP'

export function SeriesScopeDialog({
  open,
  mode,
  onOpenChange,
  onConfirm,
  seriesStatus,
  confirmationTarget,
}: {
  open: boolean
  mode: 'update' | 'delete'
  onOpenChange: (open: boolean) => void
  onConfirm: (scope: SeriesMutationScope, stopRecurrence?: boolean) => void
  /** Series status; CANCELLED/COMPLETED hide the stop-recurrence radio. */
  seriesStatus?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  confirmationTarget: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const [scope, setScope] = useState<SeriesDeleteOption>('OCCURRENCE')
  const [confirmationValue, setConfirmationValue] = useTypedConfirmationValue(
    `${open}:${mode}:${confirmationTarget}`,
  )
  const isDelete = mode === 'delete'
  const isTerminal =
    seriesStatus === 'CANCELLED' || seriesStatus === 'COMPLETED'
  const canConfirm =
    !isDelete || isTypedConfirmationMatch(confirmationValue, confirmationTarget)

  function confirmScope() {
    if (!canConfirm) return
    onConfirm(
      scope === 'THIS_AND_FUTURE_STOP' ? 'THIS_AND_FUTURE' : scope,
      scope === 'THIS_AND_FUTURE_STOP',
    )
  }

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
          {isDelete && !isTerminal && (
            <RadioGroupItem value="THIS_AND_FUTURE_STOP" card>
              <div>
                <div className="font-medium">
                  {t('deleteThisAndFutureStop')}
                </div>
              </div>
            </RadioGroupItem>
          )}
        </RadioGroup>
        {isDelete ? (
          <TypedDestructiveConfirmation
            kind="deleteRecurringExpense"
            targetName={confirmationTarget}
            value={confirmationValue}
            onValueChange={setConfirmationValue}
            onConfirm={confirmScope}
          />
        ) : null}
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
            onClick={confirmScope}
            disabled={!canConfirm}
          >
            {t('confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

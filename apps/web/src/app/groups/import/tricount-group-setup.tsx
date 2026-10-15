import { CheckCircle2, ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import type { NormalizedSource } from '@spliit/domain/import'

type Props = {
  sources: NormalizedSource[]
  selectedSourceIds: ReadonlySet<string>
  completedSourceIds?: ReadonlyArray<string>
  isApplying: boolean
  error: string | null
  onToggleSource: (sourceId: string, checked: boolean) => void
  onContinue: () => void
  onChooseAnother?: () => void
}

/**
 * Group picker for multi-group Tricount dumps. Mirrors the Cloud
 * `AccountImportSetup` checklist: one row per group with participant and
 * expense counts, completed groups disabled, continue starting the queue.
 */
export function TricountGroupSetup({
  sources,
  selectedSourceIds,
  completedSourceIds = [],
  isApplying,
  error,
  onToggleSource,
  onContinue,
  onChooseAnother,
}: Props) {
  const { t } = useTranslation()
  const completed = new Set(completedSourceIds)
  const selectable = sources.filter((s) => !completed.has(s.sourceGroupId))
  const selectedCount = sources.filter(
    (s) =>
      selectedSourceIds.has(s.sourceGroupId) && !completed.has(s.sourceGroupId),
  ).length

  return (
    <Card>
      <CardContent spacing="standalone" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {t('Groups.Import.Source.tricountMultiTitle', {
                count: sources.length,
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Source.tricountMultiDescription')}
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {sources.map((source) => {
            const done = completed.has(source.sourceGroupId)
            const checked = selectedSourceIds.has(source.sourceGroupId)
            return (
              <li
                key={source.sourceGroupId}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <Checkbox
                  checked={done || checked}
                  disabled={done || isApplying}
                  onCheckedChange={(value) =>
                    onToggleSource(source.sourceGroupId, value === true)
                  }
                  aria-label={source.name}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {source.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('Groups.Import.Source.tricountGroupStats', {
                      participants: source.participants.length,
                      expenses: source.expenses.length,
                      currency: source.currencyCode ?? source.currency,
                    })}
                  </span>
                </div>
                {done && (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-green-500"
                    aria-hidden="true"
                  />
                )}
              </li>
            )
          })}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={isApplying || selectedCount === 0}
            onClick={onContinue}
          >
            {t('Groups.Import.Source.tricountMultiContinue', {
              count: selectedCount,
            })}
          </Button>
          {selectable.length !== sources.length && (
            <span className="text-xs text-muted-foreground">
              {t('Groups.Import.Source.tricountMultiSelected', {
                selected: selectedCount,
                total: selectable.length,
              })}
            </span>
          )}
          {onChooseAnother && (
            <Button
              type="button"
              variant="ghost"
              disabled={isApplying}
              onClick={onChooseAnother}
            >
              {t('ExpenseImport.wizard.chooseAnotherFile')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

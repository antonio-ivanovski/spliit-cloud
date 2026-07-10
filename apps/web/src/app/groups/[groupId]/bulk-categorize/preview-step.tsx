import { CategorySelector } from '@/components/category-selector'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { WizardNav } from '@/components/wizard'
import { DEFAULT_CATEGORIES, type CategoryId } from '@spliit/domain'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PreviewRow } from './bulk-categorize-wizard-state'
import { ConfidenceBadge } from './category-field'

export function PreviewStep(props: {
  rows: PreviewRow[]
  total: number
  error?: string
  isGenerating: boolean
  isSaving: boolean
  onGenerate: () => void
  onEdit: (expenseId: string, categoryId: CategoryId) => void
  onInclude: (expenseId: string, included: boolean) => void
  onSave: () => void
  onBack: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const included = props.rows.filter((row) => row.included).length
  const uncategorized = Math.max(props.total - props.rows.length, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('previewTitle')}</CardTitle>
        <CardDescription>{t('previewDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.error && (
          <p className="text-sm text-destructive">
            {t('previewError', { message: props.error })}
          </p>
        )}
        {props.isGenerating && (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('generatingPreview')}
          </p>
        )}
        {!props.isGenerating && props.rows.length === 0 && !props.error && (
          <p className="text-sm text-muted-foreground">{t('noSuggestions')}</p>
        )}
        {props.rows.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('previewSummary', {
                suggested: props.rows.length,
                total: props.total,
              })}
            </p>
            {uncategorized > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('leftUncategorized', { count: uncategorized })}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <div className="min-w-[34rem]">
                <div className="grid grid-cols-[minmax(0,1fr)_12rem_7.5rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>{t('expenseColumn')}</span>
                  <span>{t('categoryColumn')}</span>
                  <span className="text-center">{t('confidenceColumn')}</span>
                </div>
                <div className="divide-y">
                  {props.rows.map((row) => {
                    const value =
                      row.overrideCategoryId ?? row.suggestedCategoryId
                    const checkboxId = `include-expense-${row.expenseId}`
                    return (
                      <div
                        key={row.expenseId}
                        className="grid grid-cols-[minmax(0,1fr)_12rem_7.5rem] items-center gap-3 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Checkbox
                            id={checkboxId}
                            checked={row.included}
                            onCheckedChange={(checked) =>
                              props.onInclude(row.expenseId, checked === true)
                            }
                            aria-label={t('removeAction')}
                            className="shrink-0"
                          />
                          <label
                            htmlFor={checkboxId}
                            className="min-w-0 cursor-pointer truncate text-sm"
                          >
                            {row.title}
                          </label>
                        </div>
                        <CategorySelector
                          categories={DEFAULT_CATEGORIES}
                          defaultValue={value}
                          onValueChange={(categoryId) =>
                            props.onEdit(row.expenseId, categoryId)
                          }
                          isLoading={false}
                        />
                        <ConfidenceBadge confidence={row.confidence} />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
      <CardFooter>
        <WizardNav
          back={{ label: t('backToCalibration'), onClick: props.onBack }}
          continue={
            props.rows.length > 0
              ? {
                  label: props.isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('saving')}
                    </>
                  ) : (
                    t('saveAll', { count: included })
                  ),
                  onClick: props.onSave,
                  disabled: props.isSaving || included === 0,
                }
              : undefined
          }
        />
        {props.rows.length === 0 && !props.isGenerating && (
          <Button className="ml-auto" type="button" onClick={props.onGenerate}>
            {t('retryPreview')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

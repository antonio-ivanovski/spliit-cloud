import { Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import { WizardNav } from '@/components/wizard'
import { DEFAULT_CATEGORIES, type CategoryId } from '@spliit/domain'

import type { CalibrationSelection } from './bulk-categorize-wizard-state'
import { ConfidenceBadge } from './category-field'

export function CalibrationStep(props: {
  selections: CalibrationSelection[]
  edits: Record<string, CategoryId>
  round: number
  ready: boolean
  error?: string
  isPending: boolean
  onEdit: (expenseId: string, categoryId: CategoryId) => void
  onSubmitReview: () => void
  onContinue: () => void
  onBack: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const hasSample = props.selections.length > 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('calibrationTitle')}</CardTitle>
        <CardDescription>{t('calibrationDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.error && (
          <p className="text-sm text-destructive">
            {t('calibrationError', { message: props.error })}
          </p>
        )}
        {props.round === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('calibrationStartHint')}
          </p>
        )}
        {props.ready ? (
          <p className="text-sm text-muted-foreground">
            {t('calibrationReady')}
          </p>
        ) : hasSample ? (
          <div className="overflow-x-auto rounded-md border">
            <div className="min-w-[34rem]">
              <div className="grid grid-cols-[minmax(0,1fr)_12rem_7.5rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{t('reviewSample')}</span>
                <span>{t('categoryColumn')}</span>
                <span className="text-center">{t('confidenceColumn')}</span>
              </div>
              <div className="divide-y">
                {props.selections.map((selection) => {
                  const value =
                    props.edits[selection.expenseId] ??
                    selection.suggestedCategoryId
                  return (
                    <div
                      key={selection.expenseId}
                      className="grid grid-cols-[minmax(0,1fr)_12rem_7.5rem] items-center gap-3 p-3"
                    >
                      <p className="truncate text-sm font-medium">
                        {selection.title}
                      </p>
                      <CategorySelector
                        categories={DEFAULT_CATEGORIES}
                        defaultValue={value}
                        onValueChange={(categoryId) =>
                          props.onEdit(selection.expenseId, categoryId)
                        }
                        isLoading={false}
                      />
                      <ConfidenceBadge confidence={selection.confidence} />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : props.round > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('calibrationNoSample')}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        {props.ready ? (
          <WizardNav
            back={{ label: t('back'), onClick: props.onBack }}
            continue={{
              label: t('continueToPreview'),
              onClick: props.onContinue,
            }}
          />
        ) : (
          <div className="ml-auto">
            <Button
              type="button"
              onClick={props.onSubmitReview}
              disabled={props.isPending}
            >
              {props.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {props.round === 0
                ? t('categorizeSample')
                : t('submitReviewedExamples')}
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { WizardStepHeader } from '@/components/wizard'
import { useLocale } from '@/i18n/react'
import { trpc } from '@/trpc/client'
import { DEFAULT_CATEGORY_ID } from '@spliit/domain'

import {
  bulkCategorizeWizardReducer,
  initialBulkCategorizeWizardState,
  type PreviewRow,
  type PriorSelection,
} from './bulk-categorize-wizard-state'
import { CalibrationStep } from './calibration-step'
import { DoneStep } from './done-step'
import { IntroStep } from './intro-step'
import { PreviewStep } from './preview-step'

export type BulkCategorizePageProps = {
  groupId: string
  groupName: string
  blockedReason?: 'admin' | 'archived' | 'feature' | null
}

export function BulkCategorizePage(props: BulkCategorizePageProps) {
  const { t: _t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const locale = useLocale()
  const [state, dispatch] = useReducer(
    bulkCategorizeWizardReducer,
    initialBulkCategorizeWizardState,
  )
  const [calibrationError, setCalibrationError] = useState<string>()
  const [previewError, setPreviewError] = useState<string>()
  const listQuery = trpc.ai.bulkCategorize.listCandidates.useQuery(
    { groupId: props.groupId },
    { enabled: !props.blockedReason },
  )
  const calibrateMutation = trpc.ai.bulkCategorize.calibrate.useMutation()
  const previewMutation = trpc.ai.bulkCategorize.preview.useMutation()
  const applyMutation = trpc.groups.expenses.bulkUpdateCategories.useMutation()
  const utils = trpc.useUtils()
  const candidates = listQuery.data?.candidates
  const titleById = useMemo(
    () =>
      new Map(
        (candidates ?? []).map((candidate) => [candidate.id, candidate.title]),
      ),
    [candidates],
  )

  useEffect(() => {
    dispatch({ type: 'RESET' })
  }, [props.groupId])

  function mergedSelections(): PriorSelection[] {
    const merged = new Map(
      state.priorSelections.map((selection) => [
        selection.expenseId,
        selection.categoryId,
      ]),
    )
    for (const selection of state.calibrationSelections) {
      merged.set(
        selection.expenseId,
        state.calibrationEdits[selection.expenseId] ??
          selection.suggestedCategoryId,
      )
    }
    return Array.from(merged, ([expenseId, categoryId]) => ({
      expenseId,
      categoryId,
    }))
  }

  async function runCalibration() {
    setCalibrationError(undefined)
    const priorSelections = mergedSelections()
    try {
      const result = await calibrateMutation.mutateAsync({
        groupId: props.groupId,
        round: state.calibrationRound + 1,
        ...(locale ? { locale } : {}),
        priorSelections,
      })
      dispatch({
        type: 'CALIBRATION_RECEIVED',
        priorSelections,
        ready: !result.response.needsFeedback,
        selections: result.response.selections.map((selection) => ({
          ...selection,
          title:
            titleById.get(selection.expenseId) ??
            result.candidates.find(
              (candidate) => candidate.id === selection.expenseId,
            )?.title ??
            selection.expenseId,
        })),
      })
    } catch (error) {
      setCalibrationError(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async function openPreview() {
    setPreviewError(undefined)
    dispatch({ type: 'OPEN_PREVIEW' })
    const priorSelections = mergedSelections()
    try {
      const response = await previewMutation.mutateAsync({
        groupId: props.groupId,
        ...(locale ? { locale } : {}),
        priorSelections,
      })
      const seen = new Set<string>()
      const rows: PreviewRow[] = response.suggestions.flatMap((suggestion) => {
        if (seen.has(suggestion.expenseId)) return []
        seen.add(suggestion.expenseId)
        return [
          {
            ...suggestion,
            title: titleById.get(suggestion.expenseId) ?? suggestion.expenseId,
            overrideCategoryId: null,
            included: true,
          },
        ]
      })
      dispatch({
        type: 'PREVIEW_RECEIVED',
        rows,
        total: response.targetIds.length,
      })
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
    }
  }

  async function savePreview() {
    const changes = state.previewRows.flatMap((row) =>
      row.included
        ? [
            {
              expenseId: row.expenseId,
              categoryId: row.overrideCategoryId ?? row.suggestedCategoryId,
            },
          ]
        : [],
    )
    if (changes.length === 0) return
    try {
      const result = await applyMutation.mutateAsync({
        groupId: props.groupId,
        fromCategoryId: DEFAULT_CATEGORY_ID,
        changes,
      })
      dispatch({ type: 'SAVED', applied: result.applied })
      await Promise.all([
        utils.groups.expenses.list.invalidate({ groupId: props.groupId }),
        listQuery.refetch(),
      ])
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
    }
  }

  const content = props.blockedReason ? (
    <BlockedCard reason={props.blockedReason} />
  ) : state.step === 'intro' ? (
    <IntroStep
      totalEligible={listQuery.data?.totalEligible ?? 0}
      isLoading={listQuery.isLoading}
      onStart={() => {
        dispatch({ type: 'START' })
        void runCalibration()
      }}
    />
  ) : state.step === 'calibration' ? (
    <CalibrationStep
      selections={state.calibrationSelections}
      edits={state.calibrationEdits}
      round={state.calibrationRound}
      ready={state.calibrationReady}
      error={calibrationError}
      isPending={calibrateMutation.isPending}
      onEdit={(expenseId, categoryId) =>
        dispatch({ type: 'CALIBRATION_EDITED', expenseId, categoryId })
      }
      onSubmitReview={() => void runCalibration()}
      onContinue={() => void openPreview()}
      onBack={() => dispatch({ type: 'RESET' })}
    />
  ) : state.step === 'preview' ? (
    <PreviewStep
      rows={state.previewRows}
      total={state.previewTotal}
      error={previewError}
      isGenerating={previewMutation.isPending}
      isSaving={applyMutation.isPending}
      onGenerate={() => void openPreview()}
      onEdit={(expenseId, categoryId) =>
        dispatch({ type: 'PREVIEW_EDITED', expenseId, categoryId })
      }
      onInclude={(expenseId, included) =>
        dispatch({ type: 'PREVIEW_INCLUDED', expenseId, included })
      }
      onSave={() => void savePreview()}
      onBack={() => dispatch({ type: 'BACK_TO_CALIBRATION' })}
    />
  ) : (
    <DoneStep groupId={props.groupId} applied={state.savedApplied ?? 0} />
  )

  return (
    <PageShell groupId={props.groupId} groupName={props.groupName}>
      {content}
    </PageShell>
  )
}

function BlockedCard(props: {
  reason: NonNullable<BulkCategorizePageProps['blockedReason']>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const title =
    props.reason === 'admin'
      ? t('adminsOnly')
      : props.reason === 'archived'
        ? t('archived')
        : t('requiresFeatureFlag')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {props.reason === 'feature' && (
          <CardDescription>
            <code className="text-xs">PUBLIC_ENABLE_BULK_CATEGORIZE</code>
          </CardDescription>
        )}
      </CardHeader>
    </Card>
  )
}

function PageShell(props: {
  groupId: string
  groupName: string
  children: React.ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
          render={<Link href={`/groups/${props.groupId}/edit`} />}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('backToSettings')}
        </Button>
        <WizardStepHeader
          eyebrow={props.groupName}
          title={t('title')}
          description={t('description')}
        />
      </div>
      {props.children}
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { WizardStepHeader } from '@/components/wizard'
import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { DEFAULT_CATEGORY_ID, type CategoryId } from '@spliit/domain'

import { getRerunReviewState } from './bulk-categorize-review-state'
import { BulkCategorizeTable } from './bulk-categorize-table'

export type BulkCategorizePageProps = {
  groupId: string
  groupName: string
  blockedReason?: 'admin' | 'archived' | null
}

export function BulkCategorizePage({
  groupId,
  groupName,
  blockedReason,
}: BulkCategorizePageProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const locale = useLocale()
  const [mode, setMode] = useState<'local' | 'jev'>('local')
  const [error, setError] = useState<string | null>(null)
  const { data: features } = trpc.features.get.useQuery()
  const count = trpc.ai.bulkCategorize.count.useQuery(
    { groupId },
    { enabled: !blockedReason },
  )
  const refetchCount = count.refetch
  const status = trpc.ai.bulkCategorize.status.useQuery(
    { groupId },
    {
      enabled: !blockedReason,
      refetchInterval: (query) =>
        [
          'QUEUED',
          'PROCESSING',
          'APPLYING',
          'QUEUED_CALIBRATION',
          'CALIBRATING',
          'QUEUED_RERUN',
          'RERUNNING',
        ].includes(query.state.data?.status ?? '')
          ? 1500
          : false,
    },
  )
  const start = trpc.ai.bulkCategorize.start.useMutation()
  const edit = trpc.ai.bulkCategorize.edit.useMutation()
  const save = trpc.ai.bulkCategorize.save.useMutation()
  const retry = trpc.ai.bulkCategorize.retry.useMutation()
  const discard = trpc.ai.bulkCategorize.discard.useMutation()
  const confirm = trpc.ai.bulkCategorize.confirm.useMutation()
  const rerun = trpc.ai.bulkCategorize.rerun.useMutation()
  const run = status.data
  const pending =
    start.isPending ||
    edit.isPending ||
    save.isPending ||
    retry.isPending ||
    discard.isPending ||
    confirm.isPending ||
    rerun.isPending

  useEffect(() => {
    if (run?.status === 'DONE') void refetchCount()
  }, [run?.status, refetchCount])

  async function act(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await status.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selected =
    run?.suggestions.filter((row) => row.categoryId !== DEFAULT_CATEGORY_ID)
      .length ?? 0
  const isRunning =
    run &&
    ['QUEUED', 'PROCESSING', 'APPLYING', 'QUEUED_RERUN', 'RERUNNING'].includes(
      run.status,
    )
  const progress =
    run && run.total > 0 ? Math.round((100 * run.processed) / run.total) : 0
  const remaining = count.data ?? 0
  const calibration = run?.calibration
  const lastRound = calibration?.metrics.at(-1)
  const provisional =
    calibration?.confirmed.filter(
      (row) => row.categoryId !== DEFAULT_CATEGORY_ID,
    ).length ?? 0
  const calibrationIds = new Set(
    calibration?.confirmed.map((row) => row.id) ?? [],
  )
  const finalRows =
    run?.suggestions.filter((row) => !calibrationIds.has(row.id)) ?? []
  const rerunCandidates = run?.rerunCandidates ?? { general: 0, uncertain: 0 }
  const {
    proposedCount,
    changedCount,
    assignedCount,
    hasNewCorrection,
    hasRerunCandidates,
    hasCorrections,
    canRerun,
  } = getRerunReviewState(finalRows, rerunCandidates)
  function editCategory(expenseId: string, categoryId: CategoryId) {
    if (!run) return
    void act(() =>
      edit.mutateAsync({
        groupId,
        runId: run.id,
        changes: [{ expenseId, categoryId }],
      }),
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 w-fit"
          nativeButton={false}
          render={<Link to="/groups/$groupId/tools" params={{ groupId }} />}
        >
          <ArrowLeft className="me-2 size-4 rtl:rotate-180" />
          {t('backToStart')}
        </Button>
        <WizardStepHeader
          eyebrow={groupName}
          title={t('title')}
          description={t('simpleDescription')}
        />
      </div>

      {blockedReason ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {blockedReason === 'admin' ? t('adminsOnly') : t('archived')}
            </CardTitle>
          </CardHeader>
        </Card>
      ) : run?.status === 'QUEUED_CALIBRATION' ||
        run?.status === 'CALIBRATING' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('calibrationRoundTitle', { round: run.round + 1 })}
            </CardTitle>
            <CardDescription>{t('calibrationLoading')}</CardDescription>
          </CardHeader>
          {lastRound && (
            <CardContent className="text-sm text-muted-foreground">
              {lastRound.proposed
                ? t('roundQualityWithSuggestions', {
                    accepted: lastRound.accepted,
                    proposed: lastRound.proposed,
                    changed: lastRound.changed,
                    missed: lastRound.missed,
                  })
                : t('roundQualityNoSuggestions', {
                    missed: lastRound.missed,
                    abstained: lastRound.abstained,
                  })}
            </CardContent>
          )}
          <CardFooter className="justify-end">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void act(() => discard.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {t('discardRun')}
            </Button>
          </CardFooter>
        </Card>
      ) : run?.status === 'CALIBRATION_REVIEW' ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>
              {t('calibrationRoundTitle', { round: run.round })}
            </CardTitle>
            <CardDescription>
              {t('calibrationReviewDescription', {
                count: calibration?.sample.length ?? 0,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="border-t p-0 sm:p-0">
            <BulkCategorizeTable
              rows={calibration?.sample ?? []}
              disabled={pending}
              aiMinConfidence={features?.aiMinConfidence ?? 0.5}
              onChange={editCategory}
            />
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-2 border-t pt-4 sm:pt-6">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void act(() => discard.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {t('discardRun')}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void act(() => confirm.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {t('confirmRound')}
            </Button>
          </CardFooter>
        </Card>
      ) : isRunning ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {run.status === 'APPLYING'
                ? t('applyProgressTitle')
                : run.mode === 'jev' && run.fullPassPhase === 'second'
                  ? t('refiningTitle')
                  : t('progressTitle')}
            </CardTitle>
            <CardDescription>{t('progressDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(calibration?.metrics.length ?? 0) > 0 && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {t('roundSummaryDescription', {
                    reviewed: calibration?.confirmed.length ?? 0,
                    categorized: provisional,
                    general: run.candidateTotal - provisional,
                  })}
                </p>
                <p>
                  {lastRound?.proposed
                    ? t('roundQualityWithSuggestions', {
                        accepted: lastRound.accepted,
                        proposed: lastRound.proposed,
                        changed: lastRound.changed,
                        missed: lastRound.missed,
                      })
                    : t('roundQualityNoSuggestions', {
                        missed: lastRound?.missed ?? 0,
                        abstained: lastRound?.abstained ?? 0,
                      })}
                </p>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span>
                {t('progressCount', {
                  processed: run.processed,
                  total: run.total,
                })}
              </span>
              <span>{progress}%</span>
            </div>
            <progress
              value={progress}
              max={100}
              aria-label={t('progressTitle')}
              className="h-2 w-full accent-primary"
            />
            {run.status !== 'APPLYING' && (
              <p className="text-sm text-muted-foreground">
                {t('runningMatches', {
                  count: run.suggestions.filter(
                    (row) => row.categoryId !== DEFAULT_CATEGORY_ID,
                  ).length,
                  total: run.candidateTotal,
                })}
              </p>
            )}
          </CardContent>
          {run.status !== 'APPLYING' && (
            <CardFooter className="justify-end">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(() =>
                    discard.mutateAsync({ groupId, runId: run.id }),
                  )
                }
              >
                {t('discardRun')}
              </Button>
            </CardFooter>
          )}
        </Card>
      ) : run?.status.startsWith('FAILED_') ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('failedTitle')}</CardTitle>
            <CardDescription>
              {t('failed', { message: run.error ?? '' })}
            </CardDescription>
            {run.status === 'FAILED_APPLY' && (
              <CardDescription>{t('partialSaveNotice')}</CardDescription>
            )}
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                void act(() => retry.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {t('retry')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void act(() => discard.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {t('discardRun')}
            </Button>
          </CardFooter>
        </Card>
      ) : run?.status === 'REVIEW' ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t('reviewTitle')}</CardTitle>
            <CardDescription>
              {t('reviewWorkload', {
                total: run.candidateTotal,
                selected,
                general: run.candidateTotal - selected,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="border-t p-0 sm:p-0">
            <BulkCategorizeTable
              rows={run.suggestions}
              disabled={pending}
              aiMinConfidence={features?.aiMinConfidence ?? 0.5}
              onChange={editCategory}
            />
          </CardContent>
          <CardFooter className="flex flex-wrap items-end justify-between gap-4 border-t pt-4 sm:pt-6">
            <div className="flex flex-col items-start gap-3">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(() =>
                    discard.mutateAsync({ groupId, runId: run.id }),
                  )
                }
              >
                {t('discardRun')}
              </Button>
              {hasCorrections && (
                <div className="max-w-xl space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  {changedCount > 0 && (
                    <p>
                      {t('rerunChanged', {
                        changed: changedCount,
                        proposed: proposedCount,
                      })}
                    </p>
                  )}
                  {assignedCount > 0 && (
                    <p>
                      {assignedCount === 1
                        ? t('rerunAssignedSingle')
                        : t('rerunAssignedMultiple', { count: assignedCount })}
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    {!hasRerunCandidates
                      ? t('rerunNoEligible')
                      : !hasNewCorrection
                        ? t('rerunAlreadyUsed')
                        : t('rerunEligible', rerunCandidates)}
                  </p>
                  {canRerun && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void act(() =>
                          rerun.mutateAsync({ groupId, runId: run.id }),
                        )
                      }
                    >
                      {rerun.isPending && (
                        <Loader2 className="me-2 size-4 animate-spin" />
                      )}
                      {t('rerunSuggestions')}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <Button
              disabled={pending}
              onClick={() =>
                void act(() => save.mutateAsync({ groupId, runId: run.id }))
              }
            >
              {save.isPending ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <Check className="me-2 size-4" />
              )}
              {selected > 0
                ? t('saveCount', { count: selected })
                : t('finishWithoutChanges')}
            </Button>
          </CardFooter>
        </Card>
      ) : run?.status === 'DONE' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check
                className="size-5 rounded-full bg-emerald-100 p-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                aria-hidden
              />
              {t('doneTitle')}
            </CardTitle>
            <CardDescription>
              {count.isFetching
                ? t('countLoading')
                : t('completionSummary', {
                    changed: run.applied,
                    total: run.candidateTotal,
                    remaining,
                  })}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              nativeButton={false}
              render={
                <Link to="/groups/$groupId/expenses" params={{ groupId }} />
              }
            >
              {t('viewExpenses')}
            </Button>
            {remaining > 0 && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(() =>
                    start.mutateAsync({ groupId, mode: run.mode, locale }),
                  )
                }
              >
                {t('restart')}
              </Button>
            )}
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('chooseMode')}</CardTitle>
            <CardDescription>
              {count.isError
                ? t('countError')
                : count.isLoading
                  ? t('countLoading')
                  : remaining === 0
                    ? t('nothingToCategorize')
                    : t('startingCount', { count: remaining })}
            </CardDescription>
          </CardHeader>
          {count.isSuccess && remaining > 0 && (
            <>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {(['local', 'jev'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    disabled={
                      value === 'jev' && !features?.bulkCategorizeJevAvailable
                    }
                    onClick={() => setMode(value)}
                    aria-pressed={mode === value}
                    className={cn(
                      'rounded-lg border p-4 text-start transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50',
                      mode === value
                        ? 'border-primary bg-primary/5'
                        : 'border-border',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {value === 'jev' && <Sparkles className="size-4" />}
                      {t(value === 'jev' ? 'jevMode' : 'localMode')}
                    </span>
                    <span className="mt-2 block text-sm text-muted-foreground">
                      {t(
                        value === 'jev'
                          ? 'jevModeDescription'
                          : 'localModeDescription',
                      )}
                    </span>
                  </button>
                ))}
                {!features?.bulkCategorizeJevAvailable && (
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    {t('unavailable')}
                  </p>
                )}
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  disabled={
                    pending ||
                    (mode === 'jev' && !features?.bulkCategorizeJevAvailable)
                  }
                  onClick={() =>
                    void act(() => start.mutateAsync({ groupId, mode, locale }))
                  }
                >
                  {pending && <Loader2 className="me-2 size-4 animate-spin" />}
                  {t('startRun')}
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

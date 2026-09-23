import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Info, Loader2, Sparkles } from 'lucide-react'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { WizardStepHeader } from '@/components/wizard'
import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { DEFAULT_CATEGORY_ID, type CategoryId } from '@spliit/domain'

import { BulkCategorizePagedReview } from './bulk-categorize-paged-review'
import { getBulkCategorizationProgress } from './bulk-categorize-progress'
import { BulkCategorizeTable } from './bulk-categorize-table'

export type BulkCategorizePageProps = {
  groupId: string
  groupName: string
  blockedReason?: 'admin' | 'archived' | null
  onViewExpense?: (expenseId: string) => void
}

export function BulkCategorizePage({
  groupId,
  groupName,
  blockedReason,
  onViewExpense,
}: BulkCategorizePageProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  const locale = useLocale()
  const [mode, setMode] = useState<'local' | 'jev'>('local')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [reviewKey, setReviewKey] = useState(0)
  const [filter, setFilter] = useState<'all' | 'general'>('all')
  const [pendingStage, setPendingStage] = useState<
    'calibration' | 'next' | 'rerun' | 'retry' | null
  >(null)
  const [completion, setCompletion] = useState<{
    runId: string
    applied: number
    total: number
    mode: 'local' | 'jev'
  } | null>(null)
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
  const completionForCurrentRun =
    run && completion?.runId === run.id
      ? completion
      : run?.status === 'DONE'
        ? {
            runId: run.id,
            applied: run.applied,
            total: run.candidateTotal,
            mode: run.mode,
          }
        : null
  const pending =
    editing ||
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

  async function act(
    action: () => Promise<unknown>,
    stage?: 'calibration' | 'next' | 'rerun' | 'retry',
  ): Promise<boolean> {
    setError(null)
    if (stage) setPendingStage(stage)
    try {
      await action()
      await status.refetch()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await status.refetch()
      setReviewKey((value) => value + 1)
      return false
    } finally {
      setPendingStage(null)
    }
  }

  async function confirmDiscardRun() {
    if (!run) return
    const discarded = await act(() =>
      discard.mutateAsync({
        groupId,
        runId: run.id,
        revision: run.revision,
      }),
    )
    if (discarded) setDiscardDialogOpen(false)
  }

  async function saveReview(
    runId: string,
    total: number,
    runMode: 'local' | 'jev',
  ) {
    setError(null)
    try {
      const result = await save.mutateAsync({
        groupId,
        runId,
        revision: run!.revision,
      })
      setCompletion({
        runId,
        applied: result.applied,
        total,
        mode: runMode,
      })
      await status.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await status.refetch()
      setReviewKey((value) => value + 1)
    }
  }

  const selected = run?.selected ?? 0
  const isRunning =
    run &&
    !run.stalled &&
    [
      'QUEUED',
      'PROCESSING',
      'APPLYING',
      'QUEUED_RERUN',
      'RERUNNING',
      'QUEUED_CALIBRATION',
      'CALIBRATING',
    ].includes(run.status)
  const showProgress = pendingStage !== null || isRunning
  const progress = run ? getBulkCategorizationProgress(run) : null
  const hasNumericProgress =
    !pendingStage &&
    run &&
    progress !== null &&
    ['QUEUED', 'PROCESSING', 'QUEUED_RERUN', 'RERUNNING'].includes(run.status)
  const remaining = count.data ?? 0
  const calibration = run?.calibration
  const lastRound = calibration?.metrics.at(-1)
  const provisional =
    calibration?.confirmed.filter(
      (row) => row.categoryId !== DEFAULT_CATEGORY_ID,
    ).length ?? 0
  const rerunCandidates = run?.rerunCandidates ?? { general: 0, uncertain: 0 }
  const {
    proposedCount,
    changedCount,
    assignedCount,
    hasNewCorrection,
    hasCorrections,
  } = run?.feedback ?? {
    proposedCount: 0,
    changedCount: 0,
    assignedCount: 0,
    hasNewCorrection: false,
    hasCorrections: false,
  }
  const hasRerunCandidates =
    rerunCandidates.general + rerunCandidates.uncertain > 0
  const canRerun = hasNewCorrection && hasRerunCandidates
  const generalCount = run ? run.candidateTotal - selected : 0
  async function editCategory(expenseId: string, categoryId: CategoryId) {
    if (!run) return false
    setError(null)
    setEditing(true)
    try {
      await edit.mutateAsync({
        groupId,
        runId: run.id,
        revision: run.revision,
        changes: [{ expenseId, categoryId }],
      })
      await status.refetch()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await status.refetch()
      setReviewKey((value) => value + 1)
      return false
    } finally {
      setEditing(false)
    }
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
      ) : showProgress ? (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2
                className="size-5 animate-spin text-primary"
                aria-hidden
              />
              {pendingStage === 'calibration'
                ? t('calibrationRoundTitle', { round: 1 })
                : run?.status === 'QUEUED_CALIBRATION' ||
                    run?.status === 'CALIBRATING' ||
                    run?.status === 'FAILED_CALIBRATION'
                  ? t('calibrationRoundTitle', {
                      round: (run?.round ?? 0) + 1,
                    })
                  : pendingStage === 'next' && !isRunning
                    ? t('preparingNextStage')
                    : run?.status === 'QUEUED_RERUN' ||
                        run?.status === 'RERUNNING' ||
                        run?.status === 'FAILED_RERUN' ||
                        pendingStage === 'rerun'
                      ? t('rerunProgressTitle')
                      : run?.mode === 'jev' && run?.fullPassPhase === 'second'
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
                    general: (run?.candidateTotal ?? 0) - provisional,
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
            {hasNumericProgress ? (
              <>
                <div className="flex justify-between text-sm">
                  <span>
                    {t('progressCount', {
                      categorized: progress.categorized,
                      total: progress.total,
                    })}
                  </span>
                  <span>{progress.percentage}%</span>
                </div>
                <Progress
                  value={progress.percentage}
                  aria-label={t('progressTitle')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('progressCountDescription')}
                </p>
              </>
            ) : (
              <output className="text-sm text-muted-foreground">
                {t('progressPreparing')}
              </output>
            )}
          </CardContent>
          {run && !pendingStage && run.status !== 'APPLYING' && (
            <CardFooter className="justify-end">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setDiscardDialogOpen(true)}
              >
                {t('discardRun')}
              </Button>
            </CardFooter>
          )}
        </Card>
      ) : completionForCurrentRun ? (
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
                    changed: completionForCurrentRun.applied,
                    total: completionForCurrentRun.total,
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
                    start.mutateAsync({
                      groupId,
                      mode: completionForCurrentRun.mode,
                      locale,
                    }),
                  )
                }
              >
                {t('restart')}
              </Button>
            )}
          </CardFooter>
        </Card>
      ) : run?.status === 'CALIBRATION_REVIEW' ? (
        <Card>
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
              preserveOrder
              disabled={pending}
              aiMinConfidence={features?.aiMinConfidence ?? 0.5}
              onChange={editCategory}
              onViewExpense={onViewExpense}
            />
          </CardContent>
          <CardFooter className="sticky bottom-0 z-30 flex flex-wrap justify-between gap-2 border-t bg-background/95 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.06)] backdrop-blur sm:py-4">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDiscardDialogOpen(true)}
            >
              {t('discardRun')}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void act(
                  () =>
                    confirm.mutateAsync({
                      groupId,
                      runId: run.id,
                      revision: run.revision,
                    }),
                  'next',
                )
              }
            >
              {t('confirmRound')}
            </Button>
          </CardFooter>
        </Card>
      ) : run?.status.startsWith('FAILED_') || run?.stalled ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('failedTitle')}</CardTitle>
            <CardDescription>
              {t('failed', { message: run.error ?? '' })}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                void act(
                  () =>
                    retry.mutateAsync({
                      groupId,
                      runId: run.id,
                      revision: run.revision,
                    }),
                  'retry',
                )
              }
            >
              {t('retry')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDiscardDialogOpen(true)}
            >
              {t('discardRun')}
            </Button>
          </CardFooter>
        </Card>
      ) : run?.status === 'REVIEW' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('reviewTitle')}</CardTitle>
            <CardDescription>
              {t('reviewWorkload', {
                total: run.candidateTotal,
                selected,
                general: run.candidateTotal - selected,
              })}
            </CardDescription>
            {run.omitted > 0 && (
              <CardDescription>
                {t('runLimitSummary', { count: run.omitted })}
              </CardDescription>
            )}
            <CardDescription>{t('ledgerAmountNotice')}</CardDescription>
            <fieldset className="flex flex-wrap gap-2 border-0 pt-2">
              <legend className="sr-only">{t('reviewFilterLabel')}</legend>
              <Button
                type="button"
                size="sm"
                variant={filter === 'all' ? 'default' : 'outline'}
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {t('filterAll', { count: run.candidateTotal })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filter === 'general' ? 'default' : 'outline'}
                aria-pressed={filter === 'general'}
                onClick={() => setFilter('general')}
              >
                {t('filterGeneral', { count: generalCount })}
              </Button>
            </fieldset>
          </CardHeader>
          <CardContent className="border-t p-0 sm:p-0">
            <BulkCategorizePagedReview
              key={`${run.id}:${run.reviewCycle}:${reviewKey}`}
              groupId={groupId}
              runId={run.id}
              reviewCycle={run.reviewCycle}
              total={filter === 'general' ? generalCount : run.candidateTotal}
              filter={filter}
              disabled={pending}
              aiMinConfidence={features?.aiMinConfidence ?? 0.5}
              onChange={editCategory}
              onViewExpense={onViewExpense}
            />
          </CardContent>
          <CardFooter className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.06)] backdrop-blur sm:py-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setDiscardDialogOpen(true)}
              >
                {t('discardRun')}
              </Button>
              {canRerun && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void act(
                      () =>
                        rerun.mutateAsync({
                          groupId,
                          runId: run.id,
                          revision: run.revision,
                        }),
                      'rerun',
                    )
                  }
                >
                  {t('improveSuggestions')}
                </Button>
              )}
              {hasCorrections && (
                <Popover modal={false}>
                  <PopoverTrigger
                    aria-label={t('rerunInfoLabel')}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Info className="size-4" aria-hidden />
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    className="space-y-2 text-sm"
                  >
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
                          : t('rerunAssignedMultiple', {
                              count: assignedCount,
                            })}
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      {!hasRerunCandidates
                        ? t('rerunNoEligible')
                        : !hasNewCorrection
                          ? t('rerunAlreadyUsed')
                          : t('rerunEligible', rerunCandidates)}
                    </p>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <Button
              disabled={pending}
              onClick={() =>
                void saveReview(run.id, run.candidateTotal, run.mode)
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
                    void act(
                      () => start.mutateAsync({ groupId, mode, locale }),
                      'calibration',
                    )
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
      <ResponsiveDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          if (!pending) setDiscardDialogOpen(open)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('discardConfirmationTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('discardConfirmationDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className="flex flex-col gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void confirmDiscardRun()}
            >
              {discard.isPending && (
                <Loader2 className="me-2 size-4 animate-spin" />
              )}
              {t('discardRun')}
            </Button>
            <ResponsiveDialogClose
              render={
                <Button variant="secondary" disabled={pending}>
                  {t('discardConfirmationCancel')}
                </Button>
              }
            />
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

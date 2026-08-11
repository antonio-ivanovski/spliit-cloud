import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  ParticipantMappingState,
} from '@spliit/domain/import'
import { buildImportBatch } from '@spliit/domain/import'

import type { CloudGroupBundleInspection } from './cloud-bundle'
import {
  cloudInspectionToSource,
  initialCloudMappings,
  toCloudApiMapping,
} from './cloud-import-flow'
import { ConfirmStep } from './confirm-step'
import {
  CurrencyConversionStep,
  type ConversionResult,
} from './currency-conversion-step'
import { DestinationStep } from './destination-step'
import { DocumentsStep } from './documents-step'
import { DoneStep } from './done-step'
import {
  importWizardReducer,
  initialWizardState,
} from './import-wizard-reducer'
import type { ImportStep } from './import-wizard-state'
import {
  buildImportExpenses,
  isDocumentImportFailure,
  shouldDiscardStagedDocumentTokens,
} from './import-wizard-state'
import { MappingStep } from './mapping-step'
import { SourceStep } from './source-step'
import { useImportSource } from './use-import-source'
import { StepHeader } from './wizard-nav'

const importRoute = getRouteApi('/groups/import')

// react-doctor-disable-next-line react-doctor/no-giant-component -- wizard orchestrator, delegates to step components
export function ImportGroupWizard() {
  const search = importRoute.useSearch()
  const navigate = useNavigate()
  const { data: account, isPending: isAccountPending } = useCurrentAccount()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const prefillSourceUrl = search.prefill ?? null
  const { t } = useTranslation()
  const importAttempt = useIdempotentCreate()
  const [pendingCloudInspection, setPendingCloudInspection] =
    useState<CloudGroupBundleInspection | null>(null)

  const [state, dispatch] = useReducer(
    importWizardReducer,
    prefillSourceUrl,
    (pp) => initialWizardState(pp),
  )

  const {
    data: sourcePreview,
    isLoading: isSourcePreviewLoading,
    error: sourcePreviewError,
    submit,
    reset: resetSourcePreview,
  } = useImportSource()

  const { data: destinationGroupData } = trpc.groups.get.useQuery(
    { groupId: state.targetGroupId! },
    { enabled: !!state.targetGroupId },
  )
  const destinationParticipants = destinationGroupData?.group?.participants

  const { data: friendsData } = trpc.account.friends.useQuery(
    { groupId: state.targetGroupId ?? undefined },
    { enabled: true },
  )
  const friends = friendsData?.friends ?? []

  const autoMatchKeyRef = useRef<string | null>(null)

  // Existing-group auto-match: applied once per (source group,
  // target group) pair. If destination data is still loading, the
  // effect re-runs and the key guard keeps it idempotent.
  useEffect(() => {
    if (state.mode !== 'EXISTING_GROUP' || !state.targetGroupId) return
    if (!destinationParticipants || destinationParticipants.length === 0) return
    const sourceGroupId = state.source?.sourceGroupId
    if (!sourceGroupId) return
    const key = `${sourceGroupId}::${state.targetGroupId}`
    if (autoMatchKeyRef.current === key) return
    dispatch({
      type: 'AUTO_MATCH',
      destinationParticipants,
    })
    autoMatchKeyRef.current = key
  }, [
    state.mode,
    state.targetGroupId,
    state.source?.sourceGroupId,
    destinationParticipants,
  ])

  const importMutation = trpc.groups.import.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        invalidateAccountGroupLists(utils),
        utils.invitations.listForAccount.invalidate(),
        utils.groups.get.invalidate({ groupId: data.groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({
          groupId: data.groupId,
        }),
        utils.groups.balances.list.invalidate({ groupId: data.groupId }),
        utils.groups.getDetails.invalidate({ groupId: data.groupId }),
        utils.account.friends.invalidate(),
      ])
      dispatch({
        type: 'IMPORT_SUCCEEDED',
        groupId: data.groupId,
        invites: data.invites ?? [],
      })
    },
    onError: (err) => {
      if (isDocumentImportFailure(err.message)) {
        dispatch({
          type: 'DOCUMENTS_FAILED',
          discardTokens: shouldDiscardStagedDocumentTokens(err.message),
        })
      }
    },
  })

  const cloudImportMutation = trpc.groups.importCloudBundle.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        invalidateAccountGroupLists(utils),
        utils.invitations.listForAccount.invalidate(),
        utils.groups.get.invalidate({ groupId: data.groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({
          groupId: data.groupId,
        }),
        utils.groups.balances.list.invalidate({ groupId: data.groupId }),
        utils.groups.getDetails.invalidate({ groupId: data.groupId }),
        utils.account.friends.invalidate(),
      ])
      dispatch({
        type: 'IMPORT_SUCCEEDED',
        groupId: data.groupId,
        invites: data.invites ?? [],
      })
    },
    onError: (err) => {
      if (isDocumentImportFailure(err.message)) {
        dispatch({
          type: 'DOCUMENTS_FAILED',
          discardTokens: shouldDiscardStagedDocumentTokens(err.message),
        })
      }
    },
  })

  // Treat the mutation result as a render result: destructure into
  // primitives so callback deps stay stable. Depending on the full
  // mutation object would yield a fresh ref each render and re-fire
  // every effect that touches it.
  const {
    mutateAsync: importGroup,
    isPending: isImportPending,
    data: importResult,
  } = importMutation
  const {
    mutateAsync: importCloudBundle,
    isPending: isCloudImportPending,
    data: cloudImportResult,
  } = cloudImportMutation
  const activeImportResult = cloudImportResult ?? importResult
  const activeImportPending = isCloudImportPending || isImportPending
  const activeImportGroupId = activeImportResult?.groupId ?? null
  const activeImportInvites = activeImportResult?.invites ?? []
  const activeImportedDocumentCount = activeImportResult?.importedDocuments ?? 0

  // Prefill error message for the source step's inline error display.
  // Derived (not stored) because the wizard's `useImportSource`
  // instance and the source step's `useImportSource` instance don't
  // share their `submittedUrl` state — the wizard knows about the
  // prefill, the source step doesn't, so we hand the message down.
  const prefillErrorMessage = useMemo(() => {
    if (state.source) return null
    if (sourcePreview && sourcePreview.kind !== 'OK') {
      return sourcePreview.kind === 'NOT_FOUND'
        ? t('Groups.Import.Source.notFoundUrl')
        : sourcePreview.message
    }
    if (sourcePreviewError) return sourcePreviewError.message
    return null
  }, [sourcePreview, sourcePreviewError, state.source, t])

  // Source URL prefill: trigger the fetch when arriving with a URL.
  useEffect(() => {
    if (prefillSourceUrl && !state.source) {
      submit(prefillSourceUrl)
    }
  }, [prefillSourceUrl, state.source, submit])

  // Bridge server-state completion into the wizard reducer. Treats
  // both NOT_FOUND (a successful response with a non-OK kind) and
  // transport errors as SOURCE_FAILED. The reducer rejects duplicates
  // so a second tick after `state.source` is set is a no-op.
  // After a successful load we clear the shared preview state so a
  // subsequent manual paste re-fires the OK→SOURCE_LOADED transition
  // cleanly instead of re-dispatching from a stale cache. The
  // auto-match key is also reset so a different source re-evaluates
  // destination matching instead of being skipped as a repeat.
  useEffect(() => {
    if (state.source) return
    if (sourcePreview?.kind === 'OK') {
      autoMatchKeyRef.current = null
      dispatch({
        type: 'SOURCE_LOADED',
        source: sourcePreview.source,
        accountId: account?.id,
      })
      resetSourcePreview()
    } else if (sourcePreview || sourcePreviewError) {
      dispatch({ type: 'SOURCE_FAILED' })
    }
  }, [
    sourcePreview,
    sourcePreviewError,
    state.source,
    account?.id,
    resetSourcePreview,
  ])

  const handleSourceError = useCallback(
    (message: string) => {
      toast({ description: message, variant: 'destructive' })
    },
    [toast],
  )

  const handleCloudLoaded = useCallback(
    (inspection: CloudGroupBundleInspection) => {
      setPendingCloudInspection(inspection)
    },
    [],
  )

  // Cloud participant identity matching must not run against the temporary
  // null account value returned while the authenticated session is loading.
  // Keep the inspected bundle pending until the signed-in identity is ready.
  useEffect(() => {
    if (state.source || !pendingCloudInspection || isAccountPending || !account)
      return
    const cloudSource = cloudInspectionToSource(pendingCloudInspection)
    dispatch({
      type: 'SOURCE_LOADED',
      source: cloudSource,
      accountId: account.id,
      sourceKind: 'CLOUD',
      cloudInspection: pendingCloudInspection,
      participants: initialCloudMappings(
        cloudSource,
        pendingCloudInspection,
        account,
      ),
      groupFormValues: {
        name: pendingCloudInspection.manifest.group.name,
        information: pendingCloudInspection.manifest.group.information ?? '',
        currency: pendingCloudInspection.manifest.group.ledger.currency,
        currencyCode:
          pendingCloudInspection.manifest.group.ledger.currencyCode ?? '',
      },
      archived: pendingCloudInspection.manifest.group.archived,
    })
    // Consume the pending inspection after it has been loaded. Keeping it
    // pending would cause this effect to immediately reload the bundle after
    // returning to the source step, bypassing the retained-bundle resume UI.
    queueMicrotask(() => setPendingCloudInspection(null))
  }, [account, isAccountPending, pendingCloudInspection, state.source])

  // File uploads are parsed client-side and hand the parsed source
  // directly up via this callback. URL pastes / prefill go through the
  // shared `useImportSource` instance and the wizard's effect above.
  const handleFileLoaded = useCallback(
    (source: NormalizedSource) => {
      setPendingCloudInspection(null)
      autoMatchKeyRef.current = null
      dispatch({
        type: 'SOURCE_LOADED',
        source,
        accountId: account?.id,
      })
    },
    [account?.id],
  )

  const handleDestinationChosen = useCallback(
    (choice: {
      mode: 'NEW_GROUP' | 'EXISTING_GROUP'
      targetGroupId: string | null
      groupFormValues: {
        name: string
        information: string
        currency: string
        currencyCode: string
      }
    }) => {
      dispatch({
        type: 'DESTINATION_CHOSEN',
        mode: choice.mode,
        targetGroupId: choice.targetGroupId,
        groupFormValues: choice.groupFormValues,
      })
    },
    [],
  )

  const handleMappingChange = useCallback(
    (participants: ParticipantMappingState[]) => {
      dispatch({ type: 'MAPPING_CHANGED', participants })
    },
    [],
  )

  const handleMappingContinue = useCallback(
    (resolved: {
      sourceIdToDestId: Record<string, string>
      destIds: Record<string, string>
      resolvedExpenses: NormalizedSourceExpense[]
    }) => {
      dispatch({ type: 'MAPPING_CONFIRMED', ...resolved })
    },
    [],
  )

  const handleCurrencyConversionContinue = useCallback(
    (result: ConversionResult) => {
      dispatch({ type: 'CONVERSION_CONFIRMED', ...result })
    },
    [],
  )

  const handleDocumentsContinue = useCallback(
    (result: {
      stagedTokens: string[]
      recoveredCount: number
      skippedCount: number
      skippedEntirely: boolean
      cloudDocuments?: Array<{
        sourceDocumentId: string
        stagedToken: string
      }>
      cloudSkippedDocumentIds?: string[]
      cloudIssuesAcknowledged?: boolean
    }) => {
      dispatch({ type: 'DOCUMENTS_CONFIRMED', ...result })
    },
    [],
  )

  const destinationCurrencyCode =
    state.mode === 'EXISTING_GROUP'
      ? (destinationGroupData?.group?.currencyCode ?? '')
      : state.groupFormValues.currencyCode
  const sourceCurrencyCode = state.source?.currencyCode ?? ''

  async function handleSubmit() {
    if (!state.source) return
    if (!state.mode) return
    if (!account?.id) return
    try {
      if (state.sourceKind === 'CLOUD' && state.cloudInspection) {
        await importAttempt.run((requestId) =>
          importCloudBundle({
            requestId,
            manifest: state.cloudInspection!.manifest,
            groupFormValues: state.groupFormValues,
            archived: state.archived,
            participants: state.participants.map(toCloudApiMapping),
            skippedDocumentIds: state.cloudSkippedDocumentIds,
            acknowledgedIssues: state.cloudDocumentIssuesAcknowledged,
            stagedDocuments: {
              sessionId: state.documentSessionId,
              documents: state.cloudStagedDocuments,
            },
          }),
        )
        return
      }
      const sourceMeta = {
        provider: state.source.provider,
        sourceGroupId: state.source.sourceGroupId,
        sourceUrl: state.prefillSourceUrl ?? undefined,
      }
      const { batch } = buildImportBatch(
        state,
        destinationCurrencyCode,
        state.rates ?? undefined,
      )
      const expenses = buildImportExpenses(batch.expenses)
      await importAttempt.run((requestId) =>
        importGroup({
          ...batch,
          groupFormValues:
            'groupFormValues' in batch ? batch.groupFormValues : undefined,
          expenses,
          sourceMeta,
          documentImport:
            state.stagedDocumentTokens.length > 0
              ? {
                  sessionId: state.documentSessionId,
                  stagedTokens: state.stagedDocumentTokens,
                }
              : undefined,
          requestId,
        }),
      )
    } catch (err) {
      const description =
        err instanceof Error
          ? err.message
          : t('Groups.Import.Confirm.importErrorFallback')
      // Cloud document failures already route the wizard back to Documents
      // from the mutation onError handler. Avoid showing a duplicate toast
      // for that expected, actionable flow.
      if (!isDocumentImportFailure(description)) {
        toast({
          title: t('Groups.Import.Confirm.importErrorTitle'),
          description,
          variant: 'destructive',
        })
      }
    }
    // Destructure fields used so the callback deps don't include the
    // mutable tRPC result object.
  }

  const handleDoneNavigate = useCallback(() => {
    if (activeImportGroupId) {
      void navigate({
        to: '/groups/$groupId',
        params: { groupId: activeImportGroupId },
      })
    } else {
      void navigate({ to: '/' })
    }
  }, [activeImportGroupId, navigate])

  const handleBack = useCallback(() => {
    if (state.step === 'destination' && state.sourceKind === 'CLOUD') {
      dispatch({ type: 'RETURN_TO_SOURCE' })
      return
    }
    dispatch({ type: 'BACK' })
  }, [state.sourceKind, state.step])

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step={state.step} />

      {state.step === 'source' &&
        (pendingCloudInspection && isAccountPending ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>{t('Groups.Import.fetchingGroup')}</p>
            </CardContent>
          </Card>
        ) : (
          <SourceStep
            onLoaded={handleFileLoaded}
            onCloudLoaded={handleCloudLoaded}
            sourcePreview={sourcePreview}
            isSourcePreviewLoading={isSourcePreviewLoading}
            sourcePreviewError={sourcePreviewError}
            submitPreview={submit}
            resetPreview={resetSourcePreview}
            onError={handleSourceError}
            initialError={prefillErrorMessage}
            retainedCloudBundle={
              state.sourceKind === 'CLOUD' && state.cloudInspection
                ? {
                    onResume: () =>
                      setPendingCloudInspection(state.cloudInspection),
                  }
                : undefined
            }
          />
        ))}

      {state.step === 'destination' && !state.source && prefillSourceUrl && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p>{t('Groups.Import.fetchingGroup')}</p>
          </CardContent>
        </Card>
      )}

      {state.step === 'destination' && state.source && (
        <>
          {state.sourceKind === 'CLOUD' &&
            state.cloudInspection?.manifest.complete === false && (
              <Alert>
                <AlertTitle>
                  {t('Groups.Import.Cloud.incompleteTitle')}
                </AlertTitle>
                <AlertDescription>
                  {t('Groups.Import.Cloud.incompleteDescription', {
                    count: state.cloudInspection.manifest.warnings.length,
                  })}
                </AlertDescription>
              </Alert>
            )}
          {state.sourceKind === 'CLOUD' &&
            state.cloudInspection?.manifest.group.groupType === 'FRIEND' && (
              <Alert>
                <AlertDescription>
                  {t('Groups.Import.Cloud.friendSourceWarning')}
                </AlertDescription>
              </Alert>
            )}
          <DestinationStep
            source={state.source}
            initialGroupFormValues={state.groupFormValues}
            mode={state.mode}
            allowExisting={state.sourceKind !== 'CLOUD'}
            currencyLocked={state.sourceKind === 'CLOUD'}
            initialArchived={state.archived}
            onArchivedChange={
              state.sourceKind === 'CLOUD'
                ? (archived) => dispatch({ type: 'ARCHIVE_CHANGED', archived })
                : undefined
            }
            onBack={handleBack}
            onContinue={handleDestinationChosen}
          />
        </>
      )}

      {state.step === 'mapping' && state.source && (
        <MappingStep
          source={state.source}
          participants={state.participants}
          account={account}
          destinationParticipants={
            state.mode === 'EXISTING_GROUP'
              ? destinationParticipants
              : undefined
          }
          friends={friends}
          onBack={handleBack}
          onChange={handleMappingChange}
          onContinue={handleMappingContinue}
        />
      )}

      {state.step === 'currencyConversion' && state.source && (
        <CurrencyConversionStep
          source={state.source}
          resolvedExpenses={state.resolvedExpenses}
          sourceCurrencyCode={sourceCurrencyCode}
          destinationCurrencyCode={destinationCurrencyCode}
          conversionModes={state.conversionModes}
          fixedRateDates={state.fixedRateDates}
          fixedRateOverrides={state.fixedRateOverrides}
          initialRates={state.rates ?? {}}
          currencyLocked={state.sourceKind === 'CLOUD'}
          onBack={handleBack}
          onContinue={handleCurrencyConversionContinue}
        />
      )}

      {state.step === 'documents' && state.source && (
        <DocumentsStep
          source={state.source}
          sessionId={state.documentSessionId}
          initialTokens={state.stagedDocumentTokens}
          initialRecoveredCount={state.recoveredDocumentCount}
          initialSkippedCount={state.skippedDocumentCount}
          initialSkippedEntirely={state.documentRecoverySkipped}
          initialCompleted={state.documentFlowVisited}
          cloud={
            state.sourceKind === 'CLOUD' && state.cloudInspection
              ? {
                  inspection: state.cloudInspection,
                  initialDocuments: state.cloudStagedDocuments,
                  initialIssues: state.cloudInspection.documentIssues,
                  initialSkippedDocumentIds: state.cloudSkippedDocumentIds,
                  onContinue: (result) =>
                    handleDocumentsContinue({
                      stagedTokens: result.stagedDocuments.map(
                        (document) => document.stagedToken,
                      ),
                      recoveredCount: result.stagedDocuments.length,
                      skippedCount: result.skippedDocumentIds.length,
                      skippedEntirely: false,
                      cloudDocuments: result.stagedDocuments,
                      cloudSkippedDocumentIds: result.skippedDocumentIds,
                      cloudIssuesAcknowledged: result.acknowledgedIssues,
                    }),
                }
              : undefined
          }
          onBack={handleBack}
          onContinue={handleDocumentsContinue}
        />
      )}

      {state.step === 'confirm' && state.source && state.mode && (
        <ConfirmStep
          source={state.source}
          mode={state.mode}
          targetGroupId={state.targetGroupId}
          groupFormValues={state.groupFormValues}
          participants={state.participants}
          rates={state.rates}
          resolvedExpenses={state.resolvedExpenses}
          invites={activeImportInvites}
          isSubmitting={activeImportPending}
          conversionModes={state.conversionModes}
          recoveredDocumentCount={state.recoveredDocumentCount}
          skippedDocumentCount={state.skippedDocumentCount}
          documentRecoverySkipped={state.documentRecoverySkipped}
          showDocumentSummary={state.documentFlowVisited}
          onBack={handleBack}
          onSubmit={handleSubmit}
          cloudSummary={
            state.sourceKind === 'CLOUD'
              ? {
                  archived: state.archived,
                  expenseCount:
                    state.cloudInspection?.manifest.expenses.length ?? 0,
                  activeRecurrenceCount:
                    state.cloudInspection?.manifest.recurrenceSeries.filter(
                      (series) => series.status === 'ACTIVE',
                    ).length ?? 0,
                }
              : undefined
          }
        />
      )}

      {state.step === 'done' && (
        <DoneStep
          groupId={activeImportGroupId}
          invites={activeImportInvites}
          importedDocumentCount={activeImportedDocumentCount}
          onContinue={handleDoneNavigate}
        />
      )}
    </div>
  )
}

export type { ImportStep }

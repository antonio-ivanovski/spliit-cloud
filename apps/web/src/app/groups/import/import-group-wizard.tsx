import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  ParticipantMappingState,
} from '@spliit/domain/import'
import { buildImportBatch } from '@spliit/domain/import'

import { ConfirmStep } from './confirm-step'
import {
  CurrencyConversionStep,
  type ConversionResult,
} from './currency-conversion-step'
import { DestinationStep } from './destination-step'
import { DoneStep } from './done-step'
import {
  importWizardReducer,
  initialWizardState,
} from './import-wizard-reducer'
import type { ImportStep } from './import-wizard-state'
import { buildImportExpenses } from './import-wizard-state'
import { MappingStep } from './mapping-step'
import { SourceStep } from './source-step'
import { useImportSource } from './use-import-source'
import { StepHeader } from './wizard-nav'

const importRoute = getRouteApi('/groups/import')

// react-doctor-disable-next-line react-doctor/no-giant-component -- wizard orchestrator, delegates to step components
export function ImportGroupWizard() {
  const search = importRoute.useSearch()
  const navigate = useNavigate()
  const { data: account } = useCurrentAccount()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const prefillSourceUrl = search.prefill ?? null
  const { t } = useTranslation()

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
        utils.account.groups.invalidate(),
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
      toast({ description: err.message, variant: 'destructive' })
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
  const importResultGroupId = importResult?.groupId ?? null
  const importResultInvites = importResult?.invites ?? []

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

  // File uploads are parsed client-side and hand the parsed source
  // directly up via this callback. URL pastes / prefill go through the
  // shared `useImportSource` instance and the wizard's effect above.
  const handleFileLoaded = useCallback(
    (source: NormalizedSource) => {
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
      await importGroup({
        ...batch,
        groupFormValues:
          'groupFormValues' in batch ? batch.groupFormValues : undefined,
        expenses,
        sourceMeta,
      })
    } catch (err) {
      toast({
        title: t('Groups.Import.Confirm.importErrorTitle'),
        description:
          err instanceof Error
            ? err.message
            : t('Groups.Import.Confirm.importErrorFallback'),
        variant: 'destructive',
      })
    }
    // Destructure fields used so the callback deps don't include the
    // mutable tRPC result object.
  }

  const handleDoneNavigate = useCallback(() => {
    if (importResultGroupId) {
      void navigate({
        to: '/groups/$groupId',
        params: { groupId: importResultGroupId },
      })
    } else {
      void navigate({ to: '/' })
    }
  }, [importResultGroupId, navigate])

  const handleBack = useCallback(() => {
    dispatch({ type: 'BACK' })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step={state.step} />

      {state.step === 'source' && (
        <SourceStep
          onLoaded={handleFileLoaded}
          sourcePreview={sourcePreview}
          isSourcePreviewLoading={isSourcePreviewLoading}
          sourcePreviewError={sourcePreviewError}
          submitPreview={submit}
          resetPreview={resetSourcePreview}
          onError={handleSourceError}
          initialError={prefillErrorMessage}
        />
      )}

      {state.step === 'destination' && !state.source && prefillSourceUrl && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p>{t('Groups.Import.fetchingGroup')}</p>
          </CardContent>
        </Card>
      )}

      {state.step === 'destination' && state.source && (
        <DestinationStep
          source={state.source}
          initialGroupFormValues={state.groupFormValues}
          mode={state.mode}
          onBack={handleBack}
          onContinue={handleDestinationChosen}
        />
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
          onBack={handleBack}
          onContinue={handleCurrencyConversionContinue}
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
          invites={importResultInvites}
          isSubmitting={isImportPending}
          conversionModes={state.conversionModes}
          onBack={handleBack}
          onSubmit={handleSubmit}
        />
      )}

      {state.step === 'done' && (
        <DoneStep
          groupId={importResultGroupId}
          invites={importResultInvites}
          onContinue={handleDoneNavigate}
        />
      )}
    </div>
  )
}

export type { ImportStep }

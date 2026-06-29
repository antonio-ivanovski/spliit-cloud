'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  NormalizedSourceParticipant,
} from '@spliit/domain/import'
import {
  applyAutoMatch,
  buildImportBatch,
  computeImportRateKeys,
  makeRateKey,
  type ImportRatesByKey,
} from '@spliit/domain/import'
import { getRouteApi } from '@tanstack/react-router'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmStep } from './confirm-step'
import { DestinationStep } from './destination-step'
import { DoneStep } from './done-step'
import { MappingStep } from './mapping-step'
import { SourceStep } from './source-step'
import { useImportSource } from './use-import-source'

const importRoute = getRouteApi('/groups/import')

export type ImportStep =
  | 'source'
  | 'destination'
  | 'mapping'
  | 'confirm'
  | 'done'

export type ImportMode = 'NEW_GROUP' | 'EXISTING_GROUP'

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  /** Existing destination `LedgerParticipant.id` when mode === 'LINK_EXISTING_PARTICIPANT'. */
  existingLedgerParticipantId?: string
}

type WizardState = {
  step: ImportStep
  source: NormalizedSource | null
  prefillSourceUrl: string | null
  mode: ImportMode | null
  targetGroupId: string | null
  groupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  participants: ParticipantMappingState[]
  sourceIdToDestId: Record<string, string>
  destIds: Record<string, string>
  resolvedExpenses: NormalizedSourceExpense[]
  /**
   * Exchange rates pre-fetched for cross-currency expenses, keyed by
   * `makeRateKey(date, base, target)`. Empty when no conversion is
   * needed; `undefined` while the rates are still being fetched.
   */
  rates: ImportRatesByKey | null | undefined
}

const initialGroupFormValues = (source: NormalizedSource | null) => ({
  name: source?.name ?? '',
  information: '',
  currency: source?.currency ?? '€',
  currencyCode: source?.currencyCode ?? '',
})

/**
 * Map the batched expenses into the shape the import mutation expects.
 * The single-payer paidBy list uses `originalAmount` when `originalCurrency`
 * is set, so the cross-currency paidBy BY_AMOUNT sum check (which the
 * domain schema runs against `originalAmount`) passes. Otherwise the
 * ledger-currency `amount` is used.
 */
export function buildImportExpenses<
  T extends { paidBy: string; amount: number; originalAmount?: number },
>(expenses: T[]): Array<Omit<T, 'paidBy'> & { paidByList: Array<{ participant: string; shares: number }>; paidBySplitMode: 'BY_AMOUNT' }> {
  return expenses.map(({ paidBy, ...rest }) => ({
    ...rest,
    paidByList: [
      { participant: paidBy, shares: rest.originalAmount ?? rest.amount },
    ],
    paidBySplitMode: 'BY_AMOUNT' as const,
  }))
}

export function ImportGroupWizard() {
  const search = importRoute.useSearch()
  const router = useRouter()
  const { data: account } = useCurrentAccount()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const prefillSourceUrl = search.source ?? null

  const { t } = useTranslation()

  const [state, setState] = useState<WizardState>(() => ({
    step: prefillSourceUrl ? 'destination' : 'source',
    source: null,
    prefillSourceUrl,
    mode: null,
    targetGroupId: null,
    groupFormValues: initialGroupFormValues(null),
    participants: [],
    sourceIdToDestId: {},
    destIds: {},
    resolvedExpenses: [],
    rates: undefined,
  }))

  const { data: destinationGroupData } = trpc.groups.get.useQuery(
    { groupId: state.targetGroupId! },
    { enabled: !!state.targetGroupId },
  )
  const destinationParticipants = destinationGroupData?.group?.participants

  const autoMatchKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (state.mode !== 'EXISTING_GROUP' || !state.targetGroupId) return
    if (!destinationParticipants || destinationParticipants.length === 0) return
    const sourceGroupId = state.source?.sourceGroupId
    if (!sourceGroupId) return
    const key = `${sourceGroupId}::${state.targetGroupId}`
    if (autoMatchKeyRef.current === key) return

    setState((s) => ({
      ...s,
      participants: applyAutoMatch(s.participants, destinationParticipants),
    }))

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
      ])
      setState((s) => ({ ...s, step: 'done' }))
    },
    onError: (err) => {
      toast({
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  // Push sentinel entries so the mobile back button walks the wizard
  // steps in reverse instead of leaving the page.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.history.pushState({ importWizard: true }, '')
    const onPopState = () => {
      setState((s) => {
        if (s.step === 'source') return s
        if (s.step === 'destination') return { ...s, step: 'source' }
        if (s.step === 'mapping') return { ...s, step: 'destination' }
        if (s.step === 'confirm') return { ...s, step: 'mapping' }
        return s
      })
      window.history.pushState({ importWizard: true }, '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleSourceLoaded = useCallback(
    (source: NormalizedSource) => {
      autoMatchKeyRef.current = null
      const participants: ParticipantMappingState[] = source.participants.map(
        (p, i) => ({
          key: `${p.sourceId}-${i}`,
          source: p,
          mode: i === 0 ? 'LINK_ACCOUNT' : 'INVITE_BY_EMAIL',
          linkedAccountId: i === 0 ? account?.id : undefined,
          inviteEmail: i === 0 ? undefined : '',
        }),
      )
      setState((s) => ({
        ...s,
        source,
        participants,
        groupFormValues: initialGroupFormValues(source),
        step: 'destination',
      }))
      if (typeof window !== 'undefined') {
        window.history.pushState({ importWizard: true }, '')
      }
    },
    [account?.id],
  )

  // ?source=<url> handoff — delegate to the same hook SourceStep uses.
  const {
    data: sourcePreview,
    error: sourcePreviewError,
    submit,
  } = useImportSource()
  useEffect(() => {
    if (prefillSourceUrl && !state.source) {
      submit(prefillSourceUrl)
    }
  }, [prefillSourceUrl, state.source, submit])
  useEffect(() => {
    if (state.source) return
    if (!sourcePreview) return
    if (sourcePreview.kind === 'OK') {
      handleSourceLoaded(sourcePreview.source)
      return
    }
    if (sourcePreview.kind === 'NOT_FOUND') {
      toast({
        description: t('Groups.Import.notFound'),
        variant: 'destructive',
      })
    } else {
      toast({
        description: sourcePreview.message,
        variant: 'destructive',
      })
    }
    setState((s) => ({ ...s, step: 'source', prefillSourceUrl: null }))
  }, [sourcePreview, state.source, handleSourceLoaded, toast, t])
  useEffect(() => {
    if (state.source) return
    if (!sourcePreviewError) return
    toast({
      description: sourcePreviewError.message,
      variant: 'destructive',
    })
    setState((s) => ({ ...s, step: 'source', prefillSourceUrl: null }))
  }, [sourcePreviewError, state.source, toast])

  const handleSourceError = useCallback(
    (message: string) => {
      toast({ description: message, variant: 'destructive' })
    },
    [toast],
  )

  const handleDestinationChosen = useCallback(
    (choice: {
      mode: ImportMode
      targetGroupId: string | null
      groupFormValues: WizardState['groupFormValues']
    }) => {
      window.history.pushState({ importWizard: true }, '')
      setState((s) => ({
        ...s,
        mode: choice.mode,
        targetGroupId: choice.targetGroupId,
        groupFormValues: choice.groupFormValues,
        step: 'mapping',
      }))
    },
    [],
  )

  const handleMappingChange = useCallback(
    (participants: ParticipantMappingState[]) => {
      setState((s) => ({ ...s, participants }))
    },
    [],
  )

  const handleMappingContinue = useCallback(
    (resolved: {
      sourceIdToDestId: Record<string, string>
      destIds: Record<string, string>
      resolvedExpenses: NormalizedSourceExpense[]
    }) => {
      window.history.pushState({ importWizard: true }, '')
      // `rates: undefined` triggers the tRPC batched fetch on the
      // confirm step; an empty object means "no conversion needed"
      // (source and destination currencies match).
      setState((s) => ({
        ...s,
        sourceIdToDestId: resolved.sourceIdToDestId,
        destIds: resolved.destIds,
        resolvedExpenses: resolved.resolvedExpenses,
        rates: undefined,
        step: 'confirm',
      }))
    },
    [],
  )

  // Resolve the destination ledger's currency code. For existing groups
  // we wait for `destinationGroupData` so we never fetch a rate against
  // a stale or empty target.
  const destinationCurrencyCode =
    state.mode === 'EXISTING_GROUP'
      ? (destinationGroupData?.group?.currencyCode ?? '')
      : state.groupFormValues.currencyCode
  const sourceCurrencyCode = state.source?.currencyCode ?? ''

  // The unique rate lookups required for this import, computed from the
  // resolved expenses + source/destination currencies. An empty array
  // means the source and destination currencies match and no fetch is
  // needed.
  const rateKeyItems = useMemo(() => {
    if (state.step !== 'confirm') return []
    return computeImportRateKeys(
      state.resolvedExpenses,
      sourceCurrencyCode,
      destinationCurrencyCode,
    )
  }, [
    state.step,
    state.resolvedExpenses,
    sourceCurrencyCode,
    destinationCurrencyCode,
  ])

  const ratesQuery = trpc.currency.getRates.useQuery(
    { items: rateKeyItems },
    {
      enabled:
        state.step === 'confirm' &&
        rateKeyItems.length > 0 &&
        destinationCurrencyCode.length > 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
  )

  // Reconcile the tRPC response into a rates map keyed by
  // `makeRateKey(date, base, target)`. Any per-item failure collapses
  // the whole batch into `null` so the import is blocked with a clear
  // message instead of silently using a half-complete rate set.
  const ratesFromQuery: ImportRatesByKey | null | undefined = useMemo(() => {
    if (rateKeyItems.length === 0) return {}
    if (ratesQuery.isLoading || ratesQuery.isFetching) return undefined
    if (ratesQuery.error || !ratesQuery.data) return null
    const out: ImportRatesByKey = {}
    for (const item of ratesQuery.data) {
      if (!item.ok) return null
      out[
        makeRateKey(item.rate.requestedDate, item.rate.base, item.rate.target)
      ] = item.rate.rate
    }
    return out
  }, [
    rateKeyItems,
    ratesQuery.data,
    ratesQuery.error,
    ratesQuery.isLoading,
    ratesQuery.isFetching,
  ])

  // Persist the resolved rates back into wizard state so the submit
  // handler reads a stable value rather than re-querying.
  useEffect(() => {
    if (state.step !== 'confirm') return
    if (state.rates === ratesFromQuery) return
    setState((s) =>
      s.step === 'confirm' ? { ...s, rates: ratesFromQuery } : s,
    )
  }, [state.step, state.rates, ratesFromQuery])

  // Surface a friendly status object to the confirm step. `idle` means
  // no cross-currency conversion is needed; `loading` and `error`
  // reflect the tRPC batched rate fetch.
  const confirmRatesStatus = useMemo<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready' }
    | { kind: 'error' }
  >(() => {
    if (state.step !== 'confirm') return { kind: 'idle' }
    if (rateKeyItems.length === 0) return { kind: 'idle' }
    if (ratesFromQuery === undefined) return { kind: 'loading' }
    if (ratesFromQuery === null) return { kind: 'error' }
    return { kind: 'ready' }
  }, [state.step, rateKeyItems.length, ratesFromQuery])

  // Displayable currency conversion entries: one row per
  // `(date, base, target)` triple, paired with the rate the provider
  // returned. The list is built in input order so the confirm step can
  // show rates alongside the dates they apply to. We only emit entries
  // when the tRPC batch succeeded — the error / loading banners already
  // handle the other states.
  const currencyConversions = useMemo<
    Array<{
      date: string
      source: string
      target: string
      rate: number
      asOfDate: string
    }>
  >(() => {
    if (!ratesQuery.data) return []
    return rateKeyItems
      .map((item, idx) => {
        const result = ratesQuery.data?.[idx]
        if (!result || !result.ok) return null
        return {
          date: item.date,
          source: item.base,
          target: item.target,
          rate: result.rate.rate,
          asOfDate: result.rate.asOfDate,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  }, [rateKeyItems, ratesQuery.data])

  const handleSubmit = useCallback(async () => {
    if (!state.source) return
    if (!state.mode) return
    if (!account) return
    // Cross-currency imports must wait until the rates are ready and
    // must block when the fetch failed — silently falling back would
    // store source-currency amounts in the destination ledger.
    if (rateKeyItems.length > 0) {
      if (state.rates === undefined || state.rates === null) {
        toast({
          description: t('Groups.Import.Confirm.rateFetchError'),
          variant: 'destructive',
        })
        return
      }
    }
    try {
      const sourceMeta = {
        provider: 'SPLIIT',
        sourceGroupId: state.source.sourceGroupId,
        sourceUrl: state.prefillSourceUrl ?? undefined,
      }
      const { batch } = buildImportBatch(
        state,
        destinationCurrencyCode,
        state.rates === undefined ? undefined : (state.rates ?? undefined),
      )
      const expenses = buildImportExpenses(batch.expenses)
      await importMutation.mutateAsync({ ...batch, expenses, sourceMeta })
    } catch {
      // Error surfaced via onError.
    }
  }, [
    state,
    importMutation,
    account,
    destinationCurrencyCode,
    rateKeyItems.length,
    toast,
    t,
  ])

  const handleDoneNavigate = useCallback(() => {
    const groupId = importMutation.data?.groupId
    if (groupId) {
      router.push({ to: '/groups/$groupId', params: { groupId } })
    } else {
      router.push({ to: '/' })
    }
  }, [importMutation.data, router])

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        step={state.step}
        onBack={() => {
          if (state.step === 'source') return
          if (state.step === 'destination') {
            setState((s) => ({ ...s, step: 'source' }))
          } else if (state.step === 'mapping') {
            setState((s) => ({ ...s, step: 'destination' }))
          } else if (state.step === 'confirm') {
            setState((s) => ({ ...s, step: 'mapping' }))
          }
          window.history.pushState({ importWizard: true }, '')
        }}
      />
      {state.step === 'source' && (
        <SourceStep onLoaded={handleSourceLoaded} onError={handleSourceError} />
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
          onChange={handleMappingChange}
          onContinue={handleMappingContinue}
        />
      )}
      {state.step === 'confirm' && state.source && state.mode && (
        <ConfirmStep
          source={state.source}
          mode={state.mode}
          targetGroupId={state.targetGroupId}
          groupFormValues={state.groupFormValues}
          participants={state.participants}
          resolvedExpenses={state.resolvedExpenses}
          invites={importMutation.data?.invites ?? []}
          isSubmitting={importMutation.isPending}
          ratesStatus={confirmRatesStatus}
          currencyConversions={currencyConversions}
          onBack={() => setState((s) => ({ ...s, step: 'mapping' }))}
          onSubmit={handleSubmit}
        />
      )}
      {state.step === 'done' && (
        <DoneStep
          groupId={importMutation.data?.groupId ?? null}
          invites={importMutation.data?.invites ?? []}
          onContinue={handleDoneNavigate}
        />
      )}
    </div>
  )
}

function StepHeader({
  step,
  onBack,
}: {
  step: ImportStep
  onBack: () => void
}) {
  const { t } = useTranslation()
  const stepLabel = t(`Groups.Import.StepHeader.${step}`)
  const isFirstStep = step === 'source'
  return (
    <div className="flex items-center gap-2">
      {!isFirstStep && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label={t('Groups.Import.StepHeader.backAriaLabel')}
          className="shrink-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">
          {t('Groups.Import.StepHeader.title')}
        </p>
        <h1 className="text-2xl font-semibold leading-none">{stepLabel}</h1>
      </div>
    </div>
  )
}

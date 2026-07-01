import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  ParticipantMappingState,
} from '@spliit/domain/import'
import { applyAutoMatch, buildImportBatch } from '@spliit/domain/import'
import { getRouteApi } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmStep } from './confirm-step'
import {
  CurrencyConversionStep,
  type ConversionResult,
} from './currency-conversion-step'
import { DestinationStep } from './destination-step'
import { DoneStep } from './done-step'
import {
  buildImportExpenses,
  getStepNavigation,
  initialGroupFormValues,
  type CustomContinueLabelKey,
  type ImportMode,
  type ImportStep,
  type StepNavRegistration,
  type WizardState,
} from './import-wizard-state'
import { MappingStep } from './mapping-step'
import { SourceStep } from './source-step'
import { useImportSource } from './use-import-source'

const importRoute = getRouteApi('/groups/import')

/**
 * i18n key for the step's short label shown in the wizard header.
 * Const-typed so `t(STEP_HEADER_LABEL_KEYS[step])` validates each
 * literal against the strict key check without `as any`.
 */
const STEP_HEADER_LABEL_KEYS = {
  source: 'Groups.Import.StepHeader.source',
  destination: 'Groups.Import.StepHeader.destination',
  mapping: 'Groups.Import.StepHeader.mapping',
  currencyConversion: 'Groups.Import.StepHeader.currencyConversion',
  confirm: 'Groups.Import.StepHeader.confirm',
  done: 'Groups.Import.StepHeader.done',
} as const satisfies Record<ImportStep, string>

const EMPTY_NAV: StepNavRegistration = {}

/**
 * The wizard stores nav registrations keyed by the active step so
 * that a stale handler from the previous step can't be invoked
 * during the brief render between a step change and the new
 * step's first registration.
 */
type NavByStep = { step: ImportStep; nav: StepNavRegistration }

export function ImportGroupWizard() {
  const search = importRoute.useSearch()
  const router = useRouter()
  const { data: account } = useCurrentAccount()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const prefillSourceUrl = search.prefill ?? null
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
    conversionModes: {},
    fixedRateDates: {},
    fixedRateOverrides: {},
  }))

  const [navByStep, setNavByStep] = useState<NavByStep>({
    step: state.step,
    nav: EMPTY_NAV,
  })

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

  // Import mutation
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
      toast({ description: err.message, variant: 'destructive' })
    },
  })

  // Navigation history
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

  // Source URL prefill
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
      toast({ description: sourcePreview.message, variant: 'destructive' })
    }
    setState((s) => ({ ...s, step: 'source', prefillSourceUrl: null }))
  }, [sourcePreview, state.source, handleSourceLoaded, toast, t])
  useEffect(() => {
    if (state.source) return
    if (!sourcePreviewError) return
    toast({ description: sourcePreviewError.message, variant: 'destructive' })
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
      setState((s) => ({
        ...s,
        sourceIdToDestId: resolved.sourceIdToDestId,
        destIds: resolved.destIds,
        resolvedExpenses: resolved.resolvedExpenses,
        rates: undefined,
        step: 'currencyConversion',
      }))
    },
    [],
  )

  const handleCurrencyConversionContinue = useCallback(
    (result: ConversionResult) => {
      window.history.pushState({ importWizard: true }, '')
      setState((s) => ({
        ...s,
        conversionModes: result.modes,
        fixedRateDates: result.fixedRateDates,
        fixedRateOverrides: result.fixedRateOverrides,
        rates: result.rates,
        step: 'confirm',
      }))
    },
    [],
  )

  const destinationCurrencyCode =
    state.mode === 'EXISTING_GROUP'
      ? (destinationGroupData?.group?.currencyCode ?? '')
      : state.groupFormValues.currencyCode
  const sourceCurrencyCode = state.source?.currencyCode ?? ''

  const handleSubmit = useCallback(async () => {
    if (!state.source) return
    if (!state.mode) return
    if (!account) return
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
      await importMutation.mutateAsync({ ...batch, expenses, sourceMeta })
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
  }, [state, importMutation, account, destinationCurrencyCode, toast, t])

  const handleDoneNavigate = useCallback(() => {
    const groupId = importMutation.data?.groupId
    if (groupId) {
      router.push({ to: '/groups/$groupId', params: { groupId } })
    } else {
      router.push({ to: '/' })
    }
  }, [importMutation.data, router])

  const handleBack = useCallback(() => {
    setState((s) => {
      if (s.step === 'source') return s
      if (s.step === 'destination') return { ...s, step: 'source' }
      if (s.step === 'mapping') return { ...s, step: 'destination' }
      if (s.step === 'currencyConversion') {
        return { ...s, step: 'mapping' }
      }
      if (s.step === 'confirm') {
        return { ...s, step: 'currencyConversion' }
      }
      return s
    })
    window.history.pushState({ importWizard: true }, '')
  }, [])

  // Steps register their Continue handler / disabled state / label
  // overrides under the step they belong to. The wizard only reads
  // the entry for the active step so a stale handler from a
  // previously-mounted step can't fire.
  const registerStepNav = useCallback(
    (step: ImportStep, nav: Partial<StepNavRegistration>) => {
      setNavByStep((prev) => {
        if (prev.step === step) {
          return { step, nav: { ...prev.nav, ...nav } }
        }
        return { step, nav }
      })
    },
    [],
  )
  const currentNav = navByStep.step === state.step ? navByStep.nav : EMPTY_NAV

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step={state.step} />

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
          mode={state.mode}
          onContinue={handleDestinationChosen}
          registerStepNav={registerStepNav}
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
          registerStepNav={registerStepNav}
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
          onContinue={handleCurrencyConversionContinue}
          registerStepNav={registerStepNav}
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
          invites={importMutation.data?.invites ?? []}
          isSubmitting={importMutation.isPending}
          conversionModes={state.conversionModes}
          onSubmit={handleSubmit}
          registerStepNav={registerStepNav}
        />
      )}

      {state.step === 'done' && (
        <DoneStep
          groupId={importMutation.data?.groupId ?? null}
          invites={importMutation.data?.invites ?? []}
          onContinue={handleDoneNavigate}
        />
      )}

      <WizardNav
        step={state.step}
        onBack={handleBack}
        onContinue={currentNav.onContinue}
        continueAsFormId={currentNav.continueAsFormId}
        continueDisabled={!!currentNav.disabled}
        customContinueLabel={currentNav.customContinueLabel}
      />
    </div>
  )
}

function StepHeader({ step }: { step: ImportStep }) {
  const { t } = useTranslation()
  const stepLabel = t(STEP_HEADER_LABEL_KEYS[step])
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        {t('Groups.Import.StepHeader.title')}
      </p>
      <h1 className="text-2xl font-semibold leading-none">{stepLabel}</h1>
    </div>
  )
}

type WizardNavProps = {
  step: ImportStep
  onBack: () => void
  onContinue?: () => void
  continueAsFormId?: string
  continueDisabled?: boolean
  customContinueLabel?: CustomContinueLabelKey
}

function WizardNav({
  step,
  onBack,
  onContinue,
  continueAsFormId,
  continueDisabled,
  customContinueLabel,
}: WizardNavProps) {
  const { t } = useTranslation()
  const nav = getStepNavigation(step)

  // No nav for the first (source) or last (done) terminal steps.
  // Done renders its own Open Group button; source transitions via
  // its own file/URL inputs.
  if (!nav.previousStepKey && !nav.nextStepKey) return null
  if (step === 'done') return null

  const previousStepLabel = nav.previousStepKey
    ? t(STEP_HEADER_LABEL_KEYS[nav.previousStepKey])
    : undefined
  const nextStepLabel = nav.nextStepKey
    ? t(STEP_HEADER_LABEL_KEYS[nav.nextStepKey])
    : undefined

  const backLabel = nav.previousStepKey
    ? t('Groups.Import.StepHeader.backTo', { step: previousStepLabel })
    : undefined
  const continueLabel =
    customContinueLabel !== undefined
      ? t(customContinueLabel)
      : nextStepLabel
        ? t('Groups.Import.StepHeader.continueTo', { step: nextStepLabel })
        : undefined

  const showContinue = continueLabel !== undefined

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {nav.previousStepKey ? (
        <Button variant="ghost" onClick={onBack} type="button">
          {backLabel}
        </Button>
      ) : (
        <span />
      )}
      {showContinue &&
        (continueAsFormId ? (
          <Button
            type="submit"
            form={continueAsFormId}
            disabled={continueDisabled}
          >
            {continueLabel}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled || !onContinue}
          >
            {continueLabel}
          </Button>
        ))}
    </div>
  )
}

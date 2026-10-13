import { getRouteApi, Link } from '@tanstack/react-router'
import { Option } from 'effect'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentGroupOrNull } from '@/app/groups/[groupId]/current-group-context'
import { formatMinorAmount } from '@/app/groups/[groupId]/expenses/csv-import-review-model'
import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { CurrencyIcon } from '@/components/currency-icon'
import {
  PairConversionCard,
  classifyPairResults,
  pairKey,
  rateItemKey,
  type PairRateSummary,
} from '@/components/currency-pair-conversion-card'
import { CurrencySelector } from '@/components/currency-selector'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  WizardNav,
  WizardProgress,
  WizardStepHeader,
} from '@/components/wizard'
import { useLocale } from '@/i18n/react'
import type { AccountPreferences } from '@/lib/account-preferences'
import { useCurrencies } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { useCurrencyRates } from '@/lib/hooks'
import { useOnlineStatus } from '@/lib/use-online-status'
import { formatCurrency } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { getCurrency } from '@spliit/domain'

import { SwapFullListDialog, SwapReviewRow } from './swap-review-list'

type SwapPair = AppRouterOutput['groups']['swapPairs']['pairs'][number]

type Step = 'target' | 'rates' | 'review' | 'confirm'
const STEPS: Step[] = ['target', 'rates', 'review', 'confirm']

const PREVIEW_PAGE_SIZE = 500

type ModesPayload = Record<
  string,
  | { mode: 'perDate'; allowFixedFallback?: boolean }
  | { mode: 'fixed'; date: string; override?: number }
>

const swapRouteApi = getRouteApi('/groups/$groupId/tools/swap')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Locale-aware money formatting for the review step. Falls back to the plain
 * `amount CODE` rendering for custom codes unknown to the currency catalog.
 */
function formatSwapAmount(code: string, minor: number, locale: string) {
  const currency = getCurrency(code)
  if (!currency) return formatMinorAmount(minor, code)
  return formatCurrency(currency, minor, locale)
}

export function CurrencySwapPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Swap' })
  const { t: tTools } = useTranslation()
  const locale = useLocale()
  const groupContext = useCurrentGroupOrNull()
  const { group, groupId, displayName, currentMember } = groupContext ?? {}
  const resolvedGroupId = groupId ?? ''
  const isOnline = useOnlineStatus()
  const oldCode = group?.currencyCode ?? null
  const { target: entryTarget } = swapRouteApi.useSearch()

  const [step, setStep] = useState<Step>('target')
  const [target, setTarget] = useState('')
  const [modes, setModes] = useState<Record<string, 'perDate' | 'fixed'>>({})
  const [dates, setDates] = useState<Record<string, string>>({})
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [fixedRates, setFixedRates] = useState<Record<string, number>>({})
  // Per-date fixed fallback per pair (withdrawn pairs only in the UI).
  // Absent = allow (the historical always-fallback behavior).
  const [fallbacks, setFallbacks] = useState<Record<string, boolean>>({})
  const [fullListOpen, setFullListOpen] = useState(false)
  const [done, setDone] = useState<{ updated: number; newCode: string } | null>(
    null,
  )

  const currencies = useCurrencies('')
  const sourceCurrency = currencies.find((c) => c.code === oldCode)
  const targetCurrencies = useMemo(
    () => currencies.filter((c) => c.code && c.code !== oldCode),
    [currencies, oldCode],
  )
  const targetCurrency = currencies.find((c) => c.code === target)
  // Settings-handoff target: only a real, non-current code counts. Anything
  // else (hand-typed URL, stale bookmark) is ignored like a missing param.
  const entryTargetCode = typeof entryTarget === 'string' ? entryTarget : ''
  const entryTargetValid =
    entryTargetCode.length > 0 &&
    entryTargetCode !== oldCode &&
    currencies.some((c) => c.code === entryTargetCode)
  const canMutate =
    Boolean(group) &&
    !group?.archived &&
    isOnline &&
    oldCode != null &&
    currentMember?.role === 'ADMIN'
  const targetValid = target.length > 0 && target !== oldCode

  // Preselect the settings-handoff target first, falling back to the user's
  // default currency once (render-time guard, same pattern as the pair
  // seeding below). When it matches the ledger or is unavailable the
  // selector stays empty — no guessing. Signed-in prefs resolve async (null
  // until synced), so the deployment default must not win the race while
  // they are still pending — the guard re-runs until a pick sticks.
  // Signed-out and test renders never resolve (updater null) and keep the
  // immediate deployment fallback.
  const accountPreferences =
    useSyncedAccountPreferences() as AccountPreferences | null
  const prefsUpdater = useAccountPreferenceUpdater()
  const prefsPending = prefsUpdater != null && !prefsUpdater.ready
  const deploymentCurrencyCode = useDeploymentConfig().defaultCurrencyCode
  if (target === '' && oldCode != null) {
    const preferred = entryTargetValid
      ? entryTargetCode
      : (accountPreferences?.defaultCurrencyCode ??
        (prefsPending ? undefined : deploymentCurrencyCode))
    if (
      preferred &&
      preferred !== oldCode &&
      targetCurrencies.some((c) => c.code === preferred)
    ) {
      setTarget(preferred)
    }
  }

  // Pairs drive the step-2 cards (DB-only, no provider calls).
  const pairsQuery = trpc.groups.swapPairs.useQuery(
    { groupId: resolvedGroupId, targetCurrencyCode: target },
    { enabled: canMutate && targetValid && !!resolvedGroupId, retry: false },
  )
  const pairs: SwapPair[] = useMemo(
    () => pairsQuery.data?.pairs ?? [],
    [pairsQuery.data],
  )
  const expenseCount = pairsQuery.data?.expenseCount ?? 0

  // Seed per-pair mode/date entries once pairs arrive (render-time guard
  // like the importer: merges into the current batch, never loops).
  const missingPairKeys = pairs
    .map((p) => pairKey(p))
    .filter((k) => !(k in modes))
  if (missingPairKeys.length > 0) {
    const today = todayIso()
    setModes((prev) => {
      const next = { ...prev }
      for (const k of missingPairKeys) if (!(k in next)) next[k] = 'perDate'
      return next
    })
    setDates((prev) => {
      const next = { ...prev }
      for (const k of missingPairKeys) if (!(k in next)) next[k] = today
      return next
    })
  }

  // Prefetch per-date rates for perDate pairs (same hook as the importer).
  // Strict pairs (fallback off) ask the server for market-only rates.
  const rateKeyItems = useMemo(() => {
    const items: Array<{
      date: string
      base: string
      target: string
      allowFixedFallback?: boolean
    }> = []
    for (const pair of pairs) {
      const key = pairKey(pair)
      if ((modes[key] ?? 'perDate') !== 'perDate') continue
      const strict = fallbacks[key] === false
      for (const date of pair.dates) {
        items.push({
          date,
          base: pair.base,
          target: pair.target,
          ...(strict ? { allowFixedFallback: false as const } : {}),
        })
      }
    }
    return items
  }, [pairs, modes, fallbacks])
  const perDateQuery = useCurrencyRates(rateKeyItems, {
    enabled: rateKeyItems.length > 0,
  })
  // Strict-aware classification per pair: fallback-composed entries count as
  // missing for strict pairs (the server already resolves them as
  // RATE_NOT_FOUND; the client filter covers shared/cached fallback data).
  const perDateClassification = useMemo(() => {
    const data = perDateQuery.data
    if (!data || data.length !== rateKeyItems.length) return null
    const values: Record<string, number> = {}
    const failed = new Set<string>()
    const summaries = new Map<string, PairRateSummary>()
    for (const pair of pairs) {
      const key = pairKey(pair)
      if ((modes[key] ?? 'perDate') !== 'perDate') continue
      const classified = classifyPairResults(
        pair,
        rateKeyItems,
        data,
        fallbacks[key] ?? true,
      )
      Object.assign(values, classified.values)
      for (const failedKey of classified.failedKeys) failed.add(failedKey)
      if (classified.summary) summaries.set(key, classified.summary)
    }
    return { values, failed, summaries }
  }, [pairs, modes, rateKeyItems, perDateQuery.data, fallbacks])
  const perDateValues = perDateClassification?.values ?? null
  const perDateFailedKeys: Set<string> =
    perDateClassification?.failed ?? new Set<string>()

  // The per-date prefetch above is display-only (the review preview
  // re-resolves every rate server-side), so it never blocks navigation.
  // Only fixed-mode inputs must be valid: a real date always, and a
  // positive override when custom mode is armed (`null` is checked-empty).
  const fixedInputsValid = useMemo(() => {
    for (const pair of pairs) {
      const key = pairKey(pair)
      if ((modes[key] ?? 'perDate') !== 'fixed') continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[key] ?? '')) return false
      const override = overrides[key]
      if (override === null) return false
      if (override !== undefined && !(override > 0)) return false
    }
    return true
  }, [pairs, modes, dates, overrides])

  const canContinueFromRates = pairsQuery.isSuccess && fixedInputsValid

  const modesPayload: ModesPayload = useMemo(() => {
    const out: ModesPayload = {}
    for (const pair of pairs) {
      const key = pairKey(pair)
      if ((modes[key] ?? 'perDate') === 'perDate') {
        // Strict pairs resolve post-withdrawal dates as missing server-side.
        out[key] =
          fallbacks[key] === false
            ? { mode: 'perDate', allowFixedFallback: false }
            : { mode: 'perDate' }
      } else {
        // Custom mode arms only with a real positive rate (`null` is
        // checked-empty and falls back to date mode until typed).
        const overrideOption = Option.fromNullishOr(overrides[key]).pipe(
          Option.filter((o) => o > 0),
        )
        const date = dates[key] ?? todayIso()
        out[key] = Option.isSome(overrideOption)
          ? { mode: 'fixed', date, override: overrideOption.value }
          : { mode: 'fixed', date }
      }
    }
    return out
  }, [pairs, modes, dates, overrides, fallbacks])

  // Paginated preview: the server caps pages at 500 rows but plans totals
  // globally, so every page is fetched and concatenated — the review shows
  // all expenses, never just the first page.
  const preview = trpc.groups.swapPreview.useInfiniteQuery(
    {
      groupId: resolvedGroupId,
      targetCurrencyCode: target,
      modes: modesPayload,
      limit: PREVIEW_PAGE_SIZE,
    },
    {
      enabled:
        step === 'review' || step === 'confirm'
          ? canMutate && targetValid && !!resolvedGroupId
          : false,
      retry: false,
      refetchOnWindowFocus: false,
      getNextPageParam: (lastPage, allPages) => {
        if (lastPage.rows.length === 0) return undefined
        const loaded = allPages.reduce(
          (count, page) => count + page.rows.length,
          0,
        )
        return loaded < lastPage.expenseCount ? loaded : undefined
      },
    },
  )
  // Eagerly fetch every page: the summary, filters and confirm all need the
  // complete plan, and 1225 expenses are only three pages. Stops on a page
  // failure — the error surfaces below with a manual retry instead of an
  // automatic loop.
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    failureReason,
    fetchNextPage,
  } = preview
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const previewMeta = preview.data?.pages[0] ?? null
  const utils = trpc.useUtils()
  const execute = trpc.groups.swapExecute.useMutation()

  const rows = useMemo(
    () => preview.data?.pages.flatMap((page) => page.rows) ?? [],
    [preview.data],
  )
  // The inline review shows only expenses that need attention; the full
  // list lives one click away in a dialog (importer mapping pattern), so a
  // 1225-row group keeps a short page and reachable footer actions.
  const attentionRows = useMemo(
    () => rows.filter((row) => row.warning != null),
    [rows],
  )

  const kindCounts = useMemo(() => {
    const counts = { converted: 0, cleared: 0, bridged: 0 }
    for (const row of rows) {
      if (row.kind === 'simple' || row.kind === 'fresh') counts.converted += 1
      else counts[row.kind] += 1
    }
    return counts
  }, [rows])

  // Rate failures grouped by conversion pair: missing-rate rows route through
  // the same pair rule as the step-2 cards (fresh rows keep their original
  // currency, every other lane resolves through the ledger currency), so a
  // failed pair can retry just its own rates instead of the whole preview.
  const failedPairs = useMemo(() => {
    if (!previewMeta) return []
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.warning !== 'missing-rate') continue
      const base =
        (row.kind === 'fresh'
          ? row.newOriginalCurrency
          : null
        )?.toUpperCase() ?? previewMeta.oldCode.toUpperCase()
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
    return [...counts.entries()].map(([base, count]) => {
      const key = pairKey({ base, target: previewMeta.newCode })
      return {
        key,
        base,
        count,
        pair: pairs.find((candidate) => pairKey(candidate) === key),
      }
    })
  }, [rows, previewMeta, pairs])
  const [pairStatus, setPairStatus] = useState<Record<string, number | null>>(
    {},
  )
  const handlePairStatus = useCallback(
    (base: string, missing: number | null) => {
      setPairStatus((prev) =>
        prev[base] === missing ? prev : { ...prev, [base]: missing },
      )
    },
    [],
  )
  // Stale statuses for pairs that already dropped out of `failedPairs` are
  // ignored by construction — only currently-failing pairs count.
  const showReloadPreview =
    (previewMeta?.missingRateCount ?? 0) > 0 &&
    failedPairs.some(({ base }) => pairStatus[base] === 0)

  // Truncated (>5000 expenses) can never execute — the server rejects beyond
  // its execute cap — so it blocks like a missing rate. hasNextPage also
  // blocks: it stays true while pages are pending or a page failed.
  const blocked =
    !previewMeta ||
    previewMeta.truncated ||
    previewMeta.missingRateCount > 0 ||
    preview.isFetching ||
    (hasNextPage ?? false)

  // Programmatic reason for the disabled Continue (wired via aria-describedby
  // so AT users hear why the button is unavailable). Only points at elements
  // actually rendered — a background refetch with no visible indicator leaves
  // the button undescribed rather than dangling.
  const reviewBlockReasonId = !previewMeta
    ? undefined
    : previewMeta.truncated
      ? 'swap-block-truncated'
      : previewMeta.missingRateCount > 0
        ? 'swap-block-rates'
        : hasNextPage || isFetchingNextPage
          ? 'swap-block-loading'
          : undefined

  async function handleExecute() {
    if (blocked || execute.isPending) return
    try {
      const result = await execute.mutateAsync({
        groupId: resolvedGroupId,
        targetCurrencyCode: target,
        modes: modesPayload,
      })
      setDone(result)
      await utils.groups.invalidate()
    } catch {
      // Error surfaces via `execute.error` below.
    }
  }

  if (!group) {
    return (
      <div className="mb-4 flex flex-col gap-4">
        <p className="px-1 text-sm text-muted-foreground">
          {t('groupUnavailable')}
        </p>
      </div>
    )
  }

  // ADMIN-only tool (mirrors the server `authorizeSwapAccess` gate and the
  // tools-page card): members opening the URL directly get an honest notice
  // instead of walking disabled steps into server FORBIDDEN errors.
  if (currentMember?.role !== 'ADMIN') {
    return (
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 pb-24">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2 w-fit"
            nativeButton={false}
            render={
              <Link
                to="/groups/$groupId/tools"
                params={{ groupId: resolvedGroupId }}
              />
            }
          >
            <ArrowLeft className="me-2 size-4 rtl:rotate-180" />
            {t('backToTools')}
          </Button>
        </div>
        <Card>
          <CardContent spacing="standalone">
            <p className="text-sm text-muted-foreground">
              {t('adminOnlyNotice')}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const progressSteps = STEPS.map((id) => ({
    id,
    label: tTools(`Tools.swap.steps.${id}.title`),
  }))

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 pb-24">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 w-fit"
          nativeButton={false}
          render={
            <Link
              to="/groups/$groupId/tools"
              params={{ groupId: resolvedGroupId }}
            />
          }
        >
          <ArrowLeft className="me-2 size-4 rtl:rotate-180" />
          {t('backToTools')}
        </Button>
        <div className="mt-2">
          <WizardStepHeader
            eyebrow={displayName ?? t('title')}
            title={t('title')}
            description={
              step === 'target'
                ? t('target.description', { current: oldCode ?? '' })
                : step === 'rates'
                  ? t('pairs.description', { code: target })
                  : step === 'review'
                    ? previewMeta
                      ? t('preview.description', {
                          count: previewMeta.expenseCount,
                          from: previewMeta.oldCode,
                          to: previewMeta.newCode,
                        })
                      : t('preview.loadingWithCount', { count: expenseCount })
                    : t('confirm.description')
            }
            focusOnChange
          />
        </div>
        <div className="mt-3">
          <WizardProgress
            steps={progressSteps}
            currentStep={step}
            completed={done !== null}
            ariaLabel={t('progressAriaLabel')}
            className="w-full"
          />
        </div>
      </div>

      {step === 'target' && (
        <Card>
          <CardContent spacing="standalone" className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('target.intro')}</p>
            {entryTargetValid &&
            target === entryTargetCode &&
            targetCurrency ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <p className="text-sm font-medium">{t('entryNotice.title')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('entryNotice.body', {
                    to: entryTargetCode,
                    name: targetCurrency.name,
                  })}
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t('target.currentLabel')}
              </p>
              {sourceCurrency ? (
                <span className="flex w-fit min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm">
                  <CurrencyIcon code={sourceCurrency.code} />
                  <span className="truncate font-medium">
                    {sourceCurrency.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {sourceCurrency.code}
                  </span>
                </span>
              ) : (
                <span className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-sm tabular-nums">
                  {oldCode}
                </span>
              )}
              <p className="text-xs text-muted-foreground">
                {t('target.currentHint', { current: oldCode ?? '' })}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="swap-target-currency"
                className="text-xs font-medium text-muted-foreground"
              >
                {t('target.label')}
              </Label>
              <CurrencySelector
                id="swap-target-currency"
                aria-label={t('target.label')}
                currencies={targetCurrencies}
                defaultValue={target}
                placeholder={t('target.placeholder')}
                pinnedCurrencyCode={target || undefined}
                disabled={!canMutate}
                onValueChange={setTarget}
                isLoading={false}
              />
              {targetValid && targetCurrency ? (
                <p className="text-xs text-muted-foreground">
                  {t('target.targetHint', {
                    from: oldCode ?? '',
                    to: target,
                    name: targetCurrency.name,
                  })}
                </p>
              ) : null}
            </div>
            {target.length > 0 && target === oldCode ? (
              <p className="text-xs text-destructive">
                {t('target.sameAsCurrent')}
              </p>
            ) : null}
            {!canMutate ? (
              <p className="text-xs text-muted-foreground">
                {!isOnline
                  ? t('offlineNotice')
                  : group.archived
                    ? t('archivedNotice')
                    : t('customLedgerNotice')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {step === 'rates' && (
        <div className="flex flex-col gap-3">
          {pairsQuery.isLoading ? (
            <Card>
              <CardContent
                spacing="standalone"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('pairs.loading')}
              </CardContent>
            </Card>
          ) : pairsQuery.error ? (
            <Card>
              <CardContent
                spacing="standalone"
                className="flex items-center gap-2 text-sm text-destructive"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                {pairsQuery.error.message}
              </CardContent>
            </Card>
          ) : pairs.length === 0 ? (
            <Card>
              <CardContent
                spacing="standalone"
                className="text-sm text-muted-foreground"
              >
                {t('pairs.empty', { code: target })}
              </CardContent>
            </Card>
          ) : (
            pairs.map((pair) => {
              const key = pairKey(pair)
              const hasPerDateResultError = pair.dates.some((date) =>
                perDateFailedKeys.has(rateItemKey({ date, ...pair })),
              )
              return (
                <Card key={key} className="overflow-hidden">
                  <CardContent spacing="standalone">
                    <PairConversionCard
                      pair={pair}
                      pairKey={key}
                      mode={modes[key] ?? 'perDate'}
                      date={dates[key] ?? todayIso()}
                      override={overrides[key]}
                      fixedRate={fixedRates[key]}
                      onFixedRate={(r) =>
                        setFixedRates((p) => ({ ...p, [key]: r }))
                      }
                      perDateValues={perDateValues}
                      perDateFetching={
                        perDateQuery.isLoading || perDateQuery.isFetching
                      }
                      perDateError={
                        !!perDateQuery.error || hasPerDateResultError
                      }
                      onRefreshPerDate={() => perDateQuery.refetch()}
                      onModeChange={(m) =>
                        setModes((p) => ({ ...p, [key]: m }))
                      }
                      fallbackEnabled={fallbacks[key] ?? true}
                      onFallbackChange={(v) =>
                        setFallbacks((p) => ({ ...p, [key]: v }))
                      }
                      perDateSummary={
                        perDateClassification?.summaries.get(key) ?? null
                      }
                      onDateChange={(d) => {
                        setDates((p) => ({ ...p, [key]: d }))
                        setFixedRates((p) => {
                          if (p[key] === undefined) return p
                          const next = { ...p }
                          delete next[key]
                          return next
                        })
                      }}
                      onOverrideChange={(v) =>
                        setOverrides((p) => {
                          const next = { ...p }
                          if (v === undefined) delete next[key]
                          else next[key] = v
                          return next
                        })
                      }
                    />
                    <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                      {t('pairs.expenseCount', { count: pair.expenseCount })}
                    </p>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      )}

      {step === 'review' && (
        <Card>
          <CardContent spacing="standalone" className="flex flex-col gap-3">
            {preview.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('preview.loadingWithCount', { count: expenseCount })}
              </p>
            ) : null}
            {preview.error ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {preview.error.message}
                </p>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => preview.refetch()}
                  >
                    {t('retry')}
                  </Button>
                </div>
              </div>
            ) : null}
            {previewMeta ? (
              <>
                <section
                  aria-label={t('preview.totalAriaLabel', {
                    from: previewMeta.oldCode,
                    to: previewMeta.newCode,
                  })}
                  className="flex flex-col gap-1.5 px-1 py-1"
                >
                  <p className="text-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-left">
                    {t('preview.totalTitle', {
                      count: previewMeta.expenseCount,
                    })}
                  </p>
                  <span className="flex flex-col gap-1 text-base font-bold tabular-nums sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-2 sm:text-xl">
                    <span className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
                      <CurrencyIcon
                        code={previewMeta.oldCode}
                        className="w-6 shrink-0 sm:w-7"
                      />
                      <span
                        className="min-w-0 truncate"
                        title={formatSwapAmount(
                          previewMeta.oldCode,
                          previewMeta.sumOld,
                          locale,
                        )}
                      >
                        {formatSwapAmount(
                          previewMeta.oldCode,
                          previewMeta.sumOld,
                          locale,
                        )}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex justify-center py-0.5 text-muted-foreground"
                    >
                      <ArrowDown className="size-4 sm:hidden" />
                      <ArrowRight className="hidden size-5 shrink-0 sm:block" />
                    </span>
                    <span className="flex min-w-0 items-center justify-center gap-2 sm:justify-end">
                      <CurrencyIcon
                        code={previewMeta.newCode}
                        className="w-6 shrink-0 sm:w-7"
                      />
                      <span
                        className="min-w-0 truncate"
                        title={formatSwapAmount(
                          previewMeta.newCode,
                          previewMeta.sumNew,
                          locale,
                        )}
                      >
                        {formatSwapAmount(
                          previewMeta.newCode,
                          previewMeta.sumNew,
                          locale,
                        )}
                      </span>
                    </span>
                  </span>
                  {previewMeta.missingRateCount > 0 ? (
                    <span
                      id="swap-block-rates"
                      className="text-center text-sm font-normal text-destructive sm:text-left"
                    >
                      {t('preview.missingRates', {
                        count: previewMeta.missingRateCount,
                      })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center gap-1 text-sm font-normal text-emerald-700 sm:justify-start dark:text-emerald-400">
                      <Check className="size-3.5" aria-hidden="true" />
                      {t('preview.ratesOk')}
                    </span>
                  )}
                  <p className="text-center text-xs text-muted-foreground sm:text-left">
                    {t('preview.totalBreakdown', {
                      converted: kindCounts.converted,
                      cleared: kindCounts.cleared,
                      bridged: kindCounts.bridged,
                      to: previewMeta.newCode,
                    })}
                  </p>
                </section>
                {previewMeta.warnings.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {previewMeta.warnings.map((warning) => (
                      <li key={warning} className="flex items-start gap-1.5">
                        <AlertTriangle
                          className="mt-0.5 size-3 shrink-0"
                          aria-hidden="true"
                        />
                        {t(
                          `warnings.${warning}` as
                            | 'warnings.minor-units'
                            | 'warnings.budgets-stale'
                            | 'warnings.recurring-stale'
                            | 'warnings.exact-to-custom'
                            | 'warnings.fixed-fallback',
                          {
                            budgetCount: previewMeta!.budgetCount,
                            recurringCount: previewMeta!.activeRecurringCount,
                          },
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {failedPairs.length > 0 ? (
                  <section
                    aria-label={t('preview.pairSectionTitle')}
                    className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
                  >
                    <h2 className="text-sm font-medium text-destructive">
                      {t('preview.pairSectionTitle')}
                    </h2>
                    {failedPairs.map(({ key, base, count, pair }) => (
                      <FailedPairCard
                        key={key}
                        groupId={resolvedGroupId}
                        target={target}
                        modes={modesPayload}
                        pairKey={key}
                        base={base}
                        count={count}
                        pair={pair}
                        mode={modes[key] ?? 'perDate'}
                        date={dates[key] ?? todayIso()}
                        override={overrides[key]}
                        fixedRate={fixedRates[key]}
                        perDateFetching={
                          perDateQuery.isLoading || perDateQuery.isFetching
                        }
                        perDateError={
                          !!perDateQuery.error ||
                          (pair?.dates.some((date) =>
                            perDateFailedKeys.has(
                              rateItemKey({ date, ...pair }),
                            ),
                          ) ??
                            false)
                        }
                        canRetry={canMutate && targetValid && !!resolvedGroupId}
                        fallbackEnabled={fallbacks[key] ?? true}
                        perDateSummary={
                          perDateClassification?.summaries.get(key) ?? null
                        }
                        onFallbackChange={(v) =>
                          setFallbacks((prev) => ({ ...prev, [key]: v }))
                        }
                        onFixedRate={(rate) =>
                          setFixedRates((prev) => ({ ...prev, [key]: rate }))
                        }
                        onRefreshPerDate={() => perDateQuery.refetch()}
                        onModeChange={(mode) =>
                          setModes((prev) => ({ ...prev, [key]: mode }))
                        }
                        onDateChange={(date) => {
                          setDates((prev) => ({ ...prev, [key]: date }))
                          setFixedRates((prev) => {
                            if (prev[key] === undefined) return prev
                            const next = { ...prev }
                            delete next[key]
                            return next
                          })
                        }}
                        onOverrideChange={(value) =>
                          setOverrides((prev) => {
                            const next = { ...prev }
                            if (value === undefined) delete next[key]
                            else next[key] = value
                            return next
                          })
                        }
                        onStatus={handlePairStatus}
                      />
                    ))}
                    {showReloadPreview ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {t('preview.pairReloadHint')}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            void utils.groups.swapPreview.invalidate()
                          }
                        >
                          {t('preview.reloadPreview')}
                        </Button>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <div className="flex flex-col gap-2">
                  {attentionRows.length > 0 ? (
                    <>
                      <h2 className="text-sm font-medium">
                        {t('filters.attention')}
                      </h2>
                      <div className="min-w-0 rounded-md border border-border/60">
                        <ul aria-label={t('preview.title')}>
                          {attentionRows.map((row) => (
                            <li
                              key={row.id}
                              className="border-b bg-background px-3 py-3 last:border-b-0"
                            >
                              <SwapReviewRow
                                row={row}
                                oldCode={previewMeta.oldCode}
                                newCode={previewMeta.newCode}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : !preview.isFetching && !hasNextPage ? (
                    <p className="text-xs text-muted-foreground">
                      {t('preview.noAttention')}
                    </p>
                  ) : null}
                  <div className="mt-1 border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFullListOpen(true)}
                    >
                      {t('preview.viewFullList', {
                        count: previewMeta.expenseCount,
                      })}
                    </Button>
                  </div>
                </div>
                {isFetchNextPageError ? (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                    <AlertTriangle
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {failureReason instanceof Error
                        ? failureReason.message
                        : t('preview.loadingMore', {
                            loaded: rows.length,
                            count: previewMeta.expenseCount,
                          })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => void fetchNextPage()}
                    >
                      {t('retry')}
                    </Button>
                  </p>
                ) : hasNextPage || isFetchingNextPage ? (
                  <p
                    id="swap-block-loading"
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Loader2
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    {t('preview.loadingMore', {
                      loaded: rows.length,
                      count: previewMeta.expenseCount,
                    })}
                  </p>
                ) : null}
                {previewMeta.truncated ? (
                  <p
                    id="swap-block-truncated"
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {t('preview.truncated', {
                      shown: rows.length,
                      count: previewMeta.expenseCount,
                    })}
                  </p>
                ) : null}
                <SwapFullListDialog
                  open={fullListOpen}
                  onOpenChange={setFullListOpen}
                  rows={rows}
                  totalCount={previewMeta.expenseCount}
                  oldCode={previewMeta.oldCode}
                  newCode={previewMeta.newCode}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {!done && step === 'confirm' && previewMeta ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              {t('confirm.title')}
            </CardTitle>
            <CardDescription>{t('confirm.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {blocked ? (
              previewMeta.truncated || (!preview.isFetching && !hasNextPage) ? (
                <p
                  id="swap-confirm-block"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {previewMeta.truncated
                    ? t('preview.truncated', {
                        shown: rows.length,
                        count: previewMeta.expenseCount,
                      })
                    : t('preview.missingRates', {
                        count: previewMeta.missingRateCount,
                      })}
                </p>
              ) : (
                <p
                  id="swap-confirm-block"
                  className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground"
                >
                  {t('preview.loading')}
                </p>
              )
            ) : (
              <>
                <p className="text-sm">
                  {t('confirm.summary', {
                    count: previewMeta.expenseCount,
                    from: previewMeta.oldCode,
                    to: previewMeta.newCode,
                  })}
                </p>
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {t('confirm.irreversible')}
                </p>
              </>
            )}
            {execute.error ? (
              <p className="text-sm text-destructive">
                {execute.error.message}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {done ? (
        <Card>
          <CardContent
            spacing="standalone"
            className="flex flex-col items-center gap-4 text-center"
          >
            <CheckCircle2
              className="size-12 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">{t('done.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('done.message', {
                  count: done.updated,
                  code: done.newCode,
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: resolvedGroupId }}
                  />
                }
              >
                {t('done.backToGroup')}
              </Button>
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/groups/$groupId/tools"
                    params={{ groupId: resolvedGroupId }}
                  />
                }
              >
                {t('done.backToTools')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <WizardNav
          back={
            step === 'target'
              ? undefined
              : {
                  label: t('back'),
                  onClick: () =>
                    setStep(
                      step === 'rates'
                        ? 'target'
                        : step === 'review'
                          ? 'rates'
                          : 'review',
                    ),
                }
          }
          continue={
            step === 'target'
              ? {
                  label: t('continue'),
                  onClick: () => setStep('rates'),
                  disabled: !canMutate || !targetValid,
                }
              : step === 'rates'
                ? {
                    label: t('previewCta'),
                    onClick: () => setStep('review'),
                    disabled: !canContinueFromRates,
                  }
                : step === 'review'
                  ? {
                      label: t('confirmCta'),
                      onClick: () => setStep('confirm'),
                      disabled: blocked,
                      describedBy: blocked ? reviewBlockReasonId : undefined,
                    }
                  : {
                      label: execute.isPending
                        ? t('confirm.running')
                        : t('confirm.run', {
                            count: previewMeta?.expenseCount ?? 0,
                            to: target,
                          }),
                      onClick: handleExecute,
                      disabled: execute.isPending || blocked || !previewMeta,
                      describedBy:
                        blocked && previewMeta
                          ? 'swap-confirm-block'
                          : undefined,
                    }
          }
        />
      )}
    </div>
  )
}

/**
 * One failed conversion pair inside the review step. Retry re-plans only this
 * pair (`pairBase`, limit 1 — the pair-wide missing count still resolves
 * server-side), so repeated attempts stay cheap on large groups. When retry
 * keeps failing, the same pair card as step 2 is embedded as a fallback: any
 * mode change flows into the shared preview input and re-plans globally.
 */
function FailedPairCard(props: {
  groupId: string
  target: string
  modes: ModesPayload
  pairKey: string
  base: string
  count: number
  pair: SwapPair | undefined
  mode: 'perDate' | 'fixed'
  date: string
  override: number | null | undefined
  fixedRate: number | undefined
  perDateFetching: boolean
  perDateError: boolean
  perDateSummary: PairRateSummary | null
  fallbackEnabled: boolean
  canRetry: boolean
  onFixedRate: (rate: number) => void
  onRefreshPerDate: () => void
  onModeChange: (mode: 'perDate' | 'fixed') => void
  onDateChange: (date: string) => void
  onOverrideChange: (value: number | null | undefined) => void
  onFallbackChange: (enabled: boolean) => void
  onStatus: (base: string, missing: number | null) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Swap' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const scoped = trpc.groups.swapPreview.useQuery(
    {
      groupId: props.groupId,
      targetCurrencyCode: props.target,
      modes: props.modes,
      pairBase: props.base,
      limit: 1,
      cursor: 0,
    },
    { enabled: props.canRetry, retry: false, refetchOnWindowFocus: false },
  )
  const missing = scoped.data?.missingRateCount ?? null
  const { base, onStatus } = props
  useEffect(() => {
    onStatus(base, missing)
  }, [base, missing, onStatus])
  const resolved = missing === 0

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
      <h3 className="text-sm font-medium">
        {t('preview.pairFailedTitle', {
          base: props.base,
          to: props.target,
          count: props.count,
        })}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('preview.pairFailedHint')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {scoped.isFetching ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {t('preview.pairChecking')}
          </p>
        ) : resolved ? (
          <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5" aria-hidden="true" />
            {t('preview.pairResolved')}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!props.canRetry}
            onClick={() => void scoped.refetch()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t('preview.pairRetry')}
          </Button>
        )}
        {scoped.error && !scoped.isFetching ? (
          <p className="text-xs text-destructive">{scoped.error.message}</p>
        ) : null}
        {props.pair ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {t(pickerOpen ? 'preview.pairHidePicker' : 'preview.pairPickRate')}
          </Button>
        ) : null}
      </div>
      {pickerOpen && props.pair ? (
        <PairConversionCard
          pair={props.pair}
          pairKey={props.pairKey}
          mode={props.mode}
          date={props.date}
          override={props.override}
          fixedRate={props.fixedRate}
          onFixedRate={props.onFixedRate}
          perDateValues={null}
          perDateFetching={props.perDateFetching}
          perDateError={props.perDateError}
          perDateSummary={props.perDateSummary}
          fallbackEnabled={props.fallbackEnabled}
          onFallbackChange={props.onFallbackChange}
          onRefreshPerDate={props.onRefreshPerDate}
          onModeChange={props.onModeChange}
          onDateChange={props.onDateChange}
          onOverrideChange={props.onOverrideChange}
        />
      ) : null}
    </div>
  )
}

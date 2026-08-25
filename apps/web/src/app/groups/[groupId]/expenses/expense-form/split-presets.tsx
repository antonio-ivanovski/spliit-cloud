import {
  ChartPie,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Save,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ExpenseSplitBars } from '@/app/groups/[groupId]/expenses/expense-split-bars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { amountAsMinorUnits } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  SplitMode,
} from '@spliit/domain'
import {
  calculatePaidByShares,
  calculateShares,
  serializePaidFor,
  sharesAsDecimal,
} from '@spliit/domain'

import type { GroupShape } from './default-values'
import {
  generatedSplitPresetName,
  uniqueGeneratedSplitPresetName,
} from './split-preset-names'

export type SplitPreset =
  AppRouterOutput['groups']['splitPresets']['list']['presets'][number]
export type SplitPresetTarget = 'PAID_BY' | 'PAID_FOR'
export type SplitPresetSection = SplitPreset
export type LoadedPresetSource = 'MY_DEFAULT' | 'GROUP_DEFAULT' | 'MANUAL'

function targetKey(target: 'paidBy' | 'paidFor'): SplitPresetTarget {
  return target === 'paidBy' ? 'PAID_BY' : 'PAID_FOR'
}

export type PresetSplit = Pick<ExpenseFormInputValues, 'splitMode' | 'paidFor'>

export function sameParticipantDistribution(
  left: Array<{ participant: string; shares: number | string }>,
  right: Array<{ participant: string; shares: number | string }>,
) {
  const canonical = (
    rows: Array<{ participant: string; shares: number | string }>,
  ) =>
    rows
      .map((row) => ({
        participant: row.participant,
        shares: Number(row.shares),
      }))
      .toSorted((a, b) => a.participant.localeCompare(b.participant))
  const a = canonical(left)
  const b = canonical(right)
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.participant === b[index]?.participant &&
        row.shares === b[index]?.shares,
    )
  )
}

export function presetToFormSplit(preset: SplitPreset): PresetSplit {
  if (preset.target !== 'PAID_FOR') {
    return { splitMode: 'EVENLY', paidFor: [] }
  }
  return {
    splitMode: preset.splitMode,
    paidFor: preset.participants.map(({ participant, shares }) => ({
      participant,
      shares:
        preset.splitMode === 'BY_PERCENTAGE'
          ? shares / 100
          : preset.splitMode === 'BY_SHARES'
            ? sharesAsDecimal(shares)
            : 1,
    })),
  }
}

export function presetToFormPaidBySplit(preset: SplitPreset) {
  if (preset.target !== 'PAID_BY') return null
  // A one-participant EVENLY preset is equivalent to the existing single
  // payer control, whose amount is derived from the expense. Keep one-row
  // share/percentage presets in the multi-payer controls so loading and
  // overwriting them preserves their selected mode and weights.
  const useSinglePayer =
    preset.splitMode === 'EVENLY' && preset.participants.length === 1
  return {
    isMultiPayer: !useSinglePayer,
    paidBySplitMode: useSinglePayer ? ('BY_AMOUNT' as const) : preset.splitMode,
    paidByList: preset.participants.map(({ participant, shares }) => ({
      participant,
      shares:
        preset.splitMode === 'BY_PERCENTAGE'
          ? shares / 100
          : preset.splitMode === 'BY_SHARES'
            ? sharesAsDecimal(shares)
            : 1,
    })),
  }
}

function presetSummary(
  preset: SplitPreset,
  group: GroupShape,
  modeLabel: (mode: SplitPreset['splitMode']) => string,
) {
  const names = preset.participants
    .map(
      (row) =>
        group.participants.find(
          (participant) => participant.id === row.participant,
        )?.name ?? row.participant,
    )
    .join(', ')
  const weights =
    preset.splitMode === 'BY_PERCENTAGE'
      ? preset.participants.map((row) => `${row.shares / 100}%`).join(' · ')
      : preset.splitMode === 'BY_SHARES'
        ? preset.participants
            .map((row) => sharesAsDecimal(row.shares))
            .join(' · ')
        : ''
  return `${modeLabel(preset.splitMode)} · ${names}${weights ? ` · ${weights}` : ''}`
}

function presetRowsInGroupOrder(preset: SplitPreset, group: GroupShape) {
  const order = new Map(
    group.participants.map((participant, index) => [participant.id, index]),
  )
  return preset.participants.toSorted(
    (left, right) =>
      (order.get(left.participant) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.participant) ?? Number.MAX_SAFE_INTEGER) ||
      left.participant.localeCompare(right.participant),
  )
}

function presetDistributionRows(
  preset: SplitPreset,
  group: GroupShape,
  amount: number | undefined,
  currency: Currency | undefined,
) {
  const presetRows = presetRowsInGroupOrder(preset, group)
  const participants = presetRows.map((row) => {
    const participant = group.participants.find(
      (candidate) => candidate.id === row.participant,
    )
    return {
      id: row.participant,
      name: participant?.name ?? row.participant,
    }
  })
  const amountMinor =
    amount != null && currency && Number.isFinite(amount) && amount !== 0
      ? amountAsMinorUnits(amount, currency)
      : null
  const sourceRows = participants.map((participant, index) => ({
    participant,
    shares: presetRows[index]?.shares ?? 0,
  }))
  const allocations =
    amountMinor == null
      ? {}
      : preset.target === 'PAID_BY'
        ? calculatePaidByShares({
            id: 'split-preset-preview',
            amount: amountMinor,
            paidBySplitMode: preset.splitMode,
            paidByList: sourceRows,
          })
        : calculateShares({
            id: 'split-preset-preview',
            amount: amountMinor,
            splitMode: preset.splitMode,
            paidFor: sourceRows,
          })
  return participants.map((participant, index) => ({
    id: participant.id,
    name: participant.name,
    participant,
    amount: allocations[participant.id] ?? 0,
    distributionWeight:
      preset.splitMode === 'BY_PERCENTAGE'
        ? (presetRows[index]?.shares ?? 0)
        : preset.splitMode === 'BY_SHARES'
          ? (presetRows[index]?.shares ?? 0)
          : 1,
    value:
      preset.splitMode === 'BY_PERCENTAGE'
        ? `${(presetRows[index]?.shares ?? 0) / 100}%`
        : preset.splitMode === 'BY_SHARES'
          ? String(sharesAsDecimal(presetRows[index]?.shares ?? 0))
          : undefined,
  }))
}

export function PresetDistributionPreview({
  preset,
  group,
  amount,
  currency,
  locale,
  modeLabel,
  showAmounts = false,
  label,
}: {
  preset: SplitPreset
  group: GroupShape
  amount?: number
  currency?: Currency
  locale: string
  modeLabel: string
  showAmounts?: boolean
  label: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const rows = presetDistributionRows(preset, group, amount, currency)
  const hasMeaningfulAmount =
    amount != null && Number.isFinite(amount) && amount !== 0
  return (
    <div className="w-full min-w-0 self-stretch">
      <ExpenseSplitBars
        label={label}
        modeLabel={modeLabel}
        rows={rows.map((row) => ({
          ...row,
          amount: hasMeaningfulAmount ? Math.abs(row.amount) : row.amount,
          amountLabel: hasMeaningfulAmount
            ? amount != null && amount < 0
              ? preset.target === 'PAID_BY'
                ? t('SplitPreset.receives')
                : t('SplitPreset.receivesShare')
              : preset.target === 'PAID_BY'
                ? t('SplitPreset.pays')
                : t('SplitPreset.owes')
            : undefined,
        }))}
        currency={
          currency ?? {
            code: '',
            symbol: '',
            rounding: 0,
            decimal_digits: 2,
          }
        }
        locale={locale}
        compact
        showAmounts={showAmounts && hasMeaningfulAmount}
      />
    </div>
  )
}

export function SplitPresetPicker(props: {
  presets: SplitPreset[]
  group: GroupShape
  target?: 'paidBy' | 'paidFor'
  /** Retained for item-editor callers; one-sided presets never show both. */
  showBothSides?: boolean
  amount?: number
  currency?: Currency
  loadedPreset?: SplitPreset | null
  loadedSource?: LoadedPresetSource | null
  modified?: boolean
  onSaveChanges?: () => void
  onSaveAsNew?: () => void
  canSaveChanges?: boolean
  disabled?: boolean
  loading?: boolean
  onSelect: (preset: SplitPreset) => void
}) {
  const {
    presets,
    group,
    disabled,
    loading,
    onSelect,
    target = 'paidFor',
    amount,
    currency,
    loadedPreset,
    loadedSource,
    modified,
    onSaveChanges,
    onSaveAsNew,
    canSaveChanges,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tMembers } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const modeLabel = useCallback(
    (mode: SplitPreset['splitMode']) =>
      (tMembers as unknown as (key: string) => string)(
        `splitPresets.modes.${mode}`,
      ),
    [tMembers],
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const eligible = useMemo(
    () => presets.filter((preset) => preset.target === targetKey(target)),
    [presets, target],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return eligible
    return eligible.filter((preset) =>
      `${preset.name} ${presetSummary(preset, group, modeLabel)}`
        .toLocaleLowerCase()
        .includes(needle),
    )
  }, [eligible, group, modeLabel, query])
  const grouped = useMemo(
    () =>
      (['PERSONAL', 'SHARED'] as const)
        .map((scope) => ({
          scope,
          presets: filtered.filter((preset) => preset.scope === scope),
        }))
        .filter(({ presets: scopePresets }) => scopePresets.length > 0),
    [filtered],
  )
  const hasMeaningfulAmount =
    amount != null && Number.isFinite(amount) && amount !== 0

  return (
    <>
      <fieldset
        aria-label={
          loadedPreset ? t('SplitPreset.loadedLabel') : t('SplitPreset.heading')
        }
        className="mt-2 w-full min-w-0 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs shadow-xs"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <ChartPie
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="shrink-0 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {loadedPreset
                ? t('SplitPreset.loadedLabel')
                : t('SplitPreset.heading')}
            </span>
            {loadedPreset && (
              <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                {loadedSource === 'MY_DEFAULT' && (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <UserRound className="size-3" aria-hidden="true" />
                    {tMembers('splitPresets.myDefault')}
                  </Badge>
                )}
                {loadedSource === 'GROUP_DEFAULT' && (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <UsersRound className="size-3" aria-hidden="true" />
                    {tMembers('splitPresets.groupDefault')}
                  </Badge>
                )}
                {modified && (
                  <Badge variant="secondary" className="shrink-0">
                    {t('SplitPreset.modified')}
                  </Badge>
                )}
                {modified && onSaveAsNew && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          aria-label={t('SplitPreset.actions')}
                        />
                      }
                    >
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={disabled}
                        onClick={onSaveAsNew}
                      >
                        <FilePlus2 className="me-2 size-4" aria-hidden="true" />
                        {t('SplitPreset.saveAsNew')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 min-w-0">
            {loadedPreset ? (
              <div className="min-w-0">
                <span className="block min-w-0 text-sm leading-snug font-semibold break-words whitespace-normal">
                  {loadedPreset.name}
                </span>
              </div>
            ) : (
              <span className="block min-w-0 text-muted-foreground">
                {loading
                  ? t('SplitPreset.loading')
                  : t('SplitPreset.untracked')}
              </span>
            )}
          </div>
          {!loadedPreset && (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
                aria-label={
                  loading ? t('SplitPreset.loading') : t('SplitPreset.load')
                }
                disabled={disabled || loading}
                onClick={() => setOpen(true)}
              >
                {loading && (
                  <LoaderCircle
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {loading ? t('SplitPreset.loading') : t('SplitPreset.load')}
              </Button>
              {onSaveAsNew && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1 px-2.5 text-xs"
                  disabled={disabled}
                  onClick={onSaveAsNew}
                >
                  <FilePlus2 className="size-3.5" aria-hidden="true" />
                  {t('SplitPreset.saveAsPreset')}
                </Button>
              )}
            </div>
          )}
          {loadedPreset && (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
                disabled={disabled || loading}
                onClick={() => setOpen(true)}
              >
                {loading ? (
                  <LoaderCircle
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <FolderOpen className="size-3.5" aria-hidden="true" />
                )}
                {loading ? t('SplitPreset.loading') : t('SplitPreset.load')}
              </Button>
              {modified && canSaveChanges && onSaveChanges && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 gap-1 px-2.5 text-xs"
                  disabled={disabled}
                  onClick={onSaveChanges}
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  {t('SplitPreset.saveChanges')}
                </Button>
              )}
            </div>
          )}
        </div>
      </fieldset>
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <ResponsiveDialogContent className="gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:grid-rows-[auto_auto_minmax(0,1fr)]">
          <ResponsiveDialogHeader className="px-4 pb-3 sm:px-6 sm:pt-6">
            <ResponsiveDialogTitle>
              {t('SplitPreset.chooseTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('SplitPreset.chooseDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-4 pb-3 sm:px-6">
            <div className="relative min-w-0">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('SplitPreset.search')}
                aria-label={t('SplitPreset.search')}
                className="ps-9"
              />
            </div>
          </div>
          <ResponsiveDialogBody className="min-h-0 w-full overflow-y-auto px-0 pb-0 sm:overflow-y-auto">
            <div className="w-full min-w-0 space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('SplitPreset.loading')}
                </p>
              ) : filtered.length === 0 ? (
                <div className="space-y-2 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('SplitPreset.emptySearch')}
                  </p>
                  {!query.trim() && eligible.length === 0 && onSaveAsNew && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t('SplitPreset.saveDescription')}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOpen(false)
                          onSaveAsNew()
                        }}
                      >
                        {t('SplitPreset.save')}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                grouped.map(({ scope, presets: scopePresets }) => (
                  <section key={scope} className="space-y-1.5">
                    <p className="px-1 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {tMembers(
                        `splitPresets.${scope === 'SHARED' ? 'shared' : 'personal'}`,
                      )}
                    </p>
                    {scopePresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-label={`${preset.name}, ${preset.scope === 'SHARED' ? tMembers('splitPresets.shared') : tMembers('splitPresets.personal')}, ${preset.target === 'PAID_BY' ? tMembers('splitPresets.paidBy') : tMembers('splitPresets.paidFor')}`}
                        className="flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-2 rounded-lg border px-3 py-2.5 text-start transition-colors hover:bg-muted"
                        onClick={() => {
                          onSelect(preset)
                          setOpen(false)
                          setQuery('')
                        }}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="min-w-0 truncate font-medium">
                              {preset.name}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {preset.splitMode === 'BY_PERCENTAGE'
                              ? tMembers('splitPresets.modes.BY_PERCENTAGE')
                              : preset.splitMode === 'BY_SHARES'
                                ? tMembers('splitPresets.modes.BY_SHARES')
                                : tMembers('splitPresets.modes.EVENLY')}
                          </span>
                        </div>
                        <PresetDistributionPreview
                          preset={preset}
                          group={group}
                          amount={amount}
                          currency={currency}
                          locale={locale}
                          modeLabel={modeLabel(preset.splitMode)}
                          showAmounts={hasMeaningfulAmount}
                          label={
                            preset.target === 'PAID_BY'
                              ? t('SplitPreset.payerDistribution')
                              : t('SplitPreset.paidForDistribution')
                          }
                        />
                      </button>
                    ))}
                  </section>
                ))
              )}
            </div>
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

export function SavePresetButton(props: {
  group: GroupShape
  groupCurrency: Currency
  target: SplitPresetTarget
  splitMode?: Exclude<SplitMode, 'BY_AMOUNT' | 'ITEMIZED'>
  paidFor?: ExpenseFormInputValues['paidFor'] | ExpenseFormItemValues['paidFor']
  paidBy?: ExpenseFormInputValues['paidByList']
  canManage?: boolean
  canManageShared?: boolean
  canManagePersonal?: boolean
  existingPreset?: SplitPreset | null
  modified?: boolean
  onSaved?: () => void
  onUpdated?: (preset: SplitPreset) => void
  onSaveChangesReady?: (save: () => void) => void
  onSaveAsReady?: (saveAs: () => void) => void
  hideTrigger?: boolean
  disabled?: boolean
}) {
  const canManageShared = props.canManageShared ?? props.canManage ?? false
  const canManagePersonal = props.canManagePersonal ?? props.canManage ?? false
  if (!canManageShared && !canManagePersonal) return null
  return <ManagedSavePresetButton {...props} />
}

function ManagedSavePresetButton(props: {
  group: GroupShape
  groupCurrency: Currency
  target: SplitPresetTarget
  splitMode?: Exclude<SplitMode, 'BY_AMOUNT' | 'ITEMIZED'>
  paidFor?: ExpenseFormInputValues['paidFor'] | ExpenseFormItemValues['paidFor']
  paidBy?: ExpenseFormInputValues['paidByList']
  canManageShared?: boolean
  canManagePersonal?: boolean
  existingPreset?: SplitPreset | null
  onSaved?: () => void
  onUpdated?: (preset: SplitPreset) => void
  onSaveChangesReady?: (save: () => void) => void
  onSaveAsReady?: (saveAs: () => void) => void
  hideTrigger?: boolean
  disabled?: boolean
}) {
  const {
    group,
    groupCurrency,
    target,
    splitMode,
    paidFor,
    paidBy,
    existingPreset,
    onSaved,
    onUpdated,
    onSaveChangesReady,
    onSaveAsReady,
    hideTrigger,
    disabled,
    canManageShared,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tMembers } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const request = useIdempotentCreate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'SHARED' | 'PERSONAL'>(
    canManageShared ? 'SHARED' : 'PERSONAL',
  )
  const create = trpc.groups.splitPresets.create.useMutation()
  const update = trpc.groups.splitPresets.update.useMutation()
  const presetsQuery = trpc.groups.splitPresets.list.useQuery({
    groupId: group.id,
  })

  const buildPreset = () => {
    const rows = (target === 'PAID_BY' ? paidBy : paidFor)?.filter(
      (row) => Number(row.shares) > 0,
    )
    if (!splitMode || !rows?.length) return null
    const serialized = serializePaidFor({
      splitMode,
      amount: 0,
      currency: groupCurrency,
      paidFor: rows,
    })
    return {
      target,
      splitMode,
      participants: serialized.map((row) => ({
        participant: row.participant,
        shares: row.shares,
      })),
    }
  }

  const currentPreset = buildPreset()
  const generatedSuggestion = currentPreset
    ? generatedSplitPresetName({
        target: currentPreset.target,
        splitMode: currentPreset.splitMode,
        rows: currentPreset.participants,
        participants: group.participants,
        locale,
        sharesAreStored: true,
        t: tMembers as unknown as (
          key: string,
          options?: Record<string, unknown>,
        ) => string,
      })
    : ''

  const submit = async () => {
    const preset = buildPreset()
    const generatedName = generatedSuggestion
      ? uniqueGeneratedSplitPresetName(
          generatedSuggestion,
          (presetsQuery.data?.presets ?? [])
            .filter((candidate) => candidate.scope === scope)
            .map((candidate) => candidate.name),
        )
      : ''
    const trimmed = name.trim() || generatedName
    if (!trimmed || !preset) return
    try {
      await request.run((requestId) =>
        create.mutateAsync({
          requestId,
          groupId: group.id,
          name: trimmed,
          scope,
          ...preset,
        }),
      )
      await utils.groups.splitPresets.list.invalidate({ groupId: group.id })
      setName('')
      setOpen(false)
      onSaved?.()
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('SplitPreset.saveError'),
        variant: 'destructive',
      })
    }
  }

  const saveChanges = async () => {
    if (!existingPreset || existingPreset.target !== target) return
    const preset = buildPreset()
    if (!preset) return
    if (
      existingPreset.scope === 'SHARED' &&
      typeof globalThis.confirm === 'function' &&
      !globalThis.confirm(t('SplitPreset.confirmSharedOverwrite'))
    ) {
      return
    }
    try {
      const result = await update.mutateAsync({
        groupId: group.id,
        presetId: existingPreset.id,
        scope: existingPreset.scope,
        name: existingPreset.name,
        expectedUpdatedAt: existingPreset.updatedAt,
        ...preset,
      })
      await utils.groups.splitPresets.list.invalidate({ groupId: group.id })
      onUpdated?.(result.preset)
      if (!onUpdated) onSaved?.()
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('SplitPreset.saveError'),
        variant: 'destructive',
      })
    }
  }

  const openSaveAsDialog = () => {
    setScope(canManageShared ? 'SHARED' : 'PERSONAL')
    setOpen(true)
  }

  useEffect(() => {
    onSaveChangesReady?.(() => void saveChanges())
    onSaveAsReady?.(openSaveAsDialog)
  })

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-1"
          disabled={disabled || create.isPending}
          onClick={openSaveAsDialog}
        >
          {existingPreset ? t('SplitPreset.saveAsNew') : t('SplitPreset.save')}
        </Button>
      )}
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false)
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('SplitPreset.saveTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('SplitPreset.saveDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="space-y-5">
            {canManageShared && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {tMembers('splitPresets.visibility')}
                </p>
                <RadioGroup
                  value={scope}
                  onValueChange={(value) =>
                    setScope(value as 'SHARED' | 'PERSONAL')
                  }
                  className="gap-2"
                  aria-label={tMembers('splitPresets.visibility')}
                >
                  {(['PERSONAL', 'SHARED'] as const).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                    >
                      <RadioGroupItem
                        value={value}
                        className="cursor-pointer"
                      />
                      <span>
                        {value === 'SHARED'
                          ? tMembers('splitPresets.shared')
                          : tMembers('splitPresets.personal')}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={tMembers('splitPresets.namePlaceholderAuto', {
                name: generatedSuggestion,
              })}
              maxLength={120}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
          </ResponsiveDialogBody>
          <div className="flex justify-end gap-2 px-4 pb-4 sm:px-6 sm:pb-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                (!name.trim() && !generatedSuggestion) || create.isPending
              }
              onClick={() => void submit()}
            >
              {t('SplitPreset.save')}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

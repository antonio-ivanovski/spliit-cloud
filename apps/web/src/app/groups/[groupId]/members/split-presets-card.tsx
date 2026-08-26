import {
  ChartPie,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { localizeCurrencyInput } from '@/lib/currency-input'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { Currency, SplitMode } from '@spliit/domain'
import { serializePaidFor } from '@spliit/domain'

import {
  enforcePercentagePattern,
  enforceSharePattern,
  stepDisplayShares,
} from '../expenses/expense-form/currency-utils'
import type { GroupShape } from '../expenses/expense-form/default-values'
import { ParticipantShareRow } from '../expenses/expense-form/participant-share-row'
import { ShareRowInputControls } from '../expenses/expense-form/share-row-input'
import {
  SinglePayerDistributionEditor,
  SplitDistributionEditor,
} from '../expenses/expense-form/split-distribution-editor'
import { convertParticipantShares } from '../expenses/expense-form/split-mode-conversions'
import {
  PaidBySplitOptionCards,
  PaidForSplitOptionCards,
  type PaidBySplitOption,
} from '../expenses/expense-form/split-option-cards'
import {
  generatedSplitPresetName,
  uniqueGeneratedSplitPresetName,
} from '../expenses/expense-form/split-preset-names'
import {
  PresetDistributionPreview,
  type SplitPreset,
} from '../expenses/expense-form/split-presets'

type Participant = GroupShape['participants'][number]
type PresetMode = Exclude<SplitMode, 'BY_AMOUNT' | 'ITEMIZED'>
type Scope = 'SHARED' | 'PERSONAL'
type Target = 'PAID_BY' | 'PAID_FOR'
type EditorState = {
  preset: SplitPreset | null
  scope: Scope
  target: Target
  name: string
  mode: PresetMode
  paidByVariant: 'SINGLE' | 'MULTIPLE'
  rows: Array<{ participant: string; shares: number | string }>
}

const emptyRows = (participants: Participant[]) =>
  participants.map((participant) => ({
    participant: participant.id,
    shares: 1,
  }))

function normalizePercentageRows(
  rows: Array<{ participant: string; shares: number | string }>,
) {
  const selected = rows.filter((row) => Number(row.shares) > 0)
  if (selected.length === 0) return rows

  const total = selected.reduce((sum, row) => sum + Number(row.shares), 0)
  if (!Number.isFinite(total) || total <= 0) return rows

  const remainingUnits = 10_000 - selected.length
  const scaled = selected.map((row) => {
    const exact = (Number(row.shares) / total) * remainingUnits
    const floor = Math.floor(exact)
    return { ...row, shares: floor + 1, remainder: exact - floor }
  })
  let remaining =
    remainingUnits - scaled.reduce((sum, row) => sum + row.shares - 1, 0)
  scaled.sort(
    (left, right) =>
      right.remainder - left.remainder ||
      left.participant.localeCompare(right.participant),
  )
  for (let index = 0; remaining > 0; index += 1) {
    scaled[index % scaled.length]!.shares += 1
    remaining -= 1
  }

  const byParticipant = new Map(
    scaled.map((row) => [row.participant, row.shares / 100]),
  )
  return rows.map((row) => ({
    ...row,
    shares: byParticipant.get(row.participant) ?? 0,
  }))
}

function editorFromPreset(
  preset: SplitPreset | null,
  scope: Scope,
  participants: Participant[],
): EditorState {
  const participantOrder = new Map(
    participants.map((participant, index) => [participant.id, index]),
  )
  const presetRows = preset?.participants.toSorted(
    (left, right) =>
      (participantOrder.get(left.participant) ?? Number.MAX_SAFE_INTEGER) -
        (participantOrder.get(right.participant) ?? Number.MAX_SAFE_INTEGER) ||
      left.participant.localeCompare(right.participant),
  )
  return {
    preset,
    scope: preset?.scope ?? scope,
    target: preset?.target ?? 'PAID_FOR',
    name: preset?.name ?? '',
    mode: preset?.splitMode ?? 'EVENLY',
    paidByVariant:
      preset?.target === 'PAID_BY' &&
      preset.splitMode === 'EVENLY' &&
      preset.participants.length === 1
        ? 'SINGLE'
        : 'MULTIPLE',
    rows:
      presetRows?.map(({ participant, shares }) => ({
        participant,
        shares:
          preset?.splitMode === 'BY_PERCENTAGE' ||
          preset?.splitMode === 'BY_SHARES'
            ? shares / 100
            : 1,
      })) ?? emptyRows(participants),
  }
}

export function SplitPresetsCard(props: {
  groupId: string
  group: GroupShape
  canManage: boolean
  isArchived: boolean
}) {
  const { groupId, group, canManage, isArchived } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { t: schemaT } = useTranslation(undefined, {
    keyPrefix: 'SchemaErrors',
  })
  const locale = useLocale()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const request = useIdempotentCreate()
  const query = trpc.groups.splitPresets.list.useQuery({ groupId })
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SplitPreset | null>(null)
  const createMutation = trpc.groups.splitPresets.create.useMutation()
  const updateMutation = trpc.groups.splitPresets.update.useMutation()
  const deleteMutation = trpc.groups.splitPresets.delete.useMutation()
  const setGroupDefault = trpc.groups.splitPresets.setGroupDefault.useMutation()
  const setPersonalDefault =
    trpc.groups.splitPresets.setPersonalDefault.useMutation()

  const presets = query.data?.presets ?? []
  const canManageShared =
    !isArchived && canManage && !!query.data?.canManageShared
  const canManagePersonal = !isArchived && !!query.data?.canManagePersonal
  const currency: Currency = {
    code: group.currencyCode ?? '',
    symbol: group.currency,
    rounding: 0,
    decimal_digits: 2,
  }
  const modeLabel = (mode: PresetMode) =>
    (t as unknown as (key: string) => string)(`splitPresets.modes.${mode}`)
  const shared = presets.filter((preset) => preset.scope === 'SHARED')
  const personal = presets.filter((preset) => preset.scope === 'PERSONAL')
  const groupDefaultIds = new Set(
    [
      query.data?.groupDefaults?.paidByPresetId,
      query.data?.groupDefaults?.paidForPresetId,
    ].filter((id): id is string => !!id),
  )
  const personalDefaultIds = new Set(
    [
      query.data?.personalDefaults.paidBy.presetId,
      query.data?.personalDefaults.paidFor.presetId,
    ].filter((id): id is string => !!id),
  )
  const saveEditor = async () => {
    if (!editor) return
    const rows = editor.rows.filter((row) => Number(row.shares) > 0)
    if (!rows.length) return
    if (
      editor.mode === 'BY_PERCENTAGE' &&
      rows.reduce((sum, row) => sum + Number(row.shares), 0) !== 100
    ) {
      toast({
        description: schemaT('percentageSum'),
        variant: 'destructive',
      })
      return
    }
    const normalizedRows = (
      editor.mode === 'EVENLY'
        ? rows.map((row) => ({ ...row, shares: 1 }))
        : rows.map((row) => ({ ...row, shares: Number(row.shares) }))
    ).map((row) => ({ ...row, shares: Number(row.shares) }))
    const generatedName = generatedSplitPresetName({
      target: editor.target,
      splitMode: editor.mode,
      rows: normalizedRows,
      participants: group.participants,
      locale,
      sharesAreStored: false,
      t: t as unknown as (
        key: string,
        options?: Record<string, unknown>,
      ) => string,
    })
    const name =
      editor.name.trim() ||
      uniqueGeneratedSplitPresetName(
        generatedName,
        presets
          .filter(
            (preset) =>
              preset.scope === editor.scope && preset.id !== editor.preset?.id,
          )
          .map((preset) => preset.name),
      )
    if (!name) return
    const serialized = serializePaidFor({
      splitMode: editor.mode,
      amount: 0,
      currency,
      paidFor: normalizedRows,
    })
    const definition = {
      target: editor.target,
      splitMode: editor.mode,
      participants: serialized.map((row) => ({
        participant: row.participant,
        shares: row.shares,
      })),
    }
    try {
      if (editor.preset) {
        await updateMutation.mutateAsync({
          groupId,
          presetId: editor.preset.id,
          scope: editor.preset.scope,
          nextScope: editor.scope,
          name,
          expectedUpdatedAt: editor.preset.updatedAt,
          ...definition,
        })
      } else {
        await request.run((requestId) =>
          createMutation.mutateAsync({
            requestId,
            groupId,
            name,
            scope: editor.scope,
            ...definition,
          }),
        )
      }
      await utils.groups.splitPresets.list.invalidate({ groupId })
      setEditor(null)
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('splitPresets.saveError'),
        variant: 'destructive',
      })
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({
        groupId,
        presetId: deleteTarget.id,
        scope: deleteTarget.scope,
      })
      await utils.groups.splitPresets.list.invalidate({ groupId })
      setDeleteTarget(null)
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : t('splitPresets.deleteError'),
        variant: 'destructive',
      })
    }
  }

  const setGroup = async (input: {
    target: Target
    presetId: string | null
  }) => {
    try {
      await setGroupDefault.mutateAsync({ groupId, ...input })
      await utils.groups.splitPresets.list.invalidate({ groupId })
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('splitPresets.saveError'),
        variant: 'destructive',
      })
    }
  }

  const setPersonal = async (input: {
    target: Target
    choice: {
      mode: 'INHERIT' | 'PRESET' | 'NEUTRAL'
      presetId: string | null
    }
  }) => {
    try {
      await setPersonalDefault.mutateAsync({ groupId, ...input })
      await utils.groups.splitPresets.list.invalidate({ groupId })
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('splitPresets.saveError'),
        variant: 'destructive',
      })
    }
  }

  const setPresetAsPersonalDefault = (preset: SplitPreset) => {
    return setPersonal({
      target: preset.target,
      choice: { mode: 'PRESET', presetId: preset.id },
    })
  }

  const setPresetAsGroupDefault = (preset: SplitPreset) =>
    setGroup({ target: preset.target, presetId: preset.id })

  const clearPersonalDefault = (
    target: Target,
    mode: 'INHERIT' | 'NEUTRAL',
  ) => {
    return setPersonal({
      target,
      choice: { mode, presetId: null },
    })
  }

  const clearGroupDefault = (target: Target) =>
    setGroup({ target, presetId: null })

  const renderPreset = (preset: SplitPreset) => {
    const manageable =
      !isArchived &&
      (preset.scope === 'SHARED' ? canManageShared : canManagePersonal)
    const canSetPersonalDefault =
      canManagePersonal && !personalDefaultIds.has(preset.id)
    const canSetGroupDefault =
      preset.scope === 'SHARED' &&
      canManageShared &&
      !groupDefaultIds.has(preset.id)
    const hasDefaultActions = canSetPersonalDefault || canSetGroupDefault
    const showActions =
      manageable || canSetPersonalDefault || canSetGroupDefault
    return (
      <div
        key={preset.id}
        className="relative min-w-0 rounded-lg border bg-card/60 p-3"
      >
        <div className={showActions ? 'min-w-0 pe-9' : 'min-w-0'}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-medium">{preset.name}</span>
            <span className="sr-only">
              {preset.scope === 'SHARED'
                ? t('splitPresets.shared')
                : t('splitPresets.personal')}
              {', '}
              {preset.target === 'PAID_BY'
                ? t('splitPresets.paidBy')
                : t('splitPresets.paidFor')}
            </span>
            {personalDefaultIds.has(preset.id) && (
              <Badge
                variant="secondary"
                className="gap-1 border-border/70 bg-muted pe-1 text-muted-foreground"
                data-testid={`my-default-${preset.id}`}
              >
                <UserRound className="size-3" aria-hidden="true" />
                <span>{t('splitPresets.myDefault')}</span>
                {canManagePersonal && (
                  <button
                    type="button"
                    className="ms-0.5 inline-flex size-4 items-center justify-center rounded-full text-destructive/80 transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    aria-label={t('splitPresets.removeMyDefault', {
                      name: preset.name,
                    })}
                    disabled={setPersonalDefault.isPending}
                    onClick={() =>
                      clearPersonalDefault(preset.target, 'INHERIT')
                    }
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            )}
            {groupDefaultIds.has(preset.id) && (
              <Badge
                variant="secondary"
                className="gap-1 border-border/70 bg-muted pe-1 text-muted-foreground"
                data-testid={`group-default-${preset.id}`}
              >
                <UsersRound className="size-3" aria-hidden="true" />
                <span>{t('splitPresets.groupDefault')}</span>
                {canManageShared && preset.scope === 'SHARED' && (
                  <button
                    type="button"
                    className="ms-0.5 inline-flex size-4 items-center justify-center rounded-full text-destructive/80 transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    aria-label={t('splitPresets.removeGroupDefault', {
                      name: preset.name,
                    })}
                    disabled={setGroupDefault.isPending}
                    onClick={() => clearGroupDefault(preset.target)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            )}
          </div>
        </div>
        <PresetDistributionPreview
          preset={preset}
          group={group}
          currency={currency}
          locale={locale}
          modeLabel={modeLabel(preset.splitMode)}
          label={
            preset.target === 'PAID_BY'
              ? t('splitPresets.paidBy')
              : t('splitPresets.paidFor')
          }
        />
        {showActions ? (
          <div className="absolute end-1.5 top-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('splitPresets.actions')}
                  />
                }
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canSetPersonalDefault ? (
                  <DropdownMenuItem
                    onClick={() => setPresetAsPersonalDefault(preset)}
                  >
                    <UserRoundCheck
                      className="me-2 size-4"
                      aria-hidden="true"
                    />
                    {t('splitPresets.setMyDefault')}
                  </DropdownMenuItem>
                ) : null}
                {canSetGroupDefault && (
                  <DropdownMenuItem
                    onClick={() => setPresetAsGroupDefault(preset)}
                  >
                    <UsersRound className="me-2 size-4" aria-hidden="true" />
                    {t('splitPresets.setGroupDefault')}
                  </DropdownMenuItem>
                )}
                {manageable && (
                  <>
                    {hasDefaultActions && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onClick={() =>
                        setEditor(
                          editorFromPreset(
                            preset,
                            preset.scope,
                            group.participants,
                          ),
                        )
                      }
                    >
                      <Pencil className="me-2 size-4" aria-hidden="true" />
                      {t('splitPresets.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive data-highlighted:text-destructive"
                      onClick={() => setDeleteTarget(preset)}
                    >
                      <Trash2 className="me-2 size-4" aria-hidden="true" />
                      {t('splitPresets.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ChartPie
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
                {t('splitPresets.title')}
              </CardTitle>
              <CardDescription className="mt-2 space-y-1 leading-relaxed">
                <span className="block">{t('splitPresets.description')}</span>
                <span className="block">
                  {t('splitPresets.descriptionVisibility')}
                </span>
                <span className="block">
                  {t('splitPresets.descriptionDefaults')}
                </span>
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(canManageShared || canManagePersonal) && (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    setEditor(
                      editorFromPreset(
                        null,
                        canManageShared ? 'SHARED' : 'PERSONAL',
                        group.participants,
                      ),
                    )
                  }
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t('splitPresets.create')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t('splitPresets.loading')}
            </p>
          ) : (
            <div className="space-y-6">
              <PresetLibrary
                title={t('splitPresets.personal')}
                presets={personal}
                emptyLabel={t('splitPresets.empty')}
                renderPreset={renderPreset}
              />
              <PresetLibrary
                title={t('splitPresets.shared')}
                presets={shared}
                emptyLabel={t('splitPresets.empty')}
                renderPreset={renderPreset}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {editor && (
        <PresetEditorDialog
          editor={editor}
          participants={group.participants}
          currency={currency}
          canManageShared={canManageShared}
          isSaving={createMutation.isPending || updateMutation.isPending}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onSave={() => void saveEditor()}
        />
      )}

      <ResponsiveDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('splitPresets.deleteTitle')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <p className="text-sm text-muted-foreground">
              {t('splitPresets.deleteDescription', {
                name: deleteTarget?.name ?? '',
              })}
            </p>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
            >
              {t('splitPresets.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('splitPresets.delete')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

function PresetLibrary(props: {
  title: string
  presets: SplitPreset[]
  emptyLabel: string
  renderPreset: (preset: SplitPreset) => ReactNode
}) {
  return (
    <section>
      <h3 className="mb-2 font-medium">{props.title}</h3>
      {props.presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyLabel}</p>
      ) : (
        <div className="space-y-3">{props.presets.map(props.renderPreset)}</div>
      )}
    </section>
  )
}

function ChoiceRadioGroup(props: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{props.label}</p>
      <RadioGroup
        value={props.value}
        onValueChange={props.onChange}
        className="gap-2"
        aria-label={props.label}
      >
        {props.options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
          >
            <RadioGroupItem
              value={option.value}
              disabled={props.disabled}
              className="cursor-pointer"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}

function PresetEditorDialog(props: {
  editor: EditorState
  participants: Participant[]
  currency: Currency
  canManageShared: boolean
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { t: expenseT } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm',
  })
  const locale = useLocale()
  const { editor, participants, onChange } = props
  const update = (next: Partial<EditorState>) =>
    onChange({ ...editor, ...next })
  const changeMode = (
    mode: PresetMode,
    next?: Pick<EditorState, 'paidByVariant'>,
  ) => {
    const converted = convertParticipantShares({
      rows: editor.rows.map((row) => ({
        ...row,
        shares: Number(row.shares),
      })),
      fromMode: editor.mode,
      toMode: mode,
      targetAmount: 0,
    })
    update({
      mode,
      ...next,
      rows:
        mode === 'BY_PERCENTAGE'
          ? normalizePercentageRows(converted)
          : converted,
    })
  }
  const changeParticipants = (participant: string, checked: boolean) => {
    const nextRows = checked
      ? [...editor.rows, { participant, shares: 1 }]
      : editor.rows.filter((row) => row.participant !== participant)
    update({
      rows:
        editor.mode === 'BY_PERCENTAGE'
          ? normalizePercentageRows(nextRows)
          : nextRows,
    })
  }
  const selectAll = () => {
    const nextRows =
      editor.rows.length === participants.length ? [] : emptyRows(participants)
    update({
      rows:
        editor.mode === 'BY_PERCENTAGE'
          ? normalizePercentageRows(nextRows)
          : nextRows,
    })
  }
  const resetDistribution = () => {
    const nextRows = emptyRows(participants)
    update({
      rows:
        editor.mode === 'BY_PERCENTAGE'
          ? normalizePercentageRows(nextRows)
          : nextRows,
    })
  }
  const updateShare = (participant: string, rawValue: string) => {
    const sanitized =
      editor.mode === 'BY_SHARES'
        ? enforceSharePattern(rawValue, locale)
        : enforcePercentagePattern(rawValue, locale)
    const existing = editor.rows.some((row) => row.participant === participant)
    const shouldRemove =
      sanitized === '' ||
      (editor.mode === 'BY_PERCENTAGE' && Number(sanitized) <= 0)

    update({
      rows: shouldRemove
        ? editor.rows.filter((row) => row.participant !== participant)
        : existing
          ? editor.rows.map((row) =>
              row.participant === participant
                ? {
                    ...row,
                    shares:
                      editor.mode === 'BY_SHARES'
                        ? sanitized
                        : Number(sanitized),
                  }
                : row,
            )
          : [
              ...editor.rows,
              {
                participant,
                shares:
                  editor.mode === 'BY_SHARES' ? sanitized : Number(sanitized),
              },
            ],
    })
  }

  const stepShare = (participant: string, direction: 1 | -1) => {
    const row = editor.rows.find(
      (candidate) => candidate.participant === participant,
    )
    const nextValue = stepDisplayShares(row?.shares, direction)
    update({
      rows:
        direction === -1 && nextValue <= 0
          ? editor.rows.filter(
              (candidate) => candidate.participant !== participant,
            )
          : row
            ? editor.rows.map((candidate) =>
                candidate.participant === participant
                  ? { ...candidate, shares: nextValue }
                  : candidate,
              )
            : [...editor.rows, { participant, shares: nextValue }],
    })
  }

  const renderParticipantContent = (mode: PresetMode) => (
    <SplitDistributionEditor
      participants={participants}
      selectedCount={editor.rows.length}
      mode={mode}
      targetAmount={mode === 'BY_PERCENTAGE' ? 100 : 0}
      shares={editor.rows.map((row) => Number(row.shares))}
      currency={props.currency}
      onReset={resetDistribution}
      onToggleAll={selectAll}
      renderRow={(participant) => {
        const row = editor.rows.find(
          (candidate) => candidate.participant === participant.id,
        )
        return (
          <ParticipantShareRow
            key={participant.id}
            participant={participant}
            checked={!!row}
            onCheckedChange={(checked) =>
              changeParticipants(participant.id, checked)
            }
            shareInput={
              mode !== 'EVENLY' ? (
                <ShareRowInputControls
                  splitMode={mode}
                  participantName={participant.name}
                  value={row?.shares}
                  isSelected={!!row}
                  readOnly={false}
                  onStep={(direction) => stepShare(participant.id, direction)}
                >
                  <div className="relative">
                    <Input
                      className={cn(
                        '-my-2 w-[72px] shrink-0 px-2 text-end text-base tabular-nums',
                        mode === 'BY_PERCENTAGE' && 'pe-5',
                      )}
                      type="text"
                      inputMode="decimal"
                      step={0.01}
                      value={localizeCurrencyInput(
                        String(row?.shares ?? ''),
                        locale,
                      )}
                      aria-label={expenseT(
                        mode === 'BY_SHARES'
                          ? 'participantSharesLabel'
                          : 'participantPercentageLabel',
                        { name: participant.name },
                      )}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        updateShare(participant.id, event.target.value)
                      }
                    />
                    {mode === 'BY_PERCENTAGE' && (
                      <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground">
                        %
                      </span>
                    )}
                  </div>
                </ShareRowInputControls>
              ) : undefined
            }
          />
        )
      }}
    />
  )

  const renderSinglePayerContent = () => (
    <SinglePayerDistributionEditor
      participants={participants}
      value={editor.rows[0]?.participant ?? ''}
      onValueChange={(value) =>
        update({
          mode: 'EVENLY',
          rows: value ? [{ participant: value, shares: 1 }] : [],
        })
      }
      className="w-full"
      placeholder={t('splitPresets.selectPayer')}
      mobileTitle={t('splitPresets.paidBy')}
    />
  )

  const renderPaidByContent = (option: PaidBySplitOption) =>
    option.isMultiPayer
      ? renderParticipantContent(option.splitMode as PresetMode)
      : renderSinglePayerContent()
  const generatedSuggestion = generatedSplitPresetName({
    target: editor.target,
    splitMode: editor.mode,
    rows: editor.rows.map((row) => ({
      ...row,
      shares: Number(row.shares),
    })),
    participants,
    locale,
    t: t as unknown as (
      key: string,
      options?: Record<string, unknown>,
    ) => string,
  })
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && props.onCancel()}>
      <ResponsiveDialogContent className="gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:grid-rows-[auto_minmax(0,1fr)_auto]">
        <ResponsiveDialogHeader className="px-4 pb-4 sm:px-6 sm:pt-6">
          <ResponsiveDialogTitle>
            {editor.preset
              ? t('splitPresets.editTitle')
              : t('splitPresets.createTitle')}
          </ResponsiveDialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('splitPresets.editorDescription')}
          </p>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="min-h-0 w-full overflow-y-auto px-0 pb-0 sm:overflow-y-auto">
          <div className="w-full min-w-0 space-y-8 px-4 pb-4 sm:px-6 sm:pb-6">
            <label className="block space-y-2 text-sm">
              <span className="font-medium">{t('splitPresets.name')}</span>
              <Input
                value={editor.name}
                maxLength={120}
                placeholder={t('splitPresets.namePlaceholderAuto', {
                  name: generatedSuggestion,
                })}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
              <ChoiceRadioGroup
                label={t('splitPresets.target')}
                value={editor.target}
                onChange={(value) =>
                  update({
                    target: value as Target,
                    ...(value === 'PAID_BY'
                      ? { paidByVariant: 'MULTIPLE' as const }
                      : {}),
                  })
                }
                options={[
                  { value: 'PAID_FOR', label: t('splitPresets.paidFor') },
                  { value: 'PAID_BY', label: t('splitPresets.paidBy') },
                ]}
              />
              <ChoiceRadioGroup
                label={t('splitPresets.visibility')}
                value={editor.scope}
                disabled={!!editor.preset && !props.canManageShared}
                onChange={(value) => update({ scope: value as Scope })}
                options={[
                  { value: 'PERSONAL', label: t('splitPresets.personal') },
                  ...(props.canManageShared
                    ? [{ value: 'SHARED', label: t('splitPresets.shared') }]
                    : []),
                ]}
              />
            </div>
            {editor.target === 'PAID_BY' ? (
              <PaidBySplitOptionCards
                hiddenOptionIds={['multi-amount']}
                value={{
                  isMultiPayer: editor.paidByVariant === 'MULTIPLE',
                  splitMode: editor.mode,
                }}
                onChange={(value) => {
                  if (!value.isMultiPayer) {
                    update({
                      mode: 'EVENLY',
                      paidByVariant: 'SINGLE',
                      rows: editor.rows[0]
                        ? [
                            {
                              participant: editor.rows[0].participant,
                              shares: 1,
                            },
                          ]
                        : [],
                    })
                    return
                  }
                  changeMode(value.splitMode as PresetMode, {
                    paidByVariant: 'MULTIPLE',
                  })
                }}
                renderContent={renderPaidByContent}
              />
            ) : (
              <PaidForSplitOptionCards
                hiddenModes={['BY_AMOUNT']}
                value={editor.mode}
                onChange={(value) => changeMode(value as PresetMode)}
                renderContent={(mode) =>
                  renderParticipantContent(mode as PresetMode)
                }
              />
            )}
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="border-t px-4 py-4 sm:px-6">
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {t('splitPresets.cancel')}
          </Button>
          <Button
            type="button"
            disabled={props.isSaving}
            onClick={props.onSave}
          >
            {t('splitPresets.save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

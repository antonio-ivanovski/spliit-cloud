import { CalendarClock, Pencil, Plus, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AmountInput } from '@/app/groups/[groupId]/expenses/expense-form/amount-input'
import {
  amountPlaceholder,
  enforceCurrencyPattern,
} from '@/app/groups/[groupId]/expenses/expense-form/currency-utils'
import { CategorySelector } from '@/components/category-selector'
import { useDocumentTitle } from '@/components/document-title'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { localizeCurrencyInput } from '@/lib/currency-input'
import {
  getRecurrencePreviewDates,
  type RecurrenceConfig,
} from '@/lib/recurrence-schedule'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { cn, formatCurrency } from '@/lib/utils'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  DEFAULT_CATEGORIES,
  type CategoryId,
} from '@spliit/domain'

import {
  useCancelPersonalRecurring,
  useCreatePersonalRecurring,
  useDeletePersonalRecurring,
  usePausePersonalRecurring,
  usePersonalProfile,
  usePersonalRecurringList,
  usePersonalRecurringUpcoming,
  useResumePersonalRecurring,
  useSkipNextPersonalRecurring,
  useUpdatePersonalRecurring,
  type PersonalRecurringInput,
  type PersonalRecurringPatch,
} from './api'
import { usePersonalTranslation } from './personal-i18n'
import type {
  PersonalRecurringSeries,
  PersonalRecurringUpcoming,
} from './types'

export type PersonalRecurringFormValue = {
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  categoryId: string
  title: string
  note: string
  anchorDate: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  end:
    | { type: 'INDEFINITE' }
    | { type: 'COUNT'; count: number }
    | { type: 'DATE'; endDate: string }
}

function cadenceLabel(
  t: (key: string, vars?: Record<string, unknown>) => string,
  series: Pick<
    PersonalRecurringSeries,
    'frequency' | 'interval' | 'endType' | 'occurrenceLimit' | 'endDate'
  >,
): string {
  const every =
    series.interval === 1
      ? t(
          `recurring.frequency${capitalize(series.frequency.toLowerCase())}` as never,
        )
      : `${t('recurring.interval')} ${series.interval} × ${series.frequency.toLowerCase()}`
  if (series.endType === 'COUNT')
    return `${every} · ×${series.occurrenceLimit ?? ''}`
  if (series.endType === 'DATE') return `${every} · ${series.endDate ?? ''}`
  return every
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Create/edit form. Creation captures the immutable schedule (start date,
 * frequency, interval); editing keeps the schedule read-only and only edits the
 * template (amount/kind/category/title/note) plus the end.
 */
export function PersonalRecurringForm({
  currencyCode,
  initial = null,
  pending = false,
  onSubmit,
}: {
  currencyCode: string
  initial?: PersonalRecurringSeries | null
  pending?: boolean
  onSubmit: (value: PersonalRecurringFormValue) => void | Promise<void>
}) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const currency = getCurrency(currencyCode) ?? {
    code: currencyCode,
    symbol: currencyCode,
    rounding: 0,
    decimal_digits: 2,
  }
  const editing = initial !== null && initial !== undefined

  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>(
    initial?.kind ?? 'EXPENSE',
  )
  const [amount, setAmount] = useState(() =>
    initial
      ? amountAsDecimal(initial.amount, currency).toFixed(
          currency.decimal_digits,
        )
      : '',
  )
  const [categoryId, setCategoryId] = useState<CategoryId>(
    (initial?.categoryId as CategoryId) ?? 'general',
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [anchorDate, setAnchorDate] = useState(
    initial?.anchorDate ?? new Date().toISOString().slice(0, 10),
  )
  const [frequency, setFrequency] = useState<
    PersonalRecurringFormValue['frequency']
  >(initial?.frequency ?? 'MONTHLY')
  const [interval, setInterval] = useState(initial?.interval ?? 1)
  const [endType, setEndType] = useState<'INDEFINITE' | 'COUNT' | 'DATE'>(
    initial?.endType ?? 'INDEFINITE',
  )
  const [count, setCount] = useState(initial?.occurrenceLimit ?? 12)
  const [endDate, setEndDate] = useState(initial?.endDate ?? anchorDate)
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = Number(amount)
  const previewConfig: RecurrenceConfig | null = useMemo(() => {
    if (anchorDate === '') return null
    try {
      return {
        frequency,
        interval,
        end:
          endType === 'COUNT'
            ? { type: 'COUNT', count: Math.max(1, Math.floor(count)) }
            : endType === 'DATE' && endDate !== ''
              ? { type: 'DATE', endDate: new Date(`${endDate}T12:00:00.000Z`) }
              : { type: 'INDEFINITE' },
      }
    } catch {
      return null
    }
  }, [frequency, interval, endType, count, endDate, anchorDate])

  const previewDates = useMemo(() => {
    if (!previewConfig || anchorDate === '') return []
    try {
      return getRecurrencePreviewDates(
        new Date(`${anchorDate}T12:00:00.000Z`),
        previewConfig,
        3,
      ).map((date) => date.toISOString().slice(0, 10))
    } catch {
      return []
    }
  }, [previewConfig, anchorDate])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (
      amount.trim() === '' ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      setError(t('recurring.validationAmount'))
      return
    }
    if (!editing && anchorDate === '') {
      setError(t('recurring.validationAmount'))
      return
    }
    setError(null)
    void onSubmit({
      kind,
      amount: amountAsMinorUnits(parsedAmount, currency),
      categoryId,
      title: title.trim(),
      note: note.trim(),
      anchorDate,
      frequency,
      interval: Math.min(99, Math.max(1, Math.floor(interval) || 1)),
      end:
        endType === 'COUNT'
          ? { type: 'COUNT', count: Math.max(1, Math.floor(count) || 1) }
          : endType === 'DATE'
            ? { type: 'DATE', endDate }
            : { type: 'INDEFINITE' },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={kind === 'EXPENSE' ? 'default' : 'outline'}
          onClick={() => setKind('EXPENSE')}
        >
          {t('recurring.kindExpense')}
        </Button>
        <Button
          type="button"
          variant={kind === 'INCOME' ? 'default' : 'outline'}
          onClick={() => setKind('INCOME')}
        >
          {t('recurring.kindIncome')}
        </Button>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recurring-amount">{t('recurring.amount')}</Label>
        <AmountInput
          id="recurring-amount"
          value={localizeCurrencyInput(amount, locale)}
          placeholder={amountPlaceholder(currency.decimal_digits, locale)}
          onChange={(event) =>
            setAmount(enforceCurrencyPattern(event.target.value))
          }
          inputMode="decimal"
        />
      </div>
      <div className="grid gap-2">
        <Label>{t('recurring.category')}</Label>
        <CategorySelector
          categories={DEFAULT_CATEGORIES}
          defaultValue={categoryId}
          onValueChange={(value) => setCategoryId(value as CategoryId)}
          isLoading={false}
          ariaLabel={t('recurring.category')}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recurring-title">{t('recurring.titleLabel')}</Label>
        <Input
          id="recurring-title"
          value={title}
          maxLength={200}
          placeholder={t('recurring.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recurring-note">{t('recurring.note')}</Label>
        <Textarea
          id="recurring-note"
          value={note}
          maxLength={2000}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {!editing && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="recurring-start">{t('recurring.startDate')}</Label>
            <DateInput
              id="recurring-start"
              pickerTitle={t('recurring.startDate')}
              value={anchorDate}
              onValueChange={setAnchorDate}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="recurring-frequency">
                {t('recurring.frequency')}
              </Label>
              <Select
                value={frequency}
                onValueChange={(value) =>
                  setFrequency(value as PersonalRecurringFormValue['frequency'])
                }
              >
                <SelectTrigger id="recurring-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map(
                    (option) => (
                      <SelectItem key={option} value={option}>
                        {t(
                          `recurring.frequency${capitalize(option.toLowerCase())}` as never,
                        )}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recurring-interval">
                {t('recurring.interval')}
              </Label>
              <Input
                id="recurring-interval"
                type="number"
                min={1}
                max={99}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
            </div>
          </div>
        </>
      )}
      <div className="grid gap-2">
        <Label>{t('recurring.end')}</Label>
        <RadioGroup
          value={endType}
          onValueChange={(value) => setEndType(value as typeof endType)}
          className="flex flex-wrap gap-2"
        >
          {(['INDEFINITE', 'COUNT', 'DATE'] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
            >
              <RadioGroupItem value={option} />
              {t(`recurring.end${capitalize(option.toLowerCase())}` as never)}
            </label>
          ))}
        </RadioGroup>
        {endType === 'COUNT' && (
          <Input
            aria-label={t('recurring.endCountLabel')}
            type="number"
            min={1}
            max={10000}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        )}
        {endType === 'DATE' && (
          <DateInput
            pickerTitle={t('recurring.end')}
            value={endDate}
            onValueChange={setEndDate}
          />
        )}
      </div>
      {previewDates.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('recurring.upcomingTitle')}: {previewDates.join(' · ')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t('recurring.saving') : t('recurring.save')}
      </Button>
    </form>
  )
}

function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  pending = false,
  destructive = false,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  pending?: boolean
  destructive?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'h-8 px-2 text-xs',
        destructive && 'text-destructive hover:text-destructive',
      )}
      disabled={pending}
      onClick={() => {
        if (confirming) onConfirm()
        else {
          setConfirming(true)
          setTimeout(() => setConfirming(false), 4000)
        }
      }}
    >
      {confirming ? confirmLabel : label}
    </Button>
  )
}

function SeriesCard({
  series,
  currencyCode,
  onEdit,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onSkip,
  pendingId,
}: {
  series: PersonalRecurringSeries
  currencyCode: string
  onEdit: (series: PersonalRecurringSeries) => void
  onPause: (series: PersonalRecurringSeries) => void
  onResume: (series: PersonalRecurringSeries) => void
  onCancel: (series: PersonalRecurringSeries) => void
  onDelete: (series: PersonalRecurringSeries) => void
  onSkip: (series: PersonalRecurringSeries) => void
  pendingId: string | null
}) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const currency = getCurrency(currencyCode) ?? getCurrency(series.currencyCode)
  const amount = currency
    ? formatCurrency(currency, series.amount, locale)
    : String(series.amount)
  const pending = pendingId === series.id

  return (
    <Card>
      <CardContent spacing="standalone" className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {series.title ?? series.categoryId}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cadenceLabel(t as never, series)} · {t('recurring.nextDate')}{' '}
              {series.nextOccurrenceDate} · {t('recurring.generatedCount')}{' '}
              {series.generatedCount}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={series.status === 'ACTIVE' ? 'default' : 'secondary'}
            >
              {t(
                `recurring.status${capitalize(series.status.toLowerCase())}` as never,
              )}
            </Badge>
            <span
              className={cn(
                'text-sm font-semibold tabular-nums',
                series.kind === 'INCOME' &&
                  'text-green-600 dark:text-green-400',
              )}
            >
              {series.kind === 'INCOME' ? '+' : '−'}
              {amount}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {(series.status === 'ACTIVE' || series.status === 'PAUSED') && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => onEdit(series)}
              >
                <Pencil className="me-1.5 size-3.5" aria-hidden="true" />
                {t('recurring.edit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => onSkip(series)}
              >
                {t('recurring.skipNext')}
              </Button>
              {series.status === 'ACTIVE' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pending}
                  onClick={() => onPause(series)}
                >
                  {t('recurring.pause')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pending}
                  onClick={() => onResume(series)}
                >
                  {t('recurring.resume')}
                </Button>
              )}
              <ConfirmButton
                label={t('recurring.cancel')}
                confirmLabel={t('recurring.confirmCancel')}
                pending={pending}
                onConfirm={() => onCancel(series)}
              />
            </>
          )}
          <ConfirmButton
            label={t('recurring.delete')}
            confirmLabel={t('recurring.confirmDelete')}
            pending={pending}
            destructive
            onConfirm={() => onDelete(series)}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Presentational planned-transactions view: series cards, upcoming projection,
 * and empty states. Data-agnostic so tests render fixtures directly.
 */
export function PersonalRecurringView({
  series,
  upcoming,
  currencyCode,
  onCreate,
  onEdit,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onSkip,
  pendingId,
}: {
  series: PersonalRecurringSeries[]
  upcoming: PersonalRecurringUpcoming[]
  currencyCode: string
  onCreate: () => void
  onEdit: (series: PersonalRecurringSeries) => void
  onPause: (series: PersonalRecurringSeries) => void
  onResume: (series: PersonalRecurringSeries) => void
  onCancel: (series: PersonalRecurringSeries) => void
  onDelete: (series: PersonalRecurringSeries) => void
  onSkip: (series: PersonalRecurringSeries) => void
  pendingId: string | null
}) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const active = series.filter(
    (row) => row.status === 'ACTIVE' || row.status === 'PAUSED',
  )
  const finished = series.filter(
    (row) => row.status === 'COMPLETED' || row.status === 'CANCELLED',
  )

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t('recurring.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('recurring.description')}
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={onCreate}>
          <Plus className="me-1.5 size-4" aria-hidden="true" />
          {t('recurring.create')}
        </Button>
      </div>

      <Card>
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t('recurring.upcomingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {t('recurring.upcomingEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {upcoming.map((item) => (
                <li
                  key={`${item.seriesId}:${item.sequence}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.title ?? item.categoryId}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.date}
                      {item.overdue && (
                        <Badge
                          variant="destructive"
                          className="ms-1.5 text-[10px]"
                        >
                          {t('recurring.overdue')}
                        </Badge>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {item.kind === 'INCOME' ? '+' : '−'}
                    {(() => {
                      const currency =
                        getCurrency(item.currencyCode) ??
                        getCurrency(currencyCode)
                      return currency
                        ? formatCurrency(currency, item.amount, locale)
                        : String(item.amount)
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {series.length === 0 ? (
        <Card className="border-dashed">
          <CardContent
            spacing="standalone"
            className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Repeat className="size-6" aria-hidden="true" />
            </span>
            <h2 className="font-semibold">{t('recurring.emptyTitle')}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('recurring.emptyDescription')}
            </p>
            <Button type="button" className="mt-1" onClick={onCreate}>
              <Plus className="me-1.5 size-4" aria-hidden="true" />
              {t('recurring.create')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('recurring.activeSection')}
            </h2>
            {active.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('recurring.upcomingEmpty')}
              </p>
            )}
            {active.map((row) => (
              <SeriesCard
                key={row.id}
                series={row}
                currencyCode={currencyCode}
                onEdit={onEdit}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onDelete={onDelete}
                onSkip={onSkip}
                pendingId={pendingId}
              />
            ))}
          </div>
          {finished.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t('recurring.completedSection')}
              </h2>
              {finished.map((row) => (
                <SeriesCard
                  key={row.id}
                  series={row}
                  currencyCode={currencyCode}
                  onEdit={onEdit}
                  onPause={onPause}
                  onResume={onResume}
                  onCancel={onCancel}
                  onDelete={onDelete}
                  onSkip={onSkip}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function PersonalRecurringPage() {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('recurring.documentTitle'))
  const { toast } = useToast()
  const profileQuery = usePersonalProfile()
  const listQuery = usePersonalRecurringList()
  const upcomingQuery = usePersonalRecurringUpcoming(10)
  const createMutation = useCreatePersonalRecurring()
  const updateMutation = useUpdatePersonalRecurring()
  const pauseMutation = usePausePersonalRecurring()
  const resumeMutation = useResumePersonalRecurring()
  const cancelMutation = useCancelPersonalRecurring()
  const deleteMutation = useDeletePersonalRecurring()
  const skipMutation = useSkipNextPersonalRecurring()
  const idempotent = useIdempotentCreate()

  const [dialog, setDialog] = useState<
    | { mode: 'closed' }
    | { mode: 'create' }
    | { mode: 'edit'; series: PersonalRecurringSeries }
  >({ mode: 'closed' })

  const currencyCode = profileQuery.data?.currencyCode ?? 'USD'
  const saving = createMutation.isPending || updateMutation.isPending
  const pendingId =
    (pauseMutation.isPending ? pauseMutation.variables?.id : null) ??
    (resumeMutation.isPending ? resumeMutation.variables?.id : null) ??
    (cancelMutation.isPending ? cancelMutation.variables?.id : null) ??
    (deleteMutation.isPending ? deleteMutation.variables?.id : null) ??
    (skipMutation.isPending ? skipMutation.variables?.id : null) ??
    null

  async function handleSubmit(value: PersonalRecurringFormValue) {
    try {
      if (dialog.mode === 'edit') {
        const patch: PersonalRecurringPatch = {
          kind: value.kind,
          amount: value.amount,
          categoryId: value.categoryId,
          ...(value.title ? { title: value.title } : { title: null }),
          ...(value.note ? { note: value.note } : { note: null }),
          end: value.end,
        }
        await updateMutation.mutateAsync({
          id: dialog.series.id,
          expectedVersion: dialog.series.version,
          patch,
        })
        toast({ description: t('recurring.updated') })
      } else {
        const input: PersonalRecurringInput = {
          frequency: value.frequency,
          interval: value.interval,
          anchorDate: value.anchorDate,
          end: value.end,
          kind: value.kind,
          amount: value.amount,
          categoryId: value.categoryId,
          ...(value.title ? { title: value.title } : {}),
          ...(value.note ? { note: value.note } : {}),
        }
        const created = await idempotent.run((requestId) =>
          createMutation.mutateAsync({ requestId, series: input }),
        )
        if (!created) return
        toast({ description: t('recurring.created') })
      }
      setDialog({ mode: 'closed' })
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : t('recurring.saveFailed'),
        variant: 'destructive',
      })
    }
  }

  function fail(error: unknown) {
    toast({
      description:
        error instanceof Error ? error.message : t('recurring.actionFailed'),
      variant: 'destructive',
    })
  }

  if (
    profileQuery.isPending ||
    listQuery.isPending ||
    upcomingQuery.isPending
  ) {
    return (
      <div
        className="flex flex-col gap-4"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (profileQuery.isError || listQuery.isError || upcomingQuery.isError) {
    return (
      <Card className="border-destructive/30">
        <CardContent
          spacing="standalone"
          className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"
        >
          <p role="alert" className="text-sm text-muted-foreground">
            {t('recurring.actionFailed')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void profileQuery.refetch()
              void listQuery.refetch()
              void upcomingQuery.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <PersonalRecurringView
        series={listQuery.data?.series ?? []}
        upcoming={upcomingQuery.data?.occurrences ?? []}
        currencyCode={currencyCode}
        onCreate={() => setDialog({ mode: 'create' })}
        onEdit={(series) => setDialog({ mode: 'edit', series })}
        onPause={(series) => {
          void pauseMutation
            .mutateAsync({ id: series.id })
            .then(() => toast({ description: t('recurring.paused') }))
            .catch(fail)
        }}
        onResume={(series) => {
          void resumeMutation
            .mutateAsync({ id: series.id })
            .then(() => toast({ description: t('recurring.resumed') }))
            .catch(fail)
        }}
        onCancel={(series) => {
          void cancelMutation
            .mutateAsync({ id: series.id })
            .then(() => toast({ description: t('recurring.cancelled') }))
            .catch(fail)
        }}
        onDelete={(series) => {
          void deleteMutation
            .mutateAsync({ id: series.id })
            .then(() => toast({ description: t('recurring.deleted') }))
            .catch(fail)
        }}
        onSkip={(series) => {
          void skipMutation
            .mutateAsync({ id: series.id })
            .then(() => toast({ description: t('recurring.skipped') }))
            .catch(fail)
        }}
        pendingId={pendingId}
      />

      <ResponsiveDialog
        open={dialog.mode !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setDialog({ mode: 'closed' })
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {dialog.mode === 'edit'
                ? t('recurring.edit')
                : t('recurring.create')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            {dialog.mode !== 'closed' && (
              <PersonalRecurringForm
                key={dialog.mode === 'edit' ? dialog.series.id : 'create'}
                currencyCode={currencyCode}
                initial={dialog.mode === 'edit' ? dialog.series : null}
                pending={saving}
                onSubmit={(value) => void handleSubmit(value)}
              />
            )}
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

// Re-exported for tests that import the form value type alongside the page.

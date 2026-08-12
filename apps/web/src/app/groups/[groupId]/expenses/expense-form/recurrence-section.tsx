import { AlertTriangle, CalendarClock, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useWatch,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ResponsiveChoicePicker } from '@/components/responsive-choice-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { DateInput } from '@/components/ui/date-input'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import { timeZoneCityOffsetLabel } from '@spliit/domain'

import {
  OccurrenceTimeline,
  OccurrenceTimelineItem,
  OccurrenceTimelineMoreItem,
} from './occurrence-timeline'
import { ProjectedScheduleList } from './projected-schedule-list'
import {
  countDueBackfillOccurrences,
  formatDateInputValue,
  getRecurrenceSchedule,
  getRecurrenceScheduleMetadata,
  isScheduleConfigEqual,
  parseDateInputValue,
  type RecurrenceConfig,
  type RecurrenceEnd,
  type RecurrenceFrequency,
} from './recurrence-schedule'

type RecurrenceFormValues = FieldValues & {
  expenseDay: string
  expenseTime: string
  expenseTimeZone: string
  recurrence?: RecurrenceConfig | null
}

const frequencies: RecurrenceFrequency[] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]

const defaultRecurrence: RecurrenceConfig = {
  frequency: 'WEEKLY',
  interval: 1,
  end: { type: 'INDEFINITE' },
}

const countPresets: Record<RecurrenceFrequency, number[]> = {
  DAILY: [7, 14, 30, 90],
  WEEKLY: [4, 12, 26, 52],
  MONTHLY: [3, 6, 12, 24],
  YEARLY: [2, 5, 10, 20],
}

const parseIntegerDraft = (value: string) => {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function RecurrenceSection<T extends RecurrenceFormValues>({
  form,
  readOnly,
  isCopy: _isCopy = false,
  currentSequence = 1,
  editScope,
  initialRecurrence,
}: {
  form: UseFormReturn<T>
  readOnly: boolean
  isCopy?: boolean
  currentSequence?: number
  /** Locked edit scope when editing an existing series. */
  editScope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' | null
  /** Original series recurrence when editing (for schedule-change detection). */
  initialRecurrence?: RecurrenceConfig | null
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm.Expense' })
  const locale = useLocale()
  const expenseTimeZone = useWatch({
    control: form.control,
    name: 'expenseTimeZone' as Path<T>,
  }) as unknown as string
  const expenseTime = useWatch({
    control: form.control,
    name: 'expenseTime' as Path<T>,
  }) as unknown as string
  const expenseTimeZoneLabel = useMemo(
    () => timeZoneCityOffsetLabel(expenseTimeZone),
    [expenseTimeZone],
  )
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Keep the raw text while a numeric field is being edited. The form value
  // stays valid, so an empty draft never reaches the API/schema validation.
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const [countDraft, setCountDraft] = useState<string | null>(null)
  const [endDateDraft, setEndDateDraft] = useState<string | null>(null)
  const recurrence = useWatch({
    control: form.control,
    name: 'recurrence' as Path<T>,
  }) as RecurrenceConfig | null | undefined
  const expenseDay = useWatch({
    control: form.control,
    name: 'expenseDay' as Path<T>,
  }) as string
  const expenseDate = useMemo(() => {
    const parsed = new Date(`${expenseDay}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }, [expenseDay])
  const lastRecurrenceRef = useRef<RecurrenceConfig>(
    recurrence ?? defaultRecurrence,
  )

  useEffect(() => {
    if (recurrence) lastRecurrenceRef.current = recurrence
  }, [recurrence])

  const isEnabled = recurrence != null
  const end = recurrence?.end
  const schedule = useMemo(
    () => getRecurrenceSchedule(expenseDate, recurrence, currentSequence, 101),
    [expenseDate, recurrence, currentSequence],
  )
  const scheduleMetadata = useMemo(
    () =>
      getRecurrenceScheduleMetadata(expenseDate, recurrence, currentSequence),
    [expenseDate, recurrence, currentSequence],
  )
  const previewEntries = schedule.entries.slice(0, 4)
  const hasViewAll =
    schedule.remainingCount === null || schedule.remainingCount > 3
  const scheduleChanged =
    editScope === 'THIS_AND_FUTURE' &&
    recurrence != null &&
    initialRecurrence != null &&
    !isScheduleConfigEqual(initialRecurrence, recurrence)
  const dueBackfillCount = useMemo(() => {
    if (
      !recurrence ||
      !expenseDate ||
      !Number.isFinite(expenseDate.getTime())
    ) {
      return 0
    }
    return countDueBackfillOccurrences(schedule)
  }, [expenseDate, recurrence, schedule])
  const showPastDateBackfillNote = isEnabled && dueBackfillCount > 0
  const frequencyLabels: Record<RecurrenceFrequency, string> = {
    DAILY: t('recurrence.frequencyOptions.daily'),
    WEEKLY: t('recurrence.frequencyOptions.weekly'),
    MONTHLY: t('recurrence.frequencyOptions.monthly'),
    YEARLY: t('recurrence.frequencyOptions.yearly'),
  }
  const scheduleSummary = recurrence
    ? schedule.totalCount === null
      ? t('recurrence.ruleSummaryIndefinite', {
          interval: recurrence.interval,
          frequency: frequencyLabels[recurrence.frequency],
        })
      : t('recurrence.ruleSummary', {
          interval: recurrence.interval,
          frequency: frequencyLabels[recurrence.frequency],
          count:
            recurrence.end.type === 'COUNT'
              ? recurrence.end.count
              : schedule.totalCount,
        })
    : ''

  const updateRecurrence = useCallback(
    (next: RecurrenceConfig | null) => {
      form.setValue('recurrence' as Path<T>, next as never, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    },
    [form],
  )

  const updateEnd = (next: RecurrenceEnd) => {
    if (!recurrence) return
    updateRecurrence({ ...recurrence, end: next })
  }

  useEffect(() => {
    if (
      !recurrence ||
      recurrence.end.type !== 'DATE' ||
      !expenseDate ||
      !Number.isFinite(expenseDate.getTime())
    ) {
      return
    }
    if (recurrence.end.endDate.getTime() >= expenseDate.getTime()) return
    updateRecurrence({
      ...recurrence,
      end: { type: 'DATE', endDate: expenseDate },
    })
    // oxlint-disable-next-line react/react-compiler -- clear the draft after normalizing the controlled date.
    setEndDateDraft(null)
  }, [expenseDate, recurrence, updateRecurrence])

  const normalizeIntervalDraft = () => {
    if (!recurrence || intervalDraft === null) return
    const parsed = parseIntegerDraft(intervalDraft)
    if (parsed !== null) {
      const interval = Math.max(1, Math.min(99, parsed))
      if (interval !== recurrence.interval) {
        updateRecurrence({ ...recurrence, interval })
      }
    }
    setIntervalDraft(null)
  }

  const normalizeCountDraft = () => {
    if (!recurrence || end?.type !== 'COUNT' || countDraft === null) return
    const parsed = parseIntegerDraft(countDraft)
    if (parsed !== null) {
      const count = Math.max(currentSequence, Math.min(9999, parsed))
      if (count !== end.count) updateEnd({ type: 'COUNT', count })
    }
    setCountDraft(null)
  }

  const toggleRecurrence = (checked: boolean) => {
    if (checked) updateRecurrence(lastRecurrenceRef.current)
    else {
      if (recurrence) lastRecurrenceRef.current = recurrence
      updateRecurrence(null)
      setScheduleOpen(false)
      setIntervalDraft(null)
      setCountDraft(null)
      setEndDateDraft(null)
    }
  }

  return (
    <>
      <FormField
        control={form.control}
        name={'recurrence' as Path<T>}
        render={() => (
          <FormItem className="order-9 col-span-1 w-full min-w-0 sm:col-span-2 md:col-span-2">
            <div className="w-full min-w-0 rounded-lg border bg-muted/20 p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <FormControl>
                  <Checkbox
                    id="recurrence-enabled"
                    checked={isEnabled}
                    onCheckedChange={(checked) =>
                      toggleRecurrence(checked === true)
                    }
                    disabled={readOnly}
                    aria-controls="recurrence-settings"
                  />
                </FormControl>
                <div className="min-w-0 flex-1">
                  <FormLabel
                    htmlFor="recurrence-enabled"
                    className="cursor-pointer text-sm leading-tight font-semibold"
                  >
                    {t('recurrence.checkboxLabel')}
                  </FormLabel>
                  <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                    {t('recurrence.checkboxDescription')}
                  </p>
                  {isEnabled && (
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {t('recurrence.scheduleHint', {
                        time: expenseTime ?? '—',
                        timeZone: expenseTimeZoneLabel,
                      })}
                    </p>
                  )}
                </div>
              </div>

              <Collapsible open={isEnabled}>
                <CollapsibleContent id="recurrence-settings" className="pt-4">
                  <div className="border-t border-border/70 pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <FormItem className="flex-1 space-y-1.5">
                        <FormLabel className="text-xs text-muted-foreground">
                          {t('recurrence.repeatEvery')}
                        </FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input
                              aria-label={t('recurrence.interval')}
                              type="number"
                              min={1}
                              max={99}
                              step={1}
                              inputMode="numeric"
                              value={
                                intervalDraft ??
                                String(recurrence?.interval ?? 1)
                              }
                              disabled={readOnly}
                              onFocus={() => {
                                if (intervalDraft === null)
                                  setIntervalDraft(
                                    String(recurrence?.interval ?? 1),
                                  )
                              }}
                              onChange={(event) => {
                                if (!recurrence) return
                                const raw = event.target.value
                                setIntervalDraft(raw)
                                const parsed = parseIntegerDraft(raw)
                                if (parsed === null) return
                                updateRecurrence({
                                  ...recurrence,
                                  interval: Math.max(1, Math.min(99, parsed)),
                                })
                              }}
                              onBlur={normalizeIntervalDraft}
                            />
                          </FormControl>
                          <ResponsiveChoicePicker
                            value={recurrence?.frequency ?? 'WEEKLY'}
                            options={frequencies.map((frequency) => ({
                              value: frequency,
                              label: frequencyLabels[frequency],
                            }))}
                            mobileTitle={t('recurrence.frequency')}
                            ariaLabel={t('recurrence.frequency')}
                            disabled={readOnly}
                            onValueChange={(value) => {
                              if (!recurrence) return
                              updateRecurrence({
                                ...recurrence,
                                frequency: value as RecurrenceFrequency,
                              })
                            }}
                            triggerClassName="min-w-32 flex-1"
                          />
                        </div>
                      </FormItem>
                      <FormItem className="flex-1 space-y-1.5">
                        <FormLabel className="text-xs text-muted-foreground">
                          {t('recurrence.ends.label')}
                        </FormLabel>
                        <ResponsiveChoicePicker
                          value={end?.type ?? 'INDEFINITE'}
                          options={[
                            {
                              value: 'INDEFINITE',
                              label: t('recurrence.ends.never'),
                            },
                            {
                              value: 'COUNT',
                              label: t('recurrence.ends.count'),
                            },
                            {
                              value: 'DATE',
                              label: t('recurrence.ends.date'),
                            },
                          ]}
                          mobileTitle={t('recurrence.ends.label')}
                          ariaLabel={t('recurrence.ends.label')}
                          disabled={readOnly}
                          onValueChange={(value) => {
                            if (value === 'COUNT')
                              updateEnd({
                                type: 'COUNT',
                                count: Math.max(2, currentSequence),
                              })
                            else if (value === 'DATE') {
                              const fallback = expenseDate ?? new Date()
                              updateEnd({
                                type: 'DATE',
                                endDate: new Date(
                                  fallback.getTime() + 30 * 24 * 60 * 60 * 1000,
                                ),
                              })
                            } else updateEnd({ type: 'INDEFINITE' })
                            setCountDraft(null)
                            setEndDateDraft(null)
                          }}
                          triggerClassName="w-full"
                        />
                      </FormItem>
                    </div>

                    {end?.type === 'COUNT' && (
                      <div className="mt-4 max-w-sm">
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          htmlFor="recurrence-count"
                        >
                          {t('recurrence.ends.countInput')}
                        </FormLabel>
                        <div className="mt-1 flex h-10 w-full max-w-56 overflow-hidden rounded-md border border-input bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-full w-10 shrink-0 rounded-none border-e"
                            aria-label={t('recurrence.decreaseOccurrences')}
                            disabled={readOnly || end.count <= currentSequence}
                            onClick={() =>
                              (() => {
                                setCountDraft(null)
                                updateEnd({
                                  type: 'COUNT',
                                  count: Math.max(
                                    currentSequence,
                                    Math.min(9999, end.count - 1),
                                  ),
                                })
                              })()
                            }
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </Button>
                          <Input
                            id="recurrence-count"
                            type="number"
                            min={currentSequence}
                            max={9999}
                            step={1}
                            inputMode="numeric"
                            value={countDraft ?? String(end.count)}
                            disabled={readOnly}
                            onFocus={() => {
                              if (countDraft === null)
                                setCountDraft(String(end.count))
                            }}
                            onChange={(event) => {
                              const raw = event.target.value
                              setCountDraft(raw)
                              const count = parseIntegerDraft(raw)
                              if (count === null) return
                              updateEnd({
                                type: 'COUNT',
                                count: Math.max(
                                  currentSequence,
                                  Math.min(9999, count),
                                ),
                              })
                            }}
                            onBlur={normalizeCountDraft}
                            className="h-full min-w-0 flex-1 appearance-none rounded-none border-0 text-center shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-full w-10 shrink-0 rounded-none border-s"
                            aria-label={t('recurrence.increaseOccurrences')}
                            disabled={readOnly || end.count >= 9999}
                            onClick={() =>
                              (() => {
                                setCountDraft(null)
                                updateEnd({
                                  type: 'COUNT',
                                  count: Math.min(9999, end.count + 1),
                                })
                              })()
                            }
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {countPresets[recurrence?.frequency ?? 'WEEKLY']
                            .filter((preset) => preset >= currentSequence)
                            .map((preset) => (
                              <Button
                                key={preset}
                                type="button"
                                size="sm"
                                variant={
                                  end.count === preset ? 'secondary' : 'outline'
                                }
                                className="h-8 px-2.5 text-xs tabular-nums"
                                disabled={readOnly}
                                aria-pressed={end.count === preset}
                                onClick={() =>
                                  (() => {
                                    setCountDraft(null)
                                    updateEnd({
                                      type: 'COUNT',
                                      count: preset,
                                    })
                                  })()
                                }
                              >
                                {preset}
                              </Button>
                            ))}
                        </div>
                      </div>
                    )}

                    {end?.type === 'DATE' && (
                      <div className="mt-3 max-w-xs">
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          htmlFor="recurrence-end-date"
                        >
                          {t('recurrence.ends.dateInput')}
                        </FormLabel>
                        <DateInput
                          id="recurrence-end-date"
                          pickerTitle={t('recurrence.ends.dateInput')}
                          min={
                            expenseDate
                              ? formatDateInputValue(expenseDate)
                              : undefined
                          }
                          value={
                            endDateDraft ??
                            (Number.isFinite(end.endDate.getTime())
                              ? formatDateInputValue(end.endDate)
                              : '')
                          }
                          disabled={readOnly}
                          onFocus={() => {
                            if (endDateDraft === null) {
                              setEndDateDraft(
                                Number.isFinite(end.endDate.getTime())
                                  ? formatDateInputValue(end.endDate)
                                  : '',
                              )
                            }
                          }}
                          onValueChange={(raw) => {
                            setEndDateDraft(raw)
                            if (!raw) return
                            const selected = parseDateInputValue(raw)
                            if (!Number.isFinite(selected.getTime())) return
                            const anchor = expenseDate ?? selected
                            updateEnd({
                              type: 'DATE',
                              endDate:
                                selected.getTime() < anchor.getTime()
                                  ? anchor
                                  : selected,
                            })
                          }}
                          onBlur={() => setEndDateDraft(null)}
                          className="date-base mt-1"
                        />
                      </div>
                    )}

                    {scheduleChanged && (
                      <Alert
                        className="mt-4 border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
                        aria-live="polite"
                      >
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <AlertTitle>
                          {t('recurrence.scheduleChangeWarningTitle')}
                        </AlertTitle>
                        <AlertDescription>
                          {t('recurrence.scheduleChangeWarning')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {showPastDateBackfillNote && (
                      <p
                        className={cn(
                          'mt-4 border-s-2 border-primary/40 ps-3 text-sm text-muted-foreground',
                          scheduleChanged && 'mt-3',
                        )}
                        aria-live="polite"
                      >
                        {t('recurrence.pastDateBackfillNote')}
                      </p>
                    )}

                    <div
                      className="mt-4"
                      aria-live="polite"
                      aria-label={t('recurrence.previewLabel')}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <CalendarClock
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {t('recurrence.previewLabel')}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {scheduleSummary}
                        </span>
                      </div>
                      {previewEntries.length > 0 ? (
                        <OccurrenceTimeline
                          aria-label={t('recurrence.previewLabel')}
                        >
                          {previewEntries.map((entry, index) => (
                            <OccurrenceTimelineItem
                              key={`${entry.sequence}-${entry.date.toISOString()}`}
                              entry={entry}
                              currentSequence={currentSequence}
                              locale={locale}
                              currentLabel={t('recurrence.currentOccurrence')}
                              completedLabel={t(
                                'recurrence.completedOccurrence',
                              )}
                              upcomingLabel={t('recurrence.upcomingOccurrence')}
                              showTopConnector={index > 0}
                              showBottomConnector={
                                index < previewEntries.length - 1 || hasViewAll
                              }
                              className="min-h-16 sm:min-h-0"
                            />
                          ))}
                          {hasViewAll && (
                            <OccurrenceTimelineMoreItem
                              label={t('recurrence.viewAll')}
                              onClick={() => setScheduleOpen(true)}
                              className="min-h-16 sm:min-h-0"
                            />
                          )}
                        </OccurrenceTimeline>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('recurrence.noFurtherOccurrences')}
                        </p>
                      )}
                      {schedule.remainingCount === 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t('recurrence.noFurtherOccurrences')}
                        </p>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <ResponsiveDialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('recurrence.scheduleTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {schedule.totalCount === null
                ? t('recurrence.unlimitedSchedule')
                : t('recurrence.scheduleCount', {
                    count: schedule.totalCount,
                  })}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="min-h-0 overflow-hidden">
            <ProjectedScheduleList
              schedule={scheduleMetadata}
              locale={locale}
              currentLabel={t('recurrence.currentOccurrence')}
              completedLabel={t('recurrence.completedOccurrence')}
              upcomingLabel={t('recurrence.upcomingOccurrence')}
              noEndLabel={t('recurrence.unlimitedSchedule')}
              emptyLabel={t('recurrence.noFurtherOccurrences')}
              ariaLabel={t('recurrence.scheduleTitle')}
            />
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

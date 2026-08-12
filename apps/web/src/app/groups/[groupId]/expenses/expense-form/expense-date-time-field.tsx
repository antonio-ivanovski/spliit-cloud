/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- the custom timeline needs grouped sticky boundaries, and popup IDs are managed by the responsive trigger primitives. */
import {
  ArrowLeft,
  CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Globe2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { TimeZonePickerContent } from '@/components/time-zone-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { getCalendarLocale } from '@/components/ui/calendar-locale'
import {
  parseIsoCalendarDate,
  toIsoCalendarDate,
} from '@/components/ui/date-input-utils'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useLocale } from '@/i18n/react'
import { formatExpenseClosed, getDeviceTimeZone } from '@/lib/expense-display'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import {
  formatTimeMinutes,
  parseTimeMinutes,
  timeZoneCityOffsetLabel,
  wallTimeToUtc,
} from '@spliit/domain'
import {
  firstDayOfWeek,
  isRtlLocale,
  resolveFormattingLocale,
} from '@spliit/domain/i18n'

import { expenseTabPriority } from './focus-navigation'

type Props = {
  // oxlint-disable-next-line typescript/no-explicit-any -- form shape varies by caller
  form: UseFormReturn<any>
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
}

type PickerView = 'date' | 'time' | 'timezone'

export type ExpenseTimeTimelineOption = {
  dateIso: string
  time: string
  key: string
  changesDate: boolean
}

type TimelineAnchor = {
  dateIso: string
  time: string
}

const MINUTE_MS = 60_000
const STEP_MINUTES = 15
const RANGE_MINUTES = 24 * 60

function presetIsoInTz(offsetDays: number, tz: string): string {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const d = parseIsoCalendarDate(iso)
  if (!d) return iso
  d.setDate(d.getDate() + offsetDays)
  return toIsoCalendarDate(d)
}

/**
 * A timezone-neutral coordinate used only to enumerate wall-clock labels. It
 * intentionally is not an instant; DST validity is checked separately.
 */
function wallClockCoordinateMs(anchor: TimelineAnchor): number {
  const date = parseIsoCalendarDate(anchor.dateIso)
  const minutes = parseTimeMinutes(anchor.time)
  if (!date) throw new RangeError('invalid timeline date')
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  )
}

function timelineOption(ms: number, selectedDateIso: string) {
  const date = new Date(ms)
  const dateIso = [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('-')
  const time = formatTimeMinutes(date.getUTCHours() * 60 + date.getUTCMinutes())
  return {
    dateIso,
    time,
    key: `${dateIso}T${time}`,
    changesDate: dateIso !== selectedDateIso,
  } satisfies ExpenseTimeTimelineOption
}

export function buildExpenseTimeTimeline(
  anchor: TimelineAnchor,
): ExpenseTimeTimelineOption[] {
  const anchorMs = wallClockCoordinateMs(anchor)
  const start = anchorMs - RANGE_MINUTES * MINUTE_MS
  const end = anchorMs + RANGE_MINUTES * MINUTE_MS
  const stepMs = STEP_MINUTES * MINUTE_MS
  const candidateTimes = new Set<number>([start, anchorMs, end])
  let cursor = Math.ceil(start / stepMs) * stepMs
  while (cursor <= end) {
    candidateTimes.add(cursor)
    cursor += stepMs
  }
  return [...candidateTimes]
    .toSorted((a, b) => a - b)
    .map((ms) => timelineOption(ms, anchor.dateIso))
}

function sentenceCase(value: string, locale: string): string {
  const [first, ...rest] = Array.from(value)
  return first ? `${first.toLocaleUpperCase(locale)}${rest.join('')}` : value
}

export function ExpenseDateTimeField({ form, readOnly, sExpense }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const expenseDay = useWatch({
    control: form.control,
    name: 'expenseDay' as never,
  }) as unknown as string
  const expenseTime = useWatch({
    control: form.control,
    name: 'expenseTime' as never,
  }) as unknown as string
  const expenseTimeZone = useWatch({
    control: form.control,
    name: 'expenseTimeZone' as never,
  }) as unknown as string

  const deviceTz = useMemo(() => getDeviceTimeZone(), [])
  const selectedTz = expenseTimeZone
  const timeStr = expenseTime
  const isoDate = expenseDay

  const instantForDisplay = useMemo(() => {
    try {
      return wallTimeToUtc(isoDate, parseTimeMinutes(timeStr), selectedTz)
    } catch {
      return parseIsoCalendarDate(isoDate) ?? new Date()
    }
  }, [isoDate, selectedTz, timeStr])
  const display = useMemo(
    () =>
      formatExpenseClosed(
        {
          expenseDate: instantForDisplay,
          expenseTimeZone: selectedTz,
        },
        locale,
        deviceTz,
        t('dateTimePicker.yourTime' as never, { defaultValue: 'your time' }),
      ),
    [deviceTz, instantForDisplay, locale, selectedTz, t],
  )

  const [open, setOpen] = useState(false)
  const [activeView, setActiveView] = useState<PickerView>('time')
  const [returnView, setReturnView] =
    useState<Exclude<PickerView, 'timezone'>>('time')
  const [timelineAnchor, setTimelineAnchor] = useState<TimelineAnchor>({
    dateIso: isoDate,
    time: timeStr,
  })
  const [calendarMonth, setCalendarMonth] = useState(
    () => parseIsoCalendarDate(isoDate) ?? new Date(),
  )
  const timeListRef = useRef<HTMLDivElement>(null)
  const [focusedTimeKey, setFocusedTimeKey] = useState(`${isoDate}T${timeStr}`)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selectedDate = parseIsoCalendarDate(isoDate)
  const formattingLocale = resolveFormattingLocale(locale)
  const calendarLocale = getCalendarLocale(locale)
  const timeline = useMemo(
    () => buildExpenseTimeTimeline(timelineAnchor),
    [timelineAnchor],
  )
  const timelineGroups = useMemo(
    () => Object.groupBy(timeline, (option) => option.dateIso),
    [timeline],
  )
  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(formattingLocale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    [formattingLocale],
  )

  const setDateIso = (nextIso: string) => {
    const date = parseIsoCalendarDate(nextIso)
    if (!date) return
    form.setValue('expenseDay' as never, nextIso as never, {
      shouldDirty: true,
      shouldTouch: true,
    })
  }
  const setTime = (next: string) => {
    form.setValue('expenseTime' as never, next as never, {
      shouldDirty: true,
      shouldTouch: true,
    })
  }
  const setTz = (next: string) => {
    form.setValue('expenseTimeZone' as never, next as never, {
      shouldDirty: true,
      shouldTouch: true,
    })
  }

  useEffect(() => {
    if (!open || activeView !== 'time') return
    let cancelled = false
    const scrollSelected = () => {
      if (cancelled) return
      const list = timeListRef.current
      const selected = list?.querySelector<HTMLElement>(
        '[data-selected-time="true"]',
      )
      if (!list || !selected) return
      const listRect = list.getBoundingClientRect()
      const selectedRect = selected.getBoundingClientRect()
      list.scrollTop +=
        selectedRect.top -
        listRect.top -
        listRect.height / 2 +
        selectedRect.height / 2
    }
    const raf = requestAnimationFrame(() => {
      scrollSelected()
      requestAnimationFrame(scrollSelected)
    })
    const timeout = window.setTimeout(scrollSelected, 80)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timeout)
    }
  }, [activeView, open, timelineAnchor])

  const anchorTimeline = (dateIso = isoDate, time = timeStr) => {
    setTimelineAnchor({ dateIso, time })
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      anchorTimeline()
      setFocusedTimeKey(`${isoDate}T${timeStr}`)
      setCalendarMonth(parseIsoCalendarDate(isoDate) ?? new Date())
      setActiveView(isDesktop ? 'time' : 'date')
      setReturnView(isDesktop ? 'time' : 'date')
    }
    setOpen(nextOpen)
  }
  const selectDate = (nextIso: string) => {
    setDateIso(nextIso)
    anchorTimeline(nextIso)
    const nextDate = parseIsoCalendarDate(nextIso)
    if (nextDate) setCalendarMonth(nextDate)
  }
  const selectTimelineOption = (option: ExpenseTimeTimelineOption) => {
    setFocusedTimeKey(option.key)
    setDateIso(option.dateIso)
    setTime(option.time)
  }
  const moveTimeFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    option: ExpenseTimeTimelineOption,
  ) => {
    const current = timeline.findIndex((entry) => entry.key === option.key)
    if (current < 0) return
    const columns = isDesktop ? 2 : 4
    const delta =
      event.key === 'ArrowDown'
        ? columns
        : event.key === 'ArrowUp'
          ? -columns
          : event.key === 'ArrowRight'
            ? isRtlLocale(locale)
              ? -1
              : 1
            : event.key === 'ArrowLeft'
              ? isRtlLocale(locale)
                ? 1
                : -1
              : null
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? timeline.length - 1
          : delta == null
            ? null
            : Math.max(0, Math.min(timeline.length - 1, current + delta))
    if (nextIndex == null) return
    event.preventDefault()
    const next = timeline[nextIndex]
    if (!next) return
    setFocusedTimeKey(next.key)
    requestAnimationFrame(() => {
      timeListRef.current
        ?.querySelector<HTMLElement>(`[data-time-key="${next.key}"]`)
        ?.focus()
    })
  }
  const showTime = () => {
    anchorTimeline()
    setActiveView('time')
  }
  const showTimezone = () => {
    setReturnView(activeView === 'date' ? 'date' : 'time')
    setActiveView('timezone')
  }

  const calendar = (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      fixedWeeks
      className={cn(
        'mx-auto',
        isDesktop
          ? '[--cell-size:--spacing(9)]'
          : '[--cell-size:clamp(2.25rem,11vw,2.75rem)]',
      )}
      month={calendarMonth}
      dir={isRtlLocale(locale) ? 'rtl' : 'ltr'}
      lang={formattingLocale}
      locale={calendarLocale}
      required
      selected={selectedDate}
      weekStartsOn={(firstDayOfWeek(locale) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
      onMonthChange={setCalendarMonth}
      onSelect={(date) => date && selectDate(toIsoCalendarDate(date))}
    />
  )
  const presets = (['yesterday', 'today', 'tomorrow'] as const).map(
    (preset) => ({
      preset,
      iso: presetIsoInTz(
        preset === 'yesterday' ? -1 : preset === 'tomorrow' ? 1 : 0,
        selectedTz,
      ),
    }),
  )
  const calendarChrome = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        !isDesktop && 'w-full flex-none',
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 justify-center overflow-y-auto px-1',
          !isDesktop && 'flex-none overflow-visible py-1',
        )}
      >
        {calendar}
      </div>
      <div className="flex shrink-0 justify-center border-t px-3 py-2">
        <div className="inline-flex rounded-lg bg-muted/70 p-1">
          {presets.map(({ preset, iso }) => {
            const selected = iso === isoDate
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  selected && 'bg-background text-foreground shadow-xs',
                )}
                onClick={() => selectDate(iso)}
              >
                {sentenceCase(
                  t(`DatePicker.presets.${preset}` as never, {
                    defaultValue: preset,
                  }),
                  formattingLocale,
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  const timeTimeline = (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/10">
      <div
        ref={timeListRef}
        role="listbox"
        aria-label={t('dateTimePicker.timeTab' as never, {
          defaultValue: 'Time',
        })}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {Object.entries(timelineGroups).map(([dateIso, options]) => {
          if (!options) return null
          const date = new Date(`${dateIso}T12:00:00.000Z`)
          const changesDate = dateIso !== isoDate
          return (
            <div key={dateIso} role="group">
              <div className="sticky top-0 z-10 -mx-2 flex items-center gap-2 border-y bg-background/95 px-3 py-2 backdrop-blur-sm">
                <span className="text-xs font-semibold">
                  {dayFormatter.format(date)}
                </span>
                {changesDate && (
                  <Badge
                    variant="secondary"
                    className="border-0 px-2 py-0.5 text-[10px] font-medium"
                  >
                    {t('dateTimePicker.changesDate' as never, {
                      defaultValue: 'Changes date',
                    })}
                  </Badge>
                )}
              </div>
              <div
                className={cn(
                  'grid gap-1 py-2',
                  isDesktop ? 'grid-cols-2' : 'grid-cols-4',
                )}
              >
                {options.map((option) => {
                  const selected =
                    option.dateIso === isoDate && option.time === timeStr
                  const anchor =
                    option.dateIso === timelineAnchor.dateIso &&
                    option.time === timelineAnchor.time
                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={option.key === focusedTimeKey ? 0 : -1}
                      data-time-key={option.key}
                      data-date={option.dateIso}
                      data-time-option={option.time}
                      data-selected-time={anchor ? 'true' : undefined}
                      className={cn(
                        'flex h-9 items-center rounded-md text-sm tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        isDesktop
                          ? 'px-2.5 text-start'
                          : 'justify-center px-1 text-center',
                        selected &&
                          'bg-primary font-medium text-primary-foreground hover:bg-primary/90',
                      )}
                      onClick={() => selectTimelineOption(option)}
                      onFocus={() => setFocusedTimeKey(option.key)}
                      onKeyDown={(event) => moveTimeFocus(event, option)}
                    >
                      <span>{option.time}</span>
                      {selected && (
                        <Check
                          className={cn(
                            'size-3.5',
                            isDesktop ? 'ms-auto' : 'ms-1',
                          )}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const timezonePicker = (
    <TimeZonePickerContent
      value={selectedTz}
      referenceDate={instantForDisplay}
      className="min-h-0 flex-1 rounded-none"
      listClassName="max-h-none min-h-0 flex-1"
      onChange={(next) => {
        setTz(next)
        setActiveView(returnView)
      }}
    />
  )
  const desktopTimezonePanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('dateTimePicker.back' as never, {
            defaultValue: 'Back',
          })}
          onClick={() => setActiveView(returnView)}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <span className="text-sm font-medium">
          {t('dateTimePicker.chooseTimezone' as never, {
            defaultValue: 'Choose timezone',
          })}
        </span>
      </div>
      {timezonePicker}
    </div>
  )
  const timezoneFooter = (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={showTimezone}
    >
      <Globe2
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t('dateTimePicker.timezone' as never, {
            defaultValue: 'Timezone',
          })}
        </span>
        <span className="block truncate text-sm">
          {timeZoneCityOffsetLabel(selectedTz, instantForDisplay)}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
        aria-hidden="true"
      />
    </button>
  )

  const desktopPanel = (
    <div className="grid h-[min(25rem,var(--available-height))] w-[min(41rem,calc(100vw-2rem))] grid-cols-[20rem_minmax(17rem,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="flex min-h-0 border-e">{calendarChrome}</div>
      <div className="flex min-h-0">
        {activeView === 'timezone' ? desktopTimezonePanel : timeTimeline}
      </div>
      <div className="col-span-2 flex items-center border-t bg-background p-1.5">
        {timezoneFooter}
      </div>
    </div>
  )

  const mobileTabs = activeView !== 'timezone' && (
    <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
      <button
        type="button"
        className={cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          activeView === 'date'
            ? 'bg-background text-foreground shadow-xs'
            : 'text-muted-foreground',
        )}
        onClick={() => setActiveView('date')}
      >
        {t('dateTimePicker.dateTab' as never, { defaultValue: 'Date' })}
      </button>
      <button
        type="button"
        className={cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          activeView === 'time'
            ? 'bg-background text-foreground shadow-xs'
            : 'text-muted-foreground',
        )}
        onClick={showTime}
      >
        {t('dateTimePicker.timeTab' as never, { defaultValue: 'Time' })}
      </button>
    </div>
  )

  const closedTrigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t(`${sExpense}.DateField.label`)}
      title={display.tooltip}
      data-expense-tab-priority={expenseTabPriority.date}
      disabled={readOnly}
      className="h-10 w-full min-w-0 justify-start gap-3 px-3 font-normal tabular-nums"
    >
      <CalendarIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-start">{display.text}</span>
      <ChevronDown
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-180',
        )}
        aria-hidden="true"
      />
    </Button>
  )

  return (
    <FormField
      control={form.control}
      name={'expenseDay' as never}
      render={() => (
        <FormItem className="col-span-full w-full min-w-0 md:col-span-2">
          <FormLabel>{t(`${sExpense}.DateField.label`)}</FormLabel>
          <div className="w-full min-w-0">
            {isDesktop ? (
              <Popover open={open} onOpenChange={handleOpenChange}>
                <FormControl>
                  <PopoverTrigger disabled={readOnly} render={closedTrigger} />
                </FormControl>
                <PopoverContent
                  align="start"
                  side="bottom"
                  collisionPadding={12}
                  collisionAvoidance={{ side: 'flip', align: 'shift' }}
                  className="max-h-(--available-height) w-auto overflow-hidden p-0"
                >
                  {desktopPanel}
                </PopoverContent>
              </Popover>
            ) : (
              <Drawer open={open} onOpenChange={handleOpenChange}>
                <FormControl>
                  <DrawerTrigger disabled={readOnly} render={closedTrigger} />
                </FormControl>
                <DrawerContent className="overflow-hidden p-0">
                  <DrawerHeader className="shrink-0 gap-3 pb-3 text-start">
                    <div className="flex min-h-7 items-center gap-2">
                      {activeView === 'timezone' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('dateTimePicker.back' as never, {
                            defaultValue: 'Back',
                          })}
                          onClick={() => setActiveView(returnView)}
                        >
                          <ArrowLeft
                            className="size-4 rtl:rotate-180"
                            aria-hidden="true"
                          />
                        </Button>
                      )}
                      <DrawerTitle>
                        {activeView === 'timezone'
                          ? t('dateTimePicker.chooseTimezone' as never, {
                              defaultValue: 'Choose timezone',
                            })
                          : t(`${sExpense}.DateField.label`)}
                      </DrawerTitle>
                    </div>
                    {mobileTabs}
                  </DrawerHeader>
                  <div
                    className={cn(
                      'flex min-h-0 overflow-hidden border-y',
                      activeView === 'date'
                        ? 'h-auto shrink-0'
                        : 'h-[min(58dvh,29rem)]',
                    )}
                  >
                    {activeView === 'timezone'
                      ? timezonePicker
                      : activeView === 'date'
                        ? calendarChrome
                        : timeTimeline}
                  </div>
                  <DrawerFooter className="shrink-0 gap-2 bg-background pt-2">
                    {activeView !== 'timezone' && timezoneFooter}
                    <Button
                      type="button"
                      onClick={() => handleOpenChange(false)}
                    >
                      {t('dateTimePicker.done' as never, {
                        defaultValue: 'Done',
                      })}
                    </Button>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            )}
          </div>
          <FormDescription className="hidden sm:block">
            {t(`${sExpense}.DateField.description`)}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

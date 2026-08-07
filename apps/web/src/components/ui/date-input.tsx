import { CalendarIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { Formatters, Matcher, Numerals } from 'react-day-picker'

import {
  firstDayOfWeek,
  isRtlLocale,
  resolveFormattingLocale,
} from '@spliit/domain/i18n'

import { useLocale } from '@/i18n/react'
import { useMediaQuery } from '@/lib/hooks'
import { cn, zonedDateOnlyIso } from '@/lib/utils'

import { Calendar } from './calendar'
import { getCalendarLocale } from './calendar-locale'
import {
  formatDateInputDisplay,
  parseDateInputDisplay,
  parseIsoCalendarDate,
  toIsoCalendarDate,
} from './date-input-utils'
import { Button } from './button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { useResponsiveDialogSurface } from './responsive-dialog'

type DateInputPreset = 'yesterday' | 'today' | 'tomorrow'
type DateInputPickerSurface = 'auto' | 'drawer' | 'inline' | 'popover'

type DateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'max' | 'min' | 'onChange' | 'type' | 'value'
> & {
  defaultValue?: string
  max?: string
  min?: string
  onValueChange?: (value: string) => void
  clearLabel?: string
  pickerButtonLabel?: string
  pickerSurface?: DateInputPickerSurface
  pickerTitle: string
  presets?: readonly DateInputPreset[]
  timeZone?: string
  value?: string
}

const PRESET_DAY_OFFSET: Record<DateInputPreset, number> = {
  yesterday: -1,
  today: 0,
  tomorrow: 1,
}

const DEVICE_TIME_ZONE =
  new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function getPresetValue(today: string, preset: DateInputPreset) {
  const date = parseIsoCalendarDate(today)
  if (!date) return ''
  date.setDate(date.getDate() + PRESET_DAY_OFFSET[preset])
  return toIsoCalendarDate(date)
}

function getNumerals(locale: string): Numerals {
  if (locale === 'ar-SA') return 'arab'
  if (locale === 'bn-BD') return 'beng'
  return 'latn'
}

function getCalendarFormatters(locale: string): Partial<Formatters> {
  const formattingLocale = resolveFormattingLocale(locale)
  const options = { calendar: 'gregory' } satisfies Intl.DateTimeFormatOptions
  const captionFormatter = new Intl.DateTimeFormat(formattingLocale, {
    ...options,
    month: 'long',
    year: 'numeric',
  })
  const dayFormatter = new Intl.DateTimeFormat(formattingLocale, {
    ...options,
    day: 'numeric',
  })
  const monthFormatter = new Intl.DateTimeFormat(formattingLocale, {
    ...options,
    month: 'long',
  })
  const weekdayFormatter = new Intl.DateTimeFormat(formattingLocale, {
    ...options,
    weekday: 'short',
  })
  const weekFormatter = new Intl.NumberFormat(formattingLocale, {
    minimumIntegerDigits: 2,
  })
  const yearFormatter = new Intl.DateTimeFormat(formattingLocale, {
    ...options,
    year: 'numeric',
  })

  return {
    formatCaption: (date) => captionFormatter.format(date),
    formatDay: (date) => dayFormatter.format(date),
    formatMonthDropdown: (date) => monthFormatter.format(date),
    formatWeekdayName: (date) => weekdayFormatter.format(date),
    formatWeekNumber: (weekNumber) => weekFormatter.format(weekNumber),
    formatYearDropdown: (date) => yearFormatter.format(date),
  }
}

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      className,
      clearLabel,
      defaultValue = '',
      disabled,
      form,
      lang,
      max,
      min,
      name,
      onValueChange,
      pickerButtonLabel,
      pickerSurface = 'auto',
      pickerTitle,
      placeholder,
      presets = [],
      readOnly,
      required,
      timeZone,
      value,
      ...props
    },
    ref,
  ) => {
    const locale = useLocale()
    const { t } = useTranslation()
    const isDesktop = useMediaQuery('(min-width: 768px)')
    const responsiveDialogSurface = useResponsiveDialogSurface()
    const resolvedPickerSurface =
      pickerSurface === 'auto'
        ? responsiveDialogSurface === 'drawer'
          ? 'inline'
          : isDesktop
            ? 'popover'
            : 'drawer'
        : pickerSurface
    const formattingLocale = resolveFormattingLocale(locale)
    const [uncontrolledValue, setUncontrolledValue] =
      React.useState(defaultValue)
    const [open, setOpen] = React.useState(false)
    const isoValue = value ?? uncontrolledValue
    const selected = parseIsoCalendarDate(isoValue)
    const minDate = parseIsoCalendarDate(min)
    const maxDate = parseIsoCalendarDate(max)
    const [defaultMonth] = React.useState(() => new Date())
    const [now] = React.useState(() => new Date())
    const resolvedTimeZone = timeZone ?? DEVICE_TIME_ZONE
    const today = zonedDateOnlyIso(now, resolvedTimeZone)
    const calendarAnchor = isoValue || min || max || ''
    const [navigation, setNavigation] = React.useState<{
      anchor: string
      month: Date
    } | null>(null)
    const month =
      (navigation?.anchor === calendarAnchor ? navigation.month : undefined) ??
      selected ??
      minDate ??
      maxDate ??
      defaultMonth
    const disabledDates = React.useMemo(() => {
      const matchers: Matcher[] = []
      const minimum = parseIsoCalendarDate(min)
      const maximum = parseIsoCalendarDate(max)
      if (minimum) matchers.push({ before: minimum })
      if (maximum) matchers.push({ after: maximum })
      return matchers
    }, [max, min])
    const displayValue = React.useMemo(
      () => formatDateInputDisplay(isoValue, locale),
      [isoValue, locale],
    )
    const [editingValue, setEditingValue] = React.useState<string | null>(null)
    const inputValue = editingValue ?? displayValue
    const calendarFormatters = React.useMemo(
      () => getCalendarFormatters(locale),
      [locale],
    )
    const defaultStartMonth = React.useMemo(() => new Date(2000, 0, 1, 12), [])
    const defaultEndMonth = React.useMemo(
      () => new Date(Number(today.slice(0, 4)) + 5, 11, 1, 12),
      [today],
    )
    const startMonth =
      minDate ??
      (selected && selected < defaultStartMonth ? selected : defaultStartMonth)
    const endMonth =
      maxDate ??
      (selected && selected > defaultEndMonth ? selected : defaultEndMonth)

    const updateValue = (nextValue: string) => {
      if (value === undefined) setUncontrolledValue(nextValue)
      onValueChange?.(nextValue)
    }

    const commitEditingValue = () => {
      const trimmed = inputValue.trim()
      if (!trimmed) {
        updateValue('')
        setEditingValue(null)
        return
      }

      const parsed = parseDateInputDisplay(trimmed, locale)
      if (!parsed) {
        setEditingValue(null)
        return
      }

      const nextValue = toIsoCalendarDate(parsed)
      updateValue(nextValue)
      setEditingValue(null)
      setNavigation(null)
    }

    const handleOpenChange = (nextOpen: boolean) => {
      if (nextOpen) setNavigation(null)
      setOpen(nextOpen)
    }

    const selectValue = (nextValue: string) => {
      updateValue(nextValue)
      setEditingValue(null)
      setNavigation(null)
      handleOpenChange(false)
    }

    const calendarLocale = getCalendarLocale(locale)
    const weekStartsOn = (firstDayOfWeek(locale) % 7) as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6

    const textInput = (
      <Input
        {...props}
        ref={ref}
        type="text"
        className={cn('min-w-0 flex-1 tabular-nums', className)}
        disabled={disabled}
        form={form}
        lang={lang ?? formattingLocale}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        value={inputValue}
        onBlur={commitEditingValue}
        onChange={(event) => {
          setEditingValue(event.target.value)
          if (!event.target.value) updateValue('')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitEditingValue()
          } else if (event.key === 'Escape') {
            setEditingValue(null)
            event.currentTarget.blur()
          }
        }}
      />
    )

    const calendar = (
      <Calendar
        mode="single"
        captionLayout="dropdown"
        className={cn(
          'mx-auto',
          resolvedPickerSurface === 'drawer' &&
            '[--cell-size:--spacing(9)]',
        )}
        month={month}
        dir={isRtlLocale(locale) ? 'rtl' : 'ltr'}
        disabled={disabledDates}
        endMonth={endMonth}
        fixedWeeks
        formatters={calendarFormatters}
        lang={formattingLocale}
        locale={calendarLocale}
        numerals={getNumerals(locale)}
        required={required}
        selected={selected}
        startMonth={startMonth}
        weekStartsOn={weekStartsOn}
        onMonthChange={(nextMonth) =>
          setNavigation({ anchor: calendarAnchor, month: nextMonth })
        }
        onSelect={(date: Date | undefined) => {
          selectValue(date ? toIsoCalendarDate(date) : '')
        }}
      />
    )

    const calendarChrome = (
      <div
        data-slot="date-picker-chrome"
        className={cn(
          'flex min-h-[21rem] flex-col overflow-hidden',
          presets.length > 0 && 'min-h-[24rem]',
        )}
      >
        <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
          {calendar}
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 border-t p-3">
            {presets.map((preset) => {
              const presetValue = getPresetValue(today, preset)
              const outsideRange =
                (min !== undefined && presetValue < min) ||
                (max !== undefined && presetValue > max)
              return (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={outsideRange}
                  onClick={() => selectValue(presetValue)}
                >
                  {t(`DatePicker.presets.${preset}`)}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    )

    const hiddenInput = name ? (
      <input
        type="hidden"
        disabled={disabled}
        form={form}
        name={name}
        value={isoValue}
      />
    ) : null

    const clearButton = !required && isoValue && !disabled && !readOnly && (
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={clearLabel ?? `${pickerTitle} ×`}
        title={clearLabel ?? `${pickerTitle} ×`}
        onClick={() => {
          updateValue('')
          setEditingValue(null)
        }}
      >
        <XIcon aria-hidden="true" />
      </Button>
    )

    const inlinePickerButton = (
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={pickerButtonLabel ?? `${pickerTitle}…`}
        disabled={disabled || readOnly}
        onClick={() => handleOpenChange(!open)}
      >
        <CalendarIcon aria-hidden="true" />
      </Button>
    )

    if (resolvedPickerSurface === 'inline') {
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {textInput}
            {inlinePickerButton}
            {clearButton}
            {hiddenInput}
          </div>
          {open && calendarChrome}
        </div>
      )
    }

    if (resolvedPickerSurface === 'drawer') {
      return (
        <div className="flex min-w-0 items-center gap-1">
          {textInput}
          <Drawer open={open} onOpenChange={handleOpenChange}>
            <DrawerTrigger
              render={<Button type="button" variant="outline" size="icon" />}
              aria-label={pickerButtonLabel ?? `${pickerTitle}…`}
              disabled={disabled || readOnly}
            >
              <CalendarIcon aria-hidden="true" />
            </DrawerTrigger>
            <DrawerContent className="overflow-hidden p-0">
              <DrawerHeader className="pb-2 text-start">
                <DrawerTitle>{pickerTitle}</DrawerTitle>
              </DrawerHeader>
              <div className="min-h-0 overflow-y-auto px-4 pb-4">
                {calendarChrome}
              </div>
            </DrawerContent>
          </Drawer>
          {clearButton}
          {hiddenInput}
        </div>
      )
    }

    return (
      <div className="flex min-w-0 items-center gap-1">
        {textInput}
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="icon" />}
            aria-label={pickerButtonLabel ?? `${pickerTitle}…`}
            disabled={disabled || readOnly}
          >
            <CalendarIcon aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            {calendarChrome}
          </PopoverContent>
        </Popover>
        {clearButton}
        {hiddenInput}
      </div>
    )
  },
)
DateInput.displayName = 'DateInput'

export {
  DateInput,
  type DateInputPickerSurface,
  type DateInputPreset,
  type DateInputProps,
}

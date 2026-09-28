/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the drum columns need listbox semantics with custom snap-scroll behavior that native select elements cannot provide. */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import {
  formatTimeMinutes,
  parseTimeMinutes,
  utcToWallTime,
} from '@spliit/domain'
import { resolveFormattingLocale } from '@spliit/domain/i18n'

export const QUICK_TIME_MINUTES = {
  morning: 9 * 60,
  midday: 12 * 60,
  evening: 19 * 60,
} as const

export function isTwelveHourLocale(formattingLocale: string): boolean {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(formattingLocale, {
      hour: 'numeric',
    }).resolvedOptions()
    return hourCycle === 'h11' || hourCycle === 'h12'
  } catch {
    return false
  }
}

export function getDayPeriodLabels(formattingLocale: string): {
  am: string
  pm: string
} {
  try {
    const formatter = new Intl.DateTimeFormat(formattingLocale, {
      hour: 'numeric',
      hour12: true,
    })
    const am =
      formatter
        .formatToParts(new Date(2026, 0, 1, 9, 0))
        .find((part) => part.type === 'dayPeriod')?.value ?? 'AM'
    const pm =
      formatter
        .formatToParts(new Date(2026, 0, 1, 21, 0))
        .find((part) => part.type === 'dayPeriod')?.value ?? 'PM'
    return { am, pm }
  } catch {
    return { am: 'AM', pm: 'PM' }
  }
}

function tryParseWheelTime(value: string): number | null {
  try {
    return parseTimeMinutes(value)
  } catch {
    return null
  }
}

/**
 * Localized short time for a wall-clock time, without applying a time zone
 * shift.
 */
function formatWallTimeLabel(
  minutes: number,
  formattingLocale: string,
): string {
  const date = new Date(
    Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60),
  )
  return new Intl.DateTimeFormat(formattingLocale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

type WheelOption = { value: string; label: string }

function WheelColumn({
  name,
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  name: string
  label: string
  options: WheelOption[]
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const scrollTimer = useRef<number | undefined>(undefined)

  const indexOf = (target: string) =>
    options.findIndex((option) => option.value === target)

  // Keep the selected option centered (drawer animation + value changes).
  useEffect(() => {
    const list = listRef.current
    const item = itemRefs.current.get(value)
    if (!list || !item) return
    const raf = requestAnimationFrame(() => {
      list.scrollTop =
        item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2
    })
    return () => cancelAnimationFrame(raf)
  }, [value, options.length])

  useEffect(() => () => window.clearTimeout(scrollTimer.current), [])

  // A scroll that settles on another option adopts it (drum behavior).
  // Clicks and arrow keys commit immediately; this only covers drag/wheel.
  const handleScroll = () => {
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const list = listRef.current
      if (!list || document.activeElement?.tagName === 'INPUT') return
      const center = list.scrollTop + list.clientHeight / 2
      let nearest: string | null = null
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const option of options) {
        const item = itemRefs.current.get(option.value)
        if (!item) continue
        const distance = Math.abs(
          item.offsetTop + item.clientHeight / 2 - center,
        )
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = option.value
        }
      }
      if (nearest != null && nearest !== value) onChange(nearest)
    }, 120)
  }

  const move = (delta: number) => {
    const next = options[indexOf(value) + delta]
    if (next) onChange(next.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const first = options[0]
      if (first) onChange(first.value)
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = options.at(-1)
      if (last) onChange(last.value)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      move(5)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      move(-5)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <span
        id={`wheel-${name}-label`}
        className="flex h-6 shrink-0 items-center justify-center pb-1 text-center text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </span>
      {/* Fixed height: the highlight overlay centers on this box, so it must
          match the scroll list exactly instead of stretching with the drawer. */}
      <div className="relative h-48 shrink-0">
        <div
          ref={listRef}
          role="listbox"
          aria-labelledby={`wheel-${name}-label`}
          aria-label={label}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          data-wheel={name}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-lg [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div aria-hidden="true" className="h-[76px] shrink-0 snap-none" />
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                ref={(node) => {
                  if (node) itemRefs.current.set(option.value, node)
                  else itemRefs.current.delete(option.value)
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                disabled={disabled}
                data-wheel-value={option.value}
                onClick={() => onChange(option.value)}
                className={cn(
                  'flex h-10 w-full min-w-0 snap-center items-center justify-center truncate rounded-md px-0.5 text-base tabular-nums transition-colors focus-visible:outline-none',
                  selected
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            )
          })}
          <div aria-hidden="true" className="h-[76px] shrink-0 snap-none" />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-md border-y bg-muted/50"
        />
      </div>
    </div>
  )
}

export function ExpenseTimeQuickChips({
  selectedTz,
  value,
  disabled,
  onChange,
}: {
  selectedTz: string
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const formattingLocale = resolveFormattingLocale(locale)

  const nowMinutes = useMemo(() => {
    try {
      return utcToWallTime(new Date(), selectedTz).timeMinutes
    } catch {
      return null
    }
  }, [selectedTz])

  const chips = useMemo(() => {
    const entries: { id: string; minutes: number; label: string }[] = [
      {
        id: 'morning',
        minutes: QUICK_TIME_MINUTES.morning,
        label: t('dateTimePicker.morning' as never, {
          defaultValue: 'Morning',
        }),
      },
      {
        id: 'midday',
        minutes: QUICK_TIME_MINUTES.midday,
        label: t('dateTimePicker.midday' as never, { defaultValue: 'Midday' }),
      },
      {
        id: 'evening',
        minutes: QUICK_TIME_MINUTES.evening,
        label: t('dateTimePicker.evening' as never, {
          defaultValue: 'Evening',
        }),
      },
    ]
    if (nowMinutes != null) {
      entries.unshift({
        id: 'now',
        minutes: nowMinutes,
        label: t('dateTimePicker.now' as never, { defaultValue: 'Now' }),
      })
    }
    return entries.map((entry) => ({
      ...entry,
      time: formatTimeMinutes(entry.minutes),
      timeLabel: formatWallTimeLabel(entry.minutes, formattingLocale),
    }))
  }, [formattingLocale, nowMinutes, t])

  const chipsScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollChipsLeft, setCanScrollChipsLeft] = useState(false)
  const [canScrollChipsRight, setCanScrollChipsRight] = useState(false)

  const updateChipsAffordance = () => {
    const el = chipsScrollRef.current
    if (!el) return
    setCanScrollChipsLeft(el.scrollLeft > 1)
    setCanScrollChipsRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1)
  }

  useEffect(() => {
    updateChipsAffordance()
    window.addEventListener('resize', updateChipsAffordance)
    return () => window.removeEventListener('resize', updateChipsAffordance)
  }, [chips])

  return (
    <div className="relative min-w-0 shrink-0 border-b">
      <div
        ref={chipsScrollRef}
        onScroll={updateChipsAffordance}
        data-chip-scroll="true"
        className="flex min-w-0 [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 py-2 [&::-webkit-scrollbar]:hidden"
      >
        {chips.map((chip) => {
          const selected = chip.time === value
          return (
            <button
              key={chip.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              data-quick-time={chip.id === 'now' ? 'now' : chip.time}
              onClick={() => onChange(chip.time)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-muted/60 text-foreground hover:bg-accent',
              )}
            >
              <span>{chip.label}</span>
              <span
                className={cn(
                  'tabular-nums',
                  selected ? 'opacity-80' : 'text-muted-foreground',
                )}
              >
                {chip.timeLabel}
              </span>
            </button>
          )
        })}
      </div>
      <div
        aria-hidden="true"
        data-chips-indicator="left"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-start bg-gradient-to-r from-background to-transparent',
          !canScrollChipsLeft && 'hidden',
        )}
      >
        <ChevronLeft className="size-4 text-muted-foreground" />
      </div>
      <div
        aria-hidden="true"
        data-chips-indicator="right"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end bg-gradient-to-l from-background to-transparent',
          !canScrollChipsRight && 'hidden',
        )}
      >
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </div>
  )
}

export function ExpenseTimeWheel({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const formattingLocale = resolveFormattingLocale(locale)

  const totalMinutes = tryParseWheelTime(value) ?? 12 * 60
  const hour24 = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  const is12h = isTwelveHourLocale(formattingLocale)
  const periodLabels = getDayPeriodLabels(formattingLocale)
  const period = hour24 < 12 ? 'am' : 'pm'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12

  const selectParts = (nextHour24: number, nextMinute: number) => {
    onChange(formatTimeMinutes(nextHour24 * 60 + nextMinute))
  }

  const hourOptions: WheelOption[] = useMemo(() => {
    const hours = is12h
      ? Array.from({ length: 12 }, (_, index) => index + 1)
      : Array.from({ length: 24 }, (_, index) => index)
    return hours.map((hour) => ({
      value: String(hour),
      label: is12h ? String(hour) : String(hour).padStart(2, '0'),
    }))
  }, [is12h])

  const minuteOptions: WheelOption[] = useMemo(
    () =>
      Array.from({ length: 60 }, (_, index) => ({
        value: String(index),
        label: String(index).padStart(2, '0'),
      })),
    [],
  )

  return (
    <div className="flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div
        dir="ltr"
        className="flex min-h-0 w-full min-w-0 flex-1 gap-1 overflow-hidden px-4 py-3"
      >
        <WheelColumn
          name="hour"
          label={t('dateTimePicker.hourLabel' as never, {
            defaultValue: 'Hour',
          })}
          options={hourOptions}
          value={String(is12h ? hour12 : hour24)}
          disabled={disabled}
          onChange={(next) => {
            const nextHour12 = Number(next)
            const nextHour24 =
              period === 'am' ? nextHour12 % 12 : (nextHour12 % 12) + 12
            selectParts(nextHour24, minute)
          }}
        />
        <div aria-hidden="true" className="shrink-0 pt-6">
          <span className="flex h-48 items-center text-lg font-semibold text-muted-foreground">
            :
          </span>
        </div>
        <WheelColumn
          name="minute"
          label={t('dateTimePicker.minuteLabel' as never, {
            defaultValue: 'Minute',
          })}
          options={minuteOptions}
          value={String(minute)}
          disabled={disabled}
          onChange={(next) => selectParts(hour24, Number(next))}
        />
        {is12h && (
          <WheelColumn
            name="period"
            label={t('dateTimePicker.periodLabel' as never, {
              defaultValue: 'AM/PM',
            })}
            options={[
              { value: 'am', label: periodLabels.am },
              { value: 'pm', label: periodLabels.pm },
            ]}
            value={period}
            disabled={disabled}
            onChange={(next) => {
              const nextPeriod = next === 'pm' ? 'pm' : 'am'
              const nextHour24 =
                nextPeriod === 'am' ? hour12 % 12 : (hour12 % 12) + 12
              selectParts(nextHour24, minute)
            }}
          />
        )}
      </div>
      <p className="w-full shrink-0 px-4 pb-2 text-center text-xs text-balance text-muted-foreground">
        {t('dateTimePicker.timeWheelHint' as never, {
          defaultValue:
            'Scroll or tap to set the time. The date stays the same.',
        })}
      </p>
    </div>
  )
}

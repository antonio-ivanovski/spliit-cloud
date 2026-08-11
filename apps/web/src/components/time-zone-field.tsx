import { useVirtualizer } from '@tanstack/react-virtual'
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- the responsive picker exposes combobox semantics through the popover/drawer trigger. */
import { Check, ChevronDown } from 'lucide-react'
import * as React from 'react'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getSupportedTimeZones } from '@/lib/account-preferences'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { resolveFormattingLocale } from '@spliit/domain'

type TimeZoneOption = {
  id: string
  city: string
  region: string
  searchValue: string
}

type TimeZoneListRow =
  | { type: 'heading'; key: string; label: string }
  | { type: 'option'; key: string; option: TimeZoneOption }

const optionCache = new Map<string, TimeZoneOption[]>()
const offsetCache = new Map<string, string>()

function humanize(value: string) {
  return value.replaceAll('_', ' ')
}

function offsetFor(timeZone: string, at: Date) {
  const cacheKey = `${timeZone}:${Math.floor(at.getTime() / 3_600_000)}`
  const cached = offsetCache.get(cacheKey)
  if (cached) return cached
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((candidate) => candidate.type === 'timeZoneName')?.value
  const offset = part === 'GMT' ? 'GMT+00:00' : (part ?? 'GMT+00:00')
  offsetCache.set(cacheKey, offset)
  return offset
}

function buildOptions(locale: string): TimeZoneOption[] {
  const cacheKey = locale
  const cached = optionCache.get(cacheKey)
  if (cached) return cached
  const collator = new Intl.Collator(resolveFormattingLocale(locale), {
    sensitivity: 'base',
  })
  const result = getSupportedTimeZones()
    .map((id) => {
      const parts = id.split('/')
      const city = id === 'UTC' ? 'UTC' : humanize(parts.at(-1) ?? id)
      const region = id === 'UTC' ? 'UTC' : humanize(parts[0] ?? 'Other')
      return {
        id,
        city,
        region,
        searchValue: `${city} ${region} ${id}`,
      }
    })
    .toSorted(
      (a, b) =>
        collator.compare(a.region, b.region) ||
        collator.compare(a.city, b.city),
    )
  optionCache.set(cacheKey, result)
  return result
}

type Props = {
  id?: string
  value: string
  disabled?: boolean
  name?: string
  onBlur?: () => void
  onChange: (value: string) => void
  className?: string
  referenceDate?: Date
}

type TimeZonePickerContentProps = {
  value: string
  onChange: (value: string) => void
  referenceDate?: Date
  className?: string
  listClassName?: string
}

export function TimeZonePickerContent({
  value,
  onChange,
  referenceDate,
  className,
  listClassName,
}: TimeZonePickerContentProps) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeOptionId, setActiveOptionId] = useState(value)
  const [mountedAt] = useState(Date.now)
  const atTime = referenceDate?.getTime() ?? mountedAt
  const options = useMemo(
    () => buildOptions(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  )
  const rows = useMemo<TimeZoneListRow[]>(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.resolvedLanguage)
    const matches = needle
      ? options.filter((option) =>
          option.searchValue
            .toLocaleLowerCase(i18n.resolvedLanguage)
            .includes(needle),
        )
      : options
    return Object.entries(
      Object.groupBy(matches, (option) => option.region),
    ).flatMap(([region, entries]) => [
      { type: 'heading', key: `heading:${region}`, label: region } as const,
      ...(entries ?? []).map(
        (option) =>
          ({
            type: 'option',
            key: option.id,
            option,
          }) as const,
      ),
    ])
  }, [i18n.resolvedLanguage, options, search])
  const currentIndex = rows.findIndex(
    (row) => row.type === 'option' && row.option.id === value,
  )
  const optionRowIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'option' ? [index] : [])),
    [rows],
  )
  const activeRowIndex = rows.findIndex(
    (row) => row.type === 'option' && row.option.id === activeOptionId,
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.type === 'heading' ? 32 : 56),
    overscan: 6,
  })
  const virtualRows = virtualizer.getVirtualItems()
  // A newly opened popover and JSDOM both start with an unmeasured viewport.
  // Seed the DOM around the selected option so opening stays useful while the
  // virtualizer obtains its real dimensions.
  const fallbackStart = Math.max(0, (currentIndex < 0 ? 0 : currentIndex) - 4)
  const visibleRows =
    virtualRows.length > 0
      ? virtualRows
      : Array.from(
          { length: Math.min(10, Math.max(0, rows.length - fallbackStart)) },
          (_, offset) => {
            const index = fallbackStart + offset
            return {
              index,
              key: rows[index]?.key ?? index,
              start:
                virtualizer.getOffsetForIndex(index, 'start')?.[0] ??
                index * 56,
            }
          },
        )

  React.useEffect(() => {
    if (search || currentIndex < 0) return
    virtualizer.scrollToIndex(currentIndex, { align: 'center' })
  }, [currentIndex, search, virtualizer])

  React.useEffect(() => {
    if (
      rows.some(
        (row) => row.type === 'option' && row.option.id === activeOptionId,
      )
    ) {
      return
    }
    const selected = rows.find(
      (row) => row.type === 'option' && row.option.id === value,
    )
    const first = rows.find((row) => row.type === 'option')
    setActiveOptionId(
      selected?.type === 'option'
        ? selected.option.id
        : first?.type === 'option'
          ? first.option.id
          : '',
    )
  }, [activeOptionId, rows, value])

  const setActiveRow = (rowIndex: number) => {
    const row = rows[rowIndex]
    if (row?.type !== 'option') return
    setActiveOptionId(row.option.id)
    virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
  }
  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (optionRowIndices.length === 0) return
    const position = optionRowIndices.indexOf(activeRowIndex)
    const nextPosition =
      event.key === 'ArrowDown'
        ? Math.min(optionRowIndices.length - 1, Math.max(0, position + 1))
        : event.key === 'ArrowUp'
          ? Math.max(0, position < 0 ? 0 : position - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? optionRowIndices.length - 1
              : null
    if (nextPosition != null) {
      event.preventDefault()
      event.stopPropagation()
      setActiveRow(optionRowIndices[nextPosition]!)
      return
    }
    if (event.key === 'Enter' && activeRowIndex >= 0) {
      const row = rows[activeRowIndex]
      if (row?.type === 'option') {
        event.preventDefault()
        event.stopPropagation()
        onChange(row.option.id)
      }
    }
  }

  return (
    <Command className={className} shouldFilter={false}>
      <CommandInput
        placeholder={t('TimeZoneSelector.search' as never, {
          defaultValue: 'Search timezones or cities',
        })}
        className="text-base"
        value={search}
        aria-activedescendant={
          activeRowIndex >= 0 ? `timezone-option-${activeRowIndex}` : undefined
        }
        onKeyDownCapture={handleInputKeyDown}
        onValueChange={(next) => {
          setSearch(next)
          setActiveOptionId('')
        }}
      />
      <CommandList
        ref={listRef}
        className={cn(
          'relative max-h-[min(60vh,420px)] overscroll-contain',
          listClassName,
        )}
      >
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm">
            {t('TimeZoneSelector.noTimeZone' as never, {
              defaultValue: 'No timezone found.',
            })}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {visibleRows.map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              if (row.type === 'heading') {
                return (
                  <div
                    key={row.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute inset-x-0 top-0 px-3 py-1.5 text-xs font-medium text-muted-foreground"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {row.label}
                  </div>
                )
              }
              const { option } = row
              const isCurrent = option.id === value
              const offset = offsetFor(option.id, new Date(atTime))
              return (
                <CommandItem
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  id={`timezone-option-${virtualRow.index}`}
                  value={option.id}
                  aria-selected={option.id === activeOptionId}
                  data-active={
                    option.id === activeOptionId ? 'true' : undefined
                  }
                  data-current-timezone={isCurrent ? 'true' : undefined}
                  onMouseMove={() => setActiveOptionId(option.id)}
                  onSelect={() => onChange(option.id)}
                  className="absolute inset-x-1 top-0 gap-3 py-2 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {option.city}{' '}
                      <span className="text-muted-foreground">({offset})</span>
                    </span>
                    {option.id !== option.city && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.id}
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      'size-4 shrink-0 text-primary',
                      isCurrent ? '' : 'invisible',
                    )}
                    aria-hidden="true"
                  />
                </CommandItem>
              )
            })}
          </div>
        )}
      </CommandList>
    </Command>
  )
}

export const TimeZoneField = forwardRef<HTMLButtonElement, Props>(
  (
    {
      id = 'time-zone',
      value,
      disabled = false,
      name,
      onBlur,
      onChange,
      className,
      referenceDate,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false)
    const isDesktop = useMediaQuery('(min-width: 768px)')
    const { t, i18n } = useTranslation()
    const [mountedAt] = useState(Date.now)
    const atTime = referenceDate?.getTime() ?? mountedAt
    const options = useMemo(
      () => buildOptions(i18n.resolvedLanguage ?? i18n.language),
      [i18n.language, i18n.resolvedLanguage],
    )
    const selected =
      options.find((option) => option.id === value) ??
      options.find((option) => option.id === 'UTC')!
    const selectedOffset = offsetFor(selected.id, new Date(atTime))

    const select = (timeZone: string) => {
      onChange(timeZone)
      setOpen(false)
    }

    const picker = (
      <TimeZonePickerContent
        value={value}
        referenceDate={referenceDate}
        onChange={select}
      />
    )

    const trigger = (
      <Button
        id={id}
        ref={ref}
        name={name}
        type="button"
        variant="outline"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onBlur={onBlur}
        className={cn(
          'h-10 w-full min-w-0 justify-between overflow-hidden px-3 text-start font-normal',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected.city}{' '}
          <span className="text-muted-foreground">({selectedOffset})</span>
        </span>
        <ChevronDown className="ms-2 size-4 shrink-0 opacity-50" />
      </Button>
    )

    if (isDesktop) {
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={trigger} />
          <PopoverContent
            align="start"
            collisionPadding={12}
            collisionAvoidance={{ side: 'flip', align: 'shift' }}
            className="max-h-(--available-height) w-[min(24rem,calc(100vw-2rem))] overflow-hidden p-0"
          >
            {picker}
          </PopoverContent>
        </Popover>
      )
    }

    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger render={trigger} />
        <DrawerContent className="p-0">
          <DrawerHeader className="pb-2 text-start">
            <DrawerTitle>
              {t('TimeZoneSelector.title' as never, {
                defaultValue: 'Choose timezone',
              })}
            </DrawerTitle>
          </DrawerHeader>
          {picker}
        </DrawerContent>
      </Drawer>
    )
  },
)
TimeZoneField.displayName = 'TimeZoneField'

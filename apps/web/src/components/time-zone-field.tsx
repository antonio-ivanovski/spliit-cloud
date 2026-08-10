/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- the responsive picker exposes combobox semantics through the popover/drawer trigger. */
import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
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
  offset: string
  searchValue: string
}

function humanize(value: string) {
  return value.replaceAll('_', ' ')
}

function offsetFor(timeZone: string) {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date())
    .find((candidate) => candidate.type === 'timeZoneName')?.value
  return part === 'GMT' ? 'GMT+00:00' : (part ?? 'GMT+00:00')
}

function buildOptions(locale: string): TimeZoneOption[] {
  const collator = new Intl.Collator(resolveFormattingLocale(locale), {
    sensitivity: 'base',
  })
  return getSupportedTimeZones()
    .map((id) => {
      const parts = id.split('/')
      const city = id === 'UTC' ? 'UTC' : humanize(parts.at(-1) ?? id)
      const region = id === 'UTC' ? 'UTC' : humanize(parts[0] ?? 'Other')
      const offset = offsetFor(id)
      return {
        id,
        city,
        region,
        offset,
        searchValue: `${city} ${region} ${id} ${offset}`,
      }
    })
    .toSorted(
      (a, b) =>
        collator.compare(a.region, b.region) ||
        collator.compare(a.city, b.city),
    )
}

type Props = {
  id?: string
  value: string
  disabled?: boolean
  name?: string
  onBlur?: () => void
  onChange: (value: string) => void
}

export const TimeZoneField = forwardRef<HTMLButtonElement, Props>(
  (
    { id = 'time-zone', value, disabled = false, name, onBlur, onChange },
    ref,
  ) => {
    const [open, setOpen] = useState(false)
    const isDesktop = useMediaQuery('(min-width: 768px)')
    const { t, i18n } = useTranslation()
    const options = useMemo(
      () => buildOptions(i18n.resolvedLanguage ?? i18n.language),
      [i18n.language, i18n.resolvedLanguage],
    )
    const selected =
      options.find((option) => option.id === value) ??
      options.find((option) => option.id === 'UTC')!

    const select = (timeZone: string) => {
      onChange(timeZone)
      setOpen(false)
    }
    const picker = (
      <Command>
        <CommandInput
          placeholder={t('TimeZoneSelector.search' as never, {
            defaultValue: 'Search timezones or cities',
          })}
          className="text-base"
        />
        <CommandEmpty>
          {t('TimeZoneSelector.noTimeZone' as never, {
            defaultValue: 'No timezone found.',
          })}
        </CommandEmpty>
        <CommandList className="max-h-[min(60vh,420px)] overscroll-contain">
          {Object.entries(
            Object.groupBy(options, (option) => option.region),
          ).map(([region, entries]) => (
            <CommandGroup key={region} heading={region}>
              {entries?.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.searchValue}
                  onSelect={() => select(option.id)}
                  className="gap-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {option.city}{' '}
                      <span className="text-muted-foreground">
                        ({option.offset})
                      </span>
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
                      option.id === value ? '' : 'invisible',
                    )}
                    aria-hidden="true"
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
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
        className="h-auto min-h-10 w-full min-w-0 justify-between overflow-hidden px-3 py-2 text-start font-normal"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {selected.city}{' '}
            <span className="text-muted-foreground">({selected.offset})</span>
          </span>
          {selected.id !== selected.city && (
            <span className="block truncate text-xs text-muted-foreground">
              {selected.id}
            </span>
          )}
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
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
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

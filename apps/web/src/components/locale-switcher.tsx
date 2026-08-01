import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccountPreferenceUpdater } from '@/components/account-preferences-sync'
import {
  getLocalizedLocaleLabels,
  localeFlags,
  localeRegionOrder,
  localeRegions,
  popularLocales,
} from '@/components/locale-switcher-data'
import { Button, type ButtonProps } from '@/components/ui/button'
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
import { useLocale } from '@/i18n/react'
import type { Locale } from '@/i18n/request'
import { localeLabels, locales } from '@/i18n/request'
import { detectBrowserLocale, setUserLocale } from '@/i18n/setup'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const updater = useAccountPreferenceUpdater()
  const selectLocale = (nextLocale: Locale) => {
    if (updater) {
      void setUserLocale(nextLocale, { persist: false, notify: false })
      void updater.patchPreferences({ locale: nextLocale })
    } else {
      void setUserLocale(nextLocale)
    }
  }
  return (
    <LocaleSelector
      value={locale}
      onValueChange={selectLocale}
      showLabelOnDesktop
      disabled={updater !== null && !updater.ready}
    />
  )
}

export function LocaleSelector({
  value,
  onValueChange,
  showLabel = false,
  showLabelOnDesktop = false,
  field = false,
  className,
  variant,
  disabled = false,
  id,
}: {
  value: Locale
  onValueChange: (locale: Locale) => void
  showLabel?: boolean
  showLabelOnDesktop?: boolean
  field?: boolean
  className?: string
  variant?: ButtonProps['variant']
  disabled?: boolean
  /** Native id forwarded to the trigger button for label association. */
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { t } = useTranslation(undefined, { keyPrefix: 'LanguageSwitcher' })
  const selectLocale = (nextLocale: Locale) => {
    setOpen(false)
    onValueChange(nextLocale)
  }
  const picker = <LocaleCommand locale={value} onValueChange={selectLocale} />
  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <LocaleButton
            locale={value}
            showLabel={field || showLabel || showLabelOnDesktop}
            field={field}
            open={open}
            className={className}
            variant={variant}
            disabled={disabled}
            id={id}
          />
        </PopoverTrigger>
        <PopoverContent
          align={field ? 'start' : 'end'}
          className={cn(
            'p-0',
            field ? 'w-[min(20rem,calc(100vw-2rem))]' : 'w-80',
          )}
        >
          {picker}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={
          <LocaleButton
            locale={value}
            showLabel={field || showLabel}
            field={field}
            open={open}
            className={className}
            variant={variant}
            disabled={disabled}
            id={id}
          />
        }
      />
      <DrawerContent className="p-0">
        <DrawerHeader className="pb-2 text-start">
          <DrawerTitle>{t('title')}</DrawerTitle>
        </DrawerHeader>
        {picker}
      </DrawerContent>
    </Drawer>
  )
}

function LocaleCommand({
  locale,
  onValueChange,
}: {
  locale: Locale
  onValueChange: (locale: Locale) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'LanguageSwitcher' })
  const localizedLabels = useMemo(
    () => getLocalizedLocaleLabels(locale),
    [locale],
  )
  const groups = useMemo(() => {
    const assigned = new Set<Locale>()
    const takeUnassigned = (options: ReadonlyArray<Locale>) =>
      options.filter((option) => {
        if (assigned.has(option)) return false
        assigned.add(option)
        return true
      })

    const suggested = takeUnassigned(
      [locale, detectBrowserLocale()].filter(
        (option): option is Locale => option !== undefined,
      ),
    )
    const popular = takeUnassigned(popularLocales)
    const collator = new Intl.Collator(locale, { sensitivity: 'base' })
    const regions = localeRegionOrder.map((region) => ({
      id: region,
      locales: takeUnassigned(
        locales
          .filter((option) => localeRegions[option] === region)
          .toSorted((a, b) =>
            collator.compare(localizedLabels[a], localizedLabels[b]),
          ),
      ),
    }))

    return { suggested, popular, regions }
  }, [locale, localizedLabels])

  const renderItems = (options: ReadonlyArray<Locale>) =>
    options.map((option) => {
      const nativeLabel = localeLabels[option]
      const localizedLabel = localizedLabels[option]
      const showLocalizedLabel =
        nativeLabel.localeCompare(localizedLabel, locale, {
          sensitivity: 'base',
        }) !== 0

      return (
        <CommandItem
          key={option}
          value={`${option} ${nativeLabel} ${localizedLabel}`}
          aria-current={option === locale ? 'true' : undefined}
          className="gap-3 py-2"
          onSelect={() => onValueChange(option)}
        >
          <LocaleFlag locale={option} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{nativeLabel}</span>
            {showLocalizedLabel && (
              <span className="block truncate text-xs text-muted-foreground">
                {localizedLabel}
              </span>
            )}
          </span>
          {option === locale && (
            <Check
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          )}
        </CommandItem>
      )
    })

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noLanguage')}</CommandEmpty>
      <CommandList className="max-h-[min(60vh,420px)] overscroll-contain">
        <CommandGroup heading={t('suggested')}>
          {renderItems(groups.suggested)}
        </CommandGroup>
        {groups.popular.length > 0 && (
          <CommandGroup heading={t('popular')}>
            {renderItems(groups.popular)}
          </CommandGroup>
        )}
        {groups.regions.map(
          (group) =>
            group.locales.length > 0 && (
              <CommandGroup key={group.id} heading={t(group.id)}>
                {renderItems(group.locales)}
              </CommandGroup>
            ),
        )}
      </CommandList>
    </Command>
  )
}

type LocaleButtonProps = {
  locale: Locale
  showLabel?: boolean
  field?: boolean
  open?: boolean
}

const LocaleButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & LocaleButtonProps
>(
  (
    {
      locale,
      showLabel = false,
      field = false,
      open = false,
      className,
      variant,
      ...props
    },
    ref,
  ) => {
    const label = localeLabels[locale]

    return (
      <Button
        ref={ref}
        type="button"
        variant={variant ?? (field ? 'outline' : 'ghost')}
        size={field ? 'default' : showLabel ? 'sm' : 'icon'}
        className={cn(
          field
            ? 'h-10 w-full min-w-0 justify-between px-3 py-2 text-start font-normal text-foreground'
            : showLabel
              ? '-my-3 gap-2 text-primary'
              : 'size-10 text-primary',
          className,
        )}
        role={field ? 'combobox' : undefined}
        aria-haspopup={field ? 'listbox' : undefined}
        aria-expanded={field ? open : undefined}
        aria-label={label}
        title={label}
        {...props}
      >
        {field ? (
          <>
            <span className="flex min-w-0 items-center gap-3">
              <LocaleFlag locale={locale} />
              <span className="truncate">{label}</span>
            </span>
            <ChevronDown
              className="ms-2 size-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <LocaleFlag locale={locale} />
            {showLabel && <span>{label}</span>}
          </>
        )}
      </Button>
    )
  },
)
LocaleButton.displayName = 'LocaleButton'

function LocaleFlag({ locale }: { locale: Locale }) {
  return (
    <span className="text-lg leading-none" aria-hidden="true">
      {localeFlags[locale]}
    </span>
  )
}

import { Check } from 'lucide-react'
import { forwardRef, useState } from 'react'

import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLocale } from '@/i18n/react'
import type { Locale } from '@/i18n/request'
import { localeLabels, locales } from '@/i18n/request'
import { setUserLocale } from '@/i18n/setup'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export const localeFlags = {
  'ar-SA': '🇸🇦',
  'bn-BD': '🇧🇩',
  'hi-IN': '🇮🇳',
  id: '🇮🇩',
  ca: '🇦🇩',
  'cs-CZ': '🇨🇿',
  'de-DE': '🇩🇪',
  'en-US': '🇺🇸',
  es: '🇪🇸',
  eu: '🇪🇸',
  'fr-FR': '🇫🇷',
  'it-IT': '🇮🇹',
  'nl-NL': '🇳🇱',
  'pl-PL': '🇵🇱',
  pt: '🇵🇹',
  'pt-BR': '🇧🇷',
  ro: '🇷🇴',
  fi: '🇫🇮',
  'sv-SE': '🇸🇪',
  'tr-TR': '🇹🇷',
  'ru-RU': '🇷🇺',
  'uk-UA': '🇺🇦',
  he: '🇮🇱',
  ko: '🇰🇷',
  'mk-MK': '🇲🇰',
  'ja-JP': '🇯🇵',
  'ur-PK': '🇵🇰',
  vi: '🇻🇳',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
} satisfies Record<Locale, string>

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selectLocale = (nextLocale: Locale) => {
    setOpen(false)
    void setUserLocale(nextLocale)
  }

  if (isDesktop) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <LocaleButton locale={locale} showLabel />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {locales.map((option) => (
            <DropdownMenuItem
              key={option}
              aria-current={option === locale ? 'true' : undefined}
              className="gap-3"
              onSelect={() => selectLocale(option)}
            >
              <LocaleFlag locale={option} />
              <span className="flex-1">{localeLabels[option]}</span>
              {option === locale && (
                <Check className="size-4 text-primary" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <LocaleButton locale={locale} />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="pb-2 text-start">
          <DrawerTitle>{localeLabels[locale]}</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto overscroll-contain px-3 pb-4">
          <div className="grid gap-1">
            {locales.map((option) => (
              <button
                key={option}
                type="button"
                aria-current={option === locale ? 'true' : undefined}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-start text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden aria-[current=true]:bg-primary/10 aria-[current=true]:text-primary"
                onClick={() => selectLocale(option)}
              >
                <LocaleFlag locale={option} />
                <span className="flex-1">{localeLabels[option]}</span>
                {option === locale && (
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

type LocaleButtonProps = {
  locale: Locale
  showLabel?: boolean
}

const LocaleButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & LocaleButtonProps
>(({ locale, showLabel = false, className, ...props }, ref) => {
  const label = localeLabels[locale]

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size={showLabel ? 'sm' : 'icon'}
      className={cn(
        showLabel ? '-my-3 gap-2 text-primary' : 'size-10 text-primary',
        className,
      )}
      aria-label={label}
      title={label}
      {...props}
    >
      <LocaleFlag locale={locale} />
      {showLabel && <span>{label}</span>}
    </Button>
  )
})
LocaleButton.displayName = 'LocaleButton'

function LocaleFlag({ locale }: { locale: Locale }) {
  return (
    <span className="text-lg leading-none" aria-hidden="true">
      {localeFlags[locale]}
    </span>
  )
}

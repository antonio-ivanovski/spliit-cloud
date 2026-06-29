import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setUserLocale, useLocale } from '@/i18n/react'
import { Locale, localeLabels } from '@/i18n/request'

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-my-3 text-primary">
          <span>{localeLabels[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {Object.entries(localeLabels).map(([locale, label]) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => setUserLocale(locale as Locale)}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

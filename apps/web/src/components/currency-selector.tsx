import { ChevronDown, Loader2 } from 'lucide-react'

import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { type DisplayCurrency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Static fallback for non-expense selectors and failed recommendation queries. */
const STATIC_COMMON_CURRENCY_CODES = [
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'CNY',
] as const

type Props = {
  currencies: DisplayCurrency[]
  onValueChange: (currencyCode: DisplayCurrency['code']) => void
  /** Currency code to be selected by default. Overwriting this value will update current selection, too. */
  defaultValue: DisplayCurrency['code']
  isLoading: boolean
  disabled?: boolean
  /**
   * When set, rendered first in the pinned section and excluded from
   * the rest of the catalog.
   */
  pinnedCurrencyCode?: string
  /**
   * Group-specific recommendations in server rank order. When provided
   * (including an empty array), replaces the static USD/EUR/JPY/GBP/CNY
   * common list. Omit / leave undefined to keep the static fallback.
   */
  recommendedCurrencyCodes?: string[]
}

export function CurrencySelector({
  currencies,
  onValueChange,
  defaultValue,
  isLoading,
  disabled = false,
  pinnedCurrencyCode,
  recommendedCurrencyCodes,
}: Props) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selectedCurrency =
    currencies.find((currency) => (currency.code ?? '') === defaultValue) ??
    currencies[0]

  const command = (
    <CurrencyCommand
      currencies={currencies}
      pinnedCurrencyCode={pinnedCurrencyCode}
      recommendedCurrencyCodes={recommendedCurrencyCodes}
      onValueChange={(code) => {
        onValueChange(code)
        setOpen(false)
      }}
    />
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <CurrencyButton
            currency={selectedCurrency}
            open={open}
            isLoading={isLoading}
            disabled={disabled}
          />
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          {command}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <CurrencyButton
          currency={selectedCurrency}
          open={open}
          isLoading={isLoading}
          disabled={disabled}
        />
      </DrawerTrigger>
      <DrawerContent className="p-0">{command}</DrawerContent>
    </Drawer>
  )
}

function CurrencyCommand({
  currencies,
  onValueChange,
  pinnedCurrencyCode,
  recommendedCurrencyCodes,
}: {
  currencies: DisplayCurrency[]
  onValueChange: (currencyId: DisplayCurrency['code']) => void
  pinnedCurrencyCode?: string
  recommendedCurrencyCodes?: string[]
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Currencies' })

  const { priority, rest } = useMemo(() => {
    const byCode = new Map(
      currencies.map((currency) => [currency.code, currency]),
    )
    const assigned = new Set<string>()
    const priority: DisplayCurrency[] = []
    const rest: DisplayCurrency[] = []

    const pin =
      pinnedCurrencyCode && pinnedCurrencyCode.length > 0
        ? pinnedCurrencyCode
        : undefined
    if (pin) {
      const pinned = byCode.get(pin)
      if (pinned) {
        priority.push(pinned)
        assigned.add(pin)
      }
    }

    // Prefer server ranking when provided; otherwise static common list.
    const commonCodes =
      recommendedCurrencyCodes !== undefined
        ? recommendedCurrencyCodes
        : STATIC_COMMON_CURRENCY_CODES

    for (const code of commonCodes) {
      if (!code || assigned.has(code)) continue
      const currency = byCode.get(code)
      if (!currency) continue
      priority.push(currency)
      assigned.add(code)
    }

    for (const currency of currencies) {
      if (assigned.has(currency.code)) continue
      rest.push(currency)
    }

    return { priority, rest }
  }, [currencies, pinnedCurrencyCode, recommendedCurrencyCodes])

  const renderItems = (items: DisplayCurrency[]) =>
    items.map((currency) => (
      <CommandItem
        key={currency.code || currency.symbol || currency.name}
        value={`${currency.code} ${currency.name} ${currency.symbol}`}
        onSelect={() => onValueChange(currency.code)}
      >
        <CurrencyLabel currency={currency} />
      </CommandItem>
    ))

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noCurrency')}</CommandEmpty>
      <div className="w-full max-h-[300px] overflow-y-auto">
        {priority.length > 0 && (
          <CommandGroup>{renderItems(priority)}</CommandGroup>
        )}
        {priority.length > 0 && rest.length > 0 && <CommandSeparator />}
        {rest.length > 0 && <CommandGroup>{renderItems(rest)}</CommandGroup>}
      </div>
    </Command>
  )
}

type CurrencyButtonProps = {
  currency: DisplayCurrency
  open: boolean
  isLoading: boolean
  disabled?: boolean
}
const CurrencyButton = forwardRef<HTMLButtonElement, CurrencyButtonProps>(
  (
    { currency, open, isLoading, ...props }: ButtonProps & CurrencyButtonProps,
    ref,
  ) => {
    const iconClassName = 'ml-2 h-4 w-4 shrink-0 opacity-50'
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="flex w-full"
        ref={ref}
        {...props}
      >
        <div className="flex-1 text-left">
          <CurrencyLabel currency={currency} />
        </div>
        {isLoading ? (
          <Loader2 className={`animate-spin ${iconClassName}`} />
        ) : (
          <ChevronDown className={iconClassName} />
        )}
      </Button>
    )
  },
)
CurrencyButton.displayName = 'CurrencyButton'

export function CurrencyLabel({ currency }: { currency: DisplayCurrency }) {
  const flagUrl = `https://flagcdn.com/h24/${
    currency?.code.length ? currency.code.slice(0, 2).toLowerCase() : 'un'
  }.png`
  return (
    <span className="flex items-center gap-3">
      <img src={flagUrl} className="w-4" alt="" />
      <span>
        {currency.name}
        {currency.code ? ` (${currency.code})` : ''}
      </span>
      {currency.symbol && currency.symbol !== currency.code ? (
        <span className="font-medium text-foreground">{currency.symbol}</span>
      ) : null}
    </span>
  )
}

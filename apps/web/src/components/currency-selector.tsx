import { ChevronDown, Loader2 } from 'lucide-react'

import { Button, ButtonProps } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { type DisplayCurrency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  currencies: DisplayCurrency[]
  onValueChange: (currencyCode: DisplayCurrency['code']) => void
  /** Currency code to be selected by default. Overwriting this value will update current selection, too. */
  defaultValue: DisplayCurrency['code']
  isLoading: boolean
  disabled?: boolean
}

export function CurrencySelector({
  currencies,
  onValueChange,
  defaultValue,
  isLoading,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<string>(defaultValue)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // allow overwriting currently selected currency from outside
  useEffect(() => {
    setValue(defaultValue)
    onValueChange(defaultValue)
  }, [defaultValue])

  const selectedCurrency =
    currencies.find((currency) => (currency.code ?? '') === value) ??
    currencies[0]

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
          <CurrencyCommand
            currencies={currencies}
            onValueChange={(code) => {
              setValue(code)
              onValueChange(code)
              setOpen(false)
            }}
          />
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
      <DrawerContent className="p-0">
        <CurrencyCommand
          currencies={currencies}
          onValueChange={(id) => {
            setValue(id)
            onValueChange(id)
            setOpen(false)
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}

type CurrencyGrouping = 'common' | 'custom' | 'other'

// Fixed display order: most-common codes first, custom second, everything
// else last. Defining this as a tuple (not an object) keeps the iteration
// order stable regardless of the input list's insertion order.
const CURRENCY_GROUPING_ORDER = ['common', 'custom', 'other'] as const

const CURRENCY_GROUPING_HEADINGS = {
  common: 'common.heading',
  custom: 'custom.heading',
  other: 'other.heading',
} as const satisfies Record<CurrencyGrouping, string>

function CurrencyCommand({
  currencies,
  onValueChange,
}: {
  currencies: DisplayCurrency[]
  onValueChange: (currencyId: DisplayCurrency['code']) => void
}) {
  const currencyGroup = (currency: DisplayCurrency): CurrencyGrouping => {
    switch (currency.code) {
      case 'USD':
      case 'EUR':
      case 'JPY':
      case 'GBP':
      case 'CNY':
        return 'common'
      default:
        if (currency.code === '') return 'custom'
        return 'other'
    }
  }
  const { t } = useTranslation(undefined, { keyPrefix: 'Currencies' })
  const currenciesByGroup = currencies.reduce<
    Record<CurrencyGrouping, DisplayCurrency[]>
  >(
    (acc, currency) => {
      const group = currencyGroup(currency)
      acc[group].push(currency)
      return acc
    },
    { common: [], custom: [], other: [] },
  )

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noCurrency')}</CommandEmpty>
      <div className="w-full max-h-[300px] overflow-y-auto">
        {CURRENCY_GROUPING_ORDER.map((group) => {
          const groupCurrencies = currenciesByGroup[group]
          if (groupCurrencies.length === 0) return null
          return (
            <CommandGroup
              key={group}
              heading={t(CURRENCY_GROUPING_HEADINGS[group])}
            >
              {groupCurrencies.map((currency) => (
                <CommandItem
                  key={currency.code || currency.symbol || currency.name}
                  value={`${currency.code} ${currency.name} ${currency.symbol}`}
                  onSelect={() => onValueChange(currency.code)}
                >
                  <CurrencyLabel currency={currency} />
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
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
        className="flex w-full justify-between"
        ref={ref}
        {...props}
      >
        <CurrencyLabel currency={currency} />
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

function CurrencyLabel({ currency }: { currency: DisplayCurrency }) {
  const flagUrl = `https://flagcdn.com/h24/${
    currency?.code.length ? currency.code.slice(0, 2).toLowerCase() : 'un'
  }.png`
  return (
    <div className="flex items-center gap-3">
      <img src={flagUrl} className="w-4" alt="" />
      {currency.name}
      {currency.code ? ` (${currency.code})` : ''}
    </div>
  )
}

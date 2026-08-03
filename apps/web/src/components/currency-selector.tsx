/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- popover triggers expose combobox semantics; popup IDs are managed by the UI primitive. */
import { Check, ChevronDown, ChevronsUpDown, Loader2 } from 'lucide-react'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { type DisplayCurrency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'

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
  /**
   * Currency code to be selected by default. Overwriting this value will update
   * current selection, too.
   */
  defaultValue: DisplayCurrency['code']
  isLoading: boolean
  disabled?: boolean
  /**
   * When set, rendered first in the pinned section and excluded from the rest
   * of the catalog.
   */
  pinnedCurrencyCode?: string
  /**
   * Group-specific recommendations in server rank order. When provided
   * (including an empty array), replaces the static USD/EUR/JPY/GBP/CNY common
   * list. Omit / leave undefined to keep the static fallback.
   */
  recommendedCurrencyCodes?: string[]
  /** Render a compact trigger for embedding beside an amount input. */
  compact?: boolean
  /** Multi-select mode for filter panels. Defaults to 'single'. */
  mode?: 'single' | 'multi'
  /** Currency codes currently selected (multi mode only). */
  selectedValues?: string[]
  /** Toggle a currency code in multi mode. */
  onValueToggle?: (currencyCode: string) => void
  /** Trigger text when nothing selected in multi mode. */
  multiPlaceholder?: string
  /** Title and action label shown by the mobile multi-select drawer. */
  mobileTitle?: string
  mobileDoneLabel?: string
  /** Native id forwarded to the trigger button for label association. */
  id?: string
  'aria-label'?: string
}

export function CurrencySelector({
  currencies,
  onValueChange,
  defaultValue,
  isLoading,
  disabled = false,
  pinnedCurrencyCode,
  recommendedCurrencyCodes,
  compact = false,
  mode = 'single',
  selectedValues = [],
  onValueToggle,
  multiPlaceholder,
  mobileTitle,
  mobileDoneLabel,
  id,
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { t } = useTranslation()
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

  if (mode === 'multi') {
    const command = (
      <CurrencyCommand
        currencies={currencies}
        pinnedCurrencyCode={pinnedCurrencyCode}
        recommendedCurrencyCodes={recommendedCurrencyCodes}
        mode="multi"
        selectedValues={selectedValues}
        onValueChange={() => {
          /* multi mode uses onValueToggle; no-op to satisfy the type */
        }}
        onValueToggle={(code) => {
          onValueToggle?.(code)
        }}
      />
    )

    if (!isDesktop) {
      return (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger
            render={
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel}
                id={id}
                disabled={disabled}
                className="h-9 justify-between px-3 text-sm font-normal"
              >
                <span className="truncate">
                  {selectedValues.length > 0
                    ? t('Expenses.filters.nSelected', {
                        count: selectedValues.length,
                      })
                    : (multiPlaceholder ?? 'Select')}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            }
          />
          <DrawerContent className="p-0">
            <DrawerHeader className="pb-2 text-start">
              <DrawerTitle>
                {mobileTitle ?? t('Expenses.filters.currency')}
              </DrawerTitle>
            </DrawerHeader>
            <div className="min-h-0 overflow-y-auto px-1">{command}</div>
            <DrawerFooter className="border-t bg-background pt-3">
              <Button type="button" onClick={() => setOpen(false)}>
                {mobileDoneLabel ?? t('Groups.Import.StepHeader.done')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={ariaLabel}
              id={id}
              disabled={disabled}
              className="h-9 justify-between px-3 text-sm font-normal"
            />
          }
        >
          <span className="truncate">
            {selectedValues.length > 0
              ? `${selectedValues.length} selected`
              : (multiPlaceholder ?? 'Select')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          {command}
        </PopoverContent>
      </Popover>
    )
  }

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <CurrencyButton
              currency={selectedCurrency}
              open={open}
              isLoading={isLoading}
              disabled={disabled}
              compact={compact}
              id={id}
              aria-label={ariaLabel}
            />
          }
        />
        <PopoverContent className="p-0" align="start">
          {command}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={
          <CurrencyButton
            currency={selectedCurrency}
            open={open}
            isLoading={isLoading}
            disabled={disabled}
            compact={compact}
            id={id}
            aria-label={ariaLabel}
          />
        }
      />
      <DrawerContent className="p-0">{command}</DrawerContent>
    </Drawer>
  )
}

function CurrencyCommand({
  currencies,
  onValueChange,
  pinnedCurrencyCode,
  recommendedCurrencyCodes,
  mode = 'single',
  selectedValues = [],
  onValueToggle,
}: {
  currencies: DisplayCurrency[]
  onValueChange: (currencyId: DisplayCurrency['code']) => void
  pinnedCurrencyCode?: string
  recommendedCurrencyCodes?: string[]
  mode?: 'single' | 'multi'
  selectedValues?: string[]
  onValueToggle?: (currencyCode: string) => void
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
      if (priority.length - (pin ? 1 : 0) >= 5) break
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
        onSelect={() => {
          if (mode === 'multi') {
            onValueToggle?.(currency.code)
          } else {
            onValueChange(currency.code)
          }
        }}
      >
        {mode === 'multi' && (
          <Check
            className={cn(
              'mr-2 h-4 w-4 shrink-0',
              selectedValues.includes(currency.code) ? '' : 'invisible',
            )}
          />
        )}
        <CurrencyLabel currency={currency} />
      </CommandItem>
    ))

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noCurrency')}</CommandEmpty>
      <div className="max-h-[300px] w-full overflow-y-auto">
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
  compact?: boolean
  /** Native id forwarded to the trigger button for label association. */
  id?: string
}
const CurrencyButton = forwardRef<HTMLButtonElement, CurrencyButtonProps>(
  (
    {
      currency,
      open,
      isLoading,
      compact = false,
      className,
      ...props
    }: ButtonProps & CurrencyButtonProps,
    ref,
  ) => {
    const iconClassName = 'ml-2 h-4 w-4 shrink-0 opacity-50'
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          compact
            ? `${currency.name}${currency.code ? ` (${currency.code})` : ''}`
            : undefined
        }
        className={cn(
          compact
            ? 'h-10 shrink-0 gap-1 rounded-none border-0 px-3'
            : 'flex w-full min-w-0 overflow-hidden',
          typeof className === 'string' ? className : undefined,
        )}
        ref={ref}
        {...props}
      >
        <span
          className={
            compact ? 'text-left' : 'min-w-0 flex-1 overflow-hidden text-left'
          }
        >
          <CurrencyLabel currency={currency} compact={compact} />
        </span>
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

function CurrencyLabel({
  currency,
  compact = false,
}: {
  currency: DisplayCurrency
  compact?: boolean
}) {
  const flagUrl = `https://flagcdn.com/h24/${
    currency?.code.length ? currency.code.slice(0, 2).toLowerCase() : 'un'
  }.png`
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={flagUrl} className="w-4 shrink-0" alt="" />
      <span className="truncate">
        {compact
          ? currency.code || currency.symbol || currency.name
          : `${currency.name}${currency.code ? ` (${currency.code})` : ''}`}
      </span>
    </div>
  )
}

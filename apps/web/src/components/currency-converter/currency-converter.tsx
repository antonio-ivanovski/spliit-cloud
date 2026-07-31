import { useNavigate } from '@tanstack/react-router'
import { ArrowDownUp, Loader2, Star } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CurrencySelector } from '@/components/currency-selector'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import { useLocale } from '@/i18n/react'
import { useCurrencies } from '@/lib/currency'
import { enforceCurrencyPattern } from '@/lib/currency-input'
import { useCurrencyRate } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import { amountAsMinorUnits, getCurrency, utcTodayIso } from '@spliit/domain'

import currencyExchangeSvg from './currency-exchange.svg'
import { rankGroupsForConverter, type ConverterGroup } from './rank-groups'

const FROM_KEY = 'spliit:converter:fromCurrency'
const TO_KEY = 'spliit:converter:toCurrency'

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  EU: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  MT: 'EUR',
  CY: 'EUR',
  HR: 'EUR',
  JP: 'JPY',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  KR: 'KRW',
  IN: 'INR',
  BR: 'BRL',
  MX: 'MXN',
  AR: 'ARS',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  TR: 'TRY',
  RU: 'RUB',
  ZA: 'ZAR',
  SG: 'SGD',
  TH: 'THB',
  MY: 'MYR',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  AE: 'AED',
  SA: 'SAR',
  IL: 'ILS',
  EG: 'EGP',
  NG: 'NGN',
  KE: 'KES',
  CO: 'COP',
  CL: 'CLP',
  PE: 'PEN',
  UA: 'UAH',
  PK: 'PKR',
  BD: 'BDT',
  LK: 'LKR',
  MM: 'MMK',
  KH: 'KHR',
  LA: 'LAK',
  NP: 'NPR',
  IS: 'ISK',
  RS: 'RSD',
  MK: 'MKD',
  AL: 'ALL',
  BA: 'BAM',
  MD: 'MDL',
  GE: 'GEL',
  AM: 'AMD',
  AZ: 'AZN',
  KZ: 'KZT',
  UZ: 'UZS',
  MA: 'MAD',
  TN: 'TND',
  DZ: 'DZD',
  GH: 'GHS',
  TZ: 'TZS',
  ET: 'ETB',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  JO: 'JOD',
  LB: 'LBP',
  IQ: 'IQD',
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable
  }
}

function getDeviceCurrency(availableCodes: Set<string>): string {
  try {
    const locale = navigator.language
    const region = new Intl.Locale(locale).maximize().region
    const code = region ? REGION_CURRENCY[region] : undefined
    if (code && availableCodes.has(code)) return code
  } catch {
    // fall through
  }
  return 'USD'
}

export function CurrencyConverterButton() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CurrencyConverter' })
  const [open, setOpen] = useState(false)

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={t('trigger')}
        >
          <img
            src={currencyExchangeSvg}
            alt=""
            className="mr-0 h-6 w-6 shrink-0 sm:mr-2 dark:invert"
          />
          <span className="hidden sm:inline">{t('trigger')}</span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-left">
            {t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="min-w-0">
          <ConverterContent />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function ConverterContent() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CurrencyConverter' })
  const locale = useLocale()
  const navigate = useNavigate()
  const currencies = useCurrencies('')

  const resolveInitialCode = useCallback(
    (key: string) => {
      const codes = new Set(currencies.map((c) => c.code))
      const stored = readStored(key)
      if (stored && codes.has(stored)) return stored
      return getDeviceCurrency(codes)
    },
    [currencies],
  )

  const [fromCode, setFromCode] = useState(() => resolveInitialCode(FROM_KEY))
  const [toCode, setToCode] = useState(() => resolveInitialCode(TO_KEY))
  const [amountStr, setAmountStr] = useState('')

  const { data: groupsData } = trpc.account.groups.useQuery(
    { includeArchived: false },
    { staleTime: 60_000 },
  )

  const today = useMemo(() => new Date(`${utcTodayIso()}T12:00:00.000Z`), [])

  const sameCurrency = fromCode === toCode
  const {
    data: rate,
    isLoading: rateLoading,
    error: rateError,
  } = useCurrencyRate(today, fromCode, toCode)

  const isStaleRate = rateError instanceof RangeError
  const rateFailed = rateError != null && !isStaleRate

  const parsedAmount = Number(enforceCurrencyPattern(amountStr))
  const amountValid =
    amountStr.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0

  const previewAmount = useMemo(() => {
    if (!amountValid) return null
    if (sameCurrency) return parsedAmount
    if (rate == null) return null
    return parsedAmount * rate
  }, [amountValid, sameCurrency, parsedAmount, rate])

  const previewReady =
    amountValid && (sameCurrency || (rate != null && !rateFailed))

  const rankedGroups = useMemo(() => {
    if (!groupsData?.groups || !fromCode) return []
    return rankGroupsForConverter(groupsData.groups, fromCode)
  }, [groupsData, fromCode])

  const handleFromChange = useCallback((code: string) => {
    setFromCode(code)
    writeStored(FROM_KEY, code)
  }, [])

  const handleToChange = useCallback((code: string) => {
    setToCode(code)
    writeStored(TO_KEY, code)
  }, [])

  const handleSwap = useCallback(() => {
    setFromCode(toCode)
    setToCode(fromCode)
    writeStored(FROM_KEY, toCode)
    writeStored(TO_KEY, fromCode)
  }, [fromCode, toCode])

  const handleGroupClick = (group: ConverterGroup) => {
    if (!amountValid || !fromCode) return
    const currency = getCurrency(fromCode)
    if (!currency) return
    const minor = amountAsMinorUnits(parsedAmount, currency)
    void navigate({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: group.id },
      search: {
        amount: String(minor),
        originalCurrency: fromCode,
      },
    })
  }

  const toCurrency = currencies.find((c) => c.code === toCode)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <label
          htmlFor="converter-from"
          className="text-xs font-medium text-muted-foreground"
        >
          {t('fromLabel')}
        </label>
        <div className="flex min-h-10 w-full min-w-0 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <div className="min-w-0 flex-1 basis-0">
            <input
              id="converter-from"
              type="text"
              inputMode="decimal"
              size={1}
              placeholder="0.00"
              value={amountStr}
              onChange={(e) =>
                setAmountStr(enforceCurrencyPattern(e.target.value))
              }
              className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-lg font-medium tabular-nums outline-none focus-visible:ring-0"
            />
          </div>
          <div className="shrink-0 border-l border-input">
            <CurrencySelector
              currencies={currencies}
              onValueChange={handleFromChange}
              defaultValue={fromCode}
              isLoading={false}
              compact
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={handleSwap}
          aria-label={t('swap')}
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <label
          htmlFor="converter-to"
          className="text-xs font-medium text-muted-foreground"
        >
          {t('toLabel')}
        </label>
        <div className="flex min-h-10 w-full min-w-0 overflow-hidden rounded-md border border-input bg-muted/40">
          <div
            id="converter-to"
            className="flex min-w-0 flex-1 basis-0 items-center truncate px-3 text-lg font-medium text-muted-foreground tabular-nums"
          >
            {previewAmount != null && toCurrency ? (
              new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: toCurrency.code || undefined,
                minimumFractionDigits: toCurrency.decimal_digits,
                maximumFractionDigits: toCurrency.decimal_digits,
              }).format(previewAmount)
            ) : rateLoading && amountValid && !sameCurrency ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              '—'
            )}
          </div>
          <div className="shrink-0 border-l border-input">
            <CurrencySelector
              currencies={currencies}
              onValueChange={handleToChange}
              defaultValue={toCode}
              isLoading={false}
              compact
            />
          </div>
        </div>
      </div>

      {rateFailed && amountValid && !sameCurrency && (
        <p className="text-sm text-destructive">{t('rateError')}</p>
      )}

      {isStaleRate && rate != null && !sameCurrency && (
        <p className="text-xs text-muted-foreground">
          {t('staleRate')} {rateError?.message}
        </p>
      )}

      {rate != null && !sameCurrency && previewReady && (
        <p className="text-xs text-muted-foreground">
          {t('rateInfo', {
            rate: rate.toFixed(4),
            from: fromCode,
            to: toCode,
          })}
          {' · '}
          {t('providerNote')}
        </p>
      )}

      {rankedGroups.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('createIn')}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {rankedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                disabled={!amountValid}
                onClick={() => handleGroupClick(group)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                {group.preference.starred && (
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                )}
                {group.displayName || group.name}
                {group.ledger.currencyCode && (
                  <span className="text-xs text-muted-foreground">
                    {group.ledger.currencyCode}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {groupsData && rankedGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('noGroups')}</p>
      )}
    </div>
  )
}

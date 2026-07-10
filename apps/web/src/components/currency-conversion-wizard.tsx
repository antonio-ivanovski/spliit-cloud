import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCurrencyRates } from '@/lib/hooks'
import {
  AlertTriangle,
  Calendar,
  Check,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type ConversionPair = {
  base: string
  target: string
  dates: string[]
}

export type ConversionPolicy =
  | { type: 'perDate' }
  | { type: 'fixedProvider'; date: string }
  | { type: 'fixedCustom'; rate: number | undefined }

export type CurrencyConversionWizardResult = {
  policies: Record<string, ConversionPolicy>
  rates: Record<string, number>
  ready: boolean
}

type Props = {
  pairs: ConversionPair[]
  initialPolicies?: Record<string, ConversionPolicy>
  onChange: (result: CurrencyConversionWizardResult) => void
}

const today = () => new Date().toISOString().slice(0, 10)
const keyFor = (pair: Pick<ConversionPair, 'base' | 'target'>) =>
  `${pair.base}|${pair.target}`
const rateKey = (date: string, base: string, target: string) =>
  `${date}|${base}|${target}`

function PolicyCard({
  id,
  icon: Icon,
  title,
  description,
  selected,
  value,
  children,
}: {
  id: string
  icon: typeof Calendar
  title: string
  description: string
  selected: boolean
  value: ConversionPolicy['type']
  children?: React.ReactNode
}) {
  return (
    <div
      className={`overflow-hidden rounded-md border bg-card transition-colors ${
        selected ? 'border-primary/60 bg-primary/[0.03]' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <label
          htmlFor={id}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left"
        >
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {description}
            </span>
          </span>
        </label>
        <RadioGroupItem id={id} value={value} className="mt-1" />
      </div>
      {selected && children ? (
        <div className="border-t border-dashed px-3 py-3">{children}</div>
      ) : null}
    </div>
  )
}

export function CurrencyConversionWizard({
  pairs,
  initialPolicies = {},
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [policies, setPolicies] = useState<Record<string, ConversionPolicy>>(
    () =>
      Object.fromEntries(
        pairs.map((pair) => [
          keyFor(pair),
          initialPolicies[keyFor(pair)] ?? { type: 'perDate' },
        ]),
      ),
  )

  const rateItems = useMemo(
    () =>
      pairs.flatMap((pair) => {
        const policy = policies[keyFor(pair)] ?? { type: 'perDate' as const }
        if (policy.type === 'fixedCustom') return []
        const dates =
          policy.type === 'fixedProvider' ? [policy.date] : pair.dates
        return dates.map((date) => ({
          date,
          base: pair.base,
          target: pair.target,
        }))
      }),
    [pairs, policies],
  )
  const ratesQuery = useCurrencyRates(rateItems, {
    enabled: rateItems.length > 0,
  })
  const rates = useMemo(() => {
    const result: Record<string, number> = {}
    ratesQuery.data?.forEach((entry, index) => {
      if (entry?.ok) {
        const item = rateItems[index]
        result[rateKey(item.date, item.base, item.target)] = entry.rate.rate
      }
    })
    return result
  }, [rateItems, ratesQuery.data])

  const ready = useMemo(
    () =>
      pairs.every((pair) => {
        const policy = policies[keyFor(pair)]
        if (!policy) return false
        if (policy.type === 'fixedCustom') {
          return (
            typeof policy.rate === 'number' &&
            Number.isFinite(policy.rate) &&
            policy.rate > 0
          )
        }
        const dates =
          policy.type === 'fixedProvider' ? [policy.date] : pair.dates
        return dates.every(
          (date) => rates[rateKey(date, pair.base, pair.target)] !== undefined,
        )
      }),
    [pairs, policies, rates],
  )

  const resolvedRates = useMemo(() => {
    const output: Record<string, number> = {}
    for (const pair of pairs) {
      const policy = policies[keyFor(pair)]
      const pairRate =
        policy?.type === 'fixedCustom'
          ? policy.rate
          : policy?.type === 'fixedProvider'
            ? rates[rateKey(policy.date, pair.base, pair.target)]
            : undefined
      for (const date of pair.dates) {
        const value =
          policy?.type === 'perDate'
            ? rates[rateKey(date, pair.base, pair.target)]
            : pairRate
        if (value !== undefined)
          output[rateKey(date, pair.base, pair.target)] = value
      }
    }
    return output
  }, [pairs, policies, rates])

  useEffect(() => {
    onChange({ policies, rates: resolvedRates, ready })
  }, [onChange, policies, ready, resolvedRates])

  if (pairs.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Check className="h-5 w-5 text-green-600" />
          <p className="text-sm">
            {t('Groups.Import.CurrencyConversion.noConversionNeeded')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {pairs.map((pair) => {
        const pairKey = keyFor(pair)
        const policy = policies[pairKey] ?? { type: 'perDate' as const }
        const fixedDate =
          policy.type === 'fixedProvider' ? policy.date : today()
        const fixedRate =
          policy.type === 'fixedProvider'
            ? rates[rateKey(fixedDate, pair.base, pair.target)]
            : undefined
        const pairHasError = pair.dates.some(
          (date) =>
            ratesQuery.data?.some(
              (entry, index) =>
                !entry.ok &&
                rateItems[index]?.date === date &&
                rateItems[index]?.base === pair.base,
            ) ?? false,
        )
        return (
          <Card key={pairKey}>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="font-mono text-sm font-medium">
                {pair.base} → {pair.target}
              </div>
              <RadioGroup
                value={policy.type}
                onValueChange={(value) =>
                  setPolicies((current) => ({
                    ...current,
                    [pairKey]:
                      value === 'perDate'
                        ? { type: 'perDate' }
                        : value === 'fixedProvider'
                          ? { type: 'fixedProvider', date: fixedDate }
                          : {
                              type: 'fixedCustom',
                              rate:
                                policy.type === 'fixedCustom'
                                  ? policy.rate
                                  : undefined,
                            },
                  }))
                }
              >
                <PolicyCard
                  id={`per-date-${pairKey}`}
                  icon={Calendar}
                  title={t('Groups.CurrencyConversion.perDateTitle')}
                  description={t(
                    'Groups.CurrencyConversion.perDateDescription',
                  )}
                  selected={policy.type === 'perDate'}
                  value="perDate"
                >
                  <p className="text-xs text-muted-foreground">
                    {ratesQuery.isFetching
                      ? t('Groups.CurrencyConversion.fetchingRates')
                      : pairHasError
                        ? t('Groups.CurrencyConversion.ratesError')
                        : t('Groups.CurrencyConversion.perDateSelectedHint')}
                  </p>
                </PolicyCard>
                <PolicyCard
                  id={`fixed-provider-${pairKey}`}
                  icon={Globe}
                  title={t('Groups.CurrencyConversion.fixedProviderTitle')}
                  description={t(
                    'Groups.CurrencyConversion.fixedProviderDescription',
                  )}
                  selected={policy.type === 'fixedProvider'}
                  value="fixedProvider"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Label htmlFor={`provider-date-${pairKey}`}>
                      {t('Groups.CurrencyConversion.rateDateLabel')}
                    </Label>
                    <Input
                      id={`provider-date-${pairKey}`}
                      type="date"
                      value={fixedDate}
                      onChange={(event) =>
                        setPolicies((current) => ({
                          ...current,
                          [pairKey]: {
                            type: 'fixedProvider',
                            date: event.target.value,
                          },
                        }))
                      }
                      className="h-8 max-w-[160px] font-mono text-xs"
                    />
                    {ratesQuery.isFetching ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {fixedRate !== undefined ? (
                      <span className="font-mono">
                        {fixedRate.toFixed(4)} {pair.target}
                      </span>
                    ) : null}
                  </div>
                </PolicyCard>
                <PolicyCard
                  id={`fixed-custom-${pairKey}`}
                  icon={Pencil}
                  title={t('Groups.CurrencyConversion.fixedCustomTitle')}
                  description={t(
                    'Groups.CurrencyConversion.fixedCustomDescription',
                  )}
                  selected={policy.type === 'fixedCustom'}
                  value="fixedCustom"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Label htmlFor={`custom-rate-${pairKey}`}>
                      {t('Groups.CurrencyConversion.customRateLabel')}
                    </Label>
                    <Input
                      id={`custom-rate-${pairKey}`}
                      type="number"
                      step="any"
                      value={
                        policy.type === 'fixedCustom' ? (policy.rate ?? '') : ''
                      }
                      onChange={(event) => {
                        const value = event.target.value
                        setPolicies((current) => ({
                          ...current,
                          [pairKey]: {
                            type: 'fixedCustom',
                            rate:
                              value === '' || !Number.isFinite(Number(value))
                                ? undefined
                                : Number(value),
                          },
                        }))
                      }}
                      className="h-8 max-w-[140px] font-mono text-xs"
                    />
                    <span className="font-mono text-muted-foreground">
                      {pair.target}
                    </span>
                  </div>
                </PolicyCard>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                {t('Groups.CurrencyConversion.affectedDates', {
                  count: pair.dates.length,
                })}
              </p>
            </CardContent>
          </Card>
        )
      })}

      {ratesQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{t('Groups.CurrencyConversion.ratesError')}</span>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1"
            onClick={() => ratesQuery.refetch()}
          >
            <RefreshCw className="h-3 w-3" />{' '}
            {t('Groups.CurrencyConversion.refresh')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

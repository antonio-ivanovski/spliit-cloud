import { Fragment } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import {
  CURRENCY_RATE_PROVIDERS,
  type CurrencyRateProviderId,
  type CurrencyRateSource,
} from '@/lib/currency-rate-providers'
import { cn } from '@/lib/utils'
import {
  fixedConversionFor,
  withdrawnDetailsFor,
} from '@spliit/domain/currency'

function ProviderLink({
  provider,
  href,
  className,
}: {
  provider: CurrencyRateProviderId
  /**
   * Per-leg reference (e.g. a currency's withdrawal page). Falls back to the
   * provider metadata URL; renders plain text when neither exists.
   */
  href?: string
  className?: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'CurrencyRateProviders',
  })
  const meta = CURRENCY_RATE_PROVIDERS[provider]
  const url = href ?? ('url' in meta ? meta.url : undefined)
  if (!url) {
    return <span className={className}>{t(provider)}</span>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'underline underline-offset-2 hover:text-foreground',
        className,
      )}
    >
      {t(provider)}
    </a>
  )
}

/**
 * Renders which FX provider(s) supplied the rate, with links to each API. When
 * bridged, also shows the intermediary currency and per-leg providers.
 */
export function CurrencyRateProviderAttribution({
  sources,
  via,
  className,
}: {
  sources: CurrencyRateSource[] | undefined
  via?: string[]
  className?: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'CurrencyRateProviders',
  })

  if (!sources?.length) return null

  const uniqueProviders = [...new Set(sources.map((source) => source.provider))]

  // Withdrawn currencies resolve through a statutory rate, not a market quote.
  // Explain every withdrawn code on fixed legs (dual-withdrawn pairs like
  // BGN↔HRK carry two fixed legs); the banner lists them too, this keeps the
  // provenance text consistent with it.
  const fixedLegCodes = [
    ...new Set(
      sources
        .filter((source) => source.provider === 'fixed')
        .flatMap((source) => [source.base, source.target]),
    ),
  ]
  const fixedDetails = withdrawnDetailsFor(fixedLegCodes)
  const fixedConversion =
    fixedDetails.length > 0
      ? fixedConversionFor(fixedDetails[0]!.code)
      : undefined
  const fixedReason =
    fixedDetails.length > 0 ? (
      <>
        {fixedDetails.map((detail) => (
          <p
            key={detail.code}
            className={cn('text-xs text-muted-foreground', className)}
          >
            {t(`fixedReason.${detail.reason}`, {
              code: detail.code,
              anchor: detail.anchor,
              rate: detail.unitsPerAnchor,
              date: detail.effectiveFrom,
            })}
          </p>
        ))}
      </>
    ) : null

  // Per-currency withdrawal references: a generic provider URL can never
  // describe every withdrawal, so fixed legs link to the catalog's
  // `referenceUrl` when the currency carries one.
  const referenceUrlFor = (source: CurrencyRateSource) => {
    if (source.provider !== 'fixed') return undefined
    for (const code of [source.base, source.target]) {
      const referenceUrl = fixedConversionFor(code)?.referenceUrl
      if (referenceUrl) return referenceUrl
    }
    return undefined
  }

  if (via?.length && sources.length >= 2) {
    return (
      <>
        <p className={cn('text-xs text-muted-foreground', className)}>
          <Trans
            i18nKey="CurrencyRateProviders.bridged"
            values={{ currencies: via.join(', ') }}
            components={{
              providers: (
                <span>
                  {sources.map((source, index) => (
                    <Fragment
                      key={`${source.provider}-${source.base}-${source.target}-${index}`}
                    >
                      {index > 0 ? ' → ' : null}
                      <ProviderLink
                        provider={source.provider}
                        href={referenceUrlFor(source)}
                      />
                    </Fragment>
                  ))}
                </span>
              ),
            }}
          />
        </p>
        {fixedReason}
      </>
    )
  }

  if (uniqueProviders.length === 1) {
    const provider = uniqueProviders[0]!
    return (
      <>
        <p className={cn('text-xs text-muted-foreground', className)}>
          <Trans
            i18nKey={`CurrencyRateProviders.direct.${provider}`}
            components={{
              provider: (
                <ProviderLink
                  provider={provider}
                  href={
                    provider === 'fixed'
                      ? fixedConversion?.referenceUrl
                      : undefined
                  }
                />
              ),
            }}
          />
        </p>
        {fixedReason}
      </>
    )
  }

  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {t('fallbackPrefix')}{' '}
      {uniqueProviders.map((provider, index) => (
        <Fragment key={provider}>
          {index > 0 ? t('fallbackSeparator') : null}
          <ProviderLink provider={provider} />
        </Fragment>
      ))}
    </p>
  )
}

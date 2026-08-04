import { Fragment } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import {
  CURRENCY_RATE_PROVIDERS,
  type CurrencyRateProviderId,
  type CurrencyRateSource,
} from '@/lib/currency-rate-providers'
import { cn } from '@/lib/utils'

function ProviderLink({
  provider,
  className,
}: {
  provider: CurrencyRateProviderId
  className?: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'CurrencyRateProviders',
  })
  const meta = CURRENCY_RATE_PROVIDERS[provider]
  return (
    <a
      href={meta.url}
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

  if (via?.length && sources.length >= 2) {
    return (
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
                    <ProviderLink provider={source.provider} />
                  </Fragment>
                ))}
              </span>
            ),
          }}
        />
      </p>
    )
  }

  if (uniqueProviders.length === 1) {
    const provider = uniqueProviders[0]!
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        <Trans
          i18nKey={`CurrencyRateProviders.direct.${provider}`}
          components={{
            provider: <ProviderLink provider={provider} />,
          }}
        />
      </p>
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

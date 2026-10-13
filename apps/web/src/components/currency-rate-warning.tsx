import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type {
  CurrencyRateWarning as RateWarning,
  FixedConversionDetail,
} from '@spliit/domain/currency'

/**
 * Amber escalation banner for rates involving withdrawn currencies. The
 * provider attribution below it stays muted provenance text; this banner is the
 * part that tells the user the rate is frozen or statutory. Pure
 * presentational: callers derive `warning` with `getCurrencyRateWarning`.
 */
export function CurrencyRateWarning({
  warning,
  className,
}: {
  warning: RateWarning | null | undefined
  className?: string
}) {
  const { t } = useTranslation()

  if (!warning) return null

  const headline =
    warning.kind === 'frozen-eol'
      ? t('CurrencyRateWarning.frozenHeadline', { date: warning.frozenDate })
      : warning.kind === 'statutory-fixed'
        ? t('CurrencyRateWarning.statutoryHeadline')
        : t('CurrencyRateWarning.triangulatedHeadline')

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5 text-xs leading-snug">
        <p className="font-medium">{headline}</p>
        {warning.details.map((detail) => (
          <WithdrawalDetailLine key={detail.code} detail={detail} />
        ))}
      </div>
    </div>
  )
}

/**
 * Pair-level notice for list surfaces (import wizard, swap tool) that only know
 * the pair — not a resolved rate. Names the withdrawn codes and their statutory
 * conversions so the user picks per-date vs fixed deliberately. `hideHeadline`
 * collapses to the statutory details (used for the compact fixed-fallback
 * summary, where the caller passes its own `summary` line instead).
 */
export function CurrencyWithdrawnNotice({
  details,
  className,
  hideHeadline = false,
  summary,
}: {
  details: FixedConversionDetail[]
  className?: string
  hideHeadline?: boolean
  summary?: string
}) {
  const { t } = useTranslation()

  if (details.length === 0) return null

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5 text-xs leading-snug">
        {!hideHeadline ? (
          <p className="font-medium">
            {t('CurrencyRateWarning.withdrawnPairHeadline', {
              codes: details.map((detail) => detail.code).join(', '),
            })}
          </p>
        ) : null}
        {summary ? <p className="font-medium">{summary}</p> : null}
        {details.map((detail) => (
          <WithdrawalDetailLine key={detail.code} detail={detail} />
        ))}
      </div>
    </div>
  )
}

function WithdrawalDetailLine({ detail }: { detail: FixedConversionDetail }) {
  const { t } = useTranslation()

  return (
    <p className="text-amber-800 dark:text-amber-200">
      {t(`CurrencyRateProviders.fixedReason.${detail.reason}` as const, {
        code: detail.code,
        anchor: detail.anchor,
        rate: detail.unitsPerAnchor,
        date: detail.effectiveFrom,
      })}
      {detail.referenceUrl ? (
        <>
          {' '}
          <a
            href={detail.referenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {t('CurrencyRateWarning.reference')}
          </a>
        </>
      ) : null}
    </p>
  )
}

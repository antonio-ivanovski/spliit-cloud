import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ParticipantAvatar } from '@/components/participant-avatar'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { resolveFormattingLocale } from '@spliit/domain'

import type { StatsDashboardData } from './dashboard-types'

type Props = {
  data: StatsDashboardData
  currency: Currency
}

export function ParticipantBreakdown({ data, currency }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Dashboard' })
  const locale = useLocale()
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(resolveFormattingLocale(locale), {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    [locale],
  )

  return (
    <section aria-labelledby="participant-breakdown-title">
      <h2
        id="participant-breakdown-title"
        className="font-semibold tracking-tight"
      >
        {t('participants')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('participantsDescription')}
      </p>
      <div className="mt-5 space-y-4">
        {data.participants.slice(0, 8).map((participant, index) => (
          <div key={participant.participantId}>
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <ParticipantAvatar
                participant={{
                  id: participant.participantId,
                  name: participant.name,
                  account: participant.account,
                }}
                size="lg"
              />
              <span className="min-w-0 flex-1 truncate">
                {participant.name}
              </span>
              <span className="font-medium tabular-nums">
                {formatCurrency(currency, participant.amount, locale)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.max(participant.percentage * 100, 3)}%`,
                    opacity: 1 - index * 0.07,
                  }}
                />
              </div>
              <span className="w-9 text-end text-xs text-muted-foreground tabular-nums">
                {percentFormatter.format(participant.percentage)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

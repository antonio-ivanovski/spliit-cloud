import { ParticipantAvatar } from '@/components/participant-avatar'
import { useLocale } from '@/i18n/react'
import type { AccountIdentity } from '@/lib/account'
import type { Balances } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'

type Participant = {
  id: string
  name: string
  account?: AccountIdentity | null
}

type Props = {
  balances: Balances
  participants: Participant[]
  currency: Currency
}

export function BalancesList({ balances, participants, currency }: Props) {
  const locale = useLocale()
  const maxBalance = Math.max(
    ...Object.values(balances).map((b) => Math.abs(b.total)),
  )

  return (
    <div className="text-sm" data-testid="balances-list">
      {participants.map((participant) => {
        const balance = balances[participant.id]?.total ?? 0
        const isLeft = balance >= 0
        return (
          <div
            key={participant.id}
            className={cn('flex min-w-0', isLeft || 'flex-row-reverse')}
            data-testid={`balance-row-${participant.name}`}
          >
            <div
              className={cn(
                'flex w-1/2 min-w-0 items-center gap-2 p-2',
                isLeft && 'justify-end',
              )}
            >
              <ParticipantAvatar
                participant={participant}
                size="md"
                className={cn('shrink-0', isLeft && 'order-last')}
              />
              <span className="block truncate">{participant.name}</span>
            </div>
            <div className={cn('relative w-1/2 min-w-0', isLeft || 'text-end')}>
              <div className="absolute inset-0 z-20 p-2">
                {formatCurrency(currency, balance, locale)}
              </div>
              {balance !== 0 && (
                <div
                  className={cn(
                    'absolute top-1 z-10 h-7',
                    isLeft
                      ? 'start-0 rounded-e-lg border border-green-300 bg-green-200 dark:border-green-700 dark:bg-green-800'
                      : 'end-0 rounded-s-lg border border-red-300 bg-red-200 dark:border-red-700 dark:bg-red-800',
                  )}
                  style={{
                    width: (Math.abs(balance) / maxBalance) * 100 + '%',
                  }}
                ></div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

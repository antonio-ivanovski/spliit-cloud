import { ParticipantAvatar } from '@/components/participant-avatar'
import type { AccountIdentity } from '@/lib/account'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

type SplitRow = {
  id: string
  name: string
  amount: number
  participant?: {
    id: string
    name: string
    account?: AccountIdentity | null
  }
}

const COLORS = [
  'bg-sky-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
]

export function ExpenseSplitBars({
  label,
  rows,
  currency,
  locale,
}: {
  label: string
  rows: SplitRow[]
  currency: Currency
  locale: string
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
  const isSingleParticipant = rows.length === 1

  return (
    <section className="space-y-2" aria-label={label}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {!isSingleParticipant && (
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted">
          {rows.map((row, index) => (
            <span
              key={row.id}
              className={`${COLORS[index % COLORS.length]} first:rounded-l-full last:rounded-r-full`}
              style={{
                width: `${total > 0 ? (Math.abs(row.amount) / total) * 100 : 0}%`,
              }}
              title={`${row.name}: ${formatCurrency(currency, row.amount, locale)}`}
            />
          ))}
        </div>
      )}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex min-w-0 items-center gap-2 text-xs">
            {!isSingleParticipant && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${COLORS[index % COLORS.length]}`}
              />
            )}
            <ParticipantAvatar
              participant={row.participant ?? { id: row.id, name: row.name }}
              size="xs"
            />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatCurrency(currency, row.amount, locale)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

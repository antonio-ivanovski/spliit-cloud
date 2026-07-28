import { ParticipantAvatar } from '@/components/participant-avatar'
import { Badge } from '@/components/ui/badge'
import type { AccountIdentity } from '@/lib/account'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

type SplitRow = {
  id: string
  name: string
  amount: number
  value?: string
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
  modeLabel,
  rows,
  currency,
  locale,
}: {
  label: string
  modeLabel?: string
  rows: SplitRow[]
  currency: Currency
  locale: string
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
  const isSingleParticipant = rows.length === 1

  return (
    <section className="space-y-2" aria-label={label}>
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {modeLabel && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] font-medium tracking-normal normal-case"
          >
            {modeLabel}
          </Badge>
        )}
      </h3>
      {!isSingleParticipant && (
        <div aria-hidden="true" className="relative h-4 w-full">
          <div className="absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 gap-px rounded-full bg-muted">
            {rows.map((row, index) => (
              <span
                key={row.id}
                className={`@container relative h-2.5 min-w-0 ${COLORS[index % COLORS.length]} first:rounded-l-full last:rounded-r-full`}
                style={{
                  width: `${total > 0 ? (Math.abs(row.amount) / total) * 100 : 0}%`,
                }}
                title={`${row.name}: ${formatCurrency(currency, row.amount, locale)}`}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center @min-[24px]:flex"
                >
                  <ParticipantAvatar
                    participant={
                      row.participant ?? { id: row.id, name: row.name }
                    }
                    size="xs"
                    variant="stack"
                    className="shadow-sm"
                  />
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex min-w-0 items-center gap-2 text-xs">
            {!isSingleParticipant && (
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${COLORS[index % COLORS.length]}`}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {row.value && (
              <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                {row.value}
              </span>
            )}
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatCurrency(currency, row.amount, locale)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

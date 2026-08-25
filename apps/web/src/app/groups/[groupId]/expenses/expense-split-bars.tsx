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
  amountLabel?: string
  distributionWeight?: number
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
  compact = false,
  showAmounts = true,
}: {
  label: string
  modeLabel?: string
  rows: SplitRow[]
  currency: Currency
  locale: string
  compact?: boolean
  showAmounts?: boolean
}) {
  if (rows.length === 0) return null
  const amountTotal = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
  const weightTotal = rows.reduce(
    (sum, row) => sum + Math.abs(row.distributionWeight ?? 0),
    0,
  )
  const useWeights = amountTotal === 0 && weightTotal > 0
  const segmentTotal = useWeights ? weightTotal : amountTotal
  const segmentValues = rows.map((row) =>
    useWeights ? Math.abs(row.distributionWeight ?? 0) : Math.abs(row.amount),
  )
  const isSingleParticipant = rows.length === 1
  const showBar = compact
    ? rows.length > 0
    : !isSingleParticipant && amountTotal > 0

  return (
    <section className="w-full min-w-0 space-y-2" aria-label={label}>
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {modeLabel && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-xs font-medium tracking-normal normal-case"
          >
            {modeLabel}
          </Badge>
        )}
      </h3>
      {showBar && (
        <div aria-hidden="true" className="relative h-4 w-full">
          <div
            className={`absolute inset-x-0 top-1/2 flex -translate-y-1/2 gap-px rounded-full bg-muted ${compact ? 'h-2' : 'h-2.5'}`}
          >
            {rows.map((row, index) => (
              <span
                key={row.id}
                className={`@container relative min-w-0 ${compact ? 'h-2' : 'h-2.5'} ${COLORS[index % COLORS.length]} first:rounded-s-full last:rounded-e-full`}
                style={{
                  width: `${segmentTotal > 0 ? ((segmentValues[index] ?? 0) / segmentTotal) * 100 : 100 / rows.length}%`,
                }}
                title={
                  useWeights
                    ? `${row.name}: ${row.value ?? row.distributionWeight ?? ''}`
                    : `${row.name}: ${formatCurrency(currency, row.amount, locale)}`
                }
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
            {row.amountLabel && (
              <span className="shrink-0 text-muted-foreground/70">
                {row.amountLabel}
              </span>
            )}
            {showAmounts && (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatCurrency(currency, row.amount, locale)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

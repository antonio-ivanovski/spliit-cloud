import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSuggestedSettlements, type Balances } from '@spliit/domain/balances'

import { splitByWeights, splitEvenly } from './split-settle-math'

const PARTICIPANTS = [
  { id: 'alex', name: 'Alex' },
  { id: 'blake', name: 'Blake' },
  { id: 'casey', name: 'Casey' },
] as const

function parseDollarsToCents(raw: string): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(1_000_000_00, Math.round(parsed * 100))
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/**
 * Lite-interactive settlement demo. Everything runs in the browser over a
 * single fictional expense — no account, no network — using the same
 * `getSuggestedSettlements` helper as production balances.
 */
export function SplitSettleDemo() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Features.demo.splitSettle',
  })
  const [amountRaw, setAmountRaw] = useState('90')
  const [payerId, setPayerId] = useState<string>('alex')
  const [mode, setMode] = useState<'equal' | 'custom'>('equal')
  const [weights, setWeights] = useState<number[]>([1, 1, 1])

  const amountCents = parseDollarsToCents(amountRaw)
  const shares = useMemo(
    () =>
      mode === 'equal'
        ? splitEvenly(amountCents, PARTICIPANTS.length)
        : splitByWeights(amountCents, weights),
    [amountCents, mode, weights],
  )

  const balances = useMemo(() => {
    const result: Balances = {}
    PARTICIPANTS.forEach((p, i) => {
      const paid = p.id === payerId ? amountCents : 0
      const owed = shares[i] ?? 0
      result[p.id] = { paid, paidFor: owed, total: paid - owed }
    })
    return result
  }, [amountCents, payerId, shares])

  const settlements = useMemo(
    () => getSuggestedSettlements(balances),
    [balances],
  )

  const nameOf = (id: string) =>
    PARTICIPANTS.find((p) => p.id === id)?.name ?? id

  return (
    <div
      data-testid="split-settle-demo"
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="demo-amount">{t('amountLabel')}</Label>
          <Input
            id="demo-amount"
            data-testid="demo-amount"
            inputMode="decimal"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder="90.00"
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">{t('payerLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {PARTICIPANTS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`demo-payer-${p.id}`}
                aria-pressed={payerId === p.id}
                onClick={() => setPayerId(p.id)}
                className={
                  p.id === payerId
                    ? 'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground'
                    : 'inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground'
                }
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">{t('modeLabel')}</legend>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="demo-mode-equal"
              aria-pressed={mode === 'equal'}
              onClick={() => setMode('equal')}
              className={
                mode === 'equal'
                  ? 'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground'
                  : 'inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground'
              }
            >
              {t('modeEqual')}
            </button>
            <button
              type="button"
              data-testid="demo-mode-custom"
              aria-pressed={mode === 'custom'}
              onClick={() => setMode('custom')}
              className={
                mode === 'custom'
                  ? 'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground'
                  : 'inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground'
              }
            >
              {t('modeCustom')}
            </button>
          </div>
        </fieldset>

        {mode === 'custom' ? (
          <div className="grid grid-cols-3 gap-2">
            {PARTICIPANTS.map((p, i) => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`demo-weight-${p.id}`}>{p.name}</Label>
                <Input
                  id={`demo-weight-${p.id}`}
                  data-testid={`demo-weight-${p.id}`}
                  inputMode="numeric"
                  value={String(weights[i] ?? 0)}
                  onChange={(e) => {
                    const next = [...weights]
                    const parsed = Number.parseInt(e.target.value, 10)
                    next[i] =
                      Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
                    setWeights(next)
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <section aria-label={t('balancesTitle')}>
          <h3 className="text-sm font-semibold">{t('balancesTitle')}</h3>
          <ul
            data-testid="demo-balances"
            className="mt-2 flex flex-col gap-1.5"
          >
            {PARTICIPANTS.map((p, i) => {
              const total = balances[p.id]?.total ?? 0
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <span>
                    {p.name}{' '}
                    <span className="text-muted-foreground">
                      {formatCents(shares[i] ?? 0)}
                    </span>
                  </span>
                  <output
                    data-testid={`demo-balance-${p.id}`}
                    className={
                      total === 0
                        ? 'font-medium text-muted-foreground'
                        : total > 0
                          ? 'font-medium text-emerald-700 dark:text-emerald-300'
                          : 'font-medium text-rose-700 dark:text-rose-300'
                    }
                  >
                    {total === 0
                      ? formatCents(0)
                      : `${total > 0 ? '+' : '−'}${formatCents(Math.abs(total))}`}
                  </output>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-label={t('settlementsTitle')}>
          <h3 className="text-sm font-semibold">{t('settlementsTitle')}</h3>
          {settlements.length === 0 ? (
            <p
              data-testid="demo-settled"
              className="mt-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground"
            >
              {t('settledLabel')}
            </p>
          ) : (
            <ul
              data-testid="demo-settlements"
              className="mt-2 flex flex-col gap-1.5"
            >
              {settlements.map((s) => (
                <li
                  key={`${s.from}-${s.to}-${s.amount}`}
                  className="rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <strong className="font-medium">{nameOf(s.from)}</strong>
                  <span aria-hidden="true"> → </span>
                  <strong className="font-medium">{nameOf(s.to)}</strong>{' '}
                  <span className="font-semibold text-primary">
                    {formatCents(s.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

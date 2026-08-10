import type { ReactNode } from 'react'

import { AccountAvatar } from '@/components/account-avatar'
import type { Currency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'
import type { SettlementUnit } from '@spliit/domain/subgroup-settlements'

import { RemovedParticipantBadge } from './removed-participant-badge'

export type SettlementParticipant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  removed?: boolean
}

export type SettlementUnitIdentity = SettlementUnit & {
  members: SettlementParticipant[]
}

export type SettlementIdentity = {
  id: string
  name: string
  members: SettlementParticipant[]
  total: number
  removed?: boolean
}

/**
 * Hydrate domain virtual units with the participant labels and accounts that
 * are available to the UI. The domain intentionally only knows participant ids;
 * rendering must never leak that id as a human-facing name.
 */
export function hydrateSettlementUnits(
  units: SettlementUnit[],
  getMembers: (memberIds: string[]) => SettlementParticipant[],
  fallbackName: string,
): SettlementUnitIdentity[] {
  return units.map((unit) => {
    const members = getMembers(unit.memberIds)
    const participantName = members[0]?.name.trim()
    return {
      ...unit,
      name:
        unit.kind === 'participant'
          ? participantName || fallbackName
          : unit.name,
      members,
    }
  })
}

export function SettlementAvatar({
  members,
  label,
  size = 'sm',
}: {
  members: SettlementParticipant[]
  label: string
  size?: 'xs' | 'sm'
}) {
  if (members.length === 0) return null
  const visibleMembers = members.slice(0, 4)
  const hiddenCount = members.length - visibleMembers.length
  const avatarClass = size === 'sm' ? 'size-5' : 'size-4'
  const overlapClass = '-ms-1'

  return (
    <div className="isolate flex shrink-0 items-center" aria-label={label}>
      {visibleMembers.map((member, index) => (
        <AccountAvatar
          key={member.id}
          account={member.account ?? { id: member.id, name: member.name }}
          variant={members.length > 1 ? 'stack' : 'default'}
          size={size}
          className={cn(avatarClass, index > 0 && overlapClass)}
        />
      ))}
      {hiddenCount > 0 && (
        <span
          className={cn(
            overlapClass,
            'grid place-items-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground',
            avatarClass,
          )}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  )
}

export function SettlementBalanceList({
  identities,
  currency,
  locale,
  emptyMessage,
  amountLabel,
}: {
  identities: SettlementIdentity[]
  currency: Currency
  locale: string
  emptyMessage?: string
  amountLabel?: (args: {
    identity: SettlementIdentity
    amount: string
    isReceiving: boolean
  }) => ReactNode
}) {
  const activeIdentities = identities.filter((identity) => identity.total !== 0)
  const orderedIdentities = [
    ...activeIdentities.filter((identity) => identity.total > 0),
    ...activeIdentities.filter((identity) => identity.total < 0),
  ]

  if (orderedIdentities.length === 0) {
    return emptyMessage ? (
      <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    ) : null
  }

  return (
    <div className="divide-y divide-border/60 rounded-lg border border-border/70">
      {orderedIdentities.map((identity) => (
        <SettlementBalanceRow
          key={identity.id}
          identity={identity}
          currency={currency}
          locale={locale}
          amountLabel={amountLabel}
        />
      ))}
    </div>
  )
}

export function SettlementBalanceRow({
  identity,
  currency,
  locale,
  amountLabel,
}: {
  identity: SettlementIdentity
  currency: Currency
  locale: string
  amountLabel?: (args: {
    identity: SettlementIdentity
    amount: string
    isReceiving: boolean
  }) => ReactNode
}) {
  const amount = formatCurrency(currency, Math.abs(identity.total), locale)
  const isReceiving = identity.total > 0

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <SettlementAvatar members={identity.members} label={identity.name} />
        <span className="min-w-0 truncate text-sm font-medium">
          {identity.name}
        </span>
        {identity.removed ? <RemovedParticipantBadge /> : null}
      </div>
      <span
        className={`shrink-0 text-sm tabular-nums ${isReceiving ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
      >
        {amountLabel?.({ identity, amount, isReceiving }) ??
          (isReceiving ? `is owed ${amount}` : `owes ${amount}`)}
      </span>
    </div>
  )
}

export function SettlementGroupCard({
  title,
  identity,
  amount,
  currency,
  locale,
  action,
  children,
}: {
  title: ReactNode
  identity: SettlementIdentity
  amount: number
  currency: Currency
  locale: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
      <div className="flex min-h-14 items-center justify-between gap-2 border-b border-dashed border-border/70 bg-background/70 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SettlementAvatar members={identity.members} label={identity.name} />
          <span className="min-w-0 truncate text-sm font-medium text-foreground sm:overflow-visible sm:break-words sm:whitespace-normal">
            {title}
          </span>
          {identity.removed ? <RemovedParticipantBadge /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-sm font-semibold text-foreground tabular-nums">
            {formatCurrency(currency, amount, locale)}
          </span>
          {action}
        </div>
      </div>
      <div className="divide-y divide-border/50 bg-background/60">
        {children}
      </div>
    </div>
  )
}

/**
 * Keeps the source rows visually attached to the segment bar above them. The
 * rail starts at the bar's edge and continues through every source row, so the
 * hierarchy reads as one small notebook-style entry.
 */
export function SettlementLegList({ children }: { children: ReactNode }) {
  return (
    <div className="relative -mx-3 -mt-3 border-t border-border/50 pt-3">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 start-5 -top-1 border-s border-border/70"
      />
      <div className="relative divide-y divide-border/50">{children}</div>
    </div>
  )
}

export function SettlementLegRow({
  counterparty,
  description,
  detail,
  amount,
  currency,
  locale,
  action,
  showRail = true,
}: {
  counterparty: SettlementIdentity
  description: ReactNode
  detail?: ReactNode
  amount: number
  currency: Currency
  locale: string
  action?: ReactNode
  showRail?: boolean
}) {
  return (
    <div className="relative flex min-h-11 items-center gap-2 bg-background/40 py-2 ps-12 pe-3 text-xs transition-colors hover:bg-muted/20">
      {showRail ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-5 border-s border-border/70"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-5 top-1/2 w-3 border-t border-border/70"
      />
      <SettlementAvatar
        members={counterparty.members}
        label={counterparty.name}
        size="xs"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-muted-foreground">{description}</div>
        {detail ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-foreground">
            {detail}
          </div>
        ) : null}
      </div>
      {counterparty.removed ? <RemovedParticipantBadge /> : null}
      <span className="shrink-0 font-medium text-muted-foreground tabular-nums">
        {formatCurrency(currency, amount, locale)}
      </span>
      {action}
    </div>
  )
}

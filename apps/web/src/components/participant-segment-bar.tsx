import type { ReactNode } from 'react'

import { ParticipantAvatar } from '@/components/participant-avatar'
import type { Currency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'

import {
  type ParticipantSegment,
  participantSegmentColor,
} from './participant-segment-utils'

type Props = {
  rows: ParticipantSegment[]
  currency: Currency
  locale: string
  /** Hide overlays when a caller wants a plain segmented track. */
  showAvatars?: boolean
  /** Keep a full-width track for a single balance leg when the context needs it. */
  showSingleParticipantBar?: boolean
  className?: string
  /** Semantic, non-decorative legend content supplied by the caller. */
  children?: ReactNode
}

/**
 * Renders proportional participant segments with the same visual language as
 * the expense preview. The track is decorative; callers should provide the
 * textual legend as children so screen readers receive the complete values.
 */
export function ParticipantSegmentBar({
  rows,
  currency,
  locale,
  showAvatars = true,
  showSingleParticipantBar = false,
  className,
  children,
}: Props) {
  if (rows.length === 0) return children ? <>{children}</> : null

  const total = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
  const isSingleParticipant = rows.length === 1

  return (
    <div
      className={cn('space-y-2', className)}
      data-testid="participant-segment-bar"
    >
      {(!isSingleParticipant || showSingleParticipantBar) && (
        <div aria-hidden="true" className="relative h-4 w-full">
          <div className="absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 gap-px rounded-full bg-muted">
            {rows.map((row, index) => {
              const participant = row.participant ?? {
                id: row.id,
                name: row.name,
              }
              const amount = formatCurrency(currency, row.amount, locale)
              return (
                <span
                  key={row.id}
                  className={cn(
                    '@container relative h-2.5 min-w-0 first:rounded-s-full last:rounded-e-full',
                    participantSegmentColor(row, index),
                  )}
                  style={{
                    width: `${total > 0 ? (Math.abs(row.amount) / total) * 100 : 0}%`,
                  }}
                  title={`${row.name}: ${amount}`}
                >
                  {showAvatars && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center @min-[24px]:flex"
                    >
                      <ParticipantAvatar
                        participant={participant}
                        size="xs"
                        variant="stack"
                        className="shadow-sm"
                      />
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

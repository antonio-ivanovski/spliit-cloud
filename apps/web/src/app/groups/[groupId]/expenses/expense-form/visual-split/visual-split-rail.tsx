import { ParticipantAvatar } from '@/components/participant-avatar'
import { useLocale } from '@/i18n/react'
import { participantSegmentColor } from '@/lib/participant-colors'
import { cn } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { useTranslation } from 'react-i18next'
import {
  allocationStep,
  type AllocationBoundary,
  type AllocationState,
} from '../allocation-engine'
import type { VisualSplitParticipant } from './types'
import type { AllocationUpdateOptions } from './visual-split-utils'
import { formatUnit } from './visual-split-utils'

export type RailRow = {
  id: string
  value: number
  locked: boolean
  participant: VisualSplitParticipant | undefined
  colorIndex: number
  width: number
  index: number
}

type VisualSplitRailProps = {
  mode: Exclude<SplitMode, 'ITEMIZED'>
  currency: Currency
  readOnly: boolean
  editable: boolean
  railRef: React.RefObject<HTMLDivElement | null>
  railRows: RailRow[]
  allocation: AllocationState | null
  boundaries: AllocationBoundary[]
  activeBoundary: number | null
  participantById: Map<string, VisualSplitParticipant>
  onSetActiveBoundary: (index: number | null) => void
  onQueuePointerMove: (index: number, clientX: number) => void
  onFinishPointerMove: () => void
  onUpdateBoundary: (
    index: number,
    value: number,
    options?: AllocationUpdateOptions,
  ) => AllocationState | null
}

export function VisualSplitRail({
  mode,
  currency,
  readOnly,
  editable,
  railRef,
  railRows,
  allocation,
  boundaries,
  activeBoundary,
  participantById,
  onSetActiveBoundary,
  onQueuePointerMove,
  onFinishPointerMove,
  onUpdateBoundary,
}: VisualSplitRailProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  const locale = useLocale()
  const sharesLabel = t('shares')
  const formatValue = (value: number) =>
    formatUnit(mode, value, currency, locale, sharesLabel)

  return (
    <div
      className={cn(
        'relative mb-8 mt-7 h-10',
        editable && !readOnly && 'mb-10',
      )}
    >
      <div
        ref={railRef}
        className="absolute inset-x-0 top-3 flex h-2.5 gap-px overflow-visible rounded-full bg-muted"
        aria-label={t('participants')}
      >
        {railRows.map((entry) => (
          <span
            key={entry.id}
            className={cn(
              '@container relative h-2.5 min-w-0 first:rounded-l-full last:rounded-r-full',
              participantSegmentColor(
                { colorIndex: entry.colorIndex },
                entry.index,
              ),
            )}
            style={{ width: `${entry.width}%` }}
            title={`${entry.participant?.name ?? entry.id}: ${formatValue(entry.value)}`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-3 inset-x-0 z-10 flex items-center justify-center"
            >
              <ParticipantAvatar
                participant={
                  entry.participant ?? { id: entry.id, name: entry.id }
                }
                size="xs"
                variant="stack"
                className="shadow-sm"
              />
            </span>
          </span>
        ))}
      </div>
      {editable &&
        !readOnly &&
        railRows.slice(0, -1).map((entry, index) => {
          if (!allocation) return null
          const right = railRows[index + 1]
          const boundary = boundaries[index]
          const position = (boundary.position / allocation.target) * 100
          const key = boundary.key
          const boundaryLabel = `${entry.participant?.name ?? entry.id} / ${right.participant?.name ?? right.id}`
          return (
            <div
              key={key}
              className="absolute inset-y-0"
              style={{ left: `${position}%` }}
            >
              <button
                type="button"
                role="slider"
                aria-label={t('setValue', {
                  name: boundaryLabel,
                  kind: t(
                    mode === 'BY_PERCENTAGE'
                      ? 'percentage'
                      : mode === 'BY_AMOUNT'
                        ? 'amount'
                        : 'shares',
                  ),
                })}
                aria-valuemin={boundary.minimum}
                aria-valuemax={boundary.maximum}
                aria-valuenow={boundary.position}
                aria-valuetext={`${formatValue(entry.value)} / ${formatValue(right.value)}`}
                className="absolute left-1/2 top-3 size-6 -translate-x-1/2 cursor-ew-resize touch-none rounded-full border-2 border-primary/60 bg-background shadow-[0_1px_3px_hsl(var(--foreground)/0.18)] transition-[transform,background-color,border-color] hover:scale-110 hover:border-primary hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:opacity-60"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onSetActiveBoundary(index)
                }}
                onPointerMove={(event) => {
                  if (event.buttons > 0)
                    onQueuePointerMove(index, event.clientX)
                }}
                onPointerUp={onFinishPointerMove}
                onPointerCancel={onFinishPointerMove}
                onLostPointerCapture={onFinishPointerMove}
                onFocus={() => onSetActiveBoundary(index)}
                onBlur={() =>
                  onSetActiveBoundary(
                    activeBoundary === index ? null : activeBoundary,
                  )
                }
                onKeyDown={(event) => {
                  const step = allocationStep(mode, allocation.target)
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    onUpdateBoundary(index, boundary.position - step)
                  }
                  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    onUpdateBoundary(index, boundary.position + step)
                  }
                  if (event.key === 'Home') {
                    event.preventDefault()
                    onUpdateBoundary(index, boundary.minimum)
                  }
                  if (event.key === 'End') {
                    event.preventDefault()
                    onUpdateBoundary(index, boundary.maximum)
                  }
                }}
              />
            </div>
          )
        })}
      {activeBoundary != null && allocation && (
        <div
          className="pointer-events-none absolute inset-x-0 -bottom-7 flex justify-center text-[11px] font-medium tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {(() => {
            const left = allocation.entries[activeBoundary]
            const right = allocation.entries[activeBoundary + 1]
            return `${participantById.get(left.id)?.name ?? left.id} ${formatValue(left.value)} · ${participantById.get(right.id)?.name ?? right.id} ${formatValue(right.value)}`
          })()}
        </div>
      )}
    </div>
  )
}

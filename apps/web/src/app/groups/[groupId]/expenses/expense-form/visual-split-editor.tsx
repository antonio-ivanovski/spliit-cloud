import { ParticipantAvatar } from '@/components/participant-avatar'
import {
  PARTICIPANT_SEGMENT_COLORS,
  participantSegmentColor,
} from '@/components/participant-segment-bar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/react'
import { amountAsMinorUnits, cn, formatCurrency } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { Check, Lock, Minus, Plus, Unlock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addAllocationEntry,
  allocationBoundaries,
  allocationBoundaryKey,
  allocationStep,
  createAllocation,
  lockAllocationBoundary,
  previewAllocationBoundary,
  quantizeAllocationPosition,
  removeAllocationEntry,
  resetAllocationEqually,
  resizeAllocationTarget,
  scaleAllocationToTarget,
  setAllocationParticipantValue,
  unlockAllAllocationBoundaries,
  unlockAllocationBoundary,
  type AllocationState,
} from './allocation-engine'

export type VisualSplitParticipant = {
  id: string
  name: string
  pending?: boolean
  account?: { id: string; name?: string | null; image?: string | null } | null
}

export type VisualSplitRow = { participant: string; shares: number }

type AllocationUpdateOptions = {
  shouldDirty: boolean
  shouldTouch: boolean
  shouldValidate: boolean
}

const updateOptions: AllocationUpdateOptions = {
  shouldDirty: true,
  shouldTouch: true,
  shouldValidate: true,
} as const

const previewOptions: AllocationUpdateOptions = {
  shouldDirty: false,
  shouldTouch: false,
  shouldValidate: false,
} as const

function amountFromMinorUnits(value: number, currency: Currency) {
  return value / 10 ** currency.decimal_digits
}

function unitValue(mode: SplitMode, value: number, currency: Currency) {
  if (mode === 'BY_PERCENTAGE') return Math.round(value * 100)
  if (mode === 'BY_AMOUNT') return amountAsMinorUnits(Math.abs(value), currency)
  return Math.max(1, Math.round(value || 1))
}

function formValue(mode: SplitMode, value: number, currency: Currency) {
  if (mode === 'BY_PERCENTAGE') return value / 100
  if (mode === 'BY_AMOUNT') return amountFromMinorUnits(value, currency)
  return value
}

function buildAllocation(
  mode: SplitMode,
  rows: VisualSplitRow[],
  target: number,
  currency: Currency,
) {
  const allocationTarget =
    mode === 'BY_PERCENTAGE'
      ? 10_000
      : mode === 'BY_AMOUNT'
        ? amountAsMinorUnits(Math.abs(target), currency)
        : rows.reduce(
            (sum, row) => sum + Math.max(1, Math.round(row.shares)),
            0,
          )

  if (allocationTarget < rows.length || rows.length === 0) return null
  const result = createAllocation(
    allocationTarget,
    rows.map((row) => ({
      id: row.participant,
      value: unitValue(mode, row.shares, currency),
    })),
  )
  return result.ok ? result.state : null
}

function allocationRows(
  mode: SplitMode,
  state: AllocationState,
  currency: Currency,
  amountSign: 1 | -1,
): VisualSplitRow[] {
  return state.entries.map((entry) => ({
    participant: entry.id,
    shares:
      formValue(mode, entry.value, currency) *
      (mode === 'BY_AMOUNT' ? amountSign : 1),
  }))
}

function rowsSignature(rows: VisualSplitRow[]) {
  return rows.map((row) => `${row.participant}:${Number(row.shares)}`).join('|')
}

export function VisualSplitEditor({
  mode,
  participants,
  rows,
  targetAmount,
  currency,
  readOnly = false,
  amountSign = 1,
  onRowsChange,
  amountPreview,
  pendingLabel,
  selectAllLabel,
}: {
  mode: Exclude<SplitMode, 'ITEMIZED'>
  participants: VisualSplitParticipant[]
  rows: VisualSplitRow[]
  targetAmount: number
  currency: Currency
  readOnly?: boolean
  amountSign?: 1 | -1
  onRowsChange: (
    rows: VisualSplitRow[],
    options?: AllocationUpdateOptions,
  ) => void
  amountPreview?: (
    participantId: string,
    rows: VisualSplitRow[],
  ) => React.ReactNode
  pendingLabel?: string
  selectAllLabel?: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  const locale = useLocale()
  const editable = mode !== 'EVENLY'
  const [allocation, setAllocation] = useState<AllocationState | null>(() =>
    editable ? buildAllocation(mode, rows, targetAmount, currency) : null,
  )
  const [activeBoundary, setActiveBoundary] = useState<number | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({})
  const [shareTargetInput, setShareTargetInput] = useState('')
  const shareTargetFocusedRef = useRef(false)
  const [resizeConflict, setResizeConflict] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const railRef = useRef<HTMLDivElement>(null)
  const allocationRef = useRef<AllocationState | null>(null)
  const pointerFrameRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ index: number; clientX: number } | null>(
    null,
  )
  const lastPointerPreviewRef = useRef<AllocationState | null>(null)
  const lastEmittedRows = useRef<string | null>(null)
  const synchronizedRows = useRef<string | null>(null)
  const previousTarget = useRef<number | null>(allocation?.target ?? null)
  const previousAmountSign = useRef<1 | -1>(amountSign)
  const rowSignature = rowsSignature(rows)
  const allocationTarget =
    mode === 'BY_PERCENTAGE'
      ? 10_000
      : mode === 'BY_AMOUNT'
        ? amountAsMinorUnits(Math.abs(targetAmount), currency)
        : rows.reduce(
            (sum, row) => sum + Math.max(1, Math.round(row.shares)),
            0,
          )

  const participantById = useMemo(
    () =>
      new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  )
  const participantIndexById = useMemo(
    () =>
      new Map(
        participants.map((participant, index) => [participant.id, index]),
      ),
    [participants],
  )
  const rowByParticipant = useMemo(
    () => new Map(rows.map((row) => [row.participant, row])),
    [rows],
  )
  const entryById = useMemo(
    () =>
      new Map((allocation?.entries ?? []).map((entry) => [entry.id, entry])),
    [allocation],
  )
  const entryIndexById = useMemo(
    () =>
      new Map(
        (allocation?.entries ?? []).map((entry, index) => [entry.id, index]),
      ),
    [allocation],
  )

  const emitAllocation = useCallback(
    (
      next: AllocationState,
      options: AllocationUpdateOptions = updateOptions,
    ) => {
      const nextRows = allocationRows(mode, next, currency, amountSign)
      lastEmittedRows.current = rowsSignature(nextRows)
      synchronizedRows.current = lastEmittedRows.current
      setAllocation(next)
      onRowsChange(nextRows, options)
    },
    [amountSign, currency, mode, onRowsChange],
  )

  useEffect(() => {
    if (!editable) {
      setAllocation(null)
      setResizeConflict(false)
      return
    }
    if (lastEmittedRows.current === rowSignature) {
      lastEmittedRows.current = null
      synchronizedRows.current = rowSignature
      return
    }
    if (synchronizedRows.current === rowSignature) return
    synchronizedRows.current = rowSignature
    const rebuilt = buildAllocation(mode, rows, targetAmount, currency)
    setAllocation(rebuilt)
    setResizeConflict(!rebuilt && rows.length > 0)
    if (!rebuilt) return
    const normalizedRows = allocationRows(mode, rebuilt, currency, amountSign)
    if (rowsSignature(normalizedRows) !== rowSignature) {
      lastEmittedRows.current = rowsSignature(normalizedRows)
      synchronizedRows.current = lastEmittedRows.current
      onRowsChange(normalizedRows, updateOptions)
    }
  }, [amountSign, currency, editable, mode, rowSignature, rows, targetAmount])

  useEffect(() => {
    if (!editable) return
    const targetChanged = previousTarget.current !== allocationTarget
    const signChanged = previousAmountSign.current !== amountSign
    previousTarget.current = allocationTarget
    previousAmountSign.current = amountSign
    if (!targetChanged && !signChanged) return
    if (signChanged && !targetChanged && allocation) emitAllocation(allocation)
    if (targetChanged && allocation && allocation.target !== allocationTarget) {
      const resized = resizeAllocationTarget(allocation, allocationTarget)
      if (!resized.ok) {
        setResizeConflict(true)
        return
      }
      setResizeConflict(false)
      emitAllocation(resized.state)
    }
  }, [allocation, allocationTarget, amountSign, editable, emitAllocation])

  const values = useMemo(
    () =>
      allocation?.entries ??
      rows.map((row) => ({
        id: row.participant,
        value:
          mode === 'EVENLY'
            ? 1
            : Math.max(1, unitValue(mode, row.shares, currency)),
        locked: false,
      })),
    [allocation, currency, mode, rows],
  )
  const total = values.reduce((sum, entry) => sum + entry.value, 0)
  const railRows = useMemo(
    () =>
      values.map((entry, index) => ({
        ...entry,
        participant: participantById.get(entry.id),
        colorIndex: participantIndexById.get(entry.id) ?? 0,
        width: total ? (entry.value / total) * 100 : 0,
        index,
      })),
    [participantById, participantIndexById, total, values],
  )
  const shareTotal = rows.reduce((sum, row) => sum + Math.max(0, row.shares), 0)
  const boundaries = useMemo(
    () => (allocation ? allocationBoundaries(allocation) : []),
    [allocation],
  )
  const amountPreviews = useMemo(() => {
    if (!amountPreview) return new Map<string, React.ReactNode>()
    return new Map(
      rows.map((row) => [
        row.participant,
        amountPreview(row.participant, rows),
      ]),
    )
  }, [amountPreview, rows])

  useEffect(() => {
    if (mode === 'BY_SHARES' && !shareTargetFocusedRef.current) {
      setShareTargetInput(String(shareTotal))
    }
  }, [mode, shareTotal])

  const formatUnit = (value: number) =>
    mode === 'BY_PERCENTAGE'
      ? `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`
      : mode === 'BY_AMOUNT'
        ? formatCurrency(currency, value, locale)
        : `${value} ${t('shares')}`

  const setInputValue = (participantId: string, value: string) => {
    setInputValues((current) => ({ ...current, [participantId]: value }))
    setInputErrors((current) => ({ ...current, [participantId]: '' }))
  }

  const commitParticipantValue = (participantId: string) => {
    if (!allocation) return
    const raw = inputValues[participantId]
    if (!raw) return
    const index = entryIndexById.get(participantId) ?? -1
    if (index < 0 || allocation.entries.length < 2) return
    const boundaryIndex =
      index < allocation.entries.length - 1 ? index : index - 1
    const key = allocationBoundaryKey(
      allocation.entries[boundaryIndex].id,
      allocation.entries[boundaryIndex + 1].id,
    )
    if (allocation.boundaryLocks?.[key]) {
      setInputErrors((current) => ({
        ...current,
        [participantId]: t('unlockToEdit'),
      }))
      return
    }
    const desired = unitValue(mode, Number(raw), currency)
    if (!Number.isFinite(desired) || desired < 1) {
      setInputErrors((current) => ({
        ...current,
        [participantId]: t('permittedRange', {
          minimum: formatUnit(1),
          maximum: formatUnit(
            allocation.target - allocation.entries.length + 1,
          ),
        }),
      }))
      return
    }
    const result = setAllocationParticipantValue(
      allocation,
      participantId,
      desired,
    )
    if (!result.ok) {
      setInputErrors((current) => ({
        ...current,
        [participantId]: t('permittedRange', {
          minimum: formatUnit(1),
          maximum: formatUnit(
            allocation.target - allocation.entries.length + 1,
          ),
        }),
      }))
      return
    }
    setInputValues((current) => ({ ...current, [participantId]: '' }))
    setInputErrors((current) => ({ ...current, [participantId]: '' }))
    emitAllocation(result.state)
  }

  const updateBoundary = (
    index: number,
    value: number,
    options: AllocationUpdateOptions = updateOptions,
  ) => {
    if (!allocation) return null
    const boundary = boundaries[index]
    if (!boundary) return null
    const position = quantizeAllocationPosition(
      value,
      allocationStep(mode, allocation.target),
      boundary.minimum,
      boundary.maximum,
    )
    if (position === boundary.position) return null
    const result = previewAllocationBoundary(allocation, index, position)
    if (!result.ok) return null
    const next = result.state
    if (
      rowsSignature(allocationRows(mode, next, currency, amountSign)) ===
      lastEmittedRows.current
    ) {
      return null
    }
    emitAllocation(next, options)
    const left = next.entries[index]
    const right = next.entries[index + 1]
    const leftName = participantById.get(left.id)?.name ?? left.id
    const rightName = participantById.get(right.id)?.name ?? right.id
    setAnnouncement(
      `${leftName} ${formatUnit(left.value)}, ${rightName} ${formatUnit(right.value)}`,
    )
    return next
  }

  allocationRef.current = allocation
  const updateBoundaryRef = useRef(updateBoundary)
  updateBoundaryRef.current = updateBoundary

  const flushPointerMove = useCallback(() => {
    pointerFrameRef.current = null
    const pending = pendingPointerRef.current
    pendingPointerRef.current = null
    const currentAllocation = allocationRef.current
    const rect = railRef.current?.getBoundingClientRect()
    if (!pending || !currentAllocation || !rect || rect.width <= 0) return
    const next = updateBoundaryRef.current(
      pending.index,
      ((pending.clientX - rect.left) / rect.width) * currentAllocation.target,
      previewOptions,
    )
    if (next) lastPointerPreviewRef.current = next
  }, [])

  const queuePointerMove = useCallback(
    (index: number, clientX: number) => {
      pendingPointerRef.current = { index, clientX }
      if (pointerFrameRef.current != null) return
      pointerFrameRef.current = requestAnimationFrame(flushPointerMove)
    },
    [flushPointerMove],
  )

  const finishPointerMove = useCallback(() => {
    if (pointerFrameRef.current != null) {
      cancelAnimationFrame(pointerFrameRef.current)
      pointerFrameRef.current = null
    }
    flushPointerMove()
    if (lastPointerPreviewRef.current) {
      emitAllocation(lastPointerPreviewRef.current, updateOptions)
    }
    lastPointerPreviewRef.current = null
    setActiveBoundary(null)
  }, [emitAllocation, flushPointerMove])

  useEffect(
    () => () => {
      if (pointerFrameRef.current != null) {
        cancelAnimationFrame(pointerFrameRef.current)
      }
    },
    [],
  )

  const toggleParticipant = (participantId: string, checked: boolean) => {
    if (readOnly) return
    if (editable) {
      if (!allocation) {
        const nextRows = checked
          ? [...rows, { participant: participantId, shares: 1 }]
          : rows.filter((row) => row.participant !== participantId)
        const next = buildAllocation(mode, nextRows, targetAmount, currency)
        if (next) emitAllocation(next)
        else onRowsChange(nextRows, updateOptions)
        return
      }
      let nextAllocation = allocation
      if (checked && mode === 'BY_SHARES') {
        const resized = resizeAllocationTarget(
          nextAllocation,
          Math.max(nextAllocation.target, nextAllocation.entries.length + 1),
        )
        if (resized.ok) nextAllocation = resized.state
      }
      const result = checked
        ? addAllocationEntry(nextAllocation, participantId)
        : removeAllocationEntry(nextAllocation, participantId)
      if (result.ok) emitAllocation(result.state)
      return
    }
    onRowsChange(
      checked
        ? [...rows, { participant: participantId, shares: 1 }]
        : rows.filter((row) => row.participant !== participantId),
      updateOptions,
    )
  }

  const selectAllParticipants = () => {
    if (readOnly) return
    const missing = participants.filter(
      (p) => !rows.some((row) => row.participant === p.id),
    )
    if (!missing.length) return
    if (editable && allocation) {
      let next = allocation
      for (const participant of missing) {
        if (mode === 'BY_SHARES' && next.target < next.entries.length + 1) {
          const resized = resizeAllocationTarget(next, next.entries.length + 1)
          if (!resized.ok) return
          next = resized.state
        }
        const result = addAllocationEntry(next, participant.id)
        if (!result.ok) return
        next = result.state
      }
      emitAllocation(next)
      return
    }
    onRowsChange(
      [...rows, ...missing.map((p) => ({ participant: p.id, shares: 1 }))],
      updateOptions,
    )
  }

  const resizeShares = (requestedTotal: number) => {
    if (readOnly || mode !== 'BY_SHARES' || !allocation) return
    const minimum = allocation.entries.length
    const nextTotal = Math.max(minimum, Math.round(requestedTotal))
    if (!Number.isFinite(nextTotal)) return
    const result = resizeAllocationTarget(allocation, nextTotal)
    if (result.ok) {
      setResizeConflict(false)
      setShareTargetInput(String(nextTotal))
      emitAllocation(result.state)
    }
  }

  const commitShareTarget = () => {
    const value = Number(shareTargetInput)
    if (!Number.isFinite(value)) {
      setShareTargetInput(String(shareTotal))
      return
    }
    resizeShares(value)
  }

  const currentValue = (id: string) =>
    entryById.get(id)?.value ??
    unitValue(mode, rowByParticipant.get(id)?.shares ?? 1, currency)

  return (
    <div
      className="mt-4 min-w-0 border-t pt-4"
      data-testid={`visual-split-${mode.toLowerCase()}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t('participants')}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1">
            {rows.length < participants.length && selectAllLabel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAllParticipants}
              >
                {selectAllLabel}
              </Button>
            )}
            {editable && allocation && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    emitAllocation(unlockAllAllocationBoundaries(allocation))
                  }
                >
                  <Unlock className="mr-1 size-3.5" />
                  {t('unlockAll')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const result = resetAllocationEqually(allocation)
                    if (result.ok) emitAllocation(result.state)
                  }}
                >
                  {t('resetEqually')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {mode === 'BY_SHARES' && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('shares')}
          </span>
          <div className="flex items-center gap-1.5">
            {[5, 10, 20].map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={shareTotal === preset ? 'secondary' : 'outline'}
                className="h-8 min-w-10 rounded-full px-2.5 tabular-nums"
                disabled={readOnly || preset < rows.length}
                aria-pressed={shareTotal === preset}
                onClick={() => resizeShares(preset)}
              >
                {preset}
              </Button>
            ))}
            <Input
              className="h-8 w-16 rounded-full px-2 text-center tabular-nums"
              type="number"
              min={rows.length}
              step={1}
              value={shareTargetInput}
              disabled={readOnly}
              aria-label={`${t('shares')} total`}
              onChange={(event) => setShareTargetInput(event.target.value)}
              onFocus={(event) => {
                shareTargetFocusedRef.current = true
                event.currentTarget.select()
              }}
              onBlur={() => {
                shareTargetFocusedRef.current = false
                commitShareTarget()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitShareTarget()
                }
                if (event.key === 'Escape') {
                  setShareTargetInput(String(shareTotal))
                }
              }}
            />
          </div>
        </div>
      )}

      {railRows.length > 0 && (
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
                title={`${entry.participant?.name ?? entry.id}: ${formatUnit(entry.value)}`}
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
              const locked = boundary.locked
              const boundaryLabel = `${entry.participant?.name ?? entry.id} / ${right.participant?.name ?? right.id}`
              return (
                <div
                  key={key}
                  className="absolute inset-y-0"
                  style={{ left: `${position}%` }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute left-1/2 top-[-1.65rem] size-6 -translate-x-1/2 rounded-full border border-border/80 bg-background/95 p-0 text-muted-foreground shadow-sm backdrop-blur-sm hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={
                      locked
                        ? t('unlock', { name: boundaryLabel })
                        : t('lock', {
                            name: boundaryLabel,
                            value: formatUnit(boundary.position),
                          })
                    }
                    onClick={() => {
                      const result = locked
                        ? unlockAllocationBoundary(allocation, key)
                        : lockAllocationBoundary(allocation, key)
                      if (result.ok) emitAllocation(result.state)
                    }}
                  >
                    {locked ? (
                      <Lock className="size-3.5" />
                    ) : (
                      <Unlock className="size-3.5 opacity-60" />
                    )}
                  </Button>
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
                    aria-valuetext={`${formatUnit(entry.value)} / ${formatUnit(right.value)}`}
                    disabled={locked}
                    className="absolute left-1/2 top-[1.15rem] size-6 -translate-x-1/2 cursor-ew-resize touch-none rounded-full border-2 border-primary/60 bg-background shadow-[0_1px_3px_hsl(var(--foreground)/0.18)] transition-[transform,background-color,border-color] hover:scale-110 hover:border-primary hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:opacity-60"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      setActiveBoundary(index)
                    }}
                    onPointerMove={(event) =>
                      queuePointerMove(index, event.clientX)
                    }
                    onPointerUp={finishPointerMove}
                    onPointerCancel={finishPointerMove}
                    onLostPointerCapture={finishPointerMove}
                    onFocus={() => setActiveBoundary(index)}
                    onBlur={() =>
                      setActiveBoundary((current) =>
                        current === index ? null : current,
                      )
                    }
                    onKeyDown={(event) => {
                      const step = allocationStep(mode, allocation.target)
                      if (
                        event.key === 'ArrowLeft' ||
                        event.key === 'ArrowDown'
                      ) {
                        event.preventDefault()
                        updateBoundary(index, boundary.position - step)
                      }
                      if (
                        event.key === 'ArrowRight' ||
                        event.key === 'ArrowUp'
                      ) {
                        event.preventDefault()
                        updateBoundary(index, boundary.position + step)
                      }
                      if (event.key === 'Home') {
                        event.preventDefault()
                        updateBoundary(index, boundary.minimum)
                      }
                      if (event.key === 'End') {
                        event.preventDefault()
                        updateBoundary(index, boundary.maximum)
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
                return `${participantById.get(left.id)?.name ?? left.id} ${formatUnit(left.value)} · ${participantById.get(right.id)?.name ?? right.id} ${formatUnit(right.value)}`
              })()}
            </div>
          )}
        </div>
      )}

      {editable && allocationTarget < rows.length && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t('unavailableAmount')}
        </p>
      )}
      {editable && resizeConflict && allocation && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          role="alert"
        >
          <p className="text-sm text-destructive">{t('allocationConflict')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const scaled = scaleAllocationToTarget(
                unlockAllAllocationBoundaries(allocation),
                allocationTarget,
              )
              if (scaled.ok) {
                setResizeConflict(false)
                emitAllocation(scaled.state)
              }
            }}
          >
            {t('scaleToTotal')}
          </Button>
        </div>
      )}

      <div className="divide-y border-y">
        {participants.map((participant) => {
          const row = rowByParticipant.get(participant.id)
          const entry = entryById.get(participant.id)
          const checked = !!row
          const value = currentValue(participant.id)
          const index = entryIndexById.get(participant.id) ?? -1
          const controllingBoundary =
            index >= 0 && allocation && allocation.entries.length > 1
              ? index < allocation.entries.length - 1
                ? index
                : index - 1
              : -1
          const controllingKey =
            controllingBoundary >= 0 && allocation
              ? allocationBoundaryKey(
                  allocation.entries[controllingBoundary].id,
                  allocation.entries[controllingBoundary + 1].id,
                )
              : ''
          const inputLocked =
            !!controllingKey && !!allocation?.boundaryLocks?.[controllingKey]
          const preview = checked
            ? (amountPreviews.get(participant.id) ?? null)
            : null
          return (
            <div key={participant.id} className="py-2.5">
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={checked}
                  disabled={readOnly || (checked && rows.length === 1)}
                  onCheckedChange={(next) =>
                    toggleParticipant(participant.id, next === true)
                  }
                  aria-label={participant.name}
                />
                <ParticipantAvatar participant={participant} size="sm" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {participant.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {participant.pending && pendingLabel
                      ? `${pendingLabel} · `
                      : ''}
                    {preview}
                  </span>
                </div>
                {checked && mode === 'BY_SHARES' && (
                  <div className="flex items-center rounded-full border bg-background p-0.5 shadow-sm">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 rounded-full"
                      disabled={readOnly || Number(row?.shares) <= 1}
                      aria-label={t('decreaseShares', {
                        name: participant.name,
                      })}
                      onClick={() =>
                        onRowsChange(
                          rows.map((candidate) =>
                            candidate.participant === participant.id
                              ? {
                                  ...candidate,
                                  shares: Math.max(
                                    1,
                                    Math.round(candidate.shares) - 1,
                                  ),
                                }
                              : candidate,
                          ),
                          updateOptions,
                        )
                      }
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      className="h-9 w-12 border-0 bg-transparent px-1 text-center font-semibold tabular-nums shadow-none focus-visible:ring-0"
                      type="number"
                      min={1}
                      step={1}
                      disabled={readOnly}
                      value={Math.max(1, Math.round(row?.shares ?? 1))}
                      aria-label={`${participant.name} ${t('shares')}`}
                      onChange={(event) => {
                        const next = Math.max(
                          1,
                          Math.round(Number(event.target.value) || 1),
                        )
                        onRowsChange(
                          rows.map((candidate) =>
                            candidate.participant === participant.id
                              ? { ...candidate, shares: next }
                              : candidate,
                          ),
                          updateOptions,
                        )
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 rounded-full"
                      disabled={readOnly}
                      aria-label={t('increaseShares', {
                        name: participant.name,
                      })}
                      onClick={() =>
                        onRowsChange(
                          rows.map((candidate) =>
                            candidate.participant === participant.id
                              ? {
                                  ...candidate,
                                  shares: Math.round(candidate.shares) + 1,
                                }
                              : candidate,
                          ),
                          updateOptions,
                        )
                      }
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                )}
                {checked && mode === 'EVENLY' && (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {preview}
                  </span>
                )}
                {checked && editable && mode !== 'BY_SHARES' && entry && (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-9 w-28 text-right tabular-nums"
                      inputMode="decimal"
                      value={
                        inputValues[participant.id] ??
                        formatUnit(value).replace(/[^0-9.,-]/g, '')
                      }
                      disabled={readOnly || inputLocked}
                      aria-label={t('setValue', {
                        name: participant.name,
                        kind: t(
                          mode === 'BY_PERCENTAGE' ? 'percentage' : 'amount',
                        ),
                      })}
                      aria-invalid={!!inputErrors[participant.id]}
                      onChange={(event) =>
                        setInputValue(participant.id, event.target.value)
                      }
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitParticipantValue(participant.id)
                        }
                        if (event.key === 'Escape') {
                          setInputValues((current) => ({
                            ...current,
                            [participant.id]: '',
                          }))
                          setInputErrors((current) => ({
                            ...current,
                            [participant.id]: '',
                          }))
                        }
                      }}
                      onBlur={() => commitParticipantValue(participant.id)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {mode === 'BY_PERCENTAGE' ? '%' : currency.symbol}
                    </span>
                    {inputLocked ? (
                      <Lock
                        className="size-3.5 text-muted-foreground"
                        aria-label={t('locked')}
                      />
                    ) : (
                      <Check
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )}
              </div>
              {inputErrors[participant.id] && (
                <p className="ml-[5.5rem] mt-1 text-right text-xs text-destructive">
                  {inputErrors[participant.id]}
                </p>
              )}
              {mode === 'BY_SHARES' && checked && (
                <div
                  className="ml-[5.5rem] mt-1 flex h-1.5 max-w-40 gap-0.5"
                  aria-hidden="true"
                >
                  {Array.from({
                    length: Math.min(
                      12,
                      Math.max(1, Math.round(row?.shares ?? 1)),
                    ),
                  }).map((_, index) => (
                    <span
                      key={index}
                      className={cn(
                        'flex-1 rounded-full',
                        PARTICIPANT_SEGMENT_COLORS[
                          (participantIndexById.get(participant.id) ?? 0) %
                            PARTICIPANT_SEGMENT_COLORS.length
                        ],
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {mode === 'BY_SHARES' && rows.length > 0 && (
        <p className="mt-2 text-right text-xs text-muted-foreground">
          {shareTotal} {t('shares')}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}

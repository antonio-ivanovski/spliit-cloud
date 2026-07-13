import { useLocale } from '@/i18n/react'
import { amountAsMinorUnits } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addAllocationEntry,
  allocationBoundaries,
  allocationStep,
  previewAllocationBoundary,
  quantizeAllocationPosition,
  removeAllocationEntry,
  resetAllocationEqually,
  resizeAllocationTarget,
  scaleAllocationToTarget,
  setAllocationParticipantValue,
  type AllocationState,
} from '../allocation-engine'
import type { VisualSplitParticipant, VisualSplitRow } from './types'
import { VisualSplitConflictBanner } from './visual-split-conflict-banner'
import { VisualSplitHeader } from './visual-split-header'
import { VisualSplitParticipantRow } from './visual-split-participant-row'
import { VisualSplitRail, type RailRow } from './visual-split-rail'
import { VisualSplitSharesControl } from './visual-split-shares-control'
import {
  allocationRows,
  buildAllocation,
  formatUnit,
  previewOptions,
  rowsSignature,
  unitValue,
  updateOptions,
  type AllocationUpdateOptions,
} from './visual-split-utils'

export type { VisualSplitParticipant, VisualSplitRow } from './types'

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
  const railRows: RailRow[] = useMemo(
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
    const desired = unitValue(mode, Number(raw), currency)
    if (!Number.isFinite(desired) || desired < 1) {
      setInputErrors((current) => ({
        ...current,
        [participantId]: t('permittedRange', {
          minimum: formatUnit(mode, 1, currency, locale, t('shares')),
          maximum: formatUnit(
            mode,
            allocation.target - allocation.entries.length + 1,
            currency,
            locale,
            t('shares'),
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
          minimum: formatUnit(mode, 1, currency, locale, t('shares')),
          maximum: formatUnit(
            mode,
            allocation.target - allocation.entries.length + 1,
            currency,
            locale,
            t('shares'),
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
      `${leftName} ${formatUnit(mode, left.value, currency, locale, t('shares'))}, ${rightName} ${formatUnit(mode, right.value, currency, locale, t('shares'))}`,
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

  const handleParticipantSharesChange = (
    participantId: string,
    nextShares: number,
  ) => {
    onRowsChange(
      rows.map((candidate) =>
        candidate.participant === participantId
          ? { ...candidate, shares: nextShares }
          : candidate,
      ),
      updateOptions,
    )
  }

  const clearInput = (participantId: string) => {
    setInputValues((current) => ({ ...current, [participantId]: '' }))
    setInputErrors((current) => ({ ...current, [participantId]: '' }))
  }

  const currentValue = (id: string) =>
    entryById.get(id)?.value ??
    unitValue(mode, rowByParticipant.get(id)?.shares ?? 1, currency)

  const handleResetEqually = () => {
    if (!allocation) return
    const result = resetAllocationEqually(allocation)
    if (result.ok) emitAllocation(result.state)
  }

  const handleScaleToTotal = () => {
    if (!allocation) return
    const scaled = scaleAllocationToTarget(allocation, allocationTarget)
    if (scaled.ok) {
      setResizeConflict(false)
      emitAllocation(scaled.state)
    }
  }

  return (
    <div
      className="mt-4 min-w-0 pt-4"
      data-testid={`visual-split-${mode.toLowerCase()}`}
    >
      <VisualSplitHeader
        readOnly={readOnly}
        editable={editable}
        hasAllocation={!!allocation}
        selectedCount={rows.length}
        participantCount={participants.length}
        selectAllLabel={selectAllLabel}
        onSelectAll={selectAllParticipants}
        onResetEqually={handleResetEqually}
      />

      {mode === 'BY_SHARES' && rows.length > 0 && (
        <VisualSplitSharesControl
          readOnly={readOnly}
          selectedCount={rows.length}
          shareTotal={shareTotal}
          shareTargetInput={shareTargetInput}
          onShareTargetInputChange={setShareTargetInput}
          onShareTargetInputFocus={() => {
            shareTargetFocusedRef.current = true
          }}
          onShareTargetInputBlur={() => {
            shareTargetFocusedRef.current = false
            commitShareTarget()
          }}
          onShareTargetInputKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitShareTarget()
            }
            if (event.key === 'Escape') {
              setShareTargetInput(String(shareTotal))
            }
          }}
          onPresetClick={resizeShares}
        />
      )}

      {railRows.length > 0 && (
        <VisualSplitRail
          mode={mode}
          currency={currency}
          readOnly={readOnly}
          editable={editable}
          railRef={railRef}
          railRows={railRows}
          allocation={allocation}
          boundaries={boundaries}
          activeBoundary={activeBoundary}
          participantById={participantById}
          onSetActiveBoundary={setActiveBoundary}
          onQueuePointerMove={queuePointerMove}
          onFinishPointerMove={finishPointerMove}
          onUpdateBoundary={updateBoundary}
        />
      )}

      <VisualSplitConflictBanner
        editable={editable}
        hasAllocation={!!allocation}
        allocationTarget={allocationTarget}
        selectedCount={rows.length}
        resizeConflict={resizeConflict}
        onScaleToTotal={handleScaleToTotal}
      />

      <div className="divide-y border-y">
        {participants.map((participant) => {
          const row = rowByParticipant.get(participant.id)
          const entry = entryById.get(participant.id)
          const checked = !!row
          const value = currentValue(participant.id)
          const preview = checked
            ? (amountPreviews.get(participant.id) ?? null)
            : null
          return (
            <VisualSplitParticipantRow
              key={participant.id}
              participant={participant}
              mode={mode}
              currency={currency}
              readOnly={readOnly}
              editable={editable}
              checked={checked}
              isOnlySelected={checked && rows.length === 1}
              value={value}
              preview={preview}
              row={row}
              entry={entry}
              inputValue={inputValues[participant.id]}
              inputError={inputErrors[participant.id]}
              pendingLabel={pendingLabel}
              onToggle={toggleParticipant}
              onSetInputValue={setInputValue}
              onCommitParticipantValue={commitParticipantValue}
              onClearInput={clearInput}
              onParticipantSharesChange={handleParticipantSharesChange}
            />
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

export const PERCENTAGE_ALLOCATION_TOTAL = 10_000

/** Coarse knob presets keep pointer updates useful without flooding the form. */
export const PERCENTAGE_ALLOCATION_STEP = 10 // 0.1 percentage points

export const DEFAULT_SHARE_TOTAL_PRESETS = [5, 10, 20] as const

export type ShareTotalPreset = (typeof DEFAULT_SHARE_TOTAL_PRESETS)[number]

export type AllocationStepMode =
  'BY_PERCENTAGE' | 'BY_AMOUNT' | 'BY_SHARES' | 'EVENLY'

/**
 * Return the share-total choices shown above the BY_SHARES splitter.
 * A custom current total is kept in the list so switching modes never hides it.
 */
export function shareTotalOptions(current?: number): number[] {
  const options: number[] = [...DEFAULT_SHARE_TOTAL_PRESETS]
  if (
    current != null &&
    Number.isSafeInteger(current) &&
    current > 0 &&
    !options.some((option) => option === current)
  ) {
    options.push(current)
  }
  return options
}

/** The smallest useful movement for a visual boundary in allocation units. */
export function allocationStep(
  mode: AllocationStepMode,
  target: number,
): number {
  if (mode === 'BY_PERCENTAGE') return PERCENTAGE_ALLOCATION_STEP
  if (mode === 'BY_SHARES' || mode === 'EVENLY') return 1
  if (target < 1_000) return 1
  if (target < 100_000) return 10
  if (target < 10_000_000) return 100
  return 1_000
}

/** Snap a boundary to a coarse step while preserving its legal range. */
export function quantizeAllocationPosition(
  position: number,
  step: number,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const safeStep = Number.isSafeInteger(step) && step > 0 ? step : 1
  const rounded = Number.isFinite(position)
    ? Math.round(position / safeStep) * safeStep
    : minimum
  return Math.min(maximum, Math.max(minimum, rounded))
}

export type AllocationEntry = {
  id: string
  value: number
  locked: boolean
}

export type AllocationState = {
  target: number
  entries: AllocationEntry[]
  /** Boundary locks are keyed by the two adjacent participant ids. */
  boundaryLocks?: Record<string, boolean>
}

export type AllocationBoundary = {
  index: number
  key: string
  leftId: string
  rightId: string
  position: number
  minimum: number
  maximum: number
  locked: boolean
}

export type AllocationFailureReason =
  | 'DUPLICATE_PARTICIPANT'
  | 'EMPTY_ALLOCATION'
  | 'INVALID_TARGET'
  | 'INSUFFICIENT_TOTAL'
  | 'INVALID_VALUE'
  | 'PARTICIPANT_NOT_FOUND'
  | 'VALUE_OUT_OF_RANGE'
  | 'LAST_FLEXIBLE'
  | 'LAST_PARTICIPANT'
  | 'LOCKED_BOUNDARY'
  | 'LOCKED_TOTAL_CONFLICT'

export type AllocationResult =
  | { ok: true; state: AllocationState }
  | {
      ok: false
      reason: AllocationFailureReason
      participantId?: string
      minimum?: number
      maximum?: number
      minimumTotal?: number
    }

export type InitialAllocationEntry = {
  id: string
  value?: number
  locked?: boolean
}

type WeightedEntry = { index: number; weight: number }

function isUnit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function cloneState(state: AllocationState): AllocationState {
  return {
    target: state.target,
    entries: state.entries.map((entry) => ({ ...entry })),
    boundaryLocks: { ...(state.boundaryLocks ?? {}) },
  }
}

/** A stable, opaque key for the boundary between two adjacent participants. */
export function allocationBoundaryKey(leftId: string, rightId: string): string {
  return JSON.stringify([leftId, rightId])
}

export const getAllocationBoundaryKey = allocationBoundaryKey
export const boundaryKey = allocationBoundaryKey

function boundaryIndex(
  state: AllocationState,
  reference: number | string,
): number {
  if (typeof reference === 'number') {
    return reference >= 0 && reference < state.entries.length - 1
      ? reference
      : -1
  }
  return state.entries.findIndex(
    (entry, index) =>
      index < state.entries.length - 1 &&
      allocationBoundaryKey(entry.id, state.entries[index + 1].id) ===
        reference,
  )
}

function cumulativeValues(state: AllocationState): number[] {
  const result: number[] = []
  let total = 0
  for (const entry of state.entries) {
    total += entry.value
    result.push(total)
  }
  return result
}

export function allocationBoundaries(
  state: AllocationState,
): AllocationBoundary[] {
  const cumulative = cumulativeValues(state)
  return state.entries.slice(0, -1).map((entry, index) => {
    const key = allocationBoundaryKey(entry.id, state.entries[index + 1].id)
    return {
      index,
      key,
      leftId: entry.id,
      rightId: state.entries[index + 1].id,
      position: cumulative[index],
      // A boundary may never cross either neighboring boundary, even when
      // those boundaries are currently flexible. Keeping these bounds tied to
      // the current cumulative positions prevents a move from creating a
      // negative segment or reordering the participant rail.
      minimum: index === 0 ? 1 : cumulative[index - 1] + 1,
      maximum:
        index === state.entries.length - 2
          ? state.target - 1
          : cumulative[index + 1] - 1,
      locked: state.boundaryLocks?.[key] === true,
    }
  })
}

function minimumTotalForBoundaryLocks(state: AllocationState): number {
  const boundaries = allocationBoundaries(state).filter(
    (boundary) => boundary.locked,
  )
  let minimum = state.entries.length
  for (const boundary of boundaries) {
    minimum = Math.max(
      minimum,
      boundary.position + (state.entries.length - boundary.index - 1),
    )
  }
  return minimum
}

/** Redistribute each interval bounded by locked cumulative boundaries. */
function redistributeBoundaryState(state: AllocationState): AllocationResult {
  if (state.entries.length === 0) {
    return { ok: false, reason: 'EMPTY_ALLOCATION' }
  }
  if (state.target < state.entries.length) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_TOTAL',
      minimumTotal: Math.max(
        state.entries.length,
        minimumTotalForBoundaryLocks(state),
      ),
    }
  }

  const locked = allocationBoundaries(state)
    .filter((boundary) => boundary.locked)
    .sort((a, b) => a.index - b.index)
  let startIndex = 0
  let startPosition = 0
  const values = state.entries.map((entry) => entry.value)
  const intervals = [
    ...locked.map((boundary) => ({
      endIndex: boundary.index,
      endPosition: boundary.position,
    })),
    { endIndex: state.entries.length - 1, endPosition: state.target },
  ]

  for (const interval of intervals) {
    const count = interval.endIndex - startIndex + 1
    const intervalTarget = interval.endPosition - startPosition
    if (intervalTarget < count) {
      return {
        ok: false,
        reason: 'LOCKED_TOTAL_CONFLICT',
        minimumTotal: minimumTotalForBoundaryLocks(state),
      }
    }
    const distributed = distributeWithMinimum(
      state.entries
        .slice(startIndex, interval.endIndex + 1)
        .map((entry, offset) => ({
          index: startIndex + offset,
          weight: entry.value,
        })),
      intervalTarget,
    )
    if (!distributed) {
      return {
        ok: false,
        reason: 'LOCKED_TOTAL_CONFLICT',
        minimumTotal: minimumTotalForBoundaryLocks(state),
      }
    }
    for (const [index, value] of distributed) values[index] = value
    startIndex = interval.endIndex + 1
    startPosition = interval.endPosition
  }

  return {
    ok: true,
    state: {
      target: state.target,
      boundaryLocks: { ...(state.boundaryLocks ?? {}) },
      entries: state.entries.map((entry, index) => ({
        ...entry,
        value: values[index],
      })),
    },
  }
}

function hamilton(entries: WeightedEntry[], target: number): number[] {
  if (entries.length === 0) return []
  // Allocation state is integer based. Round at this seam as a defensive
  // boundary so a display float can never reach BigInt conversion below.
  const weights = entries.map((entry) =>
    Number.isFinite(entry.weight) ? Math.max(0, Math.round(entry.weight)) : 0,
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const normalized = totalWeight === 0 ? weights.map(() => 1) : weights
  const denominator = BigInt(
    normalized.reduce((sum, weight) => sum + weight, 0),
  )
  const values = normalized.map((weight) =>
    Number((BigInt(target) * BigInt(weight)) / denominator),
  )
  const remainders = normalized.map((weight, index) => ({
    index,
    remainder: (BigInt(target) * BigInt(weight)) % denominator,
  }))
  const remaining = target - values.reduce((sum, value) => sum + value, 0)
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index
    return a.remainder > b.remainder ? -1 : 1
  })
  for (let index = 0; index < remaining; index += 1) {
    values[remainders[index].index] += 1
  }
  return values
}

function distributeWithMinimum(
  entries: WeightedEntry[],
  target: number,
  minimum = 1,
): Map<number, number> | null {
  if (target < entries.length * minimum) return null
  const result = new Map<number, number>()
  let active = [...entries]
  let remaining = target

  while (active.length > 0) {
    const values = hamilton(active, remaining)
    const belowMinimum = active.filter((_, index) => values[index] < minimum)
    if (belowMinimum.length === 0) {
      active.forEach((entry, index) => result.set(entry.index, values[index]))
      return result
    }
    const clamped = new Set(belowMinimum.map((entry) => entry.index))
    for (const entry of belowMinimum) result.set(entry.index, minimum)
    remaining -= belowMinimum.length * minimum
    active = active.filter((entry) => !clamped.has(entry.index))
  }

  return result
}

function redistributeFlexible(
  state: AllocationState,
  weights = state.entries.map((entry) => entry.value),
): AllocationResult {
  const lockedTotal = state.entries.reduce(
    (sum, entry) => sum + (entry.locked ? entry.value : 0),
    0,
  )
  const flexible = state.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.locked)
  const available = state.target - lockedTotal
  const distributed = distributeWithMinimum(
    flexible.map(({ index }) => ({ index, weight: weights[index] ?? 0 })),
    available,
  )
  if (!distributed) {
    return {
      ok: false,
      reason: 'LOCKED_TOTAL_CONFLICT',
      minimumTotal: lockedTotal + flexible.length,
    }
  }
  return {
    ok: true,
    state: {
      target: state.target,
      boundaryLocks: { ...(state.boundaryLocks ?? {}) },
      entries: state.entries.map((entry, index) => ({
        ...entry,
        value: entry.locked
          ? entry.value
          : (distributed.get(index) ?? entry.value),
      })),
    },
  }
}

export function createAllocation(
  target: number,
  entries: readonly InitialAllocationEntry[],
): AllocationResult {
  if (!isUnit(target)) return { ok: false, reason: 'INVALID_TARGET' }
  if (entries.length === 0) return { ok: false, reason: 'EMPTY_ALLOCATION' }
  if (target < entries.length) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_TOTAL',
      minimumTotal: entries.length,
    }
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    return { ok: false, reason: 'DUPLICATE_PARTICIPANT' }
  }
  if (entries.some((entry) => entry.value != null && !isUnit(entry.value))) {
    return { ok: false, reason: 'INVALID_VALUE' }
  }
  if (entries.every((entry) => entry.locked)) {
    return { ok: false, reason: 'LAST_FLEXIBLE' }
  }
  return redistributeFlexible({
    target,
    boundaryLocks: {},
    entries: entries.map((entry) => ({
      id: entry.id,
      value: entry.value ?? 1,
      locked: entry.locked ?? false,
    })),
  })
}

function setParticipantValue(
  state: AllocationState,
  participantId: string,
  value: number,
  commit: boolean,
): AllocationResult {
  if (!isUnit(value) || value < 1) {
    return { ok: false, reason: 'INVALID_VALUE', participantId }
  }
  const index = state.entries.findIndex((entry) => entry.id === participantId)
  if (index < 0)
    return { ok: false, reason: 'PARTICIPANT_NOT_FOUND', participantId }
  const selected = state.entries[index]
  const flexibleCount = state.entries.filter((entry) => !entry.locked).length
  if (!selected.locked && flexibleCount === 1) {
    return { ok: false, reason: 'LAST_FLEXIBLE', participantId }
  }
  const lockedOtherTotal = state.entries.reduce(
    (sum, entry, entryIndex) =>
      sum + (entryIndex !== index && entry.locked ? entry.value : 0),
    0,
  )
  const otherFlexibleCount = state.entries.filter(
    (entry, entryIndex) => entryIndex !== index && !entry.locked,
  ).length
  const maximum = state.target - lockedOtherTotal - otherFlexibleCount
  if (value > maximum) {
    return {
      ok: false,
      reason: 'VALUE_OUT_OF_RANGE',
      participantId,
      minimum: 1,
      maximum,
    }
  }
  const next = cloneState(state)
  next.entries[index] = { ...next.entries[index], value, locked: true }
  const result = redistributeFlexible(next)
  if (!result.ok || commit) return result
  result.state.entries[index].locked = selected.locked
  return result
}

export function previewAllocationValue(
  dragStartState: AllocationState,
  participantId: string,
  value: number,
): AllocationResult {
  return setParticipantValue(dragStartState, participantId, value, false)
}

export function setAllocationValue(
  state: AllocationState,
  participantId: string,
  value: number,
): AllocationResult {
  return setParticipantValue(state, participantId, value, true)
}

function setBoundaryValue(
  state: AllocationState,
  reference: number | string,
  position: number,
): AllocationResult {
  const index = boundaryIndex(state, reference)
  if (index < 0) {
    return {
      ok: false,
      reason: 'PARTICIPANT_NOT_FOUND',
      participantId: typeof reference === 'string' ? reference : undefined,
    }
  }
  const boundary = allocationBoundaries(state)[index]
  if (boundary.locked) {
    return { ok: false, reason: 'LOCKED_BOUNDARY', participantId: boundary.key }
  }
  if (!isUnit(position)) {
    return { ok: false, reason: 'INVALID_VALUE', participantId: boundary.key }
  }
  if (position < boundary.minimum || position > boundary.maximum) {
    return {
      ok: false,
      reason: 'VALUE_OUT_OF_RANGE',
      participantId: boundary.key,
      minimum: boundary.minimum,
      maximum: boundary.maximum,
    }
  }

  const next = cloneState(state)
  const total = next.entries[index].value + next.entries[index + 1].value
  let before = 0
  for (let entryIndex = 0; entryIndex < index; entryIndex += 1) {
    before += next.entries[entryIndex].value
  }
  next.entries[index].value = position - before
  next.entries[index + 1].value = total - next.entries[index].value
  return { ok: true, state: next }
}

/** Preview a cumulative boundary move without changing any lock state. */
export function previewAllocationBoundary(
  state: AllocationState,
  reference: number | string,
  position: number,
): AllocationResult {
  return setBoundaryValue(state, reference, position)
}

/** Commit a cumulative boundary move. A move itself does not implicitly lock. */
export function setAllocationBoundary(
  state: AllocationState,
  reference: number | string,
  position: number,
): AllocationResult {
  return setBoundaryValue(state, reference, position)
}

export const previewAllocationBoundaryValue = previewAllocationBoundary
export const setAllocationBoundaryValue = setAllocationBoundary

/** Edit one participant by moving its trailing (or, for the last row, leading) boundary. */
export function setAllocationParticipantValue(
  state: AllocationState,
  participantId: string,
  value: number,
): AllocationResult {
  const index = state.entries.findIndex((entry) => entry.id === participantId)
  if (index < 0)
    return { ok: false, reason: 'PARTICIPANT_NOT_FOUND', participantId }
  if (!isUnit(value) || value < 1) {
    return { ok: false, reason: 'INVALID_VALUE', participantId }
  }
  const boundaryIndexToMove =
    index < state.entries.length - 1 ? index : index - 1
  if (boundaryIndexToMove < 0) {
    return value === state.target
      ? { ok: true, state: cloneState(state) }
      : {
          ok: false,
          reason: 'VALUE_OUT_OF_RANGE',
          participantId,
          minimum: state.target,
          maximum: state.target,
        }
  }
  let before = 0
  for (let entryIndex = 0; entryIndex < boundaryIndexToMove; entryIndex += 1) {
    before += state.entries[entryIndex].value
  }
  const position =
    index < state.entries.length - 1 ? before + value : state.target - value
  return setBoundaryValue(state, boundaryIndexToMove, position)
}

export const previewAllocationParticipantValue = setAllocationParticipantValue

export function lockAllocationBoundary(
  state: AllocationState,
  reference: number | string,
): AllocationResult {
  const index = boundaryIndex(state, reference)
  if (index < 0) {
    return {
      ok: false,
      reason: 'PARTICIPANT_NOT_FOUND',
      participantId: typeof reference === 'string' ? reference : undefined,
    }
  }
  const boundary = allocationBoundaries(state)[index]
  const next = cloneState(state)
  next.boundaryLocks = { ...(next.boundaryLocks ?? {}), [boundary.key]: true }
  return { ok: true, state: next }
}

export function unlockAllocationBoundary(
  state: AllocationState,
  reference: number | string,
): AllocationResult {
  const index = boundaryIndex(state, reference)
  if (index < 0) {
    return {
      ok: false,
      reason: 'PARTICIPANT_NOT_FOUND',
      participantId: typeof reference === 'string' ? reference : undefined,
    }
  }
  const boundary = allocationBoundaries(state)[index]
  const next = cloneState(state)
  delete next.boundaryLocks?.[boundary.key]
  return { ok: true, state: next }
}

export function unlockAllAllocationBoundaries(
  state: AllocationState,
): AllocationState {
  return { ...cloneState(state), boundaryLocks: {} }
}

export function lockAllocationEntry(
  state: AllocationState,
  participantId: string,
): AllocationResult {
  const entry = state.entries.find(
    (candidate) => candidate.id === participantId,
  )
  if (!entry)
    return { ok: false, reason: 'PARTICIPANT_NOT_FOUND', participantId }
  if (entry.locked) return { ok: true, state: cloneState(state) }
  return setAllocationValue(state, participantId, entry.value)
}

export function unlockAllocationEntry(
  state: AllocationState,
  participantId: string,
): AllocationResult {
  const index = state.entries.findIndex((entry) => entry.id === participantId)
  if (index < 0)
    return { ok: false, reason: 'PARTICIPANT_NOT_FOUND', participantId }
  const next = cloneState(state)
  next.entries[index].locked = false
  return { ok: true, state: next }
}

export function unlockAllAllocationEntries(
  state: AllocationState,
): AllocationState {
  return {
    target: state.target,
    entries: state.entries.map((entry) => ({ ...entry, locked: false })),
  }
}

export function resetAllocationEqually(
  state: AllocationState,
): AllocationResult {
  return createAllocation(
    state.target,
    state.entries.map((entry) => ({ id: entry.id })),
  )
}

export function addAllocationEntry(
  state: AllocationState,
  participantId: string,
): AllocationResult {
  if (state.entries.some((entry) => entry.id === participantId)) {
    return { ok: false, reason: 'DUPLICATE_PARTICIPANT', participantId }
  }
  if (state.target < state.entries.length + 1) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_TOTAL',
      minimumTotal: state.entries.length + 1,
    }
  }
  const flexible = state.entries.filter((entry) => !entry.locked)
  const meanWeight = Math.max(
    1,
    Math.round(
      flexible.reduce((sum, entry) => sum + entry.value, 0) / flexible.length,
    ),
  )
  const next: AllocationState = {
    target: state.target,
    boundaryLocks: { ...(state.boundaryLocks ?? {}) },
    entries: [
      ...state.entries.map((entry) => ({ ...entry })),
      { id: participantId, value: meanWeight, locked: false },
    ],
  }
  if (Object.keys(state.boundaryLocks ?? {}).length > 0) {
    return redistributeBoundaryState(next)
  }
  return redistributeFlexible(next)
}

export function removeAllocationEntry(
  state: AllocationState,
  participantId: string,
): AllocationResult {
  const index = state.entries.findIndex((entry) => entry.id === participantId)
  if (index < 0)
    return { ok: false, reason: 'PARTICIPANT_NOT_FOUND', participantId }
  if (state.entries.length === 1) {
    return { ok: false, reason: 'LAST_PARTICIPANT', participantId }
  }
  const boundaryMode = Object.keys(state.boundaryLocks ?? {}).length > 0
  const next = cloneState(state)
  next.entries.splice(index, 1)
  if (boundaryMode) {
    const validKeys = new Set(
      next.entries
        .slice(0, -1)
        .map((entry, entryIndex) =>
          allocationBoundaryKey(entry.id, next.entries[entryIndex + 1].id),
        ),
    )
    next.boundaryLocks = Object.fromEntries(
      Object.entries(next.boundaryLocks ?? {}).filter(([key]) =>
        validKeys.has(key),
      ),
    )
    return redistributeBoundaryState(next)
  }
  if (next.entries.every((entry) => entry.locked)) {
    const replacementIndex = Math.min(index, next.entries.length - 1)
    next.entries[replacementIndex].locked = false
  }
  return redistributeFlexible(next)
}

export function resizeAllocationTarget(
  state: AllocationState,
  target: number,
): AllocationResult {
  if (!isUnit(target)) return { ok: false, reason: 'INVALID_TARGET' }
  if (target < state.entries.length) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_TOTAL',
      minimumTotal: state.entries.length,
    }
  }
  const next = { ...cloneState(state), target }
  if (Object.keys(state.boundaryLocks ?? {}).length > 0) {
    return redistributeBoundaryState(next)
  }
  return redistributeFlexible(next)
}

export function scaleAllocationToTarget(
  state: AllocationState,
  target: number,
): AllocationResult {
  return createAllocation(
    target,
    state.entries.map((entry) => ({ id: entry.id, value: entry.value })),
  )
}

export function percentageToBasisPoints(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0
  return Math.round(percentage * 100)
}

export function basisPointsToPercentage(basisPoints: number): number {
  return basisPoints / 100
}

export function majorToMinorUnits(
  value: number,
  decimalDigits: number,
): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10 ** decimalDigits)
}

export function minorToMajorUnits(
  value: number,
  decimalDigits: number,
): number {
  return value / 10 ** decimalDigits
}

export function toAllocationMagnitude(value: number): number {
  return Math.abs(Math.trunc(value))
}

export function fromAllocationMagnitude(
  magnitude: number,
  signedTotal: number,
): number {
  return signedTotal < 0 ? -magnitude : magnitude
}

import { describe, expect, it } from 'vitest'
import {
  addAllocationEntry,
  allocationBoundaries,
  allocationBoundaryKey,
  allocationStep,
  createAllocation,
  fromAllocationMagnitude,
  lockAllocationBoundary,
  majorToMinorUnits,
  PERCENTAGE_ALLOCATION_TOTAL,
  percentageToBasisPoints,
  previewAllocationBoundary,
  previewAllocationValue,
  quantizeAllocationPosition,
  removeAllocationEntry,
  resizeAllocationTarget,
  setAllocationBoundary,
  setAllocationValue,
  shareTotalOptions,
  unlockAllAllocationBoundaries,
  unlockAllAllocationEntries,
  unlockAllocationBoundary,
} from './allocation-engine'

function stateOf(result: ReturnType<typeof createAllocation>) {
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

function values(state: ReturnType<typeof stateOf>) {
  return state.entries.map((entry) => entry.value)
}

describe('allocation locking', () => {
  it('locks edits and redistributes the flexible remainder in stable order', () => {
    let state = stateOf(
      createAllocation(PERCENTAGE_ALLOCATION_TOTAL, [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'd' },
      ]),
    )
    const first = setAllocationValue(state, 'a', 3000)
    expect(first.ok && values(first.state)).toEqual([3000, 2334, 2333, 2333])
    if (!first.ok) return
    state = first.state
    const second = setAllocationValue(state, 'b', 4000)
    expect(second.ok && values(second.state)).toEqual([3000, 4000, 1500, 1500])
    expect(
      second.ok && second.state.entries.map((entry) => entry.locked),
    ).toEqual([true, true, false, false])
  })

  it('is predictable when editing from the right first', () => {
    let state = stateOf(
      createAllocation(10_000, [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'd' },
      ]),
    )
    const right = setAllocationValue(state, 'd', 4000)
    expect(right.ok && values(right.state)).toEqual([2000, 2000, 2000, 4000])
    if (!right.ok) return
    state = right.state
    const middle = setAllocationValue(state, 'b', 3000)
    expect(middle.ok && values(middle.state)).toEqual([1500, 3000, 1500, 4000])
  })

  it('keeps the sole flexible entry as an uneditable remainder', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 30, locked: true },
        { id: 'b', value: 70 },
      ]),
    )
    expect(setAllocationValue(state, 'b', 60)).toMatchObject({
      ok: false,
      reason: 'LAST_FLEXIBLE',
    })
  })

  it('derives drag previews from the supplied snapshot without committing a lock', () => {
    const start = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const preview = previewAllocationValue(start, 'a', 50)
    expect(preview.ok && values(preview.state)).toEqual([50, 25, 25])
    expect(preview.ok && preview.state.entries[0].locked).toBe(false)
    expect(values(start)).toEqual([34, 33, 33])
  })

  it('unlock-all preserves the current distribution', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 30, locked: true },
        { id: 'b', value: 35 },
        { id: 'c', value: 35 },
      ]),
    )
    const unlocked = unlockAllAllocationEntries(state)
    expect(values(unlocked)).toEqual([30, 35, 35])
    expect(unlocked.entries.every((entry) => !entry.locked)).toBe(true)
  })
})

describe('allocation lifecycle', () => {
  it('uses stable largest-remainder order', () => {
    expect(
      values(
        stateOf(
          createAllocation(10_000, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
        ),
      ),
    ).toEqual([3334, 3333, 3333])
  })

  it('rejects totals below the one-unit-per-participant minimum', () => {
    expect(
      createAllocation(2, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    ).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_TOTAL',
      minimumTotal: 3,
    })
  })

  it('adds a participant using the mean flexible weight', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 25 },
        { id: 'b', value: 75 },
      ]),
    )
    const added = addAllocationEntry(state, 'c')
    expect(added.ok && values(added.state)).toEqual([17, 50, 33])
  })

  it('unlocks the nearest next participant when removing the sole remainder', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 20, locked: true },
        { id: 'b', value: 30 },
        { id: 'c', value: 50, locked: true },
      ]),
    )
    const removed = removeAllocationEntry(state, 'b')
    expect(removed.ok && removed.state.entries).toEqual([
      { id: 'a', value: 20, locked: true },
      { id: 'c', value: 80, locked: false },
    ])
  })

  it('preserves locked values while resizing and reports conflicts explicitly', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 80, locked: true },
        { id: 'b', value: 10 },
        { id: 'c', value: 10 },
      ]),
    )
    const resized = resizeAllocationTarget(state, 120)
    expect(resized.ok && values(resized.state)).toEqual([80, 20, 20])
    expect(resizeAllocationTarget(state, 81)).toEqual({
      ok: false,
      reason: 'LOCKED_TOTAL_CONFLICT',
      minimumTotal: 82,
    })
  })
})

describe('cumulative boundary allocation', () => {
  it('moves only the two segments adjacent to the selected boundary', () => {
    const state = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const boundary = allocationBoundaries(state)[0]
    expect(boundary.position).toBe(34)
    const moved = setAllocationBoundary(state, boundary.key, 50)
    expect(moved.ok && values(moved.state)).toEqual([50, 17, 33])
  })

  it('supports out-of-order boundary edits without redistributing distant segments', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'd' },
      ]),
    )
    const right = setAllocationBoundary(state, 2, 75)
    expect(right.ok && values(right.state)).toEqual([25, 25, 25, 25])
    if (!right.ok) return
    const left = setAllocationBoundary(right.state, 0, 40)
    expect(left.ok && values(left.state)).toEqual([40, 10, 25, 25])
  })

  it('locks a boundary by adjacent participant identity', () => {
    const state = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const key = allocationBoundaryKey('a', 'b')
    const locked = lockAllocationBoundary(state, key)
    expect(locked.ok && locked.state.boundaryLocks).toEqual({ [key]: true })
    if (!locked.ok) return
    expect(setAllocationBoundary(locked.state, key, 50)).toMatchObject({
      ok: false,
      reason: 'LOCKED_BOUNDARY',
    })
    const unlocked = unlockAllocationBoundary(locked.state, key)
    expect(unlocked.ok && unlocked.state.boundaryLocks).toEqual({})
  })

  it('never lets a boundary cross a locked neighboring boundary', () => {
    const state = stateOf(
      createAllocation(100, [
        { id: 'a', value: 30 },
        { id: 'b', value: 30 },
        { id: 'c', value: 40 },
      ]),
    )
    const locked = lockAllocationBoundary(state, 1)
    if (!locked.ok) return
    expect(setAllocationBoundary(locked.state, 0, 90)).toMatchObject({
      ok: false,
      reason: 'VALUE_OUT_OF_RANGE',
      maximum: 59,
    })
    expect(values(locked.state)).toEqual([30, 30, 40])
  })

  it('keeps locked cumulative positions while resizing', () => {
    const initial = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const locked = lockAllocationBoundary(initial, 0)
    if (!locked.ok) return
    const resized = resizeAllocationTarget(locked.state, 120)
    expect(resized.ok && values(resized.state)).toEqual([34, 43, 43])
    expect(resized.ok && allocationBoundaries(resized.state)[0].position).toBe(
      34,
    )
  })

  it('preserves boundary locks when adding and removes locks whose pair disappears', () => {
    const initial = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const locked = lockAllocationBoundary(initial, 0)
    if (!locked.ok) return
    const added = addAllocationEntry(locked.state, 'd')
    expect(added.ok && added.state.boundaryLocks).toEqual({
      [allocationBoundaryKey('a', 'b')]: true,
    })
    if (!added.ok) return
    const removed = removeAllocationEntry(added.state, 'b')
    expect(removed.ok && removed.state.boundaryLocks).toEqual({})
  })

  it('previews a boundary without changing the source or locks', () => {
    const state = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const preview = previewAllocationBoundary(state, 1, 70)
    expect(preview.ok && values(preview.state)).toEqual([34, 36, 30])
    expect(values(state)).toEqual([34, 33, 33])
    expect(preview.ok && preview.state.boundaryLocks).toEqual({})
  })

  it('clears every boundary lock without changing the distribution', () => {
    const state = stateOf(
      createAllocation(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    const first = lockAllocationBoundary(state, 0)
    if (!first.ok) return
    const second = lockAllocationBoundary(first.state, 1)
    if (!second.ok) return
    const unlocked = unlockAllAllocationBoundaries(second.state)
    expect(values(unlocked)).toEqual(values(second.state))
    expect(unlocked.boundaryLocks).toEqual({})
  })
})

describe('unit adapters', () => {
  it('maps display amounts and signed paid-by values at the boundary', () => {
    expect(majorToMinorUnits(12.345, 2)).toBe(1235)
    expect(fromAllocationMagnitude(1235, -20)).toBe(-1235)
    expect(fromAllocationMagnitude(1235, 20)).toBe(1235)
  })

  it('converts decimal percentages to integer basis points safely', () => {
    expect(percentageToBasisPoints(40.3)).toBe(4030)
    expect(percentageToBasisPoints(33.33)).toBe(3333)
    expect(percentageToBasisPoints(Number.NaN)).toBe(0)
  })

  it('uses coarse, value-aware knob steps', () => {
    expect(allocationStep('BY_PERCENTAGE', 10_000)).toBe(10)
    expect(allocationStep('BY_AMOUNT', 999)).toBe(1)
    expect(allocationStep('BY_AMOUNT', 1_000)).toBe(10)
    expect(allocationStep('BY_AMOUNT', 100_000)).toBe(100)
    expect(allocationStep('BY_AMOUNT', 10_000_000)).toBe(1_000)
  })

  it('quantizes and clamps positions deterministically', () => {
    expect(quantizeAllocationPosition(4.9, 10, 1, 99)).toBe(1)
    expect(quantizeAllocationPosition(5.1, 10, 1, 99)).toBe(10)
    expect(quantizeAllocationPosition(98, 10, 1, 95)).toBe(95)
  })

  it('exposes default share totals and preserves a custom total', () => {
    expect(shareTotalOptions()).toEqual([5, 10, 20])
    expect(shareTotalOptions(10)).toEqual([5, 10, 20])
    expect(shareTotalOptions(7)).toEqual([5, 10, 20, 7])
  })
})

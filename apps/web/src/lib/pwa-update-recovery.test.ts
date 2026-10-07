import { describe, expect, it, vi } from 'vitest'

import {
  clearRestartScrollState,
  readRestartScrollState,
  restoreRestartScroll,
  type ScrollViewport,
} from './pwa-update-recovery'

function storageWith(value: string | null) {
  return {
    getItem: vi.fn(() => value),
    removeItem: vi.fn(),
  }
}

function viewportWith(
  frames: Array<{ maxY: number }>,
  options?: { userTakesOverAt?: number },
): ScrollViewport & { writes: Array<{ x: number; y: number }> } {
  const writes: Array<{ x: number; y: number }> = []
  let position = { x: 0, y: 0 }
  let frame = 0
  let takeOver: (() => void) | null = null
  return {
    writes,
    readPosition: () => ({ ...position }),
    readMaxScroll: () => ({
      maxX: 0,
      maxY: frames[Math.min(frame, frames.length - 1)]?.maxY ?? 0,
    }),
    writePosition: (x, y) => {
      writes.push({ x, y })
      position = { x, y }
    },
    currentUrl: () => '/groups/g1',
    requestFrame: (fn) => {
      frame += 1
      if (
        options?.userTakesOverAt !== undefined &&
        frame === options.userTakesOverAt
      ) {
        takeOver?.()
      }
      fn()
    },
    onUserScroll: (listener) => {
      takeOver = listener
      return () => {
        takeOver = null
      }
    },
  }
}

describe('restart scroll recovery', () => {
  it('reads, validates, and clears restart state', () => {
    const key = 'restart-state'
    expect(
      readRestartScrollState(
        storageWith(JSON.stringify({ url: '/a', x: 0, y: 120 })),
        key,
      ),
    ).toMatchObject({ url: '/a', x: 0, y: 120 })
    expect(readRestartScrollState(storageWith(null), key)).toBeNull()
    expect(readRestartScrollState(storageWith('nope{'), key)).toBeNull()
    expect(
      readRestartScrollState(
        storageWith(JSON.stringify({ url: '/a', x: 0, y: NaN })),
        key,
      ),
    ).toBeNull()
    const storage = storageWith(JSON.stringify({ url: '/a', x: 0, y: 1 }))
    clearRestartScrollState(storage, key)
    expect(storage.removeItem).toHaveBeenCalledWith(key)
  })

  it('restores the offset once content renders', async () => {
    const viewport = viewportWith([{ maxY: 0 }, { maxY: 400 }, { maxY: 900 }])
    const restored = await restoreRestartScroll(viewport, { x: 0, y: 300 })
    expect(restored).toBe(true)
    const last = viewport.writes.at(-1)
    expect(last?.y).toBe(300)
  })

  it('settles at the reachable max when content stays short', async () => {
    const viewport = viewportWith([{ maxY: 120 }])
    const restored = await restoreRestartScroll(
      viewport,
      { x: 0, y: 900 },
      { frameBudget: 30 },
    )
    expect(restored).toBe(true)
    expect(viewport.writes.at(-1)).toEqual({ x: 0, y: 120 })
  })

  it('yields immediately when the user scrolls', async () => {
    const viewport = viewportWith([{ maxY: 0 }, { maxY: 100 }, { maxY: 900 }], {
      userTakesOverAt: 2,
    })
    const restored = await restoreRestartScroll(viewport, { x: 0, y: 300 })
    expect(restored).toBe(false)
  })

  it('gives up after the frame budget', async () => {
    let maxY = 0
    const viewport: ScrollViewport = {
      readPosition: () => ({ x: 0, y: 0 }),
      readMaxScroll: () => {
        maxY += 1
        return { maxX: 0, maxY }
      },
      writePosition: () => {},
      currentUrl: () => '/a',
      requestFrame: (fn) => fn(),
    }
    const restored = await restoreRestartScroll(
      viewport,
      { x: 0, y: 50 },
      { frameBudget: 5 },
    )
    // Unreachable target with ever-growing content: budget exhausted.
    expect(restored).toBe(false)
  })
})

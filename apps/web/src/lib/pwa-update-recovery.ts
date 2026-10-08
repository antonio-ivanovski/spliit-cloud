export type RestartScrollState = {
  url: string
  x: number
  y: number
  at: number
}

export const PWA_RESTART_RESTORE_FRAME_BUDGET = 120

/** Read a previously saved restart scroll state. Null when absent/corrupt. */
export function readRestartScrollState(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
): RestartScrollState | null {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RestartScrollState>
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null
    }
    const at =
      typeof parsed.at === 'number' && Number.isFinite(parsed.at)
        ? parsed.at
        : 0
    return { url: parsed.url, x: parsed.x, y: parsed.y, at }
  } catch {
    return null
  }
}

export function clearRestartScrollState(
  storage: Pick<Storage, 'removeItem'> | undefined,
  key: string,
): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Best-effort cleanup only.
  }
}

export type ScrollViewport = {
  readPosition: () => { x: number; y: number }
  readMaxScroll: () => { maxX: number; maxY: number }
  writePosition: (x: number, y: number) => void
  currentUrl: () => string
  requestFrame: (fn: () => void) => void
  onUserScroll?: (listener: () => void) => () => void
}

/**
 * Restore a saved scroll offset after an update reload, once per boot.
 *
 * Content renders asynchronously after boot, so a single write lands short:
 * re-assert the target while the document keeps growing, and stop when the
 * position holds, the target is unreachable after the frame budget, or the user
 * scrolls (their input wins immediately). Resolves true when the target
 * position holds.
 */
export async function restoreRestartScroll(
  viewport: ScrollViewport,
  target: { x: number; y: number },
  options?: { frameBudget?: number },
): Promise<boolean> {
  const budget = options?.frameBudget ?? PWA_RESTART_RESTORE_FRAME_BUDGET
  let userTookOver = false
  const stopListening = viewport.onUserScroll?.(() => {
    userTookOver = true
  })
  try {
    let stableFrames = 0
    let lastMaxY = -1
    for (let frame = 0; frame < budget; frame += 1) {
      if (userTookOver) return false
      const max = viewport.readMaxScroll()
      const x = Math.min(Math.max(0, target.x), Math.max(0, max.maxX))
      const y = Math.min(Math.max(0, target.y), Math.max(0, max.maxY))
      viewport.writePosition(x, y)
      await new Promise<void>((resolve) => viewport.requestFrame(resolve))
      if (userTookOver) return false
      const actual = viewport.readPosition()
      if (
        Math.abs(actual.x - target.x) < 1 &&
        Math.abs(actual.y - target.y) < 1
      ) {
        return true
      }
      // Content shorter than the saved offset: settle at the reachable max
      // once it stops growing instead of spinning the full budget. An empty
      // document never counts as stable (content has not rendered yet).
      stableFrames =
        max.maxY > 0 && max.maxY === lastMaxY ? stableFrames + 1 : 0
      lastMaxY = max.maxY
      if (stableFrames >= 10) return true
    }
    return false
  } finally {
    try {
      stopListening?.()
    } catch {
      // Listener teardown never fails restoration reporting.
    }
  }
}

export type MascotPin = {
  /** Viewport X percent (0–100) for the host center. */
  x: number
  /** Viewport Y percent (0–100) for the host center. */
  y: number
}

export type MascotDialPlacement =
  | 'bottom-end'
  | 'bottom-start'
  | 'top-end'
  | 'top-start'

const MASCOT_PIN_EVENT = 'spliit:mascot-pin-changed'
const MASCOT_PIN_PREFIX = 'mascotPin:'
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const MARGIN_PX = 8

export const MASCOT_REJECT_SELECTOR =
  '[data-app-header], [data-fixed-action-bar], [data-create-expense-fab]'

export function mascotPinKey(accountId: string) {
  return `${MASCOT_PIN_PREFIX}${accountId}`
}

export function canDragMascot() {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia(FINE_POINTER_QUERY).matches
}

export function subscribeFinePointer(callback: () => void) {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => undefined
  }
  const media = window.matchMedia(FINE_POINTER_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

let pinCache = new Map<string, MascotPin | null>()

export function readMascotPin(accountId: string | undefined): MascotPin | null {
  if (!accountId || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(mascotPinKey(accountId))
    if (!raw) {
      pinCache.set(accountId, null)
      return null
    }
    const parsed = JSON.parse(raw) as Partial<MascotPin>
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      pinCache.set(accountId, null)
      return null
    }
    const next = clampPin({ x: parsed.x, y: parsed.y })
    const prev = pinCache.get(accountId)
    if (prev && prev.x === next.x && prev.y === next.y) return prev
    pinCache.set(accountId, next)
    return next
  } catch {
    return null
  }
}

export function writeMascotPin(
  accountId: string | undefined,
  pin: MascotPin | null,
) {
  if (!accountId || typeof localStorage === 'undefined') return
  try {
    if (pin === null) {
      localStorage.removeItem(mascotPinKey(accountId))
      pinCache.set(accountId, null)
    } else {
      const next = clampPin(pin)
      localStorage.setItem(mascotPinKey(accountId), JSON.stringify(next))
      pinCache.set(accountId, next)
    }
    window.dispatchEvent(new Event(MASCOT_PIN_EVENT))
  } catch {
    // Position is a local hint; a storage failure keeps the default dock.
  }
}

export function subscribeMascotPin(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MASCOT_PIN_EVENT, callback)
  window.addEventListener('storage', callback)
  window.addEventListener('resize', callback)
  return () => {
    window.removeEventListener(MASCOT_PIN_EVENT, callback)
    window.removeEventListener('storage', callback)
    window.removeEventListener('resize', callback)
  }
}

export function clampPin(
  pin: MascotPin,
  hostWidth = 108,
  hostHeight = 118,
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight,
): MascotPin {
  const safeWidth = Math.max(viewportWidth, hostWidth + MARGIN_PX * 2)
  const safeHeight = Math.max(viewportHeight, hostHeight + MARGIN_PX * 2)
  const minX = ((hostWidth / 2 + MARGIN_PX) / safeWidth) * 100
  const maxX = ((safeWidth - hostWidth / 2 - MARGIN_PX) / safeWidth) * 100
  const minY = ((hostHeight / 2 + MARGIN_PX) / safeHeight) * 100
  const maxY = ((safeHeight - hostHeight / 2 - MARGIN_PX) / safeHeight) * 100
  return {
    x: Math.min(maxX, Math.max(minX, pin.x)),
    y: Math.min(maxY, Math.max(minY, pin.y)),
  }
}

export function pinFromClient(clientX: number, clientY: number): MascotPin {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  return clampPin({
    x: (clientX / viewportWidth) * 100,
    y: (clientY / viewportHeight) * 100,
  })
}

export function dropHitsReject(
  clientX: number,
  clientY: number,
  hostWidth: number,
  hostHeight: number,
) {
  if (typeof document === 'undefined') return false
  const hostRect = {
    left: clientX - hostWidth / 2,
    right: clientX + hostWidth / 2,
    top: clientY - hostHeight / 2,
    bottom: clientY + hostHeight / 2,
  }
  for (const node of document.querySelectorAll(MASCOT_REJECT_SELECTOR)) {
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (
      hostRect.left < rect.right &&
      hostRect.right > rect.left &&
      hostRect.top < rect.bottom &&
      hostRect.bottom > rect.top
    ) {
      return true
    }
  }
  return false
}

export function dialPlacementFromPin(
  pin: MascotPin | null,
): MascotDialPlacement {
  if (!pin) return 'bottom-end'
  const top = pin.y < 45
  const start = pin.x < 50
  if (top && start) return 'top-start'
  if (top) return 'top-end'
  if (start) return 'bottom-start'
  return 'bottom-end'
}

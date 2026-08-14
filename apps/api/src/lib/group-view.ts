import { randomBytes } from 'node:crypto'

/** Opaque route ids intentionally have the same shape as canonical group ids. */
export function generateGroupRouteId() {
  return randomBytes(16).toString('hex')
}

export function isGroupRouteId(value: string) {
  return /^[a-f0-9]{32}$/u.test(value)
}

/** Prevent pending invitation email addresses from becoming display labels. */
export function redactViewerDisplayName(name: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name) ? '' : name
}

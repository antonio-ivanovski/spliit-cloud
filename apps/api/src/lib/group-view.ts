import { randomBytes, timingSafeEqual } from 'node:crypto'

/** 256-bit URL-safe secret used as `?viewKey=` on a canonical group URL. */
export function generateGroupViewKey() {
  return randomBytes(32).toString('base64url')
}

export function groupViewKeysMatch(stored: string, candidate: string) {
  const current = Buffer.from(stored)
  const provided = Buffer.from(candidate)
  if (current.length !== provided.length) return false
  return timingSafeEqual(current, provided)
}

/** Prevent pending invitation email addresses from becoming display labels. */
export function redactViewerDisplayName(name: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name) ? '' : name
}

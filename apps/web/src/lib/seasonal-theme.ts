/**
 * Device-local seasonal appearance state.
 *
 * Halloween runs from October 30 through November 1 inclusive in the device's
 * local calendar. The opt-out is a browser preference, not an account
 * preference: it is intentionally independent of the light/dark theme and is
 * kept across years until the user turns the effects back on.
 *
 * Keep the date window and theme colors in sync with the prepaint script and
 * styles in `apps/web/index.html`.
 */

export const HALLOWEEN_DISABLED_STORAGE_KEY =
  'spliit:halloween-effects-disabled'

const BASE_THEME_COLOR_LIGHT = '#ffffff'
const BASE_THEME_COLOR_DARK = '#0c0a09'
const HALLOWEEN_THEME_COLOR_LIGHT = '#FFF0CE'
const HALLOWEEN_THEME_COLOR_DARK = '#24152F'

/** Whether the local calendar date is inside the Halloween window. */
export function isHalloweenSeason(date: Date): boolean {
  const month = date.getMonth()
  const day = date.getDate()
  return (month === 9 && day >= 30) || (month === 10 && day === 1)
}

/** Read the persisted opt-out. Missing or unreadable storage means enabled. */
export function isHalloweenDisabled(): boolean {
  try {
    return localStorage.getItem(HALLOWEEN_DISABLED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** Persist the opt-out without ever throwing when storage is unavailable. */
export function writeHalloweenDisabled(disabled: boolean): void {
  try {
    if (disabled) {
      localStorage.setItem(HALLOWEEN_DISABLED_STORAGE_KEY, 'true')
    } else {
      localStorage.removeItem(HALLOWEEN_DISABLED_STORAGE_KEY)
    }
  } catch {
    // The in-memory switch still applies for this session.
  }
}

/** Browser chrome color for the current light/dark and seasonal state. */
export function resolveThemeColor(dark: boolean, halloween: boolean): string {
  if (halloween) {
    return dark ? HALLOWEEN_THEME_COLOR_DARK : HALLOWEEN_THEME_COLOR_LIGHT
  }
  return dark ? BASE_THEME_COLOR_DARK : BASE_THEME_COLOR_LIGHT
}

/** Next local midnight, used to roll the season over without a reload. */
export function nextLocalMidnight(now: Date): Date {
  const next = new Date(now.getTime())
  next.setHours(24, 0, 0, 0)
  return next
}

/**
 * Fixed-point share units for the `BY_SHARES` split mode.
 *
 * Display shares can have up to two decimal places (the user sees `0.5`, `1.1`,
 * `25.75`). The database and the API wire format always store them as integers,
 * scaled by {@link SHARE_SCALE}: `0.5 → 50`, `1.1 → 110`.
 *
 * All other split modes continue to use their own units on the same polymorphic
 * `shares` column:
 *
 * | Owning mode     | Meaning of stored `shares`                           |
 * | --------------- | ---------------------------------------------------- |
 * | `BY_SHARES`     | Hundredths of one share (`100 = 1 displayed share`)  |
 * | `BY_PERCENTAGE` | Basis points (`10000 = 100%`), unchanged             |
 * | `BY_AMOUNT`     | Currency minor units, unchanged                      |
 * | `ITEMIZED`      | Currency minor units at the expense level, unchanged |
 * | `EVENLY`        | Inclusion marker / ignored weight, not user-visible  |
 *
 * Calculation functions (`calculateExactShares`, `calculateShares`,
 * `calculatePaidByShares`) operate on stored fixed units directly. Do not
 * divide before calling them — share ratios work with whatever scale was
 * stored, so multiplying all weights by the same constant leaves the allocation
 * unchanged.
 */

import type { SplitMode } from './enums'

export const SHARE_SCALE = 100
export const SHARE_DECIMAL_PLACES = 2
export const MIN_DISPLAY_SHARES = 0.01
export const MAX_DISPLAY_SHARES = 1_000_000
export const MAX_STORED_SHARES = MAX_DISPLAY_SHARES * SHARE_SCALE

const FIXED_UNITS_EPSILON = 1e-6

/**
 * Convert a display share (e.g. `0.5`) to its stored fixed-unit form (`50`).
 *
 * The input must be a finite positive display value in the product range
 * (`0.01–1,000,000`) with at most two decimal places. The check tolerates the
 * typical `0.1 + 0.2 !== 0.3` representation noise by comparing `value *
 * SHARE_SCALE` against the nearest integer within a small epsilon; values like
 * `1.001` (which would round to `100`) are still rejected.
 */
export function sharesAsFixedUnits(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('display share must be a finite number')
  }
  if (value < MIN_DISPLAY_SHARES) {
    throw new RangeError(
      `display share must be ≥ ${MIN_DISPLAY_SHARES} (no zero/negative shares)`,
    )
  }
  if (value > MAX_DISPLAY_SHARES) {
    throw new RangeError(`display share must be ≤ ${MAX_DISPLAY_SHARES}`)
  }
  const scaled = value * SHARE_SCALE
  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > FIXED_UNITS_EPSILON) {
    throw new RangeError(
      `display share must have at most ${SHARE_DECIMAL_PLACES} decimal places`,
    )
  }
  return rounded
}

/**
 * Convert stored fixed units back to display units.
 *
 * Stored values produced by {@link sharesAsFixedUnits} are already exact
 * hundredths, so this is a plain division with no further rounding.
 */
export function sharesAsDecimal(value: number): number {
  return value / SHARE_SCALE
}

/**
 * Display-side validation: `0.01 ≤ value ≤ 1_000_000` and at most two decimal
 * places (with epsilon tolerance for representation noise).
 */
export function isValidDisplayShare(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < MIN_DISPLAY_SHARES || value > MAX_DISPLAY_SHARES) return false
  const scaled = value * SHARE_SCALE
  return Math.abs(scaled - Math.round(scaled)) <= FIXED_UNITS_EPSILON
}

/**
 * Format a display share for the UI: at most two decimal places, with trailing
 * zeroes trimmed (`100 → "1"`, `110 → "1.1"`, `50 → "0.5"`).
 *
 * This is for human-facing display only. Use {@link sharesAsFixedUnits} and the
 * integer wire format for serialization.
 */
export function formatDisplayShares(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: SHARE_DECIMAL_PLACES,
    minimumFractionDigits: 0,
    useGrouping: false,
  }).format(value)
}

export type ShareErrorKey = 'sharesInvalid' | 'noZeroShares' | 'invalidNumber'

/**
 * Single source of truth for per-row display-share validation, shared by the
 * Zod form schema (`validateDisplayShareForMode`) and the UI row-error summary
 * (`getRowShareErrors`).
 *
 * Returns the `SchemaErrors` i18n key describing the problem, or `null` when
 * the share is acceptable. Non-finite values (`NaN`, e.g. a partial input like
 * `"-"`, and `±Infinity`, e.g. a long pasted string overflowing `Number`) are
 * reported as `invalidNumber` so they cannot silently pass both validators —
 * the schema-level `z.coerce.number()` accepts `NaN` and every numeric
 * comparison against it is false.
 *
 * `mode` must be `BY_SHARES` / `BY_PERCENTAGE` / `BY_AMOUNT`; callers guard
 * `EVENLY` / `ITEMIZED` before invoking.
 */
export function getDisplayShareErrorKey(
  value: number,
  mode: SplitMode,
  options: { allowNegative?: boolean } = {},
): ShareErrorKey | null {
  const { allowNegative = false } = options
  if (!Number.isFinite(value)) return 'invalidNumber'
  if (mode === 'BY_SHARES') {
    // One shared range/precision contract for every BY_SHARES editor:
    // 0.01–1,000,000 with at most two decimal places.
    return isValidDisplayShare(value) ? null : 'sharesInvalid'
  }
  // Zero rows are invalid in every mode (a removed participant is absent
  // from the list, not present with a zero share); signed rows are only
  // valid on deliberately signed paths (negative-expense paid-by BY_AMOUNT).
  if (value === 0) return 'noZeroShares'
  if (!allowNegative && value <= 0) return 'noZeroShares'
  return null
}

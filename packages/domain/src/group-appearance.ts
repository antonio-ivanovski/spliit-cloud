/**
 * Group appearance (emoji + color) helpers shared by the web client, API, and
 * validation schemas.
 *
 * `Group.emoji` uses an empty-string sentinel to distinguish three states:
 *
 * - `null` (SQL NULL / `undefined` in forms): undecided. The group page may offer
 *   the "groups can have an emoji" intro when the name contains one.
 * - `''`: explicitly none picked / intro dismissed. Never prompt again.
 * - Any other value: the chosen emoji.
 *
 * Always go through the helpers below instead of `??`, `||`, or truthiness
 * checks: coercing `''` to `null` (or vice versa) silently changes the prompt
 * state and is not recoverable from the UI.
 */

export const GROUP_COLOR_IDS = [
  'slate',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'pink',
  'rose',
] as const

export type GroupColorId = (typeof GROUP_COLOR_IDS)[number]

/**
 * Reference hex values for the standard color sets (Tailwind 500). Each id in
 * `GROUP_COLOR_IDS` maps to one curated swatch; groups may also store a custom
 * `#rrggbb` hex color instead. Used to render accents through a single CSS
 * custom property so standard and custom colors share one code path.
 */
export const GROUP_COLOR_HEX: Record<GroupColorId, string> = {
  slate: '#64748b',
  stone: '#78716c',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
}

/**
 * A stored group color: either one of the standard palette ids or a custom
 * `#rrggbb` hex color. Always normalize custom values with `normalizeHexColor`
 * before storing them so comparisons stay stable.
 */
export type GroupColor = GroupColorId | `#${string}`

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/

export function isGroupColorId(value: string): value is GroupColorId {
  return (GROUP_COLOR_IDS as readonly string[]).includes(value)
}

/**
 * Normalize free-form hex input: trims, tolerates a missing `#` and the
 * three-digit shorthand, lowercases, and returns null when the result is not a
 * six-digit hex color.
 */
export function normalizeHexColor(raw: string): `#${string}` | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (/^#[0-9a-f]{3}$/.test(withHash)) {
    const [r, g, b] = withHash.slice(1)
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return HEX_COLOR_PATTERN.test(withHash) ? (withHash as `#${string}`) : null
}

export function isGroupColor(value: string): value is GroupColor {
  return (
    isGroupColorId(value) || HEX_COLOR_PATTERN.test(value.trim().toLowerCase())
  )
}

/**
 * Resolve any stored color (palette id or custom hex) to the hex value used for
 * styling. Unknown values return null so callers fall back to neutral styling.
 */
export function resolveGroupColorHex(
  color: string | null | undefined,
): string | null {
  if (!color) return null
  if (isGroupColorId(color)) return GROUP_COLOR_HEX[color]
  return normalizeHexColor(color)
}

/**
 * Standard emoji choices offered in the appearance picker. These are defaults,
 * not a closed set: groups may store any single emoji (see
 * `normalizeEmojiInput` and the `emoji` schema), with the trailing "custom"
 * picker item covering the rest. Kept free of ZWJ family/profession sequences
 * and skin-tone modifiers, which render inconsistently across platforms and can
 * be split by name emoji detection.
 */
export const GROUP_EMOJI_CHOICES = [
  '🏠',
  '🏝️',
  '✈️',
  '🏔️',
  '🚗',
  '🎉',
  '🍕',
  '🍻',
  '☕',
  '💼',
  '🎓',
  '💪',
  '🎮',
  '🎬',
  '🎵',
  '📚',
  '🐶',
  '🐱',
  '🌸',
  '🌈',
  '⭐',
  '🔥',
  '💰',
  '🛒',
  '🧳',
  '🚀',
  '❤️',
  '🥂',
] as const

export type GroupEmojiChoice = (typeof GROUP_EMOJI_CHOICES)[number]

const EMOJI_GRAPHEME_PATTERN =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

// A lone regional indicator is half of a flag and renders as a letter, so it
// must not count as an emoji grapheme; only the paired flag sequence does.
const LONE_REGIONAL_INDICATOR_PATTERN = /^\p{Regional_Indicator}$/u

function isEmojiGrapheme(grapheme: string): boolean {
  if (LONE_REGIONAL_INDICATOR_PATTERN.test(grapheme)) return false
  return EMOJI_GRAPHEME_PATTERN.test(grapheme)
}

function segmentGraphemes(value: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(value), (part) => part.segment)
}

/**
 * First emoji in a free-text name, or null. Digits/keycap sequences and lone
 * regional indicators don't match.
 */
export function detectEmojiInName(name: string): string | null {
  if (!name) return null
  for (const grapheme of segmentGraphemes(name)) {
    if (isEmojiGrapheme(grapheme)) return grapheme
  }
  return null
}

/** True when the whole value is a single emoji grapheme (or a flag). */
export function isSingleEmoji(value: string): boolean {
  if (!value) return false
  const graphemes = segmentGraphemes(value)
  return graphemes.length === 1 && isEmojiGrapheme(graphemes[0] ?? '')
}

/**
 * Turn raw custom-emoji input into a storable value: trims, maps blank input to
 * the `''` "none picked" sentinel, and extracts the first emoji from pasted
 * text. Non-blank input without an emoji is returned as-is so validation
 * rejects it with a visible form error.
 */
export function normalizeEmojiInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (isSingleEmoji(trimmed)) return trimmed
  return detectEmojiInName(trimmed) ?? trimmed
}

/**
 * Remove the first occurrence of `emoji` from `name`. Returns the original name
 * when stripping would leave it empty, unless `allowEmpty` is set — the live
 * form interception opts in so an emoji-only input still transfers (leaving the
 * name empty, which then fails validation until a real name is typed).
 */
export function stripNameEmoji(
  name: string,
  emoji: string,
  allowEmpty = false,
): string {
  const index = name.indexOf(emoji)
  if (index === -1) return name
  const remainder = (name.slice(0, index) + name.slice(index + emoji.length))
    .replace(/\s{2,}/g, ' ')
    .trim()
  return remainder.length > 0 || allowEmpty ? remainder : name
}

/**
 * Single-emoji title extraction for the group form's live name interception.
 * Returns the emoji and the stripped name only when the value contains exactly
 * one emoji grapheme: zero means there is nothing to move, and two or more
 * means deliberate decoration that stays in the name. The form strips even a
 * one-character remainder (which then fails name validation until the user
 * types more), and an emoji-only value transfers too, leaving the name empty
 * (which fails validation the same way) — the Undo notice restores it.
 */
export function extractSingleTitleEmoji(name: string): {
  emoji: string
  strippedName: string
} | null {
  if (!name) return null
  const emojis = segmentGraphemes(name).filter((grapheme) =>
    EMOJI_GRAPHEME_PATTERN.test(grapheme),
  )
  if (emojis.length !== 1) return null
  const emoji = emojis[0] as string
  const strippedName = stripNameEmoji(name, emoji, true)
  return strippedName === name ? null : { emoji, strippedName }
}

/** `null`/`undefined` = the admin was never asked (intro may be offered). */
export function isEmojiUndecided(
  emoji: string | null | undefined,
): emoji is null | undefined {
  return emoji === null || emoji === undefined
}

/** `''` = explicitly none picked / intro dismissed. */
export function isEmojiDeclined(emoji: string | null | undefined): emoji is '' {
  return emoji === ''
}

/** Emoji to render, or null when not set or explicitly none. */
export function displayEmoji(emoji: string | null | undefined): string | null {
  return emoji ? emoji : null
}

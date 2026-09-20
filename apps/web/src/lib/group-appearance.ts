import type { CSSProperties } from 'react'

import {
  detectEmojiInName,
  isEmojiUndecided,
  isGroupColorId,
  normalizeHexColor,
  resolveGroupColorHex,
  type GroupColor,
} from '@spliit/domain'

/** Neutral card hover, used when the group has no color accent. */
export const GROUP_CARD_NEUTRAL = 'hover:border-primary/25 hover:bg-muted/20'

/**
 * Inline style that exposes the resolved accent hex to the `group-accent-*`
 * utilities defined in globals.css. Palette ids and custom hex colors share the
 * same code path; unknown values return null so callers fall back to neutral
 * styling instead of rendering an unresolved `color-mix()`.
 */
export function groupAccentStyle(
  color: string | null | undefined,
): CSSProperties | null {
  const hex = resolveGroupColorHex(color)
  if (!hex) return null
  return { '--group-accent': hex } as CSSProperties
}

/**
 * Narrow a stored color to a palette id or a normalized custom hex color.
 * Unknown values return null so callers fall back to neutral styling instead of
 * breaking the layout.
 */
export function resolveGroupColor(
  color: string | null | undefined,
): GroupColor | null {
  if (!color) return null
  if (isGroupColorId(color)) return color
  return normalizeHexColor(color)
}

/**
 * Gate for the one-time "groups can have an emoji" intro. Only admins of a
 * live, non-friend group whose emoji is still undecided and whose stored name
 * contains an emoji are offered the prompt. Explicitly declined (`''`) or
 * picked emoji never prompt again.
 */
export function shouldOfferGroupEmojiIntro(input: {
  isLoading: boolean
  groupType: 'GROUP' | 'FRIEND' | null | undefined
  archived: boolean | null | undefined
  groupName: string | null | undefined
  groupEmoji: string | null | undefined
  currentMemberRole: 'ADMIN' | 'MEMBER' | null | undefined
  viewerAccess: 'READ_WRITE' | 'READ_ONLY' | null | undefined
}): boolean {
  if (input.isLoading) return false
  if (!input.groupName) return false
  if (input.groupType !== 'GROUP') return false
  if (input.archived) return false
  if (input.currentMemberRole !== 'ADMIN') return false
  if (input.viewerAccess === 'READ_ONLY') return false
  return (
    isEmojiUndecided(input.groupEmoji) &&
    detectEmojiInName(input.groupName) !== null
  )
}

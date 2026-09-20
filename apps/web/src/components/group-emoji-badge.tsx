import { groupAccentStyle } from '@/lib/group-appearance'
import { cn } from '@/lib/utils'
import { displayEmoji } from '@spliit/domain'

const SIZE_CLASSES = {
  sm: 'size-6 text-sm',
  md: 'size-8 text-base',
  lg: 'size-10 text-xl',
} as const

export type GroupEmojiBadgeSize = keyof typeof SIZE_CLASSES

/**
 * Colored chip that renders a group's emoji. Renders nothing when the group has
 * no emoji or explicitly picked none, so callers can drop it in
 * unconditionally. Decorative: the adjacent group name carries the meaning.
 *
 * Accepts the raw persisted value so the `''` "none picked" sentinel and `null`
 * "undecided" both map to "no chip". `showColorOnly` additionally renders an
 * empty swatch when a color is set but no emoji is — used where the chip is the
 * only appearance signal (the import confirm step).
 */
export function GroupEmojiBadge({
  emoji,
  color,
  size = 'md',
  className,
  showColorOnly = false,
}: {
  emoji: string | null | undefined
  color: string | null | undefined
  size?: GroupEmojiBadgeSize
  className?: string
  showColorOnly?: boolean
}) {
  const value = displayEmoji(emoji)
  const accent = groupAccentStyle(color)
  if (!value && !(showColorOnly && accent)) return null
  return (
    <span
      aria-hidden="true"
      data-group-emoji
      style={accent ?? undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg leading-none select-none',
        SIZE_CLASSES[size],
        accent
          ? 'group-accent-chip'
          : 'bg-muted ring-1 ring-transparent ring-inset',
        className,
      )}
    >
      {value}
    </span>
  )
}

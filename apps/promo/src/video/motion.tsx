import type { CSSProperties, ReactNode } from 'react'
import { spring, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

/**
 * Local sequence frames make entrances reproducible even when frames render out
 * of order.
 */
export function Entrance({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: CSSProperties
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  })
  return (
    <div
      style={{
        ...style,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 24}px)`,
      }}
    >
      {children}
    </div>
  )
}

export function Reveal({
  children,
  start = 0,
  end = 18,
}: {
  children: ReactNode
  start?: number
  end?: number
}) {
  const frame = useCurrentFrame()
  const progress = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div
      style={{
        opacity: progress,
        clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
      }}
    >
      {children}
    </div>
  )
}

export function Focus({
  children,
  start = 0,
  end = 30,
  scale = 1.035,
  origin = 'center',
}: {
  children: ReactNode
  start?: number
  end?: number
  scale?: number
  origin?: string
}) {
  const frame = useCurrentFrame()
  const zoom = interpolate(frame, [start, end], [1, scale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>
      {children}
    </div>
  )
}

export function Highlight({
  children,
  activeFrom = 0,
  activeTo = 90,
}: {
  children: ReactNode
  activeFrom?: number
  activeTo?: number
}) {
  const frame = useCurrentFrame()
  const opacity = interpolate(
    frame,
    [activeFrom, activeFrom + 8, activeTo, activeTo + 8],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <div
        style={{
          position: 'absolute',
          inset: -7,
          border: '3px solid hsl(var(--primary))',
          borderRadius: 18,
          opacity,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

/** A control depresses at the action frame, then releases into its new state. */
export function ActionCue({
  children,
  at,
}: {
  children: ReactNode
  at: number
}) {
  const frame = useCurrentFrame()
  const scale = interpolate(frame, [at - 4, at, at + 8], [1, 0.975, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return <div style={{ transform: `scale(${scale})` }}>{children}</div>
}

import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from 'motion/react'
import { useId, useSyncExternalStore } from 'react'

import type { MascotReaction } from './mascot-context'

type BillCharacterProps = {
  className?: string
  docked?: boolean
  open?: boolean
  reaction?: MascotReaction
  reactionKey?: number
}

const spring = {
  type: 'spring',
  stiffness: 360,
  damping: 24,
  mass: 0.72,
} as const

function subscribeToVisibility(callback: () => void) {
  if (typeof document === 'undefined') return () => undefined
  document.addEventListener('visibilitychange', callback)
  return () => document.removeEventListener('visibilitychange', callback)
}

function pageIsVisible() {
  return (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )
}

export function BillCharacter({
  className,
  docked = false,
  open = false,
  reaction = 'idle',
  reactionKey = 0,
}: BillCharacterProps) {
  return (
    <LazyMotion features={domAnimation} strict>
      <BillArtwork
        className={className}
        docked={docked}
        open={open}
        reaction={reaction}
        reactionKey={reactionKey}
      />
    </LazyMotion>
  )
}

function BillArtwork({
  className,
  docked,
  open,
  reaction,
  reactionKey,
}: Required<Omit<BillCharacterProps, 'className'>> & { className?: string }) {
  const reducedMotion = useReducedMotion()
  const visible = useSyncExternalStore(
    subscribeToVisibility,
    pageIsVisible,
    () => true,
  )
  const id = useId().replaceAll(':', '')
  const ambient = visible && !reducedMotion && reaction === 'idle' && !open
  const splitDistance = docked ? 7 : 15

  const wholeAnimation = reducedMotion
    ? { x: 0, y: 0, rotate: 0, scale: docked ? 0.78 : 1 }
    : reaction === 'success'
      ? {
          x: 0,
          y: [0, -13, 0, -6, 0],
          rotate: [0, -4, 4, -2, 0],
          scale: docked ? 0.78 : [1, 1.07, 0.98, 1.03, 1],
        }
      : reaction === 'failure'
        ? {
            x: [0, -3, 3, -2.5, 2, 0],
            y: [0, 1.5, 0],
            rotate: [0, -2.5, 2.5, -1.5, 1, 0],
            scale: docked ? 0.78 : 1,
          }
        : reaction === 'thinking'
          ? {
              x: 0,
              y: [0, -2.5, 0],
              rotate: [-1, 1, -1],
              scale: docked ? 0.78 : 1,
            }
          : {
              x: 0,
              y: ambient ? [0, -2.5, 0] : 0,
              rotate: 0,
              scale: docked ? 0.78 : 1,
            }

  return (
    <m.svg
      viewBox="0 0 140 158"
      data-mascot-reaction={reaction}
      data-mascot-open={open ? 'true' : 'false'}
      className={className}
      aria-hidden="true"
      focusable="false"
      initial={{ opacity: 0, y: 8, scale: 0.82 }}
      animate={{ opacity: 1, ...wholeAnimation }}
      transition={
        reaction === 'idle'
          ? {
              opacity: { duration: 0.24 },
              scale: spring,
              y: ambient
                ? { duration: 4.8, ease: 'easeInOut', repeat: Infinity }
                : spring,
            }
          : reaction === 'thinking'
            ? {
                y: { duration: 1.35, ease: 'easeInOut', repeat: Infinity },
                rotate: {
                  duration: 1.35,
                  ease: 'easeInOut',
                  repeat: Infinity,
                },
                scale: spring,
              }
            : { duration: 0.72, ease: [0.22, 1, 0.36, 1] }
      }
      style={{ overflow: 'visible', transformOrigin: '70px 138px' }}
    >
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--background))" />
          <stop offset="0.58" stopColor="hsl(var(--card))" />
          <stop offset="1" stopColor="hsl(var(--primary) / 0.11)" />
        </linearGradient>
        <linearGradient id={`${id}-leftTint`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary) / 0.03)" />
          <stop offset="1" stopColor="hsl(var(--primary) / 0.28)" />
        </linearGradient>
        <linearGradient id={`${id}-rightTint`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--foreground) / 0.02)" />
          <stop offset="1" stopColor="hsl(var(--ring) / 0.2)" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.75" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <filter
          id={`${id}-shadow`}
          x="-60%"
          y="-100%"
          width="220%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <filter
          id={`${id}-glow`}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <m.ellipse
        cx="70"
        cy="145"
        rx="36"
        ry="6"
        fill="hsl(var(--foreground) / 0.19)"
        filter={`url(#${id}-shadow)`}
        initial={{ rx: 36, opacity: 0.18 }}
        animate={{
          rx:
            reaction === 'success'
              ? [36, 27, 36]
              : open
                ? 48
                : docked
                  ? 28
                  : 36,
          opacity:
            reaction === 'success' ? [0.18, 0.1, 0.18] : docked ? 0.12 : 0.18,
        }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />

      <m.circle
        cx="70"
        cy="76"
        r="53"
        fill="hsl(var(--primary) / 0.08)"
        stroke="hsl(var(--primary) / 0.11)"
        strokeWidth="1"
        initial={false}
        animate={{
          opacity: open || reaction === 'success' ? 1 : 0,
          scale: open ? 1 : reaction === 'success' ? [0.75, 1.08, 1] : 0.72,
        }}
        transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: '70px 76px' }}
      />

      <ReceiptHalf
        side="left"
        id={id}
        open={open}
        splitDistance={splitDistance}
        reducedMotion={Boolean(reducedMotion)}
      />
      <ReceiptHalf
        side="right"
        id={id}
        open={open}
        splitDistance={splitDistance}
        reducedMotion={Boolean(reducedMotion)}
      />

      <m.rect
        x="68.55"
        y="15.5"
        width="2.9"
        height="114.5"
        rx="1.4"
        fill={`url(#${id}-paper)`}
        initial={false}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.12 }}
      />

      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <m.g
            key="twins"
            initial={{ opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.82 }}
            transition={{ delay: reducedMotion ? 0 : 0.16, duration: 0.24 }}
            style={{ transformOrigin: '70px 70px' }}
          >
            <TwinFace x={46 - splitDistance} />
            <TwinFace x={94 + splitDistance} />
          </m.g>
        ) : (
          <m.g
            key={`face-${reaction}-${reactionKey}`}
            initial={{ opacity: 0, scale: 0.82, y: 2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            style={{ transformOrigin: '70px 65px' }}
          >
            <FullFace reaction={reaction} ambient={ambient} />
          </m.g>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reaction === 'thinking' && (
          <m.g
            key={`thinking-${reactionKey}`}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            style={{ transformOrigin: '112px 25px' }}
          >
            {[0, 1, 2].map((dot) => (
              <m.circle
                key={dot}
                cx={103 + dot * 8}
                cy={29 - dot * 6}
                r={2.1 + dot * 0.7}
                fill="hsl(var(--primary))"
                animate={
                  reducedMotion
                    ? undefined
                    : { y: [0, -3, 0], opacity: [0.45, 1, 0.45] }
                }
                transition={{
                  delay: dot * 0.14,
                  duration: 1,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </m.g>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reaction === 'success' && (
          <m.g
            key={`success-${reactionKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CelebrationParticles reducedMotion={Boolean(reducedMotion)} />
          </m.g>
        )}
      </AnimatePresence>
    </m.svg>
  )
}

function ReceiptHalf({
  side,
  id,
  open,
  splitDistance,
  reducedMotion,
}: {
  side: 'left' | 'right'
  id: string
  open: boolean
  splitDistance: number
  reducedMotion: boolean
}) {
  const left = side === 'left'
  const bodyPath = left
    ? 'M70 14H42C34.3 14 28 20.3 28 28V121L34 128L41 121L48 129L55 121L62 129L70 122C67 116 73 110 70 104C67 98 73 92 70 86C67 80 73 74 70 68C67 62 73 56 70 50C67 44 73 38 70 32C67 26 73 20 70 14Z'
    : 'M70 14H98C105.7 14 112 20.3 112 28V121L106 128L99 121L92 129L85 121L78 129L70 122C73 116 67 110 70 104C73 98 67 92 70 86C73 80 67 74 70 68C73 62 67 56 70 50C73 44 67 38 70 32C73 26 67 20 70 14Z'
  const direction = left ? -1 : 1

  return (
    <m.g
      initial={false}
      animate={{
        x: open ? direction * splitDistance : 0,
        y: open ? -1 : 0,
        rotate: open ? direction * 4.2 : 0,
      }}
      transition={reducedMotion ? { duration: 0 } : spring}
      style={{ transformOrigin: left ? '70px 74px' : '70px 74px' }}
    >
      <path
        d={bodyPath}
        fill={`url(#${id}-paper)`}
        stroke="hsl(var(--primary))"
        strokeWidth="2.15"
        strokeLinejoin="round"
      />
      <m.path
        d={bodyPath}
        fill={`url(#${id}-${left ? 'leftTint' : 'rightTint'})`}
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.32 }}
      />

      <path
        d={left ? 'M36 34H62' : 'M78 34H104'}
        stroke="hsl(var(--primary) / 0.42)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={left ? 'M36 42H55' : 'M85 42H104'}
        stroke="hsl(var(--foreground) / 0.17)"
        strokeWidth="2.3"
        strokeLinecap="round"
      />

      <g opacity={open ? 0.34 : 0.72}>
        <path
          d={left ? 'M38 91H62' : 'M78 91H102'}
          stroke="hsl(var(--foreground) / 0.28)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d={left ? 'M38 100H58' : 'M82 100H102'}
          stroke="hsl(var(--primary) / 0.36)"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
        <path
          d={left ? 'M38 109H52' : 'M88 109H102'}
          stroke="hsl(var(--foreground) / 0.18)"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
      </g>

      <m.path
        d="M34 22C48 16 52 22 60 17"
        fill="none"
        stroke={`url(#${id}-shine)`}
        strokeWidth="3"
        strokeLinecap="round"
        opacity={left ? 0.7 : 0}
      />
    </m.g>
  )
}

function FullFace({
  reaction,
  ambient,
}: {
  reaction: MascotReaction
  ambient: boolean
}) {
  if (reaction === 'success') {
    return (
      <g fill="none" stroke="hsl(var(--foreground))" strokeLinecap="round">
        <path d="M51 61Q57 54 63 61" strokeWidth="3.6" />
        <path d="M77 61Q83 54 89 61" strokeWidth="3.6" />
        <path
          d="M55 70Q70 88 85 70Q82 92 70 93Q58 92 55 70Z"
          fill="hsl(var(--foreground))"
          strokeWidth="2"
        />
        <path
          d="M63 83Q70 79 77 83"
          stroke="hsl(var(--primary))"
          strokeWidth="3"
        />
      </g>
    )
  }

  if (reaction === 'failure') {
    return (
      <g stroke="hsl(var(--foreground))" strokeLinecap="round">
        <path d="M50 52L62 55" strokeWidth="2.2" />
        <path d="M78 55L90 52" strokeWidth="2.2" />
        <ellipse
          cx="58"
          cy="64"
          rx="4.3"
          ry="5.6"
          fill="hsl(var(--foreground))"
          stroke="none"
        />
        <ellipse
          cx="82"
          cy="64"
          rx="4.3"
          ry="5.6"
          fill="hsl(var(--foreground))"
          stroke="none"
        />
        <path d="M59 84Q70 72 81 84" fill="none" strokeWidth="3" />
        <m.path
          d="M91 67C96 74 96 78 91 81C86 78 86 74 91 67Z"
          fill="hsl(var(--primary) / 0.72)"
          stroke="hsl(var(--primary))"
          strokeWidth="1.2"
          initial={{ y: -2, opacity: 0 }}
          animate={{ y: [0, 5, 5], opacity: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: 1, ease: 'easeIn' }}
        />
      </g>
    )
  }

  const thinking = reaction === 'thinking'
  return (
    <g>
      <m.g
        animate={
          ambient
            ? { scaleY: [1, 1, 0.08, 1, 1, 1, 0.08, 1, 1] }
            : { scaleY: 1 }
        }
        transition={
          ambient
            ? {
                duration: 8.2,
                times: [0, 0.42, 0.44, 0.47, 0.82, 0.86, 0.88, 0.91, 1],
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : { duration: 0.1 }
        }
        style={{ transformOrigin: '70px 62px' }}
      >
        <ellipse
          cx="57"
          cy="62"
          rx="5.2"
          ry="7"
          fill="hsl(var(--foreground))"
        />
        <ellipse
          cx="83"
          cy="62"
          rx="5.2"
          ry="7"
          fill="hsl(var(--foreground))"
        />
        <circle
          cx={thinking ? 59 : 58.5}
          cy={thinking ? 59.5 : 60}
          r="1.45"
          fill="hsl(var(--background))"
        />
        <circle
          cx={thinking ? 85 : 84.5}
          cy={thinking ? 59.5 : 60}
          r="1.45"
          fill="hsl(var(--background))"
        />
      </m.g>
      {thinking && (
        <path
          d="M49 50Q56 46 63 50M77 50Q84 45 91 49"
          fill="none"
          stroke="hsl(var(--foreground))"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      <path
        d={thinking ? 'M61 78Q70 82 79 77' : 'M58 76Q70 87 82 76'}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse
        cx="47"
        cy="73"
        rx="5"
        ry="2.6"
        fill="hsl(var(--primary) / 0.13)"
      />
      <ellipse
        cx="93"
        cy="73"
        rx="5"
        ry="2.6"
        fill="hsl(var(--primary) / 0.13)"
      />
    </g>
  )
}

function TwinFace({ x }: { x: number }) {
  return (
    <g transform={`translate(${x - 18} 0)`} fill="hsl(var(--foreground))">
      <ellipse cx="11" cy="64" rx="3.4" ry="5" />
      <ellipse cx="25" cy="64" rx="3.4" ry="5" />
      <path
        d="M11 74Q18 81 25 74"
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  )
}

function CelebrationParticles({ reducedMotion }: { reducedMotion: boolean }) {
  const particles = [
    { x: 23, y: 46, dx: -12, dy: -15, color: 'primary' },
    { x: 38, y: 25, dx: -5, dy: -18, color: 'foreground' },
    { x: 103, y: 28, dx: 7, dy: -18, color: 'primary' },
    { x: 117, y: 55, dx: 12, dy: -10, color: 'foreground' },
    { x: 25, y: 95, dx: -13, dy: 5, color: 'foreground' },
    { x: 115, y: 96, dx: 13, dy: 5, color: 'primary' },
  ] as const

  return (
    <>
      {particles.map((particle, index) => (
        <m.g
          key={`${particle.x}-${particle.y}`}
          initial={{
            x: 0,
            y: 0,
            opacity: 0,
            scale: 0.3,
            rotate: 0,
          }}
          animate={{
            x: reducedMotion ? 0 : particle.dx,
            y: reducedMotion ? 0 : [0, particle.dy, particle.dy + 8],
            opacity: [0, 1, 0],
            scale: [0.3, 1.15, 0.8],
            rotate: reducedMotion ? 0 : 120 * (index % 2 ? -1 : 1),
          }}
          transition={{ delay: index * 0.045, duration: 0.9, ease: 'easeOut' }}
          style={{ transformOrigin: `${particle.x}px ${particle.y}px` }}
        >
          <path
            d={`M${particle.x - 3} ${particle.y}H${particle.x + 3}M${particle.x} ${particle.y - 3}V${particle.y + 3}`}
            stroke={`hsl(var(--${particle.color}))`}
            strokeWidth="2.5"
            strokeLinecap="round"
            filter="drop-shadow(0 1px 2px hsl(var(--background)))"
          />
        </m.g>
      ))}
    </>
  )
}

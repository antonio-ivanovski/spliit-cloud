import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from 'motion/react'
import { useId, useSyncExternalStore } from 'react'

import type { MascotCharacterProps } from '../../mascot-character'
import type { MascotReaction } from '../../mascot-context'
import {
  getMascotResumeCycle,
  subscribeMascotResume,
} from '../../mascot-resume'

const spring = {
  type: 'spring',
  stiffness: 360,
  damping: 24,
  mass: 0.72,
} as const

export function BillCharacter({
  className,
  docked = false,
  open = false,
  reaction = 'idle',
  reactionKey = 0,
}: MascotCharacterProps) {
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
}: Required<Omit<MascotCharacterProps, 'className'>> & { className?: string }) {
  const reducedMotion = useReducedMotion()
  const resumeCycle = useSyncExternalStore(
    subscribeMascotResume,
    getMascotResumeCycle,
    () => 0,
  )
  const id = useId().replaceAll(':', '')
  const ambient = !reducedMotion && reaction === 'idle' && !open
  const clap = reaction === 'celebrate'
  const splitDistance = docked ? 7 : 15

  const wholeAnimation = reducedMotion
    ? { x: 0, y: 0, rotate: 0, scale: docked ? 0.78 : 1 }
    : reaction === 'celebrate'
      ? {
          x: 0,
          y: [0, -6, 0],
          rotate: 0,
          scale: docked ? 0.78 : [1, 1.04, 1],
        }
      : reaction === 'success'
        ? {
            x: 0,
            y: [0, -13, 0, -6, 0],
            rotate: [0, -4, 4, -2, 0],
            scale: docked ? 0.78 : [1, 1.07, 0.98, 1.03, 1],
          }
        : reaction === 'welcome'
          ? {
              x: 0,
              y: [0, -4, 0, -2, 0],
              rotate: [0, -3, 2, -2, 0],
              scale: docked ? 0.78 : 1,
            }
          : reaction === 'acknowledge'
            ? {
                x: 0,
                y: [0, 3, 0],
                rotate: [0, 5, 0],
                scale: docked ? 0.78 : 1,
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
                    y: ambient ? [0, -5, 0] : 0,
                    rotate: ambient ? [-1.2, 1.4, -0.8, 1.2] : 0,
                    scale: docked ? 0.78 : 1,
                  }

  return (
    <m.svg
      key={
        reaction === 'idle'
          ? `idle-${resumeCycle}`
          : `${reaction}-${reactionKey}`
      }
      viewBox="0 0 140 158"
      data-mascot-reaction={reaction}
      data-mascot-open={open ? 'true' : 'false'}
      data-mascot-cycle={resumeCycle}
      className={className}
      aria-hidden="true"
      focusable="false"
      initial={false}
      animate={{ opacity: 1, ...wholeAnimation }}
      transition={
        reaction === 'idle'
          ? {
              opacity: { duration: 0.24 },
              scale: spring,
              y: ambient
                ? { duration: 3.6, ease: 'easeInOut', repeat: Infinity }
                : spring,
              rotate: ambient
                ? { duration: 5.4, ease: 'easeInOut', repeat: Infinity }
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
            : reaction === 'acknowledge'
              ? {
                  duration: 0.7,
                  times: [0, 0.45, 1],
                  ease: 'easeInOut',
                }
              : { duration: 0.72, ease: [0.22, 1, 0.36, 1] }
      }
      style={{ overflow: 'visible', transformOrigin: '70px 138px' }}
    >
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--mascot-paper))" />
          <stop offset="0.58" stopColor="hsl(var(--mascot-paper-mid))" />
          <stop offset="1" stopColor="hsl(var(--mascot-paper-edge))" />
        </linearGradient>
        <linearGradient id={`${id}-leftTint`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--mascot-accent) / 0.08)" />
          <stop offset="1" stopColor="hsl(var(--mascot-accent) / 0.2)" />
        </linearGradient>
        <linearGradient id={`${id}-rightTint`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--mascot-ink) / 0.03)" />
          <stop offset="1" stopColor="hsl(var(--mascot-ink) / 0.08)" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop
            offset="0"
            stopColor="hsl(var(--mascot-paper))"
            stopOpacity="0"
          />
          <stop
            offset="0.5"
            stopColor="hsl(var(--mascot-paper))"
            stopOpacity="0.9"
          />
          <stop
            offset="1"
            stopColor="hsl(var(--mascot-paper))"
            stopOpacity="0"
          />
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
        fill="hsl(var(--mascot-ink) / 0.22)"
        filter={`url(#${id}-shadow)`}
        initial={{ rx: 36, opacity: 0.18 }}
        animate={{
          rx:
            reaction === 'success' || reaction === 'celebrate'
              ? [36, 27, 36]
              : open
                ? 48
                : docked
                  ? 28
                  : 36,
          opacity:
            reaction === 'success' || reaction === 'celebrate'
              ? [0.18, 0.1, 0.18]
              : docked
                ? 0.12
                : 0.18,
        }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />

      {(reaction === 'success' || reaction === 'celebrate') && (
        <m.circle
          cx="70"
          cy="76"
          r="53"
          fill="hsl(var(--mascot-accent) / 0.14)"
          stroke="hsl(var(--mascot-accent) / 0.18)"
          strokeWidth="1"
          initial={false}
          animate={{
            opacity: 1,
            scale: reaction === 'celebrate' ? [0.82, 1.1, 1] : [0.75, 1.08, 1],
          }}
          transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: '70px 76px' }}
        />
      )}

      {(reaction === 'welcome' || reaction === 'acknowledge') && (
        <StickArm
          pose={reaction === 'welcome' ? 'wave' : 'toss'}
          reducedMotion={Boolean(reducedMotion)}
        />
      )}

      <ReceiptHalf
        side="left"
        id={id}
        open={open}
        clap={clap}
        splitDistance={splitDistance}
        reducedMotion={Boolean(reducedMotion)}
      />
      <ReceiptHalf
        side="right"
        id={id}
        open={open}
        clap={clap}
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
        animate={{
          opacity: open ? 0 : clap && !reducedMotion ? [1, 0, 1, 0, 1] : 1,
        }}
        transition={
          clap && !reducedMotion
            ? { duration: 0.95, ease: [0.22, 1, 0.36, 1] }
            : { duration: reducedMotion ? 0 : 0.12 }
        }
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
                fill="hsl(var(--mascot-accent))"
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
            data-mascot-fx="success"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SuccessRain reducedMotion={Boolean(reducedMotion)} />
          </m.g>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reaction === 'celebrate' && (
          <m.g
            key={`celebrate-${reactionKey}`}
            data-mascot-fx="celebrate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SuccessSparkles reducedMotion={Boolean(reducedMotion)} />
            <CelebrateCoins reducedMotion={Boolean(reducedMotion)} />
          </m.g>
        )}
      </AnimatePresence>

      {reaction === 'acknowledge' && (
        <g data-mascot-fx="acknowledge">
          <AcknowledgeToss reducedMotion={Boolean(reducedMotion)} />
        </g>
      )}
    </m.svg>
  )
}

function ReceiptHalf({
  side,
  id,
  open,
  clap,
  splitDistance,
  reducedMotion,
}: {
  side: 'left' | 'right'
  id: string
  open: boolean
  clap: boolean
  splitDistance: number
  reducedMotion: boolean
}) {
  const left = side === 'left'
  const bodyPath = left
    ? 'M70 14H42C34.3 14 28 20.3 28 28V121L34 128L41 121L48 129L55 121L62 129L70 122C67 116 73 110 70 104C67 98 73 92 70 86C67 80 73 74 70 68C67 62 73 56 70 50C67 44 73 38 70 32C67 26 73 20 70 14Z'
    : 'M70 14H98C105.7 14 112 20.3 112 28V121L106 128L99 121L92 129L85 121L78 129L70 122C73 116 67 110 70 104C73 98 67 92 70 86C73 80 67 74 70 68C73 62 67 56 70 50C73 44 67 38 70 32C73 26 67 20 70 14Z'
  const direction = left ? -1 : 1
  const clapMotion = clap && !open && !reducedMotion

  return (
    <m.g
      data-mascot-clap={clap && !open ? 'true' : undefined}
      initial={false}
      animate={{
        x: open
          ? direction * splitDistance
          : clapMotion
            ? [
                0,
                direction * splitDistance,
                0,
                direction * (splitDistance * 0.55),
                0,
              ]
            : 0,
        y: open ? -1 : clapMotion ? [0, -3, 0, -2, 0] : 0,
        rotate: open
          ? direction * 4.2
          : clapMotion
            ? [0, direction * 9, 0, direction * 5, 0]
            : 0,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : clapMotion
            ? { duration: 0.95, ease: [0.22, 1, 0.36, 1] }
            : spring
      }
      style={{ transformOrigin: '70px 74px' }}
    >
      <path
        d={bodyPath}
        fill={`url(#${id}-paper)`}
        stroke="hsl(var(--mascot-stroke))"
        strokeWidth="2.15"
        strokeLinejoin="round"
      />
      <m.path
        d={bodyPath}
        fill={`url(#${id}-${left ? 'leftTint' : 'rightTint'})`}
        initial={false}
        animate={{ opacity: clap ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.32 }}
      />

      <path
        d={left ? 'M36 34H62' : 'M78 34H104'}
        stroke="hsl(var(--mascot-accent))"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={left ? 'M36 42H55' : 'M85 42H104'}
        stroke="hsl(var(--mascot-rule) / 0.7)"
        strokeWidth="2.3"
        strokeLinecap="round"
      />

      <g opacity={0.85}>
        <path
          d={left ? 'M38 91H62' : 'M78 91H102'}
          stroke="hsl(var(--mascot-rule) / 0.75)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d={left ? 'M38 100H58' : 'M82 100H102'}
          stroke="hsl(var(--mascot-accent) / 0.7)"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
        <path
          d={left ? 'M38 109H52' : 'M88 109H102'}
          stroke="hsl(var(--mascot-rule) / 0.6)"
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

function HappyEyes() {
  return (
    <>
      <path d="M51 61Q57 54 63 61" strokeWidth="3.6" />
      <path d="M77 61Q83 54 89 61" strokeWidth="3.6" />
    </>
  )
}

function FullFace({
  reaction,
  ambient,
}: {
  reaction: MascotReaction
  ambient: boolean
}) {
  if (reaction === 'success' || reaction === 'celebrate') {
    return (
      <g fill="none" stroke="hsl(var(--mascot-ink))" strokeLinecap="round">
        <HappyEyes />
        <path
          d={
            reaction === 'celebrate'
              ? 'M56 76Q70 90 84 76'
              : 'M57 76Q70 88 83 76'
          }
          strokeWidth="3"
        />
      </g>
    )
  }

  if (reaction === 'welcome') {
    return (
      <g fill="none" stroke="hsl(var(--mascot-ink))" strokeLinecap="round">
        <ellipse
          cx="57"
          cy="62"
          rx="5.2"
          ry="7"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <ellipse
          cx="83"
          cy="62"
          rx="5.2"
          ry="7"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <circle cx="58.5" cy="60" r="1.45" fill="hsl(var(--mascot-paper))" />
        <circle cx="84.5" cy="60" r="1.45" fill="hsl(var(--mascot-paper))" />
        <path d="M56 78Q70 91 84 78" strokeWidth="3" />
      </g>
    )
  }

  if (reaction === 'acknowledge') {
    return (
      <g fill="none" stroke="hsl(var(--mascot-ink))" strokeLinecap="round">
        <ellipse
          cx="57"
          cy="64"
          rx="5.2"
          ry="6.4"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <ellipse
          cx="83"
          cy="64"
          rx="5.2"
          ry="6.4"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <path d="M60 80Q70 86 80 80" strokeWidth="3" />
      </g>
    )
  }

  if (reaction === 'failure') {
    return (
      <g stroke="hsl(var(--mascot-ink))" strokeLinecap="round">
        <path d="M50 52L62 55" strokeWidth="2.2" />
        <path d="M78 55L90 52" strokeWidth="2.2" />
        <ellipse
          cx="58"
          cy="64"
          rx="4.3"
          ry="5.6"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <ellipse
          cx="82"
          cy="64"
          rx="4.3"
          ry="5.6"
          fill="hsl(var(--mascot-ink))"
          stroke="none"
        />
        <path d="M59 84Q70 72 81 84" fill="none" strokeWidth="3" />
        <m.path
          d="M91 67C96 74 96 78 91 81C86 78 86 74 91 67Z"
          fill="hsl(var(--mascot-accent) / 0.85)"
          stroke="hsl(var(--mascot-stroke))"
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
            ? { x: [0, 0, 0, 2.4, 2.4, 0, 0, 0, -2.2, -2.2, 0] }
            : { x: 0 }
        }
        transition={
          ambient
            ? {
                duration: 11,
                times: [
                  0, 0.18, 0.28, 0.34, 0.46, 0.52, 0.64, 0.72, 0.78, 0.9, 1,
                ],
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : { duration: 0.2 }
        }
      >
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
            fill="hsl(var(--mascot-ink))"
          />
          <ellipse
            cx="83"
            cy="62"
            rx="5.2"
            ry="7"
            fill="hsl(var(--mascot-ink))"
          />
          <circle
            cx={thinking ? 59 : 58.5}
            cy={thinking ? 59.5 : 60}
            r="1.45"
            fill="hsl(var(--mascot-paper))"
          />
          <circle
            cx={thinking ? 85 : 84.5}
            cy={thinking ? 59.5 : 60}
            r="1.45"
            fill="hsl(var(--mascot-paper))"
          />
        </m.g>
      </m.g>
      {thinking && (
        <path
          d="M49 50Q56 46 63 50M77 50Q84 45 91 49"
          fill="none"
          stroke="hsl(var(--mascot-ink))"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      <path
        d={thinking ? 'M61 78Q70 82 79 77' : 'M58 76Q70 87 82 76'}
        fill="none"
        stroke="hsl(var(--mascot-ink))"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse
        cx="47"
        cy="73"
        rx="5"
        ry="2.6"
        fill="hsl(var(--mascot-accent) / 0.22)"
      />
      <ellipse
        cx="93"
        cy="73"
        rx="5"
        ry="2.6"
        fill="hsl(var(--mascot-accent) / 0.22)"
      />
    </g>
  )
}

function TwinFace({ x }: { x: number }) {
  return (
    <g transform={`translate(${x - 18} 0)`} fill="hsl(var(--mascot-ink))">
      <ellipse cx="11" cy="64" rx="3.4" ry="5" />
      <ellipse cx="25" cy="64" rx="3.4" ry="5" />
      <path
        d="M11 74Q18 81 25 74"
        fill="none"
        stroke="hsl(var(--mascot-ink))"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  )
}

function StickArm({
  pose,
  reducedMotion,
}: {
  pose: 'wave' | 'toss'
  reducedMotion: boolean
}) {
  const wave = pose === 'wave'

  return (
    <m.g
      data-mascot-arm={pose}
      initial={{ opacity: 0, rotate: wave ? 18 : 12 }}
      animate={
        reducedMotion
          ? { opacity: [1, 0], rotate: wave ? -28 : 82 }
          : wave
            ? {
                opacity: [0, 1, 1, 1, 0],
                rotate: [12, -38, -2, -36, 24],
              }
            : {
                opacity: [0, 1, 1, 0],
                rotate: [12, 82, 88, 40],
              }
      }
      transition={
        reducedMotion
          ? { duration: 0.35 }
          : wave
            ? {
                duration: 2.05,
                times: [0, 0.12, 0.4, 0.64, 1],
                ease: 'easeInOut',
              }
            : {
                duration: 0.55,
                times: [0, 0.3, 0.55, 1],
                ease: 'easeInOut',
              }
      }
      style={{ transformOrigin: '100px 76px' }}
    >
      <path
        d="M100 76L134 56"
        fill="none"
        stroke="hsl(var(--mascot-ink))"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </m.g>
  )
}

function SuccessSparkles({ reducedMotion }: { reducedMotion: boolean }) {
  const sparkles = [
    { x: 28, y: 38, dx: -8, dy: -12 },
    { x: 112, y: 42, dx: 9, dy: -10 },
    { x: 70, y: 18, dx: 0, dy: -14 },
  ] as const

  return (
    <g data-mascot-sparkles="true">
      {sparkles.map((sparkle, index) => (
        <m.g
          key={`${sparkle.x}-${sparkle.y}`}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.3 }}
          animate={{
            x: reducedMotion ? 0 : sparkle.dx,
            y: reducedMotion ? 0 : [0, sparkle.dy, sparkle.dy + 4],
            opacity: [0, 1, 0],
            scale: [0.3, 1, 0.7],
          }}
          transition={{ delay: index * 0.06, duration: 0.72, ease: 'easeOut' }}
          style={{ transformOrigin: `${sparkle.x}px ${sparkle.y}px` }}
        >
          <path
            d={`M${sparkle.x - 2.4} ${sparkle.y}H${sparkle.x + 2.4}M${sparkle.x} ${sparkle.y - 2.4}V${sparkle.y + 2.4}`}
            stroke="hsl(var(--mascot-accent))"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </m.g>
      ))}
    </g>
  )
}

function SuccessRain({ reducedMotion }: { reducedMotion: boolean }) {
  const drops = [
    { kind: 'coin', x: 18, delay: 0, spin: 50 },
    { kind: 'bill', x: 40, delay: 0.1, spin: -36 },
    { kind: 'coin', x: 62, delay: 0.04, spin: 28 },
    { kind: 'bill', x: 86, delay: 0.16, spin: 44 },
    { kind: 'coin', x: 108, delay: 0.08, spin: -40 },
    { kind: 'bill', x: 28, delay: 0.28, spin: 22 },
    { kind: 'coin', x: 74, delay: 0.22, spin: -18 },
    { kind: 'bill', x: 122, delay: 0.18, spin: 32 },
  ] as const

  return (
    <g data-mascot-rain="true">
      {drops.map((drop, index) => (
        <m.g
          key={`${drop.kind}-${drop.x}-${index}`}
          initial={{ y: -18, opacity: 0, rotate: 0 }}
          animate={{
            y: reducedMotion ? 64 : [-18, 150],
            opacity: reducedMotion ? 1 : [0, 1, 1, 0],
            rotate: reducedMotion ? drop.spin / 4 : [0, drop.spin],
          }}
          transition={{
            delay: reducedMotion ? 0 : drop.delay,
            duration: reducedMotion ? 0 : 1.35,
            ease: 'easeIn',
          }}
          style={{ transformOrigin: `${drop.x}px 0px` }}
        >
          {drop.kind === 'coin' ? (
            <>
              <circle
                cx={drop.x}
                cy="0"
                r="5.4"
                fill="hsl(var(--mascot-paper))"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.6"
              />
              <circle
                cx={drop.x}
                cy="0"
                r="2.8"
                fill="none"
                stroke="hsl(var(--mascot-accent))"
                strokeWidth="1.1"
              />
            </>
          ) : (
            <g>
              <rect
                x={drop.x - 7}
                y="-4.5"
                width="14"
                height="9"
                rx="1.6"
                fill="hsl(var(--mascot-paper))"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.3"
              />
              <path
                d={`M${drop.x - 4} -1H${drop.x + 4}`}
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </g>
          )}
        </m.g>
      ))}
    </g>
  )
}

function CelebrateCoins({ reducedMotion }: { reducedMotion: boolean }) {
  const coins = [
    { x: 26, y: 48, dx: -16, dy: -14 },
    { x: 114, y: 44, dx: 16, dy: -12 },
    { x: 32, y: 98, dx: -14, dy: 8 },
    { x: 110, y: 100, dx: 14, dy: 7 },
    { x: 70, y: 20, dx: 2, dy: -18 },
  ] as const

  return (
    <>
      {coins.map((coin, index) => (
        <m.g
          key={`${coin.x}-${coin.y}`}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
          animate={{
            x: reducedMotion ? 0 : coin.dx,
            y: reducedMotion ? 0 : [0, coin.dy, coin.dy + 6],
            opacity: reducedMotion ? 1 : [0, 1, 0],
            scale: reducedMotion ? 1 : [0.4, 1.1, 0.85],
            rotate: reducedMotion ? 0 : [0, 40 * (index % 2 ? -1 : 1)],
          }}
          transition={{ delay: index * 0.05, duration: 0.95, ease: 'easeOut' }}
          style={{ transformOrigin: `${coin.x}px ${coin.y}px` }}
        >
          <circle
            cx={coin.x}
            cy={coin.y}
            r="6.2"
            fill="hsl(var(--mascot-paper))"
            stroke="hsl(var(--mascot-stroke))"
            strokeWidth="1.8"
          />
          <circle
            cx={coin.x}
            cy={coin.y}
            r="3.4"
            fill="none"
            stroke="hsl(var(--mascot-accent))"
            strokeWidth="1.2"
          />
        </m.g>
      ))}
    </>
  )
}

function AcknowledgeToss({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <g>
      <m.g
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{
          opacity: reducedMotion ? 1 : [0, 1, 1, 0],
          scale: 1,
        }}
        transition={{
          duration: reducedMotion ? 0 : 0.7,
          times: [0, 0.12, 0.62, 1],
          ease: 'easeOut',
        }}
        style={{ transformOrigin: '128px 96px' }}
      >
        <path
          d="M118 86L121 110H135L138 86Z"
          fill="hsl(var(--mascot-paper))"
          stroke="hsl(var(--mascot-stroke))"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M123 92H133M122 99H134"
          stroke="hsl(var(--mascot-rule))"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <m.g
          initial={false}
          animate={reducedMotion ? { rotate: -28 } : { rotate: [0, -36, 0] }}
          transition={{
            duration: reducedMotion ? 0 : 0.45,
            times: [0, 0.35, 1],
            ease: 'easeInOut',
          }}
          style={{ transformOrigin: '118px 84px' }}
        >
          <rect
            x="116"
            y="81"
            width="24"
            height="4.5"
            rx="1.4"
            fill="hsl(var(--mascot-ink))"
          />
        </m.g>
      </m.g>
      {!reducedMotion && (
        <m.path
          d="M124 52H134L132 62H122Z"
          fill="hsl(var(--mascot-paper))"
          stroke="hsl(var(--mascot-stroke))"
          strokeWidth="1.5"
          strokeLinejoin="round"
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{
            x: [0, 4, 6],
            y: [0, -4, 34],
            opacity: [0, 1, 0],
            rotate: [0, 18, 80],
          }}
          transition={{ duration: 0.42, delay: 0.06, ease: 'easeIn' }}
          style={{ transformOrigin: '128px 56px' }}
        />
      )}
    </g>
  )
}

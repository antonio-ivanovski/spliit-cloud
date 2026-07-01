import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Self-contained typing animation that demonstrates the "swap .app for
 * .cloud" trick. The component owns its animation state and timing —
 * the parent just renders it where the visual should appear.
 *
 * Phases (per cycle):
 *  1. Type `https://spliit.app/groups/yourGroupId` character-by-character
 *  2. Strike through `app` in red
 *  3. Backspace `app` character-by-character — the cursor stays put at
 *     position 16 and the deleted characters drop from its left while
 *     `/groups/yourGroupId` remains visible to its right
 *  4. Pause to let the eye register the empty gap
 *  5. Type `cloud` character-by-character in place of `app`
 *  6. Hold the final `https://spliit.cloud/groups/yourGroupId` URL
 *  7. Brief gap, then loop
 */

const APP_URL = 'https://spliit.app/groups/yourGroupId'
const CLOUD_URL = 'https://spliit.cloud/groups/yourGroupId'
const BEFORE_CURSOR_PREFIX = 'https://spliit.'
const APP = 'app'
const CLOUD = 'cloud'
const AFTER_CURSOR = '/groups/yourGroupId'

const TYPING_CHAR_MS = 32
const STRIKE_MS = 420
const BACKSPACE_CHAR_MS = 70
const PAUSE_AFTER_BACKSPACE_MS = 450
const TYPE_CLOUD_CHAR_MS = 80
const HOLD_MS = 2200
const GAP_MS = 350

type TypingFrame = {
  /** Text rendered to the LEFT of the cursor. */
  beforeCursor: string
  /** Text rendered to the RIGHT of the cursor (stays put during backspace/typing-cloud). */
  afterCursor: string
  showStrike: boolean
  duration: number
}

function buildTypingFrames(): TypingFrame[] {
  const frames: TypingFrame[] = []

  // Phase 1: type the app URL, one character at a time. The cursor
  // moves to the right as each character appears.
  for (let i = 1; i <= APP_URL.length; i++) {
    frames.push({
      beforeCursor: APP_URL.slice(0, i),
      afterCursor: '',
      showStrike: false,
      duration: TYPING_CHAR_MS,
    })
  }

  // Phase 2: hold the full URL with a red strikethrough on "app".
  frames.push({
    beforeCursor: APP_URL,
    afterCursor: '',
    showStrike: true,
    duration: STRIKE_MS,
  })

  // Phase 3: backspace "app" one character at a time. The cursor
  // stays put at position 16 (right after "https://spliit.") and
  // the deleted characters drop from the LEFT of the cursor.
  for (let i = 1; i <= APP.length; i++) {
    frames.push({
      beforeCursor: BEFORE_CURSOR_PREFIX + APP.slice(0, APP.length - i),
      afterCursor: AFTER_CURSOR,
      showStrike: false,
      duration: BACKSPACE_CHAR_MS,
    })
  }

  // Phase 4: a brief pause so the eye registers the empty gap
  // before "cloud" starts streaming in.
  frames.push({
    beforeCursor: BEFORE_CURSOR_PREFIX,
    afterCursor: AFTER_CURSOR,
    showStrike: false,
    duration: PAUSE_AFTER_BACKSPACE_MS,
  })

  // Phase 5: type "cloud" in place of "app", one character at a
  // time. The cursor moves to the right as each character appears.
  for (let i = 1; i <= CLOUD.length; i++) {
    frames.push({
      beforeCursor: BEFORE_CURSOR_PREFIX + CLOUD.slice(0, i),
      afterCursor: AFTER_CURSOR,
      showStrike: false,
      duration: TYPE_CLOUD_CHAR_MS,
    })
  }

  // Phase 6: hold the final cloud URL.
  frames.push({
    beforeCursor: CLOUD_URL,
    afterCursor: '',
    showStrike: false,
    duration: HOLD_MS,
  })

  // Phase 7: brief gap before looping, so the eye resets.
  frames.push({
    beforeCursor: '',
    afterCursor: '',
    showStrike: false,
    duration: GAP_MS,
  })

  return frames
}

const TYPING_FRAMES = buildTypingFrames()
const FRAME_BOUNDARIES: number[] = (() => {
  let cumulative = 0
  return TYPING_FRAMES.map((frame) => {
    cumulative += frame.duration
    return cumulative
  })
})()
const TOTAL_CYCLE_MS = FRAME_BOUNDARIES[FRAME_BOUNDARIES.length - 1]

function getTypingFrame(elapsedMs: number): TypingFrame {
  for (let i = 0; i < FRAME_BOUNDARIES.length; i++) {
    if (elapsedMs < FRAME_BOUNDARIES[i]) {
      return TYPING_FRAMES[i]
    }
  }
  return TYPING_FRAMES[TYPING_FRAMES.length - 1]
}

function renderBeforeCursor(beforeCursor: string, showStrike: boolean) {
  if (!beforeCursor) return null

  // Strike phase: full app URL — strike "app" only, keep the rest plain.
  if (showStrike && beforeCursor === APP_URL) {
    return (
      <>
        {BEFORE_CURSOR_PREFIX}
        <span className="text-rose-500 line-through decoration-2">{APP}</span>
        {AFTER_CURSOR}
      </>
    )
  }

  // Hold phase: full cloud URL — green "cloud" only, rest plain.
  if (beforeCursor === CLOUD_URL) {
    return (
      <>
        {BEFORE_CURSOR_PREFIX}
        <span className="text-emerald-600 dark:text-emerald-400">{CLOUD}</span>
        {AFTER_CURSOR}
      </>
    )
  }

  // Typing-cloud phase with the full word typed — green "cloud" only.
  if (beforeCursor === BEFORE_CURSOR_PREFIX + CLOUD) {
    return (
      <>
        {BEFORE_CURSOR_PREFIX}
        <span className="text-emerald-600 dark:text-emerald-400">{CLOUD}</span>
      </>
    )
  }

  // Typing-cloud phase mid-word — green just the typed prefix.
  if (
    beforeCursor.startsWith(BEFORE_CURSOR_PREFIX) &&
    CLOUD.startsWith(beforeCursor.slice(BEFORE_CURSOR_PREFIX.length))
  ) {
    const tail = beforeCursor.slice(BEFORE_CURSOR_PREFIX.length)
    if (tail.length > 0) {
      return (
        <>
          {BEFORE_CURSOR_PREFIX}
          <span className="text-emerald-600 dark:text-emerald-400">{tail}</span>
        </>
      )
    }
  }

  // Typing-URL, backspace, pause, gap — plain text, no highlighting.
  return <>{beforeCursor}</>
}

export function DomainSwapTyping() {
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)

  useEffect(() => {
    const step = (now: number) => {
      if (startRef.current === 0) startRef.current = now
      const cycleElapsed = (now - startRef.current) % TOTAL_CYCLE_MS
      setElapsed(cycleElapsed)
      rafRef.current = window.requestAnimationFrame(step)
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const { beforeCursor, afterCursor, showStrike } = useMemo(
    () => getTypingFrame(elapsed),
    [elapsed],
  )

  return (
    <div
      className="flex items-center gap-2 font-mono text-sm leading-none"
      aria-live="polite"
    >
      <span className="truncate">
        {renderBeforeCursor(beforeCursor, showStrike)}
        <span
          aria-hidden
          className="ml-px inline-block h-[1.1em] w-[3px] -translate-y-px bg-current align-middle animate-cursor-blink"
        />
        {afterCursor}
      </span>
    </div>
  )
}

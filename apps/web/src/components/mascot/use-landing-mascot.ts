import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  useMascotController,
  useMascotState,
  type MascotReaction,
} from './mascot-context'

export const LANDING_SPEECH_KEYS = [
  'Mascot.landingGreeting',
  'Mascot.landingHintSplit',
  'Mascot.landingHintSettle',
  'Mascot.landingHintTap',
] as const

export type LandingSpeechKey = (typeof LANDING_SPEECH_KEYS)[number]

export const LANDING_FIRST_SPEECH_MS = 14_000
export const LANDING_SPEECH_GAP_MS = 28_000
export const LANDING_FIRST_REACTION_MS = 32_000
export const LANDING_REACTION_GAP_MS = 38_000
export const LANDING_SPEECH_DISMISS_MS = 3_000

const AMBIENT_REACTIONS: Array<{
  reaction: MascotReaction
  duration: number
}> = [
  { reaction: 'welcome', duration: 2_200 },
  { reaction: 'thinking', duration: 1_600 },
  { reaction: 'success', duration: 2_500 },
]

function wrapIndex(index: number) {
  const length = LANDING_SPEECH_KEYS.length
  return ((index % length) + length) % length
}

function isAuthFieldFocused() {
  const active = document.activeElement
  return (
    active instanceof HTMLElement &&
    Boolean(active.closest('[data-auth-panel]'))
  )
}

export function useLandingMascot() {
  const mascot = useMascotController()
  const mascotState = useMascotState()
  const reducedMotion = useReducedMotion()
  const [speechIndex, setSpeechIndex] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [cycle, setCycle] = useState(0)
  const speechIndexRef = useRef(-1)
  const speechOpenRef = useRef(false)
  const reactionRef = useRef(mascotState?.reaction ?? 'idle')
  const ambientIndex = useRef(0)

  useEffect(() => {
    reactionRef.current = mascotState?.reaction ?? 'idle'
  }, [mascotState?.reaction])

  useEffect(() => {
    speechOpenRef.current = speechIndex !== null
  }, [speechIndex])

  const speechKey =
    speechIndex === null ? null : LANDING_SPEECH_KEYS[speechIndex]

  const openSpeech = useCallback((index: number) => {
    const next = wrapIndex(index)
    speechIndexRef.current = next
    setSpeechIndex(next)
  }, [])

  const resetIdle = useCallback(() => {
    setCycle((current) => current + 1)
  }, [])

  const onTap = useCallback(() => {
    resetIdle()
    mascot.react('success', 900)
    openSpeech(speechIndexRef.current + 1)
  }, [mascot, openSpeech, resetIdle])

  useEffect(() => {
    const syncPause = () => {
      setPaused(document.visibilityState === 'hidden' || isAuthFieldFocused())
    }
    syncPause()
    document.addEventListener('visibilitychange', syncPause)
    document.addEventListener('focusin', syncPause)
    document.addEventListener('focusout', syncPause)
    return () => {
      document.removeEventListener('visibilitychange', syncPause)
      document.removeEventListener('focusin', syncPause)
      document.removeEventListener('focusout', syncPause)
    }
  }, [])

  useEffect(() => {
    if (speechIndex === null) return
    const timer = window.setTimeout(
      () => setSpeechIndex(null),
      LANDING_SPEECH_DISMISS_MS,
    )
    return () => window.clearTimeout(timer)
  }, [speechIndex])

  useEffect(() => {
    if (paused) return
    let interval = 0
    const first = window.setTimeout(() => {
      openSpeech(speechIndexRef.current + 1)
      interval = window.setInterval(() => {
        openSpeech(speechIndexRef.current + 1)
      }, LANDING_SPEECH_GAP_MS)
    }, LANDING_FIRST_SPEECH_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [cycle, openSpeech, paused])

  useEffect(() => {
    if (paused || reducedMotion) return
    let interval = 0
    const first = window.setTimeout(() => {
      const pose = () => {
        if (speechOpenRef.current || reactionRef.current !== 'idle') return
        const next =
          AMBIENT_REACTIONS[ambientIndex.current % AMBIENT_REACTIONS.length]
        ambientIndex.current += 1
        mascot.react(next.reaction, next.duration)
      }
      pose()
      interval = window.setInterval(pose, LANDING_REACTION_GAP_MS)
    }, LANDING_FIRST_REACTION_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [cycle, mascot, paused, reducedMotion])

  return {
    onTap,
    reducedMotion,
    speechKey,
    reaction: mascotState?.reaction,
    reactionKey: mascotState?.reactionKey,
  }
}

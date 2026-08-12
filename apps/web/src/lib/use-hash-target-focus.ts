import { useReducedMotion } from 'motion/react'
import { useEffect } from 'react'

export const HASH_FOCUS_MS = 1_800
const HASH_FOCUS_WAIT_MS = 8_000

function readHashId(hash?: string) {
  const raw =
    hash ?? (typeof window === 'undefined' ? '' : window.location.hash)
  return decodeURIComponent(raw.replace(/^#/, ''))
}

function prefersReducedScroll(reducedMotion: boolean | null) {
  return Boolean(reducedMotion)
}

/**
 * Scrolls the element matching `location.hash` into the middle of the viewport
 * and flashes a highlight. Retries until the node exists so async settings
 * sections still get focused.
 */
export function useHashTargetFocus(hash?: string) {
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    let observer: MutationObserver | null = null
    let focusTimer: number | null = null
    let pollTimer: number | null = null
    let focused: HTMLElement | null = null
    const startedAt = Date.now()

    function stopWaiting() {
      observer?.disconnect()
      observer = null
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    }

    function clearHighlight() {
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer)
        focusTimer = null
      }
      focused?.removeAttribute('data-hash-focus')
      focused = null
    }

    function apply(element: HTMLElement) {
      if (focused === element) return
      clearHighlight()
      focused = element
      element.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: prefersReducedScroll(reducedMotion) ? 'auto' : 'smooth',
      })
      element.setAttribute('data-hash-focus', '')
      focusTimer = window.setTimeout(() => {
        if (focused === element) {
          element.removeAttribute('data-hash-focus')
          focused = null
        }
        focusTimer = null
      }, HASH_FOCUS_MS)
    }

    function tryFocus() {
      const id = readHashId(hash)
      if (!id) {
        stopWaiting()
        clearHighlight()
        return
      }

      const element = document.getElementById(id)
      if (element) {
        stopWaiting()
        apply(element)
        return
      }

      if (!observer) {
        observer = new MutationObserver(() => tryFocus())
        observer.observe(document.body, { childList: true, subtree: true })
      }
      if (Date.now() - startedAt > HASH_FOCUS_WAIT_MS) {
        stopWaiting()
        return
      }
      if (pollTimer === null) {
        pollTimer = window.setInterval(tryFocus, 50)
      }
    }

    tryFocus()
    window.addEventListener('hashchange', tryFocus)
    return () => {
      window.removeEventListener('hashchange', tryFocus)
      stopWaiting()
      clearHighlight()
    }
  }, [hash, reducedMotion])
}

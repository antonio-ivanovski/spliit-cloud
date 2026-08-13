import { useReducedMotion } from 'motion/react'
import { useEffect } from 'react'

export const HASH_FOCUS_MS = 1_800
const HASH_FOCUS_WAIT_MS = 8_000
const HASH_SCROLL_RETRY_MS = 0

function readHashId(hash?: string) {
  const raw =
    hash ?? (typeof window === 'undefined' ? '' : window.location.hash)
  return decodeURIComponent(raw.replace(/^#/, ''))
}

function prefersReducedScroll(reducedMotion: boolean | null) {
  return Boolean(reducedMotion)
}

function readVisibleHeaderHeight() {
  let height = 0
  for (const node of document.querySelectorAll('[data-app-header]')) {
    if (!(node instanceof HTMLElement)) continue
    height = Math.max(height, node.getBoundingClientRect().height)
  }
  return height
}

/**
 * Centers `element` in the viewport below the fixed app header. Uses
 * `window.scrollTo` so overflow clipping on settings cards cannot swallow
 * `scrollIntoView`.
 */
export function scrollElementToVisibleCenter(
  element: HTMLElement,
  behavior: ScrollBehavior,
) {
  const headerHeight = readVisibleHeaderHeight()
  const rect = element.getBoundingClientRect()
  const visibleHeight = Math.max(window.innerHeight - headerHeight, 0)
  const top = Math.max(
    0,
    window.scrollY +
      rect.top -
      headerHeight -
      (visibleHeight - rect.height) / 2,
  )
  window.scrollTo({ top, behavior })
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
    let scrollTimer: number | null = null
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

    function cancelScroll() {
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer)
        scrollTimer = null
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
      cancelScroll()
      focused = element
      const behavior = prefersReducedScroll(reducedMotion) ? 'auto' : 'smooth'
      const scroll = () => scrollElementToVisibleCenter(element, behavior)
      scroll()
      // Native hash navigation aligns to the top after paint and would hide
      // the row behind the navbar; re-assert once the browser is done.
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null
        if (focused === element) scroll()
      }, HASH_SCROLL_RETRY_MS)
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
        cancelScroll()
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
      cancelScroll()
      clearHighlight()
    }
  }, [hash, reducedMotion])
}

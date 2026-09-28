/**
 * Scroll choreography for failed expense saves.
 *
 * On mobile the Save button sits in a fixed bottom bar while validation
 * messages render next to their fields further up the page, so a failed save
 * can look like a no-op. Every invalid-submit path funnels through here: focus
 * the offending input (when one exists) and smooth-scroll it — or the error
 * message itself for root errors with no single input — into the visible area
 * between the fixed app header and the fixed action bar.
 */

export type ErrorAnchorKey = 'paidFor' | 'paidByList' | 'items' | 'summary'

export function getErrorScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'auto'
  }
  return 'smooth'
}

function readFixedChromeHeights(): { header: number; actionBar: number } {
  if (typeof document === 'undefined') return { header: 0, actionBar: 0 }
  let header = 0
  let actionBar = 0
  for (const node of document.querySelectorAll('[data-app-header]')) {
    if (node instanceof HTMLElement) {
      header = Math.max(header, node.getBoundingClientRect().height)
    }
  }
  for (const node of document.querySelectorAll('[data-fixed-action-bar]')) {
    if (node instanceof HTMLElement) {
      actionBar = Math.max(actionBar, node.getBoundingClientRect().height)
    }
  }
  return { header, actionBar }
}

/**
 * Center `element` in the viewport area that is not covered by the fixed app
 * header (top) or the fixed save action bar (bottom). Uses `window.scrollTo` so
 * overflow clipping on the form cards cannot swallow `scrollIntoView`.
 */
export function scrollErrorElementIntoView(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
): void {
  if (typeof window === 'undefined') return
  const { header, actionBar } = readFixedChromeHeights()
  const rect = element.getBoundingClientRect()
  const visibleHeight = Math.max(window.innerHeight - header - actionBar, 0)
  const top = Math.max(
    0,
    window.scrollY + rect.top - header - (visibleHeight - rect.height) / 2,
  )
  window.scrollTo({ top, behavior })
}

function reveal(element: HTMLElement, behavior: ScrollBehavior): void {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    window.requestAnimationFrame(() =>
      scrollErrorElementIntoView(element, behavior),
    )
  } else {
    scrollErrorElementIntoView(element, behavior)
  }
}

/**
 * Focus `element` without letting the browser jump, then smooth-scroll it to
 * the visible center. `preventScroll` avoids the native instant jump (which
 * would hide the field behind the fixed header) fighting the animated scroll.
 */
export function focusAndScrollError(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
): void {
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
  reveal(element, behavior)
}

/**
 * Map a first-error path (see `firstErrorPath` in the expense form) to the card
 * that renders its message. Returns `null` for plain fields whose input is
 * itself the scroll target.
 */
export function resolveErrorAnchorKey(path: string): ErrorAnchorKey | null {
  if (/^(paidFor|splitMode)([.[]|$)/.test(path)) return 'paidFor'
  if (/^(paidByList|paidBySplitMode|isMultiPayer)([.[]|$)/.test(path)) {
    return 'paidByList'
  }
  if (/^(items|itemizedRemainder)([.[]|$)/.test(path)) return 'items'
  return null
}

/**
 * Scroll to the rendered error inside the anchored card: prefer the per-row
 * summary (root sum errors), then any visible alert/message, then the anchor
 * itself.
 */
export function scrollToAnchoredError(
  root: ParentNode,
  key: ErrorAnchorKey,
  behavior: ScrollBehavior = 'smooth',
): boolean {
  if (typeof document === 'undefined') return false
  const anchor =
    root instanceof Element
      ? root.matches(`[data-expense-error-anchor="${key}"]`)
        ? (root as HTMLElement)
        : root.querySelector<HTMLElement>(
            `[data-expense-error-anchor="${key}"]`,
          )
      : null
  if (!anchor) return false
  const rowErrors = anchor.querySelector<HTMLElement>(
    '[data-expense-row-errors]',
  )
  if (rowErrors) {
    scrollErrorElementIntoView(rowErrors, behavior)
    return true
  }
  const message = anchor.querySelector<HTMLElement>(
    '[role="alert"], p.text-destructive',
  )
  if (message && message.textContent?.trim()) {
    scrollErrorElementIntoView(message, behavior)
    return true
  }
  scrollErrorElementIntoView(anchor, behavior)
  return true
}

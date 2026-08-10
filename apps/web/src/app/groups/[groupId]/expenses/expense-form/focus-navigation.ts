import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'

export const expenseTabPriority = {
  title: 10,
  amount: 20,
  date: 30,
  item: 40,
  paidFor: 50,
  paidBy: 60,
  submit: 70,
} as const

const focusableSelector = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

function isVisible(element: HTMLElement, boundary?: HTMLElement) {
  let current: HTMLElement | null = element
  while (current) {
    if (
      current.hidden ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false
    }
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === 'none' || style?.visibility === 'hidden')
      return false
    if (current === boundary) break
    current = current.parentElement
  }
  return true
}

function nativeTabStops(root: ParentNode, boundary?: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      isVisible(element, boundary),
  )
}

function priorityOf(element: HTMLElement) {
  const owner = element.closest<HTMLElement>('[data-expense-tab-priority]')
  if (!owner) return null
  const value = Number(owner.dataset.expenseTabPriority)
  return Number.isFinite(value) ? value : null
}

function orderedFormTabStops(form: HTMLFormElement) {
  const nativeOrder = nativeTabStops(form, form)
  const primary = nativeOrder
    .map((element, domIndex) => ({
      element,
      domIndex,
      priority: priorityOf(element),
    }))
    .filter(
      (entry): entry is typeof entry & { priority: number } =>
        entry.priority !== null,
    )
    .sort(
      (left, right) =>
        left.priority - right.priority || left.domIndex - right.domIndex,
    )
    .map(({ element }) => element)
  const primarySet = new Set(primary)
  const secondary = nativeOrder
    .map((element, domIndex) => ({
      element,
      domIndex,
      defer:
        element.closest('[data-expense-tab-after-secondary]') !== null ? 1 : 0,
    }))
    .filter(({ element }) => !primarySet.has(element))
    .sort(
      (left, right) =>
        left.defer - right.defer || left.domIndex - right.domIndex,
    )
    .map(({ element }) => element)
  return [...primary, ...secondary]
}

function externalTabStop(form: HTMLFormElement, direction: 1 | -1) {
  const candidates = nativeTabStops(form.ownerDocument).filter(
    (element) => !form.contains(element),
  )
  if (direction === 1) {
    return candidates.find(
      (element) =>
        form.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
  }
  return candidates.findLast(
    (element) =>
      form.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING,
  )
}

/**
 * Gives the expense form a task-oriented Tab path while retaining every
 * secondary control in a second, DOM-ordered pass. Portalled surfaces sit
 * outside the form and therefore keep their own native focus management.
 */
export function useExpenseFormTabNavigation(
  formRef: RefObject<HTMLFormElement | null>,
) {
  const keyboardEntryDirection = useRef<1 | -1 | null>(null)
  const movingFocus = useRef(false)

  useEffect(() => {
    const document = formRef.current?.ownerDocument
    if (!document) return

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      keyboardEntryDirection.current =
        event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : null
    }
    const handlePointerDown = () => {
      keyboardEntryDirection.current = null
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [formRef])

  const onFocusCapture = (event: FocusEvent<HTMLFormElement>) => {
    if (movingFocus.current) return
    const form = formRef.current
    const direction = keyboardEntryDirection.current
    if (!form || !direction) return
    if (
      event.relatedTarget instanceof Node &&
      form.contains(event.relatedTarget)
    ) {
      return
    }

    const ordered = orderedFormTabStops(form)
    const destination = direction === 1 ? ordered[0] : ordered.at(-1)
    if (destination && destination !== event.target) {
      movingFocus.current = true
      destination.focus()
      movingFocus.current = false
    }
  }

  const onKeyDownCapture = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      event.defaultPrevented ||
      event.key !== 'Tab' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return
    }
    const form = formRef.current
    if (!form || !(event.target instanceof HTMLElement)) return

    const ordered = orderedFormTabStops(form)
    const currentIndex = ordered.indexOf(event.target)
    if (currentIndex < 0) return

    const direction = event.shiftKey ? -1 : 1
    const destination = ordered[currentIndex + direction]
    if (destination) {
      event.preventDefault()
      movingFocus.current = true
      destination.focus()
      movingFocus.current = false
      return
    }

    const outside = externalTabStop(form, direction)
    if (outside) {
      event.preventDefault()
      movingFocus.current = true
      outside.focus()
      movingFocus.current = false
    }
  }

  return { onFocusCapture, onKeyDownCapture }
}

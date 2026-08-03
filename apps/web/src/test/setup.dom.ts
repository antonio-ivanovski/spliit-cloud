import '@testing-library/jest-dom'
import { act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import './setup.shared'

// ── Polyfill window.matchMedia ──────────────────────────────────────────
// Base UI primitives and useMediaQuery depend on it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// ── Polyfill IntersectionObserver ───────────────────────────────────────
// Used by react-intersection-observer (expense list infinite scroll).
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = '0px'
    readonly scrollMargin: string = '0px'
    readonly thresholds: ReadonlyArray<number> = [0]

    constructor() {}

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  },
})

// ── Polyfill ResizeObserver ─────────────────────────────────────────────
// Required by Base UI dialogs / popovers / drawers and embla carousel.
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: class MockResizeObserver implements ResizeObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

// ── Polyfill PointerEvent (canvas) ──────────────────────────────────────
// Required by Base UI / pointer interaction in jsdom.
if (!globalThis.PointerEvent) {
  class PointerEvent extends Event {
    readonly pointerType = 'mouse'
    constructor(type: string, init?: PointerEventInit) {
      super(type, init)
    }
  }
  Object.defineProperty(globalThis, 'PointerEvent', {
    writable: true,
    value: PointerEvent,
  })
}

// ── Polyfill pointer-capture methods (drawer swipe gestures) ────────────
// Base UI's drawer calls setPointerCapture / releasePointerCapture on
// pointer events to track swipe gestures. Stub them to no-ops when missing.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function () {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function () {}
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function () {
      return false
    }
  }
}

// ── Polyfill HTMLDialogElement ──────────────────────────────────────────
if (typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype) {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  }
}

// ── Polyfill Element.scrollIntoView (Select / focus management) ─────────
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// ── requestAnimationFrame ─────────────────────────────────────────────
// Base UI opens menus/selects inside rAF (floating-ui useClick). Map rAF to
// setTimeout(0) so the open runs after the full pointer sequence — a sync
// stub remounts the trigger mid-click and poisons later tests.
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  return setTimeout(() => cb(performance.now()), 0) as unknown as number
})
vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  clearTimeout(id)
})

// Flush Base UI's deferred open after user-event pointer/keyboard actions.
const flushBaseUiFrames = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

const originalUserSetup = userEvent.setup.bind(userEvent)
Object.defineProperty(userEvent, 'setup', {
  configurable: true,
  value: (options?: Parameters<typeof userEvent.setup>[0]) => {
    const user = originalUserSetup(options)
    const wrap =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const result = await fn(...args)
        await flushBaseUiFrames()
        return result
      }
    return {
      ...user,
      click: wrap(user.click.bind(user)),
      dblClick: wrap(user.dblClick.bind(user)),
      tripleClick: wrap(user.tripleClick.bind(user)),
      pointer: wrap(user.pointer.bind(user)),
      keyboard: wrap(user.keyboard.bind(user)),
      type: wrap(user.type.bind(user)),
      clear: wrap(user.clear.bind(user)),
      selectOptions: wrap(user.selectOptions.bind(user)),
      deselectOptions: wrap(user.deselectOptions.bind(user)),
      upload: wrap(user.upload.bind(user)),
      tab: wrap(user.tab.bind(user)),
      hover: wrap(user.hover.bind(user)),
      unhover: wrap(user.unhover.bind(user)),
      copy: wrap(user.copy.bind(user)),
      cut: wrap(user.cut.bind(user)),
      paste: wrap(user.paste.bind(user)),
    }
  },
})

// Make navigator writable so userEvent can attach its clipboard stub.
const navProto = Object.getPrototypeOf(navigator)
if (navProto && Object.getOwnPropertyDescriptor(navProto, 'clipboard')) {
  delete (navProto as { clipboard?: PropertyDescriptor }).clipboard
}
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  configurable: true,
  value: {
    writeText: () => Promise.resolve(),
    readText: () => Promise.resolve(''),
  },
})

import '@testing-library/jest-dom'
import './setup.shared'

// ── Polyfill window.matchMedia ──────────────────────────────────────────
// Radix UI primitives and useMediaQuery hook depend on it.
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
// Required by Radix UI dialogs / popovers / drawers and embla carousel.
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
// Required by radix-ui focus management.
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

// ── Polyfill pointer-capture methods (vaul) ──────────────────────────────
// vaul's drawer calls setPointerCapture / releasePointerCapture on
// pointer events to track drag gestures. Stub them to no-ops when missing.
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

// ── Polyfill HTMLDialogElement (used by some Radix dialog internals) ───
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

// ── Polyfill Element.scrollIntoView (Radix UI Select depends on it) ────
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// ── Suppress Radix UI "missing data-state" act() warnings ──────────────
let rafHandle = 0
vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => {
  rafHandle++
  return rafHandle
})
vi.stubGlobal('cancelAnimationFrame', () => {})

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

import '@testing-library/jest-dom'

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

// ── Polyfill HTMLDialogElement (used by some Radix dialog internals) ───
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

// ── Suppress Radix UI "missing data-state" act() warnings ──────────────
let rafHandle = 0
vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => {
  rafHandle++
  return rafHandle
})
vi.stubGlobal('cancelAnimationFrame', () => {})

// Make navigator writable so userEvent can attach its clipboard stub.
// jsdom defines navigator.clipboard as non-configurable; deleting it
// from the prototype lets userEvent.setup() attach its own stub.
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

// ── Initialize i18n (loads en-US locale for tests) ─────────────────────
import { initI18n } from '@/i18n/react'
await initI18n()

// ── Stub import.meta.env defaults ──────────────────────────────────────
vi.stubGlobal('import.meta', {
  env: {
    VITE_API_URL: 'http://localhost:3001',
    VITE_ENABLE_GOOGLE_OAUTH: 'false',
    VITE_ENABLE_GITHUB_OAUTH: 'false',
    MODE: 'test',
    DEV: true,
    PROD: false,
  },
})

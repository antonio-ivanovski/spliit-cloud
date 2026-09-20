import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

// ── Helpers ─────────────────────────────────────────────────────────────

/** Force the responsive primitive to render in desktop mode (Dialog). */
function mockDesktopMediaQuery() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

/** Force the responsive primitive to render in mobile mode (Drawer). */
function mockMobileMediaQuery() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

function SampleDialog() {
  return (
    <ResponsiveDialog defaultOpen>
      <ResponsiveDialogTrigger render={<button type="button">Open</button>} />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Confirm action</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This action cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <p>Body content</p>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Confirm</button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function NestedDialogs({ threeLevels = false }: { threeLevels?: boolean }) {
  return (
    <ResponsiveDialog defaultOpen>
      <ResponsiveDialogContent data-testid="parent-dialog">
        <ResponsiveDialogTitle>Parent dialog</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Parent description
        </ResponsiveDialogDescription>
        <ResponsiveDialog defaultOpen>
          <ResponsiveDialogContent
            className="nested-custom-class max-w-xl"
            data-testid="nested-dialog"
          >
            <ResponsiveDialogTitle>Nested dialog</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Nested description
            </ResponsiveDialogDescription>
            {threeLevels ? (
              <ResponsiveDialog defaultOpen>
                <ResponsiveDialogContent data-testid="third-dialog">
                  <ResponsiveDialogTitle>Third dialog</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Third description
                  </ResponsiveDialogDescription>
                </ResponsiveDialogContent>
              </ResponsiveDialog>
            ) : null}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ResponsiveDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders desktop content as a centered dialog (Radix)', () => {
    mockDesktopMediaQuery()
    render(<SampleDialog />)

    // Radix Dialog exposes role="dialog" and renders the title as a heading.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /confirm action/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this action cannot be undone/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
    // Buttons rendered inside the dialog.
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
  })

  it('positions the close button at the logical end in RTL layouts', () => {
    mockDesktopMediaQuery()
    document.documentElement.dir = 'rtl'
    render(<SampleDialog />)

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('end-4')
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveClass(
      'right-4',
    )
    document.documentElement.dir = 'ltr'
  })

  it('renders mobile content as a bottom drawer (Base UI)', () => {
    mockMobileMediaQuery()
    render(<SampleDialog />)

    // Base UI exposes role="dialog" on the drawer popup so
    // accessibility tooling treats it the same as a modal.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveClass('overflow-hidden')
    // Title remains an h2 on mobile.
    expect(
      screen.getByRole('heading', { name: /confirm action/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
    expect(screen.getByText('Body content').parentElement).toHaveClass(
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
    )
  })

  it('dims the parent and elevates a nested desktop dialog', () => {
    mockDesktopMediaQuery()
    render(<NestedDialogs />)

    expect(screen.getByTestId('parent-dialog')).toHaveAttribute(
      'data-nested-dialog-open',
    )
    expect(screen.getByTestId('parent-dialog')).toHaveClass(
      'data-[nested-dialog-open]:scale-[0.96]',
      'data-[nested-dialog-open]:brightness-75',
    )
    expect(screen.getByTestId('nested-dialog')).toHaveClass(
      'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)]',
      'ring-1',
      'ring-foreground/20',
      'nested-custom-class',
      'max-w-xl',
    )
  })

  it('dims the parent and elevates a nested mobile drawer', () => {
    mockMobileMediaQuery()
    render(<NestedDialogs />)

    expect(screen.getByTestId('parent-dialog')).toHaveAttribute(
      'data-nested-drawer-open',
    )
    expect(screen.getByTestId('parent-dialog')).toHaveClass(
      'data-[nested-drawer-open]:-translate-y-2',
      'data-[nested-drawer-open]:scale-[0.96]',
      'data-[nested-drawer-open]:brightness-75',
    )
    expect(screen.getByTestId('nested-dialog')).toHaveClass(
      'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)]',
      'ring-1',
      'ring-foreground/20',
      'nested-custom-class',
      'max-w-xl',
    )
  })

  it('does not apply nested elevation to a standalone dialog or drawer', () => {
    mockDesktopMediaQuery()
    const { unmount } = render(<SampleDialog />)

    expect(screen.getByRole('dialog')).toHaveClass('shadow-lg')
    expect(screen.getByRole('dialog')).not.toHaveClass(
      'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)]',
      'ring-foreground/20',
    )
    expect(screen.getByRole('dialog')).not.toHaveAttribute(
      'data-nested-dialog-open',
    )

    unmount()
    mockMobileMediaQuery()
    render(<SampleDialog />)

    expect(screen.getByRole('dialog')).toHaveClass('shadow-xl')
    expect(screen.getByRole('dialog')).not.toHaveClass(
      'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)]',
      'ring-foreground/20',
    )
    expect(screen.getByRole('dialog')).not.toHaveAttribute(
      'data-nested-drawer-open',
    )
  })

  it('recedes every inactive layer in a three-dialog stack', () => {
    mockDesktopMediaQuery()
    render(<NestedDialogs threeLevels />)

    expect(screen.getByTestId('parent-dialog')).toHaveAttribute(
      'data-nested-dialog-open',
    )
    expect(screen.getByTestId('nested-dialog')).toHaveAttribute(
      'data-nested-dialog-open',
    )
    expect(screen.getByTestId('third-dialog')).not.toHaveAttribute(
      'data-nested-dialog-open',
    )
    expect(screen.getByTestId('third-dialog')).toHaveClass(
      'shadow-[0_24px_80px_-20px_rgb(0_0_0/0.65)]',
      'ring-foreground/20',
    )
  })

  it('keeps title and description accessible in both modes', () => {
    mockDesktopMediaQuery()
    const { unmount } = render(<SampleDialog />)
    expect(
      screen.getByRole('heading', { name: /confirm action/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this action cannot be undone/i),
    ).toBeInTheDocument()
    unmount()

    mockMobileMediaQuery()
    render(<SampleDialog />)
    expect(
      screen.getByRole('heading', { name: /confirm action/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this action cannot be undone/i),
    ).toBeInTheDocument()
  })

  it('passes open and onOpenChange through to the underlying primitive', () => {
    mockDesktopMediaQuery()
    const onOpenChange = vi.fn()
    render(
      <ResponsiveDialog open onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Controlled</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>desc</ResponsiveDialogDescription>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /controlled/i }),
    ).toBeInTheDocument()
  })

  it('publishes the visual-viewport keyboard inset to a mobile drawer', async () => {
    mockMobileMediaQuery()

    let viewportHeight = window.innerHeight
    let viewportOffsetTop = 0
    const resizeListeners = new Set<(event: Event) => void>()
    const scrollListeners = new Set<(event: Event) => void>()
    const visualViewport = {
      width: window.innerWidth,
      get height() {
        return viewportHeight
      },
      offsetLeft: 0,
      get offsetTop() {
        return viewportOffsetTop
      },
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      onresize: null,
      onscroll: null,
      addEventListener: (type: string, listener: EventListener) => {
        if (type === 'resize' && typeof listener === 'function') {
          resizeListeners.add(listener as (event: Event) => void)
        }
        if (type === 'scroll' && typeof listener === 'function') {
          scrollListeners.add(listener as (event: Event) => void)
        }
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (type === 'resize' && typeof listener === 'function') {
          resizeListeners.delete(listener as (event: Event) => void)
        }
        if (type === 'scroll' && typeof listener === 'function') {
          scrollListeners.delete(listener as (event: Event) => void)
        }
      },
      dispatchEvent: () => false,
    } as unknown as VisualViewport
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      'visualViewport',
    )
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })

    try {
      const renderDialog = (open: boolean) => (
        <ResponsiveDialog open={open}>
          <ResponsiveDialogContent>
            <ResponsiveDialogTitle>Keyboard aware</ResponsiveDialogTitle>
            <input type="text" placeholder="Search" />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )
      const { rerender } = render(renderDialog(true))

      const popup = screen.getByRole('dialog')
      const viewport = popup.parentElement
      expect(viewport?.className).toContain(
        'pb-[var(--drawer-keyboard-inset,0px)]',
      )
      expect(popup.className).toContain(
        'max-h-[calc(100dvh-3rem-var(--drawer-keyboard-inset,0px))]',
      )

      const input = screen.getByPlaceholderText('Search')
      input.focus()
      viewportHeight = window.innerHeight - 336
      const resize = new Event('resize')
      resizeListeners.forEach((listener) => listener(resize))

      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('336px')
      })

      fireEvent.blur(input)
      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('0px')
      })

      viewportOffsetTop = 24
      fireEvent.focus(input)
      resizeListeners.forEach((listener) => listener(new Event('resize')))
      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('312px')
      })

      fireEvent.blur(input)
      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('0px')
      })

      input.focus()
      viewportOffsetTop = 0
      resizeListeners.forEach((listener) => listener(new Event('resize')))
      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('336px')
      })

      rerender(renderDialog(false))
      await waitFor(() => {
        expect(
          viewport?.style.getPropertyValue('--drawer-keyboard-inset'),
        ).toBe('')
      })

      rerender(renderDialog(true))
      const reopenedViewport = screen.getByRole('dialog').parentElement
      expect(
        reopenedViewport?.style.getPropertyValue('--drawer-keyboard-inset'),
      ).not.toBe('336px')
    } finally {
      if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      } else {
        // oxlint-disable-next-line typescript/no-explicit-any
        delete (window as any).visualViewport
      }
    }
  })
})

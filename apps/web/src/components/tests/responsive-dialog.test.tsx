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
import { render, screen } from '@/test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
      <ResponsiveDialogTrigger asChild>
        <button type="button">Open</button>
      </ResponsiveDialogTrigger>
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

  it('renders mobile content as a bottom drawer (vaul)', () => {
    mockMobileMediaQuery()
    render(<SampleDialog />)

    // vaul also exposes role="dialog" on the drawer container so
    // accessibility tooling treats it the same as a modal.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Title remains an h2 on mobile.
    expect(
      screen.getByRole('heading', { name: /confirm action/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
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
})

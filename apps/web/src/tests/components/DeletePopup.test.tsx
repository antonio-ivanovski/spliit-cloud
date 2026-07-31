import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeletePopup } from '@/components/delete-popup'
import { render, screen, waitFor } from '@/test/test-utils'

// The component now uses the responsive primitive, which switches between
// Radix Dialog (desktop) and Base UI Drawer (mobile) based on matchMedia.
// The Base UI Drawer keeps the dialog element in the DOM during its close
// animation, so we drive these tests in desktop mode to assert Radix's
// mount/unmount behaviour. The mobile path is covered by the primitive
// test in src/components/tests/responsive-dialog.test.tsx.
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

describe('DeletePopup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a trigger button with the label text', () => {
    mockDesktopMediaQuery()
    render(<DeletePopup onDelete={vi.fn()} />)
    // The trigger button is rendered with the translated "Delete" label
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('clicking the trigger opens a dialog with title and description', async () => {
    mockDesktopMediaQuery()
    const { user } = render(<DeletePopup onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /delete/i }))

    // Dialog content should appear (Radix renders in a portal)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /delete this expense/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/do you really want to delete this expense/i),
    ).toBeInTheDocument()
  })

  it('clicking the "yes" button calls onDelete (async)', async () => {
    mockDesktopMediaQuery()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<DeletePopup onDelete={onDelete} />)

    // Open the dialog
    await user.click(screen.getByRole('button', { name: /delete/i }))

    // Click the "Yes" button (inside the dialog)
    const yesButton = screen.getByRole('button', { name: /^yes$/i })
    await user.click(yesButton)

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('clicking "cancel" closes the dialog', async () => {
    mockDesktopMediaQuery()
    const { user } = render(<DeletePopup onDelete={vi.fn()} />)

    // Open the dialog
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Click the "Cancel" button inside the dialog
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    // Dialog should close (disappear from the DOM)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

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
      screen.getByText(/this expense will be permanently removed/i),
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

  it('requires the expense title before deleting a protected expense', async () => {
    mockDesktopMediaQuery()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <DeletePopup onDelete={onDelete} confirmationTarget="Dinner" />,
    )

    await user.click(screen.getByRole('button', { name: /delete/i }))
    const deleteButton = screen.getByRole('button', { name: /^delete$/i })
    expect(deleteButton).toBeDisabled()
    expect(
      screen.getByText(/to permanently delete the expense/i),
    ).toHaveTextContent(
      'To permanently delete the expense Dinner, type its title exactly as shown below.',
    )

    const input = screen.getByRole('textbox', { name: /enter the name/i })
    await user.type(input, 'Dinner')
    expect(deleteButton).toBeEnabled()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
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

  it('prevents duplicate protected submissions while deletion is pending', async () => {
    mockDesktopMediaQuery()
    let resolveDelete: (() => void) | undefined
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
    )
    const { user } = render(
      <DeletePopup onDelete={onDelete} confirmationTarget="Dinner" />,
    )

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.type(screen.getByRole('textbox'), 'Dinner')
    await user.keyboard('{Enter}{Enter}')

    expect(onDelete).toHaveBeenCalledTimes(1)
    resolveDelete?.()
  })
})

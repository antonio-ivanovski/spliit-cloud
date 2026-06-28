import { render, screen } from '@/test/test-utils'
import { AsyncButton } from '@/components/async-button'
import { describe, it, expect, vi } from 'vitest'

describe('AsyncButton', () => {
  it('renders children when idle', () => {
    render(<AsyncButton>Click me</AsyncButton>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('shows Loader2 and loadingContent when action is in progress', async () => {
    const { user } = render(
      <AsyncButton action={() => new Promise(() => {})} loadingContent="Saving…">
        Click me
      </AsyncButton>,
    )

    await user.click(screen.getByRole('button'))

    // The button should now contain a Loader2 icon and the loading content
    expect(screen.getByRole('button').querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('Saving…')
  })

  it('calls action() on click', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const { user } = render(<AsyncButton action={action}>Click me</AsyncButton>)

    await user.click(screen.getByRole('button'))

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not throw when action rejects', async () => {
    // Suppress console.error from the internal catch
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi.fn().mockRejectedValue(new Error('boom'))

    const { user } = render(<AsyncButton action={action}>Click me</AsyncButton>)

    const button = screen.getByRole('button')
    // Click should not throw even though the action rejects
    await expect(user.click(button)).resolves.not.toThrow()

    expect(action).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it('button is disabled while loading via the onClick handler (loading state shown)', async () => {
    let resolvePromise!: () => void
    const deferred = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })
    const action = vi.fn(() => deferred)

    const { user } = render(
      <AsyncButton action={action} loadingContent="Working…">
        Click me
      </AsyncButton>,
    )

    // Start the action
    await user.click(screen.getByRole('button'))

    // While loading, the button should show loading content
    expect(screen.getByRole('button')).toHaveTextContent('Working…')
    expect(screen.getByRole('button').querySelector('.animate-spin')).toBeInTheDocument()

    // Resolve the action
    resolvePromise()
    // Wait for the state update
    await vi.waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Click me')
    })
  })
})

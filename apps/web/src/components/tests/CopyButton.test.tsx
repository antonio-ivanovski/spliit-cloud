import { CopyButton } from '@/components/copy-button'
import { act, fireEvent, render, screen } from '@/test/test-utils'

describe('CopyButton', () => {
  it('copies the provided text to clipboard on click', async () => {
    const { user } = render(<CopyButton text="hello" />)
    // Spy after render because userEvent.setup() replaces navigator.clipboard
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    await user.click(screen.getByRole('button'))
    expect(writeTextSpy).toHaveBeenCalledWith('hello')
  })

  it('shows check icon after click and reverts to copy icon after 1 second', () => {
    vi.useFakeTimers()
    render(<CopyButton text="test" />)
    // Spy after render because userEvent.setup() replaces navigator.clipboard
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    const button = screen.getByRole('button')

    // Initially shows copy icon
    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()

    // Click to copy
    act(() => {
      fireEvent.click(button)
    })

    // After click, shows check icon and clipboard was called
    expect(writeTextSpy).toHaveBeenCalledWith('test')
    expect(button.querySelector('.lucide-copy')).not.toBeInTheDocument()
    expect(button.querySelector('.lucide-check')).toBeInTheDocument()

    // Advance time by 1 second (the timeout duration)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // After timeout, reverts to copy icon
    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})

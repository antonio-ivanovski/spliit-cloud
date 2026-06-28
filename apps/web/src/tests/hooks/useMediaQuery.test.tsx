import { useMediaQuery } from '@/lib/hooks'
import { act, render, screen } from '@/test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ── Helper component ───────────────────────────────────────────────────

function TestComponent({ query }: { query: string }) {
  const matches = useMediaQuery(query)
  return <div data-testid="result">{matches ? 'true' : 'false'}</div>
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false when media query does not match', () => {
    render(<TestComponent query="(min-width: 9999px)" />)
    expect(screen.getByTestId('result')).toHaveTextContent('false')
  })

  it('returns true when matchMedia returns matches: true', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(min-width: 768px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    } as unknown as MediaQueryList)

    render(<TestComponent query="(min-width: 768px)" />)
    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })

  it('listens for media query changes and updates the returned value', () => {
    // Use a mutable variable so the listener sees the new value
    let currentMatches = false
    let changeHandler: (() => void) | undefined

    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      get matches() {
        return currentMatches
      },
      media: query,
      onchange: null,
      addListener: vi.fn((cb: () => void) => {
        changeHandler = cb
      }),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }))

    render(<TestComponent query="(min-width: 768px)" />)
    expect(screen.getByTestId('result')).toHaveTextContent('false')

    // Simulate a media query change
    currentMatches = true
    act(() => {
      changeHandler?.()
    })
    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })

  it('cleans up listener on unmount', () => {
    const removeListener = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(min-width: 768px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    } as unknown as MediaQueryList)

    const { unmount } = render(<TestComponent query="(min-width: 768px)" />)
    unmount()
    expect(removeListener).toHaveBeenCalledWith(expect.any(Function))
  })

  it('uses addEventListener when addListener is not available', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(min-width: 768px)',
      onchange: null,
      addListener: undefined,
      removeListener: undefined,
      addEventListener,
      removeEventListener,
      dispatchEvent: vi.fn(() => false),
    } as unknown as MediaQueryList)

    const { unmount } = render(<TestComponent query="(min-width: 768px)" />)
    expect(addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    )
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    )
  })
})

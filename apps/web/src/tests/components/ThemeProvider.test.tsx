import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme } from '@/components/theme-provider'

// ── Helpers ─────────────────────────────────────────────────────────────

function TestConsumer() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Light
      </button>
      <button data-testid="set-system" onClick={() => setTheme('system')}>
        System
      </button>
    </div>
  )
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  cleanup()
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('ThemeProvider', () => {
  it('defaults to system theme when localStorage is empty', () => {
    renderWithProvider(<TestConsumer />)
    expect(screen.getByTestId('theme-value')).toHaveTextContent('system')
  })

  it('reads theme from localStorage on mount', () => {
    localStorage.setItem('theme', 'dark')
    renderWithProvider(<TestConsumer />)
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark')
  })

  it('reads light theme from localStorage on mount', () => {
    localStorage.setItem('theme', 'light')
    renderWithProvider(<TestConsumer />)
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light')
  })

  it('setTheme writes to localStorage and toggles dark class on <html>', async () => {
    const user = userEvent.setup()
    renderWithProvider(<TestConsumer />)

    // Initial: system + matchMedia returns false → light → no dark class
    expect(localStorage.getItem('theme')).toBeNull()

    await user.click(screen.getByTestId('set-dark'))
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByTestId('set-light'))
    expect(localStorage.getItem('theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // Switch to system (matchMedia is false → light)
    await user.click(screen.getByTestId('set-system'))
    expect(localStorage.getItem('theme')).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('system dark preference resolves dark class when theme is system', async () => {
    // Override matchMedia so it reports dark mode preference
    const listeners: Record<
      string,
      Array<(e: MediaQueryListEvent) => void>
    > = {}
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string): MediaQueryList => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (
          event: string,
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          if (!listeners[event]) listeners[event] = []
          listeners[event].push(cb)
        },
        removeEventListener: (
          event: string,
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((l) => l !== cb)
          }
        },
        dispatchEvent: () => true,
      }),
    )

    renderWithProvider(<TestConsumer />)
    expect(screen.getByTestId('theme-value')).toHaveTextContent('system')
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  it('useTheme throws when used outside ThemeProvider', () => {
    // Suppress React's error boundary console.error for the expected exception
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function BadComponent() {
      useTheme()
      return null
    }

    expect(() => render(<BadComponent />)).toThrow(
      'useTheme must be used within ThemeProvider',
    )

    consoleSpy.mockRestore()
  })
})

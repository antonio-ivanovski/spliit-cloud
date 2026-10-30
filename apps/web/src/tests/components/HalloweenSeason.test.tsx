import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTheme } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { HALLOWEEN_DISABLED_STORAGE_KEY } from '@/lib/seasonal-theme'
import { act, fireEvent, render, screen } from '@/test/test-utils'

import indexHtml from '../../../index.html?raw'

const updaterState = vi.hoisted(() => ({
  current: null as null | {
    ready: boolean
    patchPreferences: (patch: { theme: string }) => Promise<boolean>
  },
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useAccountPreferenceUpdater: () => updaterState.current,
}))

function localTimestamp(
  year: number,
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
) {
  return new Date(year, month, day, hours, minutes, 0, 0).getTime()
}

function mockNow(timestamp: number) {
  return vi.spyOn(Date, 'now').mockReturnValue(timestamp)
}

function refreshRuntimeDate() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
}

function ThemeProbe() {
  const {
    theme,
    halloweenInSeason,
    halloweenEnabled,
    setTheme,
    setHalloweenEnabled,
  } = useTheme()

  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <span data-testid="in-season">{String(halloweenInSeason)}</span>
      <span data-testid="enabled">{String(halloweenEnabled)}</span>
      <button type="button" onClick={() => setTheme('light')}>
        Light
      </button>
      <button type="button" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setHalloweenEnabled(false)}>
        Disable Halloween
      </button>
    </div>
  )
}

let themeColorMeta: HTMLMetaElement | undefined

beforeEach(() => {
  updaterState.current = null
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-season')
  document.documentElement.style.removeProperty('color-scheme')
  document.querySelector('meta[name="theme-color"]')?.remove()
  themeColorMeta = document.createElement('meta')
  themeColorMeta.name = 'theme-color'
  themeColorMeta.content = '#ffffff'
  document.head.append(themeColorMeta)
})

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-season')
  document.documentElement.classList.remove('dark')
  document.documentElement.style.removeProperty('color-scheme')
  themeColorMeta?.remove()
})

describe('Halloween before the first app paint', () => {
  // Execute the shipped bootstrap, not a second copy of its date logic: the
  // provider cannot prevent a flash if this independent entry point drifts.
  // The DOM project serves modules over HTTP, so import.meta.url is not a
  // file: URL; Vite's ?raw transform reads the entry document from disk.
  const script = new DOMParser()
    .parseFromString(indexHtml, 'text/html')
    .querySelector('script')!.textContent!

  const bootstrapCases: Array<
    [
      number,
      number,
      number,
      'light' | 'dark',
      boolean,
      string | undefined,
      string,
    ]
  > = [
    [2026, 9, 29, 'light', false, undefined, '#ffffff'],
    [2026, 9, 30, 'light', false, 'halloween', '#FFF0CE'],
    [2026, 9, 31, 'dark', false, 'halloween', '#24152F'],
    [2026, 10, 1, 'light', false, 'halloween', '#FFF0CE'],
    [2026, 10, 2, 'dark', false, undefined, '#0c0a09'],
    [2027, 9, 31, 'dark', true, undefined, '#0c0a09'],
  ]

  it.each(bootstrapCases)(
    'resolves %i/%i/%i with %s and opt-out %s',
    (year, month, day, theme, disabled, season, color) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(year, month, day, 12))
      localStorage.setItem('theme', theme)
      if (disabled) localStorage.setItem(HALLOWEEN_DISABLED_STORAGE_KEY, 'true')

      window.eval(script)

      expect(document.documentElement.dataset.season).toBe(season)
      expect(document.documentElement.classList.contains('dark')).toBe(
        theme === 'dark',
      )
      expect(themeColorMeta?.content).toBe(color)
    },
  )
})

describe('Halloween season integration', () => {
  it('turns on at local midnight on October 30 and off at midnight on November 2', () => {
    const now = mockNow(localTimestamp(2026, 9, 29, 23, 59))
    render(<ThemeProbe />)

    expect(screen.getByTestId('in-season')).toHaveTextContent('false')
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(themeColorMeta?.content).toBe('#ffffff')

    now.mockReturnValue(localTimestamp(2026, 9, 30, 0, 0))
    refreshRuntimeDate()
    expect(screen.getByTestId('in-season')).toHaveTextContent('true')
    expect(document.documentElement.dataset.season).toBe('halloween')
    expect(themeColorMeta?.content).toBe('#FFF0CE')

    now.mockReturnValue(localTimestamp(2026, 10, 1, 23, 59))
    refreshRuntimeDate()
    expect(document.documentElement.dataset.season).toBe('halloween')

    now.mockReturnValue(localTimestamp(2026, 10, 2, 0, 0))
    refreshRuntimeDate()
    expect(screen.getByTestId('in-season')).toHaveTextContent('false')
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(themeColorMeta?.content).toBe('#ffffff')
  })

  it('keeps the seasonal look separate from the light/dark preference', () => {
    localStorage.setItem('theme', 'dark')
    mockNow(localTimestamp(2026, 9, 30, 12))
    render(<ThemeProbe />)

    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.dataset.season).toBe('halloween')
    expect(themeColorMeta?.content).toBe('#24152F')

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(themeColorMeta?.content).toBe('#FFF0CE')
    expect(localStorage.getItem('theme')).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(themeColorMeta?.content).toBe('#24152F')
    expect(localStorage.getItem('theme')).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Disable Halloween' }))
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(themeColorMeta?.content).toBe('#0c0a09')
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('offers an immediate Halloween switch during the season', async () => {
    mockNow(localTimestamp(2026, 9, 30, 12))
    const { user } = render(<ThemeToggle />)
    expect(document.documentElement.dataset.season).toBe('halloween')

    await user.click(screen.getByRole('button', { name: /change theme/i }))
    const onItem = screen.getByRole('menuitemcheckbox', {
      name: /halloween effects/i,
    })
    expect(onItem).toBeChecked()

    await user.click(onItem)
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(localStorage.getItem(HALLOWEEN_DISABLED_STORAGE_KEY)).toBe('true')

    const offItem = screen.getByRole('menuitemcheckbox', {
      name: /halloween effects/i,
    })
    expect(offItem).not.toBeChecked()

    await user.click(offItem)
    expect(document.documentElement.dataset.season).toBe('halloween')
    expect(localStorage.getItem(HALLOWEEN_DISABLED_STORAGE_KEY)).toBeNull()
  })

  it('hides the Halloween switch outside the season', async () => {
    mockNow(localTimestamp(2026, 10, 2, 12))
    const { user } = render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: /change theme/i }))
    expect(
      screen.queryByRole('menuitemcheckbox', { name: /halloween effects/i }),
    ).not.toBeInTheDocument()
    expect(document.documentElement.dataset.season).toBeUndefined()
  })

  it('keeps the Halloween escape switch usable while account preferences are not ready', async () => {
    const patchPreferences = vi.fn(async () => true)
    updaterState.current = { ready: false, patchPreferences }
    mockNow(localTimestamp(2026, 9, 30, 12))
    const { user } = render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: /change theme/i })
    expect(trigger).toBeEnabled()

    await user.click(trigger)

    for (const name of ['Light', 'Dark', 'System default']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }

    const halloweenItem = screen.getByRole('menuitemcheckbox', {
      name: /halloween effects/i,
    })
    expect(halloweenItem).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(halloweenItem)
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(localStorage.getItem(HALLOWEEN_DISABLED_STORAGE_KEY)).toBe('true')
    expect(patchPreferences).not.toHaveBeenCalled()
  })

  it('keeps the theme trigger disabled outside the season while account preferences are not ready', () => {
    updaterState.current = {
      ready: false,
      patchPreferences: vi.fn(async () => true),
    }
    mockNow(localTimestamp(2026, 10, 2, 12))
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: /change theme/i })).toBeDisabled()
  })

  it('recalculates the next-midnight timer after the wall clock moves backward', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 12))
    render(<ThemeProbe />)
    expect(document.documentElement.dataset.season).toBe('halloween')

    // Move the wall clock backward to Oct 29 18:00, outside the season.
    vi.setSystemTime(new Date(2026, 9, 29, 18))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByTestId('in-season')).toHaveTextContent('false')
    expect(document.documentElement.dataset.season).toBeUndefined()

    // Under the new wall clock the next local midnight is six hours away.
    // Timer-only: no second focus/visibility event.
    act(() => {
      vi.advanceTimersByTime(6 * 60 * 60 * 1_000)
    })
    expect(screen.getByTestId('in-season')).toHaveTextContent('true')
    expect(document.documentElement.dataset.season).toBe('halloween')
  })

  it('remembers an opt-out across years and applies cross-tab changes', () => {
    localStorage.setItem(HALLOWEEN_DISABLED_STORAGE_KEY, 'true')
    mockNow(localTimestamp(2027, 9, 30, 12))
    render(<ThemeProbe />)

    expect(screen.getByTestId('in-season')).toHaveTextContent('true')
    expect(screen.getByTestId('enabled')).toHaveTextContent('false')
    expect(document.documentElement.dataset.season).toBeUndefined()

    localStorage.removeItem(HALLOWEEN_DISABLED_STORAGE_KEY)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: HALLOWEEN_DISABLED_STORAGE_KEY,
          newValue: null,
        }),
      )
    })
    expect(screen.getByTestId('enabled')).toHaveTextContent('true')
    expect(document.documentElement.dataset.season).toBe('halloween')

    localStorage.setItem(HALLOWEEN_DISABLED_STORAGE_KEY, 'true')
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: HALLOWEEN_DISABLED_STORAGE_KEY,
          newValue: 'true',
        }),
      )
    })
    expect(screen.getByTestId('enabled')).toHaveTextContent('false')
    expect(document.documentElement.dataset.season).toBeUndefined()
  })

  it('rolls over at local midnight without a reload', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 59))
    render(<ThemeProbe />)

    expect(document.documentElement.dataset.season).toBe('halloween')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(document.documentElement.dataset.season).toBe('halloween')

    act(() => {
      // Two days also covers a DST transition between Nov 1 and Nov 2.
      vi.advanceTimersByTime(48 * 60 * 60 * 1_000)
    })
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(screen.getByTestId('in-season')).toHaveTextContent('false')
  })

  it('keeps the in-memory switch working when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    mockNow(localTimestamp(2026, 9, 30, 12))
    render(<ThemeProbe />)

    expect(document.documentElement.dataset.season).toBe('halloween')

    fireEvent.click(screen.getByRole('button', { name: 'Disable Halloween' }))
    expect(document.documentElement.dataset.season).toBeUndefined()
    expect(screen.getByTestId('enabled')).toHaveTextContent('false')
  })
})

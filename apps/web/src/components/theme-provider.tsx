import type { PropsWithChildren } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  ACCOUNT_THEME_CHANGED_EVENT,
  type AccountTheme as Theme,
} from '@/lib/account-preferences'
import {
  HALLOWEEN_DISABLED_STORAGE_KEY,
  isHalloweenDisabled,
  isHalloweenSeason,
  nextLocalMidnight,
  resolveThemeColor,
  writeHalloweenDisabled,
} from '@/lib/seasonal-theme'

type ThemeContextValue = {
  theme: Theme
  setTheme: (
    theme: Theme,
    options?: { notify?: boolean; persist?: boolean },
  ) => void
  /** True throughout Oct 30-Nov 1, even when the user opted out. */
  halloweenInSeason: boolean
  /** True only while the season is active and the browser opt-out is absent. */
  halloweenEnabled: boolean
  setHalloweenEnabled: (enabled: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: PropsWithChildren<object>) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('theme')
      return saved === 'light' || saved === 'dark' ? saved : 'system'
    } catch {
      return 'system'
    }
  })
  const [now, setNow] = useState(() => new Date(Date.now()))
  const [halloweenDisabled, setHalloweenDisabledState] = useState(() =>
    isHalloweenDisabled(),
  )

  const halloweenInSeason = isHalloweenSeason(now)
  const halloweenEnabled = halloweenInSeason && !halloweenDisabled

  // Re-evaluate the local date at midnight and whenever a background tab
  // returns. A long-lived tab must roll into and out of the season without a
  // reload, including across a timezone or clock change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true

    const scheduleMidnight = (current: Date) => {
      if (timer !== undefined) clearTimeout(timer)
      const next = nextLocalMidnight(current)
      timer = setTimeout(
        refresh,
        Math.max(next.getTime() - current.getTime(), 1_000),
      )
    }

    function refresh() {
      if (!active) return
      const current = new Date(Date.now())
      setNow(current)
      scheduleMidnight(current)
    }

    scheduleMidnight(new Date(Date.now()))

    const onVisibilityChange = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [])

  // The opt-out lives in localStorage so another tab's switch applies here
  // immediately. A missing or unreadable storage area keeps the default on.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== HALLOWEEN_DISABLED_STORAGE_KEY)
        return
      setHalloweenDisabledState(isHalloweenDisabled())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setHalloweenEnabled = useCallback((enabled: boolean) => {
    writeHalloweenDisabled(!enabled)
    setHalloweenDisabledState(!enabled)
  }, [])

  // Only an active season may tag the document. The scenery component and
  // seasonal CSS key off this attribute, so removing it restores the normal
  // app immediately.
  useEffect(() => {
    const root = document.documentElement
    if (halloweenEnabled) {
      root.dataset.season = 'halloween'
    } else {
      root.removeAttribute('data-season')
    }
    return () => {
      if (root.dataset.season === 'halloween')
        root.removeAttribute('data-season')
    }
  }, [halloweenEnabled])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolvedTheme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.classList.toggle(
        'dark',
        resolvedTheme === 'dark',
      )
      document.documentElement.style.colorScheme = resolvedTheme
      // Match the app surface, including explicit overrides of the OS theme.
      // Keep these colors aligned with index.html and styles/theme.css.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          'content',
          resolveThemeColor(resolvedTheme === 'dark', halloweenEnabled),
        )
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [halloweenEnabled, theme])

  const value = useMemo(
    () => ({
      theme,
      halloweenInSeason,
      halloweenEnabled,
      setHalloweenEnabled,
      setTheme: (
        nextTheme: Theme,
        options?: { notify?: boolean; persist?: boolean },
      ) => {
        if (options?.persist !== false) {
          try {
            localStorage.setItem('theme', nextTheme)
          } catch {
            // An unavailable storage area must not prevent a theme change.
          }
        }
        setThemeState(nextTheme)
        if (options?.notify !== false) {
          window.dispatchEvent(
            new CustomEvent(ACCOUNT_THEME_CHANGED_EVENT, { detail: nextTheme }),
          )
        }
      },
    }),
    [halloweenEnabled, halloweenInSeason, setHalloweenEnabled, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// react-doctor-disable-next-line react-doctor/only-export-components -- hook export (use[A-Z]) allowed per rule docs
export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

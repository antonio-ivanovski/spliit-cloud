import type { PropsWithChildren } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import {
  ACCOUNT_THEME_CHANGED_EVENT,
  type AccountTheme as Theme,
} from '@/lib/account-preferences'

type ThemeContextValue = {
  theme: Theme
  setTheme: (
    theme: Theme,
    options?: { notify?: boolean; persist?: boolean },
  ) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: PropsWithChildren<object>) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme | null) ?? 'system'
  })

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolvedTheme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.classList.toggle(
        'dark',
        resolvedTheme === 'dark',
      )
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: (
        nextTheme: Theme,
        options?: { notify?: boolean; persist?: boolean },
      ) => {
        if (options?.persist !== false) {
          localStorage.setItem('theme', nextTheme)
        }
        setThemeState(nextTheme)
        if (options?.notify !== false) {
          window.dispatchEvent(
            new CustomEvent(ACCOUNT_THEME_CHANGED_EVENT, { detail: nextTheme }),
          )
        }
      },
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// react-doctor-disable-next-line react-doctor/only-export-components -- hook export (use[A-Z]) allowed per rule docs
export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

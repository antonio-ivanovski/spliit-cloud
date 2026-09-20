import type { CSSProperties, PropsWithChildren } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

type AmbientAccentContextValue = {
  /** Resolved group accent hex, or null when the default backdrop applies. */
  accent: string | null
  setAmbientAccent: (hex: string | null) => void
}

const AmbientAccentContext = createContext<AmbientAccentContextValue | null>(
  null,
)

/**
 * Provides the ambient backdrop accent. The backdrop lives in `AppShell`
 * (pathname-only, no group data) while the color is known deeper in the tree
 * (group layout), so the group layout pushes its resolved hex up through this
 * context instead of mutating a global.
 */
export function AmbientAccentProvider({ children }: PropsWithChildren) {
  const [accent, setAccent] = useState<string | null>(null)
  const setAmbientAccent = useCallback((hex: string | null) => {
    setAccent(hex)
  }, [])
  const value = useMemo(
    () => ({ accent, setAmbientAccent }),
    [accent, setAmbientAccent],
  )
  return (
    <AmbientAccentContext.Provider value={value}>
      {children}
    </AmbientAccentContext.Provider>
  )
}

function useAmbientAccentContext() {
  const ctx = useContext(AmbientAccentContext)
  if (!ctx) {
    throw new Error(
      'useAmbientAccent must be used inside <AmbientAccentProvider>',
    )
  }
  return ctx
}

/** Current accent hex (null = default emerald/coral backdrop). */
export function useAmbientAccent(): string | null {
  return useAmbientAccentContext().accent
}

/** Push a resolved accent hex up to the backdrop; null restores default. */
export function useSetAmbientAccent(): (hex: string | null) => void {
  return useAmbientAccentContext().setAmbientAccent
}

/**
 * Page ambient backdrop. When a group accent is set, exposes it as
 * `--group-accent` and flags `data-group-tinted` so globals.css can re-hue the
 * orbs at their usual subtle alphas.
 */
export function AmbientBackdrop() {
  const accent = useAmbientAccent()
  return (
    <div
      className="ambient-backdrop"
      aria-hidden="true"
      {...(accent
        ? {
            'data-group-tinted': 'true',
            style: { '--group-accent': accent } as CSSProperties,
          }
        : {})}
    >
      <span className="ambient-backdrop__orb ambient-backdrop__orb--emerald" />
      <span className="ambient-backdrop__orb ambient-backdrop__orb--coral" />
    </div>
  )
}

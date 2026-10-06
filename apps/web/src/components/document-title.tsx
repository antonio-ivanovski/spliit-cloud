import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

export const DEFAULT_DOCUMENT_TITLE =
  'Spliit Cloud — Share expenses with friends & family'

type TitleEntry = { id: string; title: string | null }

type DocumentTitleRegistry = {
  register: (id: string) => void
  update: (id: string, title: string | null) => void
  unregister: (id: string) => void
}

const DocumentTitleRegistryContext =
  createContext<DocumentTitleRegistry | null>(null)

/**
 * Owns `document.title` for the whole app. Pages declare a title (or `null` for
 * "no opinion"); the last mounted declarer wins and anything unmounting falls
 * back to the next declarer or the default. Because every navigation ends on
 * either a declared title or the default, no route can leave a stale title
 * behind.
 */
export function DocumentTitleProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<TitleEntry[]>([])

  const register = useCallback((id: string) => {
    setEntries((prev) =>
      prev.some((entry) => entry.id === id)
        ? prev
        : [...prev, { id, title: null }],
    )
  }, [])

  const update = useCallback((id: string, title: string | null) => {
    setEntries((prev) => {
      const index = prev.findIndex((entry) => entry.id === id)
      if (index === -1) return [...prev, { id, title }]
      if (prev[index].title === title) return prev
      const next = [...prev]
      next[index] = { id, title }
      return next
    })
  }, [])

  const unregister = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id))
  }, [])

  const registry = useMemo(
    () => ({ register, update, unregister }),
    [register, update, unregister],
  )

  useEffect(() => {
    document.title =
      entries.findLast((entry) => entry.title != null)?.title ??
      DEFAULT_DOCUMENT_TITLE
  }, [entries])

  return (
    <DocumentTitleRegistryContext.Provider value={registry}>
      {children}
    </DocumentTitleRegistryContext.Provider>
  )
}

/**
 * Declare the tab title while mounted. Parents register before children, so a
 * nested page (focused route, print view) overrides its layout and restores it
 * on unmount. Title updates apply in place so a parent re-render (data load,
 * locale switch) never jumps above a child.
 */
export function useDocumentTitle(title: string | null) {
  const registry = useContext(DocumentTitleRegistryContext)
  const id = useId()
  if (!registry) {
    throw new Error(
      'useDocumentTitle must be used inside a DocumentTitleProvider.',
    )
  }

  useEffect(() => {
    registry.register(id)
    return () => registry.unregister(id)
  }, [registry, id])

  useEffect(() => {
    registry.update(id, title)
  }, [registry, id, title])
}

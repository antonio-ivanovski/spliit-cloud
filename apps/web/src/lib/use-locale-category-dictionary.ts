import { useEffect, useState } from 'react'

import {
  loadLocaleDictionary,
  peekLocaleDictionary,
  type LocaleDictionary,
} from '@spliit/domain'

/**
 * Load the locale category-search dictionary for `locale` only. English is
 * already in the main bundle; other locales (e.g. mk-MK) arrive as a separate
 * chunk.
 */
export function useLocaleCategoryDictionary(
  locale: string,
): LocaleDictionary | undefined {
  const [dictionary, setDictionary] = useState<LocaleDictionary | undefined>(
    () => peekLocaleDictionary(locale),
  )

  useEffect(() => {
    let cancelled = false
    void loadLocaleDictionary(locale).then((loaded) => {
      if (cancelled) return
      setDictionary(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  return dictionary
}

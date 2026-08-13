import { useEffect, useState } from 'react'

import {
  loadLocaleDictionary,
  peekLocaleDictionary,
  type LocaleDictionary,
} from '@spliit/domain'

type LocaleDictionaryState = {
  locale: string
  dictionary: LocaleDictionary | undefined
}

/**
 * Load the locale category-search dictionary for `locale` only. English is
 * already in the main bundle; other locales (e.g. mk-MK) arrive as a separate
 * chunk.
 */
export function useLocaleCategoryDictionary(
  locale: string,
): LocaleDictionary | undefined {
  const [state, setState] = useState<LocaleDictionaryState>(() => ({
    locale,
    dictionary: peekLocaleDictionary(locale),
  }))

  useEffect(() => {
    let cancelled = false
    void loadLocaleDictionary(locale).then((loaded) => {
      if (cancelled) return
      setState({ locale, dictionary: loaded })
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  return state.locale === locale ? state.dictionary : undefined
}

import { type ReactNode, useLayoutEffect } from 'react'
import { I18nextProvider } from 'react-i18next'

import { defaultLocale, isRtlLocale } from '@spliit/domain/i18n'

import { i18n } from './setup'

export { useLocale } from './use-locale'

export function I18nProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    function updateDocumentLocale(locale: string) {
      document.documentElement.lang = locale
      document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr'
    }

    updateDocumentLocale(i18n.language || defaultLocale)
    i18n.on('languageChanged', updateDocumentLocale)

    return () => {
      i18n.off('languageChanged', updateDocumentLocale)
    }
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

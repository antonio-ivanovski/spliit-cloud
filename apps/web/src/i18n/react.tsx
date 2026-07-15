import { defaultLocale } from '@spliit/domain/i18n'
import { type ReactNode, useLayoutEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { i18n } from './setup'

// react-doctor-disable-next-line react-doctor/only-export-components -- hook export (use[A-Z]) allowed per rule docs
export function useLocale() {
  const { i18n: instance } = useTranslation()
  return instance.language || defaultLocale
}

export function I18nProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    function updateDocumentLocale(locale: string) {
      document.documentElement.lang = locale
      document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr'
    }

    updateDocumentLocale(i18n.language || defaultLocale)
    i18n.on('languageChanged', updateDocumentLocale)

    return () => {
      i18n.off('languageChanged', updateDocumentLocale)
    }
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

import { useTranslation } from 'react-i18next'

import { defaultLocale } from '@spliit/domain/i18n'

// react-doctor-disable-next-line react-doctor/only-export-components -- hook export (use[A-Z]) allowed per rule docs
export function useLocale() {
  const { i18n: instance } = useTranslation()
  return instance.language || defaultLocale
}

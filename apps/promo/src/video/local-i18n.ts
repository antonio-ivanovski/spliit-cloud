import messages from '@web/messages/en-US.json'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
/**
 * Offline renderer adapter: app hooks use this instance without loading locales
 * remotely.
 */
export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  lng: 'en-US',
  fallbackLng: 'en-US',
  resources: { 'en-US': { translation: messages } },
  initAsync: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
})

import {
  defaultLocale,
  localeLabels,
  locales,
  type Locale,
} from '@spliit/domain/i18n'
import i18next from 'i18next'
import { type ReactNode } from 'react'
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from 'react-i18next'

const COOKIE_NAME = 'NEXT_LOCALE'

export const defaultNS = 'translation'

export const localeLoaders = {
  'en-US': () => import('@/messages/en-US.json'),
  ca: () => import('@/messages/ca.json'),
  'cs-CZ': () => import('@/messages/cs-CZ.json'),
  'de-DE': () => import('@/messages/de-DE.json'),
  es: () => import('@/messages/es.json'),
  eu: () => import('@/messages/eu.json'),
  fi: () => import('@/messages/fi.json'),
  'fr-FR': () => import('@/messages/fr-FR.json'),
  he: () => import('@/messages/he.json'),
  id: () => import('@/messages/id.json'),
  'it-IT': () => import('@/messages/it-IT.json'),
  'ja-JP': () => import('@/messages/ja-JP.json'),
  ko: () => import('@/messages/ko.json'),
  'mk-MK': () => import('@/messages/mk-MK.json'),
  'nl-NL': () => import('@/messages/nl-NL.json'),
  'pl-PL': () => import('@/messages/pl-PL.json'),
  pt: () => import('@/messages/pt.json'),
  'pt-BR': () => import('@/messages/pt-BR.json'),
  ro: () => import('@/messages/ro.json'),
  'ru-RU': () => import('@/messages/ru-RU.json'),
  'tr-TR': () => import('@/messages/tr-TR.json'),
  'uk-UA': () => import('@/messages/uk-UA.json'),
  'zh-CN': () => import('@/messages/zh-CN.json'),
  'zh-TW': () => import('@/messages/zh-TW.json'),
} satisfies Record<Locale, () => Promise<{ default: unknown }>>

export const i18n = i18next.createInstance()

const loadedLocales = new Set<Locale>()

export async function loadLocale(locale: Locale) {
  if (loadedLocales.has(locale)) return
  const messages = await localeLoaders[locale]()
  i18n.addResourceBundle(locale, defaultNS, messages.default, true, true)
  loadedLocales.add(locale)
}

export function detectLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale
  const cookieLocale = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1]
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    return cookieLocale as Locale
  }
  const browserLocale = navigator.language
  return (locales as readonly string[]).includes(browserLocale)
    ? (browserLocale as Locale)
    : defaultLocale
}

export async function initI18n() {
  const locale = detectLocale()
  // Init first so the store API (addResourceBundle, hasResourceBundle, ...)
  // is wired onto the instance — see i18next's init() where it copies the
  // store methods onto the i18n object.
  await i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng: defaultLocale,
    defaultNS,
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    partialBundledLanguages: true,
    resources: {},
  })
  await loadLocale(defaultLocale)
  if (locale !== defaultLocale) await loadLocale(locale)
  return i18n
}

export function useLocale() {
  const { i18n: instance } = useTranslation()
  return instance.language || defaultLocale
}

export async function setUserLocale(locale: Locale) {
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`
  await loadLocale(locale)
  await i18n.changeLanguage(locale)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

export { localeLabels, locales, type Locale }

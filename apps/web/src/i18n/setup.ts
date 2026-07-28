import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { defaultLocale, locales, type Locale } from '@spliit/domain/i18n'

const COOKIE_NAME = 'NEXT_LOCALE'

export const defaultNS = 'translation'

const messageModules = import.meta.glob<{ default: unknown }>(
  '@/messages/*.json',
)

function loaderFor(
  locale: Locale,
): (() => Promise<{ default: unknown }>) | undefined {
  const suffix = `/${locale}.json`
  for (const [path, loader] of Object.entries(messageModules)) {
    if (path === suffix || path.endsWith(suffix)) return loader
  }
  return undefined
}

export async function loadLocaleMessages(locale: Locale): Promise<unknown> {
  const loader = loaderFor(locale)
  if (!loader) {
    throw new Error(`No message bundle registered for locale "${locale}"`)
  }
  const mod = await loader()
  return mod.default
}

export const i18n = i18next.createInstance()

const loadedLocales = new Set<Locale>()

export async function loadLocale(locale: Locale) {
  if (loadedLocales.has(locale)) return
  const messages = await loadLocaleMessages(locale)
  i18n.addResourceBundle(locale, defaultNS, messages, true, true)
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

export async function setUserLocale(locale: Locale) {
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`
  await loadLocale(locale)
  await i18n.changeLanguage(locale)
}

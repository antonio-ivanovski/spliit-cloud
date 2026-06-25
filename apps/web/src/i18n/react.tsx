import ca from '@/messages/ca.json'
import csCZ from '@/messages/cs-CZ.json'
import deDE from '@/messages/de-DE.json'
import enUS from '@/messages/en-US.json'
import es from '@/messages/es.json'
import eu from '@/messages/eu.json'
import fi from '@/messages/fi.json'
import frFR from '@/messages/fr-FR.json'
import he from '@/messages/he.json'
import id from '@/messages/id.json'
import itIT from '@/messages/it-IT.json'
import jaJP from '@/messages/ja-JP.json'
import ko from '@/messages/ko.json'
import nlNL from '@/messages/nl-NL.json'
import plPL from '@/messages/pl-PL.json'
import ptBR from '@/messages/pt-BR.json'
import pt from '@/messages/pt.json'
import ro from '@/messages/ro.json'
import ruRU from '@/messages/ru-RU.json'
import trTR from '@/messages/tr-TR.json'
import ukUA from '@/messages/uk-UA.json'
import zhCN from '@/messages/zh-CN.json'
import zhTW from '@/messages/zh-TW.json'
import {
  defaultLocale,
  localeLabels,
  locales,
  type Locale,
} from '@spliit/domain/i18n'
import i18next from 'i18next'
import { Fragment, ReactNode } from 'react'
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from 'react-i18next'

const COOKIE_NAME = 'NEXT_LOCALE'

const resources = {
  ca,
  'cs-CZ': csCZ,
  'de-DE': deDE,
  'en-US': enUS,
  es,
  eu,
  fi,
  'fr-FR': frFR,
  he,
  id,
  'it-IT': itIT,
  'ja-JP': jaJP,
  ko,
  'nl-NL': nlNL,
  'pl-PL': plPL,
  pt,
  'pt-BR': ptBR,
  ro,
  'ru-RU': ruRU,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} satisfies Record<Locale, unknown>

function detectLocale(): Locale {
  const cookieLocale = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1]
  if (cookieLocale && locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale
  }
  const browserLocale = navigator.language
  return locales.includes(browserLocale as Locale)
    ? (browserLocale as Locale)
    : defaultLocale
}

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: typeof document === 'undefined' ? defaultLocale : detectLocale(),
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  resources: Object.fromEntries(
    Object.entries(resources).map(([locale, translation]) => [
      locale,
      { translation },
    ]),
  ),
})

function lookup(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, messages)
}

function renderRich(
  template: string,
  values: TranslationValues = {},
): ReactNode {
  const parts: ReactNode[] = []
  let partKey = 0
  const pushPart = (node: ReactNode) => {
    parts.push(<Fragment key={partKey++}>{node}</Fragment>)
  }
  let rest = template
  const tagPattern = /<([a-zA-Z][\w-]*)>(.*?)<\/\1>/
  while (rest.length) {
    const match = rest.match(tagPattern)
    if (!match || match.index === undefined) {
      pushPart(interpolate(rest, values))
      break
    }
    if (match.index > 0)
      pushPart(interpolate(rest.slice(0, match.index), values))
    const [, tag, content] = match
    const renderer = values[tag]
    pushPart(
      typeof renderer === 'function'
        ? (renderer as (chunks: ReactNode) => ReactNode)(
            interpolate(content, values),
          )
        : interpolate(content, values),
    )
    rest = rest.slice(match.index + match[0].length)
  }
  return parts
}

function interpolate(value: string, values: TranslationValues) {
  return value.replace(/\{([^}]+)\}/g, (_, key) => String(values[key] ?? ''))
}

export function useTranslations(namespace?: string) {
  const { t, i18n } = useTranslation()
  const translate = (key: string, values?: TranslationValues) =>
    t(namespace ? `${namespace}.${key}` : key, values)
  translate.rich = (key: string, values?: TranslationValues) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    const currentResources =
      resources[i18n.language as Locale] ?? resources[defaultLocale]
    const template =
      lookup(currentResources, fullKey) ??
      lookup(resources[defaultLocale], fullKey)
    return renderRich(String(template ?? fullKey), values)
  }
  return translate
}

export function useLocale() {
  return i18n.language || defaultLocale
}

export function useMessages() {
  return resources[(i18n.language as Locale) || defaultLocale]
}

export function setUserLocale(locale: Locale) {
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`
  void i18n.changeLanguage(locale)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

export { localeLabels, locales, type Locale }
type RichValue = string | number | boolean | ((chunks: ReactNode) => ReactNode)
type TranslationValues = Record<string, RichValue>

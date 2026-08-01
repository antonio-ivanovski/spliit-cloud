import type { Locale } from '@/i18n/request'
import { localeLabels, locales } from '@/i18n/request'

export const localeFlags = {
  'ar-SA': '🇸🇦',
  'bn-BD': '🇧🇩',
  'en-GZ': '💀',
  'hi-IN': '🇮🇳',
  id: '🇮🇩',
  ca: '🇦🇩',
  'cs-CZ': '🇨🇿',
  'de-DE': '🇩🇪',
  'en-US': '🇺🇸',
  es: '🇪🇸',
  eu: '🇪🇸',
  'fr-FR': '🇫🇷',
  'it-IT': '🇮🇹',
  'nl-NL': '🇳🇱',
  'pl-PL': '🇵🇱',
  pt: '🇵🇹',
  'pt-BR': '🇧🇷',
  ro: '🇷🇴',
  fi: '🇫🇮',
  'sv-SE': '🇸🇪',
  'tr-TR': '🇹🇷',
  'ru-RU': '🇷🇺',
  'uk-UA': '🇺🇦',
  he: '🇮🇱',
  ko: '🇰🇷',
  'mk-MK': '🇲🇰',
  'ja-JP': '🇯🇵',
  'ur-PK': '🇵🇰',
  vi: '🇻🇳',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
} satisfies Record<Locale, string>

export const popularLocales = [
  'en-US',
  'es',
  'fr-FR',
  'de-DE',
  'pt-BR',
  'hi-IN',
  'en-GZ',
] as const satisfies ReadonlyArray<Locale>

export const localeRegionOrder = [
  'americas',
  'asiaPacific',
  'europe',
  'middleEastAndNorthAfrica',
] as const

type LocaleRegion = (typeof localeRegionOrder)[number]

export const localeRegions = {
  'ar-SA': 'middleEastAndNorthAfrica',
  'bn-BD': 'asiaPacific',
  'en-GZ': 'europe',
  'hi-IN': 'asiaPacific',
  id: 'asiaPacific',
  ca: 'europe',
  'cs-CZ': 'europe',
  'de-DE': 'europe',
  'en-US': 'americas',
  es: 'europe',
  eu: 'europe',
  'fr-FR': 'europe',
  'it-IT': 'europe',
  'nl-NL': 'europe',
  'pl-PL': 'europe',
  pt: 'europe',
  'pt-BR': 'americas',
  ro: 'europe',
  fi: 'europe',
  'sv-SE': 'europe',
  'tr-TR': 'europe',
  'ru-RU': 'europe',
  'uk-UA': 'europe',
  he: 'middleEastAndNorthAfrica',
  ko: 'asiaPacific',
  'mk-MK': 'europe',
  'ja-JP': 'asiaPacific',
  'ur-PK': 'asiaPacific',
  vi: 'asiaPacific',
  'zh-CN': 'asiaPacific',
  'zh-TW': 'asiaPacific',
} as const satisfies Record<Locale, LocaleRegion>

const localizedLabelsCache = new Map<Locale, Record<Locale, string>>()

export function getLocalizedLocaleLabels(
  displayLocale: Locale,
): Record<Locale, string> {
  const cached = localizedLabelsCache.get(displayLocale)
  if (cached) return cached

  let displayNames: Intl.DisplayNames | undefined
  try {
    displayNames = new Intl.DisplayNames([displayLocale], {
      type: 'language',
    })
  } catch {
    // Native labels remain usable in environments without Intl.DisplayNames.
  }

  const labels = Object.fromEntries(
    locales.map((locale) => [
      locale,
      displayNames?.of(locale) ?? localeLabels[locale],
    ]),
  ) as Record<Locale, string>
  localizedLabelsCache.set(displayLocale, labels)
  return labels
}

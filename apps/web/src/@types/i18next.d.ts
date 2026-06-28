import type { DefaultMessages } from '@/i18n/types'
import type { SupportedCurrencyCode } from '@spliit/domain/currency'
import 'i18next'

/**
 * Synthetic map of `Currencies.byCode.${code}.name` entries, derived from
 * the canonical currency list. The en-US.json message bundle mirrors these
 * keys, so the runtime resolves them; this type augmentation lets the i18n
 * `t()` function know about every supported code's name without us having
 * to keep two lists in sync by hand.
 */
type CurrencyNameKeys = {
  [K in SupportedCurrencyCode as `Currencies.byCode.${K}.name`]: string
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: DefaultMessages & CurrencyNameKeys
    }
    strictKeyChecks: true
  }
}

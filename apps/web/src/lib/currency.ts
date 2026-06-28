export * from '@spliit/domain/currency'
import {
  type Currency,
  type SupportedCurrencyCode,
  currencyList,
} from '@spliit/domain/currency'
import { useTranslation } from 'react-i18next'

/**
 * A `Currency` with a localized display name. The domain's `Currency` is
 * canonical (code, symbol, decimal digits, rounding); this adds the
 * locale-specific `name` resolved from i18n.
 */
export type DisplayCurrency = Currency & { name: string }

/**
 * Union of every `Currencies.byCode.${code}.name` i18n key, derived from
 * `SupportedCurrencyCode`. The augmented i18next resources type ensures
 * `t(...)` accepts these without a cast.
 */
export type CurrencyNameKey = `Currencies.byCode.${SupportedCurrencyCode}.name`

const nameKey = (code: SupportedCurrencyCode): CurrencyNameKey =>
  `Currencies.byCode.${code}.name`

/**
 * Returns the canonical currency list with each entry's localized name
 * resolved from i18n. Prepends a "custom currency" entry whose name is the
 * provided label (typically `t('CurrencyCodeField.customOption')`).
 *
 * @param customChoiceLabel  Label for the "add custom currency" option. When
 *   empty, no custom entry is added.
 * @param currentCustomValue  When set, the custom entry uses this as its
 *   `name` and `symbol` (the user-typed text). Lets the combobox display a
 *   saved custom currency's actual value rather than a generic "Custom".
 */
export function useCurrencies(
  customChoiceLabel: string,
  currentCustomValue?: string,
): DisplayCurrency[] {
  const { t } = useTranslation()
  // `t`'s overloads only accept literal key types; the dynamic name key is
  // safe because the corresponding string lives in every locale bundle and
  // is part of the augmented `CustomTypeOptions.resources` type.
  const nameFor = (code: SupportedCurrencyCode): string => {
    const translated = t(nameKey(code), { defaultValue: code })
    return (translated as string) ?? code
  }
  const items: DisplayCurrency[] = currencyList.map((c) => ({
    ...c,
    name: nameFor(c.code as SupportedCurrencyCode),
  }))

  if (!customChoiceLabel && !currentCustomValue) {
    return items
  }

  // The custom entry sits first so it's easy to find. When a saved custom
  // value exists we render it (preserving the user's typed text); otherwise
  // we render the option label.
  const customEntry: DisplayCurrency = currentCustomValue
    ? {
        code: '',
        symbol: currentCustomValue,
        rounding: 0,
        decimal_digits: 2,
        name: currentCustomValue,
      }
    : {
        code: '',
        symbol: '',
        rounding: 0,
        decimal_digits: 2,
        name: customChoiceLabel,
      }
  items.unshift(customEntry)
  return items
}

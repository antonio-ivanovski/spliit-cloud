import { useTranslation } from 'react-i18next'

export function useBudgetTranslation() {
  return useTranslation(undefined, { keyPrefix: 'Budgets' }).t
}

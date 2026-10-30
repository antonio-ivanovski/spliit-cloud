import { useTranslation } from 'react-i18next'

/** `Personal.*` scoped translation hook (Spliit's voice, BudgetBakers-like IA). */
export function usePersonalTranslation() {
  return useTranslation(undefined, { keyPrefix: 'Personal' })
}

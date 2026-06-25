import type { DefaultMessages } from '@/i18n/types'
import 'i18next'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: DefaultMessages
    }
    strictKeyChecks: true
  }
}

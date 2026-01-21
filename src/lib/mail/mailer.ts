import { env } from '@/lib/env'
import { localMailer } from '@/lib/mail/local-mailer'
import type { Mailer } from '@/lib/mail/types'

export const resolveMailer = async (): Promise<Mailer> => {
  if (env.MAIL_TRANSPORT === 'local') {
    return localMailer
  }
  if (env.MAIL_TRANSPORT === 'smtp') {
    return await import('@/lib/mail/smtp-mailer').then((m) => m.smtpMailer)
  }

  throw new Error(`Unsupported MAIL_TRANSPORT: ${env.MAIL_TRANSPORT}`)
}

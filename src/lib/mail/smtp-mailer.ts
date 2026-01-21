import nodemailer from 'nodemailer'

import { env } from '@/lib/env'
import type { MailMessage, Mailer } from '@/lib/mail/types'

const smtpConfig = {
  host: env.SMTP_HOST,
  port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined,
  secure: env.SMTP_PORT === '465',
  auth:
    env.SMTP_USER && env.SMTP_PASSWORD
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASSWORD,
        }
      : undefined,
}

const hasSmtpConfig =
  !!smtpConfig.host && !!smtpConfig.port && !!env.SMTP_FROM

const transporter = hasSmtpConfig
  ? nodemailer.createTransport(smtpConfig)
  : null

export const smtpMailer: Mailer = {
  async sendMail(message: MailMessage) {
    if (!transporter) {
      throw new Error('SMTP configuration is missing')
    }

    await transporter.sendMail({
      from: message.from ?? env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  },
}

import nodemailer from 'nodemailer'

import { env } from '@/lib/env'

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

export async function sendMagicLinkEmail(
  email: string,
  magicLinkUrl: string,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') return

  if (!transporter) {
    throw new Error('SMTP configuration is missing')
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Your Spliit sync magic link',
    text: `Use this link to sign in: ${magicLinkUrl}`,
  })
}

import nodemailer, { type Transporter } from 'nodemailer'

import { env } from '../env'
import { PROVIDER_TIMEOUT_MS } from '../notifications/delivery-senders'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html: string
  /** Controlled RFC 5322 headers (for example List-Unsubscribe). */
  headers?: Record<string, string>
}

/**
 * SMTP delivery configuration for one sender instance.
 *
 * Unlike the previous module-global implementation — which re-read the mutable
 * `env` snapshot every time the transporter was first created — the
 * configuration is captured when a sender is constructed. The default
 * `sendEmail` sender therefore captures its values at `send.ts` import time.
 * Production never mutates environment configuration after startup, so the two
 * behaviors are equivalent in practice, and capturing makes senders
 * independently testable without module-registry resets.
 */
export type SmtpSenderConfig = Readonly<{
  host?: string
  port?: number
  user?: string
  pass?: string
  from?: string
}>

export type EmailSender = (message: EmailMessage) => Promise<void>

export function createEmailSender(config: SmtpSenderConfig): EmailSender {
  let transporter: Transporter | undefined
  let loggedConfig = false

  function getTransporter(): Transporter {
    if (transporter) return transporter
    const port = config.port ?? 587
    // 465 is implicit TLS (SMTPS). Everything else is plain SMTP upgraded via
    // STARTTLS: 587 always requires STARTTLS per RFC 6409, 25 is opportunistic.
    const secure = port === 465
    const requireTLS = port === 587
    transporter = nodemailer.createTransport({
      host: config.host,
      port,
      secure,
      requireTLS,
      connectionTimeout: PROVIDER_TIMEOUT_MS,
      greetingTimeout: PROVIDER_TIMEOUT_MS,
      socketTimeout: PROVIDER_TIMEOUT_MS,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    })
    if (!loggedConfig) {
      loggedConfig = true
      console.log(
        `[mail] SMTP delivery enabled host=${config.host} port=${port} secure=${secure} requireTLS=${requireTLS}`,
      )
    }
    return transporter
  }

  return async function sendEmail(message: EmailMessage): Promise<void> {
    if (!config.host) {
      throw new Error(
        '[mail] SMTP_HOST is not configured. Set SMTP_HOST/SMTP_PORT ' +
          '(and EMAIL_FROM in production) to deliver email. Local dev: ' +
          'run `bun dev:up` to start MailDev via compose.dev.yaml.',
      )
    }

    if (
      typeof message.text !== 'string' ||
      typeof message.html !== 'string' ||
      !message.text.trim() ||
      !message.html.trim()
    ) {
      throw new Error('[mail] Email text and html must be non-empty.')
    }

    await getTransporter().sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    })
  }
}

export const sendEmail = createEmailSender({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.EMAIL_FROM,
})

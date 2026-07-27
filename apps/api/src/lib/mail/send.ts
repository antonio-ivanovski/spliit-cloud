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

let transporter: Transporter | undefined
let loggedConfig = false

function getTransporter(): Transporter {
  if (transporter) return transporter
  const port = env.SMTP_PORT ?? 587
  // 465 is implicit TLS (SMTPS). Everything else is plain SMTP upgraded via
  // STARTTLS: 587 always requires STARTTLS per RFC 6409, 25 is opportunistic.
  const secure = port === 465
  const requireTLS = port === 587
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    requireTLS,
    connectionTimeout: PROVIDER_TIMEOUT_MS,
    greetingTimeout: PROVIDER_TIMEOUT_MS,
    socketTimeout: PROVIDER_TIMEOUT_MS,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  })
  if (!loggedConfig) {
    loggedConfig = true
    console.log(
      `[mail] SMTP delivery enabled host=${env.SMTP_HOST} port=${port} secure=${secure} requireTLS=${requireTLS}`,
    )
  }
  return transporter
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.SMTP_HOST) {
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
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
  })
}

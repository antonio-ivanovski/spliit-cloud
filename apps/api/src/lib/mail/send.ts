import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../env'

const MAIL_DIR = join(process.cwd(), '.mail')

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
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
    // Local development: drop the message into .mail/ for inspection.
    await fs.mkdir(MAIL_DIR, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeRecipient = message.to.replace(/[^a-z0-9@._-]/gi, '_')
    const file = join(MAIL_DIR, `${timestamp}-${safeRecipient}.eml`)
    const body = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      '',
      message.text,
    ].join('\n')
    await fs.writeFile(file, body, 'utf8')
    console.log(`[mail] wrote ${file}`)
    return
  }

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env'

const MAIL_DIR = join(process.cwd(), '.mail')

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
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

  // In production, prefer an SMTP library. For now we log a warning and fall
  // back to writing to .mail/ until SMTP delivery is wired up.
  console.warn(
    `[mail] SMTP delivery is not yet wired up; falling back to local file. to=${message.to} subject=${message.subject}`,
  )
  await fs.mkdir(MAIL_DIR, { recursive: true })
  const file = join(MAIL_DIR, `${Date.now()}-${message.to}.eml`)
  await fs.writeFile(file, message.text, 'utf8')
}

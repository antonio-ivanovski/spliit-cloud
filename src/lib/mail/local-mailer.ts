import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { MailMessage, Mailer } from '@/lib/mail/types'

const outputDir = path.join(process.cwd(), '.mail')

const ensureOutputDir = async () => {
  await fs.mkdir(outputDir, { recursive: true })
}

const formatValue = (value?: string) => value ?? ''

export const localMailer: Mailer = {
  async sendMail(message: MailMessage) {
    await ensureOutputDir()

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${timestamp}-${Math.random().toString(16).slice(2)}.json`
    const filePath = path.join(outputDir, fileName)

    const payload = {
      to: message.to,
      subject: message.subject,
      from: message.from,
      text: formatValue(message.text),
      html: formatValue(message.html),
    }

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  },
}

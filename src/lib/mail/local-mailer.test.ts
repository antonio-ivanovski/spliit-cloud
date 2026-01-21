import { promises as fs } from 'node:fs'
import path from 'node:path'

import { localMailer } from './local-mailer'

const outputDir = path.join(process.cwd(), '.mail')

describe('localMailer', () => {
  beforeEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  it('writes outgoing mail to .mail folder', async () => {
    await localMailer.sendMail({
      to: 'user@example.com',
      subject: 'Test subject',
      text: 'Hello from test',
      html: '<p>Hello from test</p>',
    })

    const files = await fs.readdir(outputDir)
    expect(files).toHaveLength(1)

    const filePath = path.join(outputDir, files[0] as string)
    const contents = await fs.readFile(filePath, 'utf8')
    const payload = JSON.parse(contents) as {
      to: string
      subject: string
      text: string
      html: string
    }

    expect(payload.to).toBe('user@example.com')
    expect(payload.subject).toBe('Test subject')
    expect(payload.text).toBe('Hello from test')
    expect(payload.html).toBe('<p>Hello from test</p>')
  })
})

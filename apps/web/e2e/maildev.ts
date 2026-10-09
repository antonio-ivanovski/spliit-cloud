import { expect } from '@playwright/test'

const MAILDEV_URL = process.env.MAILDEV_URL ?? 'http://localhost:1080'

type MailDevRecipient = { address: string }
type MailDevMessage = {
  id: string
  to?: MailDevRecipient[]
  envelope?: { to?: MailDevRecipient[] }
  html?: string
  text?: string
}

function recipientsOf(message: MailDevMessage): string[] {
  const recipients = message.to ?? message.envelope?.to ?? []
  return recipients.map((recipient) => recipient.address.toLowerCase())
}

function linkFrom(message: MailDevMessage, urlPart: string): string | null {
  const bodies = [message.html ?? '', message.text ?? '']
  for (const body of bodies) {
    const match = body.match(
      new RegExp(`https?://[^"'\\s<>]*${urlPart}[^"'\\s<>]*`),
    )
    // Links come from rendered HTML: decode entities or the API sees a
    // literal `amp;callbackURL` param and returns JSON instead of redirecting
    // to the web app (no session, no complete-profile page).
    if (match) return match[0].replaceAll('&amp;', '&')
  }
  return null
}

async function findEmailLink(
  to: string,
  urlPart: string,
): Promise<string | null> {
  const response = await fetch(`${MAILDEV_URL}/email`)
  if (!response.ok) return null
  const messages = (await response.json()) as MailDevMessage[]
  const message = messages.find((candidate) =>
    recipientsOf(candidate).includes(to.toLowerCase()),
  )
  if (!message) return null
  // The list endpoint may carry only a snippet; fetch the full message so
  // the link is always present.
  const fullResponse = await fetch(`${MAILDEV_URL}/email/${message.id}`)
  if (!fullResponse.ok) return linkFrom(message, urlPart)
  return linkFrom((await fullResponse.json()) as MailDevMessage, urlPart)
}

/**
 * Poll the MailDev inbox for the newest message to `to` and return the first
 * link containing `urlPart` (e.g. `/auth/verify-email`). Inbound email is
 * external async work, so this is the one place that takes a custom timeout —
 * it bounds inbox delivery, not app rendering.
 */
export async function waitForEmailLink(
  to: string,
  urlPart: string,
): Promise<string> {
  let link: string | null = null
  await expect
    .poll(
      async () => (link = await findEmailLink(to, urlPart)),
      // oxlint-disable-next-line spliit-e2e/no-custom-timeout -- inbound email is external async work, not app rendering.
      { timeout: 20_000 },
    )
    .toBeTruthy()
  if (!link) throw new Error(`No ${urlPart} email arrived for ${to}`)
  return link
}

/**
 * Tiny MailDev HTTP client used by integration tests to inspect and clear the
 * local MailDev inbox. MailDev runs as part of `bun dev:up` via
 * `compose.dev.yaml` on http://localhost:1080 (web UI) + 1025 (SMTP). SMTP
 * delivery is asynchronous, so callers must poll.
 *
 * Reference: https://github.com/maildev/maildev/blob/master/docs/http.md
 */

const MAILDEV_BASE = process.env.MAILDEV_URL ?? 'http://localhost:1080'

interface MaildevAddress {
  address: string
  name?: string
}

interface MaildevSummary {
  id: string
  from: MaildevAddress[]
  to: MaildevAddress[]
  subject: string
  date?: string
}

interface MaildevDetail extends MaildevSummary {
  text?: string
  html?: string
}

export interface CapturedEmail {
  id: string
  subject: string
  text: string
  /** Non-empty HTML body; parsing rejects messages that omit it. */
  html: string
}

/** Probe MailDev's web UI. Returns true if the inbox responds. */
export async function probeMaildev(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILDEV_BASE}/email`)
    return res.ok
  } catch {
    return false
  }
}

/** Drop every email currently in the MailDev inbox. */
export async function clearMaildevInbox(): Promise<void> {
  await fetch(`${MAILDEV_BASE}/email/all`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// New diagnostic helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a summary of every message in the MailDev inbox. Used for diagnostics
 * when an expected email is missing.
 */
export async function getMaildevInboxSummary(): Promise<
  Array<{ id: string; to: string[]; subject: string }>
> {
  const res = await fetch(`${MAILDEV_BASE}/email`)

  if (!res.ok) {
    throw new Error(
      `MailDev GET /email failed: ${res.status} ${res.statusText}`,
    )
  }

  const list = (await res.json()) as MaildevSummary[]

  return list.map((message) => ({
    id: message.id,
    to: message.to.map((recipient) => recipient.address),
    subject: message.subject,
  }))
}

/**
 * Single-shot lookup for an email by recipient (and optional subject). Returns
 * the full CapturedEmail or null if no match is found.
 */
export async function getEmailForRecipient({
  recipient,
  subject,
}: {
  recipient: string
  subject?: string
}): Promise<CapturedEmail | null> {
  const wantedRecipient = recipient.toLowerCase()

  const res = await fetch(`${MAILDEV_BASE}/email`)

  if (!res.ok) {
    throw new Error(
      `MailDev GET /email failed: ${res.status} ${res.statusText}`,
    )
  }

  const list = (await res.json()) as MaildevSummary[]

  const summary = list.find((message) => {
    const recipientMatches = message.to.some(
      (to) => to.address.toLowerCase() === wantedRecipient,
    )

    const subjectMatches = subject === undefined || message.subject === subject

    return recipientMatches && subjectMatches
  })

  if (!summary) return null

  const detailRes = await fetch(`${MAILDEV_BASE}/email/${summary.id}`)

  if (!detailRes.ok) {
    throw new Error(
      `MailDev GET /email/${summary.id} failed: ${detailRes.status} ${detailRes.statusText}`,
    )
  }

  const detail = (await detailRes.json()) as MaildevDetail

  if (
    typeof detail.text !== 'string' ||
    !detail.text.trim() ||
    typeof detail.html !== 'string' ||
    !detail.html.trim()
  ) {
    throw new Error(
      `MailDev email ${summary.id} is missing a non-empty text or html body`,
    )
  }

  return {
    id: summary.id,
    subject: summary.subject,
    text: detail.text,
    html: detail.html,
  }
}

/**
 * Poll for an email matching recipient (and optional subject) with a short
 * bounded retry window. Throws a diagnostic error if the email does not appear,
 * including the full inbox summary.
 */
export async function expectEmailEventually({
  recipient,
  subject,
  attempts = 10,
  delayMs = 100,
}: {
  recipient: string
  subject?: string
  attempts?: number
  delayMs?: number
}): Promise<CapturedEmail> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const email = await getEmailForRecipient({ recipient, subject })

    if (email) return email

    await sleep(delayMs)
  }

  const inbox = await getMaildevInboxSummary()

  throw new Error(
    `Expected email to ${recipient}` +
      (subject ? ` with subject "${subject}"` : '') +
      `, but none was found after ${attempts} attempts.` +
      `\n\nInbox:\n${JSON.stringify(inbox, null, 2)}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Tiny MailDev HTTP client used by integration tests to inspect and clear
 * the local MailDev inbox. MailDev runs as part of `bun dev:up` via
 * `compose.dev.yaml` on http://localhost:1080 (web UI) + 1025 (SMTP).
 * SMTP delivery is asynchronous, so callers must poll.
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

/**
 * Poll the MailDev inbox until an email addressed to `recipient` appears,
 * then return its plain-text body. Returns null if no such email arrives
 * within `timeoutMs`.
 */
export async function findEmailForRecipient(
  recipient: string,
  {
    timeoutMs = 5000,
    pollMs = 100,
  }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<CapturedEmail | null> {
  const deadline = Date.now() + timeoutMs
  const wanted = recipient.toLowerCase()
  while (Date.now() < deadline) {
    const match = await findOnce(wanted)
    if (match) return match
    await sleep(pollMs)
  }
  return null
}

async function findOnce(
  wantedRecipient: string,
): Promise<CapturedEmail | null> {
  const res = await fetch(`${MAILDEV_BASE}/email`)
  if (!res.ok) return null
  const list = (await res.json()) as MaildevSummary[]
  const summary = list.find((m) =>
    m.to.some((t) => t.address.toLowerCase() === wantedRecipient),
  )
  if (!summary) return null
  const detailRes = await fetch(`${MAILDEV_BASE}/email/${summary.id}`)
  if (!detailRes.ok) return null
  const detail = (await detailRes.json()) as MaildevDetail
  return {
    id: summary.id,
    subject: summary.subject,
    text: detail.text ?? '',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

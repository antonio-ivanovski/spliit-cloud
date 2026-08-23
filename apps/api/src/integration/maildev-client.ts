/**
 * Tiny MailDev HTTP client used by integration tests to inspect and clean up
 * the local MailDev inbox. MailDev runs as part of `bun dev:up` via
 * `compose.dev.yaml` on http://localhost:1080 (web UI) + 1025 (SMTP). SMTP
 * delivery is asynchronous, so callers must poll.
 *
 * Every lookup uses MailDev's server-side filtering (`GET /email?to.address=…`
 * and optionally `subject=…`, supported since v2.2) instead of downloading the
 * whole inbox: the dev instance persists messages across runs, so an unfiltered
 * request can transfer tens of megabytes per poll.
 *
 * Messages are deleted after a successful consuming assertion, and suites can
 * call `cleanupMaildevInbox` in `afterEach`/`afterAll`, to keep the persistent
 * store bounded. Never issue a global `DELETE /email/all` from tests: parallel
 * test runs share this MailDev instance and would delete each other's mail.
 *
 * Reference: https://github.com/maildev/maildev/blob/master/docs/http.md
 */

const MAILDEV_BASE = process.env.MAILDEV_URL ?? 'http://localhost:1080'

/** Maximum number of entries included in failure diagnostics. */
const DIAGNOSTIC_SUMMARY_LIMIT = 10

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

/** Probe MailDev's health endpoint. Returns true if the server responds. */
export async function probeMaildev(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/healthz', MAILDEV_BASE))
    return res.ok
  } catch {
    return false
  }
}

/**
 * Build the filtered inbox list URL. Addresses are lowercased because the
 * server-side `to.address` comparison is case-sensitive.
 */
function filteredListUrl(recipient: string, subject?: string): string {
  const url = new URL('/email', MAILDEV_BASE)
  url.searchParams.set('to.address', recipient.toLowerCase())
  if (subject !== undefined) url.searchParams.set('subject', subject)
  return url.toString()
}

async function fetchFilteredSummaries({
  recipient,
  subject,
}: {
  recipient: string
  subject?: string
}): Promise<MaildevSummary[]> {
  const res = await fetch(filteredListUrl(recipient, subject))

  if (!res.ok) {
    throw new Error(
      `MailDev GET /email failed: ${res.status} ${res.statusText}`,
    )
  }

  return (await res.json()) as MaildevSummary[]
}

/** Delete a single message by id. */
export async function deleteMaildevEmail(id: string): Promise<void> {
  const res = await fetch(new URL(`/email/${id}`, MAILDEV_BASE), {
    method: 'DELETE',
  })

  if (!res.ok) {
    throw new Error(
      `MailDev DELETE /email/${id} failed: ${res.status} ${res.statusText}`,
    )
  }
}

/**
 * Delete every message addressed to any of the given recipients. Recipient-
 * scoped on purpose: parallel test runs share this MailDev instance, so only
 * mail owned by the calling suite may be removed.
 *
 * Returns the number of deleted messages. Suites that trigger emails without
 * consuming them should call this in `afterEach`/`afterAll`.
 */
export async function cleanupMaildevInbox(
  recipients: string[],
): Promise<number> {
  let deleted = 0

  for (const recipient of recipients) {
    const summaries = await fetchFilteredSummaries({ recipient })
    for (const summary of summaries) {
      await deleteMaildevEmail(summary.id)
      deleted += 1
    }
  }

  return deleted
}

/**
 * Single-shot lookup for an email by recipient (and optional subject). Returns
 * the full CapturedEmail or null if no match is found.
 *
 * With `consume: true`, the message is deleted from MailDev once it has been
 * fully read — use this when the assertion owns the message, so the persistent
 * inbox stays small across runs.
 */
export async function getEmailForRecipient({
  recipient,
  subject,
  consume = false,
}: {
  recipient: string
  subject?: string
  consume?: boolean
}): Promise<CapturedEmail | null> {
  const wantedRecipient = recipient.toLowerCase()

  const summaries = await fetchFilteredSummaries({ recipient, subject })

  // Belt-and-braces re-check: the server-side filter is exact and
  // case-sensitive; matching locally keeps semantics identical to the old
  // client-side scan.
  const summary = summaries.find((message) => {
    const recipientMatches = message.to.some(
      (to) => to.address.toLowerCase() === wantedRecipient,
    )

    const subjectMatches = subject === undefined || message.subject === subject

    return recipientMatches && subjectMatches
  })

  if (!summary) return null

  const detailRes = await fetch(new URL(`/email/${summary.id}`, MAILDEV_BASE))

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

  const captured: CapturedEmail = {
    id: summary.id,
    subject: summary.subject,
    text: detail.text,
    html: detail.html,
  }

  if (consume) await deleteMaildevEmail(summary.id)

  return captured
}

/**
 * Poll for an email matching recipient (and optional subject) with a short
 * bounded retry window. Throws a diagnostic error if the email does not appear;
 * diagnostics are scoped to the expected recipient and capped, never the whole
 * inbox.
 *
 * Pass `consume: true` when the assertion owns the message so it is removed
 * after a successful lookup.
 */
export async function expectEmailEventually({
  recipient,
  subject,
  attempts = 10,
  delayMs = 100,
  consume = false,
}: {
  recipient: string
  subject?: string
  attempts?: number
  delayMs?: number
  consume?: boolean
}): Promise<CapturedEmail> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const email = await getEmailForRecipient({ recipient, subject, consume })

    if (email) return email

    await sleep(delayMs)
  }

  const inbox = (await fetchFilteredSummaries({ recipient }))
    .slice(0, DIAGNOSTIC_SUMMARY_LIMIT)
    .map((message) => ({
      id: message.id,
      to: message.to.map((recipient) => recipient.address),
      subject: message.subject,
    }))

  throw new Error(
    `Expected email to ${recipient}` +
      (subject ? ` with subject "${subject}"` : '') +
      `, but none was found after ${attempts} attempts.` +
      `\n\nMessages to ${recipient}` +
      ` (showing at most ${DIAGNOSTIC_SUMMARY_LIMIT}):\n${JSON.stringify(inbox, null, 2)}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import nodemailer, { type Transporter } from 'nodemailer'

import { env } from '../env'
import { PROVIDER_TIMEOUT_MS } from '../notifications/delivery-senders'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html: string
  /**
   * Controlled RFC 5322 headers (for example List-Unsubscribe). The Cloudflare
   * REST sender only accepts the provider allowlist (plus `X-` headers) and
   * rejects anything else — see `assertCloudflareHeaders`.
   */
  headers?: Record<string, string>
}

function assertNonEmptyBodies(message: EmailMessage): void {
  if (
    typeof message.text !== 'string' ||
    typeof message.html !== 'string' ||
    !message.text.trim() ||
    !message.html.trim()
  ) {
    throw new Error('[mail] Email text and html must be non-empty.')
  }
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
        '[mail] No email transport is configured. Set SMTP_HOST/SMTP_PORT ' +
          'or Cloudflare email (CF_EMAIL_ACCOUNT_ID/CF_EMAIL_API_TOKEN, ' +
          'plus EMAIL_FROM) to deliver email. Local dev: ' +
          'run `bun dev:up` to start MailDev via compose.dev.yaml.',
      )
    }

    assertNonEmptyBodies(message)

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

/**
 * Cloudflare Email Sending (REST over HTTPS:443) configuration for one sender
 * instance. Unlike SMTP submission (`smtp.mx.cloudflare.net:465`, implicit TLS
 * only), the REST endpoint is reachable from hosts that filter outbound SMTP
 * ports (Hetzner blocks 25/465 by default). Uses the same `EmailSender`
 * signature so all callers stay transport-agnostic.
 */
export type CloudflareEmailSenderConfig = Readonly<{
  accountId?: string
  apiToken?: string
  from?: string
  /** Override for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}>

export function cloudflareEmailSendUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`
}

type CloudflareRestErrorShape = Error & {
  code: string
  responseCode?: number
  provider: 'cloudflare-email'
}

function cloudflareRestError(
  code: string,
  message: string,
  responseCode?: number,
): CloudflareRestErrorShape {
  const error = new Error(message) as CloudflareRestErrorShape
  error.code = code
  error.provider = 'cloudflare-email'
  if (responseCode !== undefined) error.responseCode = responseCode
  return error
}

function describeCloudflareApiFailure(
  status: number,
  bodyText: string,
): string {
  // Cloudflare returns `{ success, errors: [{ code, message }], ... }`.
  // Surface the first provider error codes so operators can tell auth
  // (6103/unauthorized), domain onboarding, and validation failures apart.
  try {
    const body = JSON.parse(bodyText) as {
      errors?: Array<{ code?: unknown; message?: unknown }>
    }
    const errors = Array.isArray(body.errors) ? body.errors : []
    const first = errors
      .map((entry) => {
        const code =
          typeof entry.code === 'number' || typeof entry.code === 'string'
            ? String(entry.code)
            : null
        const text =
          typeof entry.message === 'string' && entry.message.trim()
            ? entry.message.trim()
            : null
        return code && text ? `${code}: ${text}` : (text ?? code ?? null)
      })
      .filter((part): part is string => part !== null)
      .slice(0, 2)
      .join('; ')
    if (first)
      return `Cloudflare Email Sending failed (HTTP ${status}): ${first}`
  } catch {
    // Non-JSON body: fall through to the status-only message below.
  }
  const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 200)
  return snippet
    ? `Cloudflare Email Sending failed (HTTP ${status}): ${snippet}`
    : `Cloudflare Email Sending failed (HTTP ${status})`
}

export function createCloudflareEmailSender(
  config: CloudflareEmailSenderConfig,
): EmailSender {
  const fetchImpl = config.fetchImpl ?? fetch
  let loggedConfig = false

  return async function sendEmail(message: EmailMessage): Promise<void> {
    if (!config.accountId || !config.apiToken) {
      throw new Error(
        '[mail] No email transport is configured. Set Cloudflare email ' +
          '(CF_EMAIL_ACCOUNT_ID/CF_EMAIL_API_TOKEN, plus EMAIL_FROM) or ' +
          'SMTP_HOST/SMTP_PORT to deliver email. Local dev: ' +
          'run `bun dev:up` to start MailDev via compose.dev.yaml.',
      )
    }
    if (!config.from) {
      throw new Error(
        '[mail] EMAIL_FROM is not configured. Cloudflare Email Sending ' +
          'requires a sender identity on an onboarded sending domain.',
      )
    }

    assertNonEmptyBodies(message)
    assertCloudflareHeaders(message.headers)

    if (!loggedConfig) {
      loggedConfig = true
      console.log(
        `[mail] Cloudflare Email Sending (REST) enabled account=${config.accountId}`,
      )
    }

    let response: Response
    try {
      response = await fetchImpl(cloudflareEmailSendUrl(config.accountId), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: toCloudflareAddress(config.from),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.headers ? { headers: message.headers } : {}),
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw cloudflareRestError(
          'CF_TIMEOUT',
          `Cloudflare Email Sending timed out after ${PROVIDER_TIMEOUT_MS}ms`,
        )
      }
      const detail =
        error instanceof Error && error.message
          ? error.message.replace(/\s+/g, ' ').trim().slice(0, 200)
          : 'network error'
      const code =
        error instanceof Error && error.name === 'AbortError'
          ? 'CF_TIMEOUT'
          : 'CF_NETWORK'
      throw cloudflareRestError(
        code,
        `Cloudflare Email Sending failed: ${detail}`,
      )
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw cloudflareRestError(
        `CF_HTTP_${response.status}`,
        describeCloudflareApiFailure(response.status, bodyText),
        response.status,
      )
    }
    await throwOnRecipientDrop(response, message.to)
  }
}

/**
 * Cloudflare Email Sending accepts headers on an allowlist (plus `X-` headers)
 * and rejects the entire request when anything else is present — including
 * platform-controlled headers it generates itself (`Message-ID`, `Date`, …) and
 * first-class API fields (`From`, `Subject`, …). Fail fast locally with a clear
 * error instead of burning an API round-trip that can only come back HTTP 400
 * (`email.sending.error.email.invalid`).
 */
const CLOUDFLARE_PLATFORM_HEADERS = new Set([
  'date',
  'message-id',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'dkim-signature',
  'return-path',
  'received',
  'feedback-id',
  'arc-seal',
  'arc-message-signature',
  'arc-authentication-results',
  'tls-required',
  'tls-report-domain',
  'tls-report-submitter',
  'cfbl-address',
  'cfbl-feedback-id',
  // First-class API fields must use the dedicated `from`/`to`/`subject`
  // properties instead of the `headers` object.
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'reply-to',
])

function assertCloudflareHeaders(
  headers: Record<string, string> | undefined,
): void {
  if (!headers) return
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase()
    if (lower.startsWith('arc-') || CLOUDFLARE_PLATFORM_HEADERS.has(lower)) {
      throw new Error(
        `[mail] Email header '${name}' is not allowed by Cloudflare Email ` +
          'Sending and would reject the whole request. Use the dedicated ' +
          'API fields or an `X-` tracking header instead.',
      )
    }
  }
}

/**
 * The REST `from` field accepts a bare address or an `{address, name}` object —
 * not a display-name string (`Name <addr>`), which the schema does not
 * document. Normalize that common `EMAIL_FROM` form to the object shape so
 * provider validation cannot reject it.
 */
function toCloudflareAddress(
  from: string,
): string | { address: string; name: string } {
  const match = from.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/)
  const name = match?.[1]?.trim()
  const address = match?.[2]?.trim()
  if (address && name) return { address, name }
  return address ?? from
}

/**
 * A 2xx response can still mean our recipient never got the message
 * (`permanent_bounces`, or `suppressed_recipients` when suppression dropping is
 * enabled). Treat that as a permanent failure instead of recording a phantom
 * SENT. Anything else — including an unparseable body — keeps the previous
 * accept semantics.
 */
async function throwOnRecipientDrop(
  response: Response,
  recipient: string,
): Promise<void> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return
  }
  if (!body || typeof body !== 'object') return
  const result = (body as { result?: unknown }).result
  if (!result || typeof result !== 'object') return
  const dropped: string[] = []
  for (const bucket of [
    'permanent_bounces',
    'suppressed_recipients',
  ] as const) {
    const list = (result as Record<string, unknown>)[bucket]
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry === 'string') dropped.push(entry)
      }
    }
  }
  if (dropped.includes(recipient)) {
    throw cloudflareRestError(
      'CF_PERMANENT_BOUNCE',
      `Cloudflare Email Sending dropped recipient ${recipient}: ` +
        'permanent bounce or suppression list.',
    )
  }
}

function resolveDefaultSender(): EmailSender {
  // Cloudflare REST wins when fully configured: it runs on 443, which stays
  // open on hosts that filter outbound SMTP ports (Hetzner blocks 25/465).
  // Otherwise fall back to SMTP (local MailDev, self-hosted relays).
  if (env.CF_EMAIL_ACCOUNT_ID && env.CF_EMAIL_API_TOKEN) {
    return createCloudflareEmailSender({
      accountId: env.CF_EMAIL_ACCOUNT_ID,
      apiToken: env.CF_EMAIL_API_TOKEN,
      from: env.EMAIL_FROM,
    })
  }
  return createEmailSender({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM,
  })
}

export const sendEmail: EmailSender = resolveDefaultSender()

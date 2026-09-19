import { createHash, createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { type IncomingMessage, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

import { env, getWebhookRelayConfig } from '../env'

export const WEBHOOK_TIMEOUT_MS = 10_000

export type ResolvedWebhookTarget = {
  url: URL
  addresses: Array<{ address: string; family: 4 | 6 }>
}

export function isTransientDnsError(error: unknown): boolean {
  const code =
    error instanceof Error
      ? ((error as NodeJS.ErrnoException).code ?? error.message)
      : String(error)
  return (
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_FAIL' ||
    /EAI_AGAIN|ETIMEDOUT|query.*timed out|temporary.*failure/i.test(
      String(code),
    )
  )
}

// Keep in sync with `isIpLiteralHostname` in `apps/webhook-relay/src/index.ts`:
// the relay rejects these destinations structurally, so when the relay is
// enabled the API must reject them up front too.
function isIpLiteralHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (host.includes(':')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

function isPrivateAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/.test(value)) return true
  if (isIP(value) === 6) {
    const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1)
    const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/)
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16)
      const low = Number.parseInt(mapped[2]!, 16)
      return isPrivateAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      )
    }
    return false
  }
  if (isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export async function resolveWebhookTarget(
  value: string,
): Promise<ResolvedWebhookTarget> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Webhook URL is invalid')
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not include credentials')
  }
  if (env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Webhook URL must use HTTP or HTTPS')
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  // Mirrors the relay worker's structural check: a destination the relay would
  // reject must fail here as invalid, not burn retries as a transient 502.
  if (getWebhookRelayConfig() && isIpLiteralHostname(hostname)) {
    throw new Error(
      'Webhook URL must use a hostname instead of an IP literal when the relay is enabled',
    )
  }
  const addresses =
    isIP(hostname) !== 0
      ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
      : (
          (await lookup(hostname, { all: true, verbatim: true })) as Array<{
            address: string
            family: number
          }>
        ).map(({ address, family }) => ({
          address,
          family: family as 4 | 6,
        }))
  if (
    addresses.length === 0 ||
    (!env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS &&
      addresses.some(({ address }) => isPrivateAddress(address)))
  ) {
    throw new Error('Webhook URL must resolve to a public address')
  }
  return { url, addresses }
}

export async function validateWebhookUrl(value: string): Promise<URL> {
  return (await resolveWebhookTarget(value)).url
}

export async function sendWebhookRequest(args: {
  target: ResolvedWebhookTarget
  headers: Record<string, string>
  body: string
}): Promise<number> {
  let lastError: unknown = null
  for (const { address } of args.target.addresses) {
    try {
      return await sendToAddress(args, address)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('Webhook request failed')
}

/**
 * Pin a webhook request to a single DNS-resolved address.
 *
 * The `lookup` request option only exists on Node.js — other runtimes ignore it
 * (Bun connects to `undefined` and fails with `ERR_INVALID_IP_ADDRESS`), so
 * pinning is done by rewriting the URL to the literal IP instead. The original
 * host travels via the `Host` header (HTTP routing) and `servername` (TLS SNI +
 * certificate verification), which every runtime honors.
 */
export function buildPinnedWebhookRequest(
  url: URL,
  address: string,
): { url: URL; host: string; servername: string | undefined } {
  const pinned = new URL(url.toString())
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return {
    url: pinned,
    host: url.host,
    servername: isIP(hostname) === 0 ? hostname : undefined,
  }
}
function sendToAddress(
  args: {
    target: ResolvedWebhookTarget
    headers: Record<string, string>
    body: string
  },
  address: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const pinned = buildPinnedWebhookRequest(args.target.url, address)
    const headers = {
      ...args.headers,
      host: pinned.host,
      'content-length': Buffer.byteLength(args.body).toString(),
    }
    const onResponse = (response: IncomingMessage) => {
      clearTimeout(timeout)
      response.resume()
      resolve(response.statusCode ?? 0)
    }
    const req =
      pinned.url.protocol === 'https:'
        ? httpsRequest(
            pinned.url,
            {
              method: 'POST',
              headers,
              ...(pinned.servername !== undefined
                ? { servername: pinned.servername }
                : null),
            },
            onResponse,
          )
        : httpRequest(pinned.url, { method: 'POST', headers }, onResponse)
    timeout = setTimeout(() => {
      req.destroy(new Error('Webhook request timed out'))
    }, WEBHOOK_TIMEOUT_MS)
    req.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    req.end(args.body)
  })
}

function masterSecret(): string {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required for webhooks')
  }
  return env.BETTER_AUTH_SECRET
}

export function webhookSecretBytes(
  endpointId: string,
  secretVersion: number,
): Buffer {
  return createHmac('sha256', masterSecret())
    .update(`spliit:webhook-signing:v1:${endpointId}:${secretVersion}`)
    .digest()
}

export function displayWebhookSecret(
  endpointId: string,
  secretVersion: number,
): string {
  return `whsec_${webhookSecretBytes(endpointId, secretVersion).toString('base64')}`
}

export function standardWebhookHeaders(args: {
  endpointId: string
  secretVersion: number
  eventId: string
  body: string
  now?: Date
}): Record<string, string> {
  const timestamp = Math.floor((args.now ?? new Date()).getTime() / 1000)
  const signed = `${args.eventId}.${timestamp}.${args.body}`
  const signature = createHmac(
    'sha256',
    webhookSecretBytes(args.endpointId, args.secretVersion),
  )
    .update(signed)
    .digest('base64')
  return {
    'content-type': 'application/json',
    'user-agent': 'Spliit-Webhooks/1.0',
    'webhook-id': args.eventId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${signature}`,
  }
}

// Optional Cloudflare Worker relay (see `WEBHOOK_RELAY_URL`). Spliit POSTs
// the original webhook body unchanged to the relay; the relay verifies the
// envelope below and performs the final request, so destinations only ever
// see the Cloudflare source IP. The relay owns no retries, history, or
// webhook signatures — it only forwards.
export const WEBHOOK_RELAY_VERSION = '1'
export const WEBHOOK_RELAY_EXPIRY_SECONDS = 60

export const WEBHOOK_RELAY_HEADER_VERSION = 'x-spliit-relay-version'
export const WEBHOOK_RELAY_HEADER_DESTINATION = 'x-spliit-relay-destination'
export const WEBHOOK_RELAY_HEADER_EXPIRES = 'x-spliit-relay-expires'
export const WEBHOOK_RELAY_HEADER_REQUEST_ID = 'x-spliit-relay-request-id'
export const WEBHOOK_RELAY_HEADER_SIGNATURE = 'x-spliit-relay-signature'

/**
 * Normalize a destination URL into the exact string covered by the relay
 * signature. WHATWG URL parsing already lowercases the scheme/host and drops
 * default ports; explicit ports, path, and query are preserved.
 */
export function canonicalizeRelayDestination(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Webhook URL is invalid')
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not include credentials')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS')
  }
  url.hash = ''
  return url.toString()
}

export type WebhookRelayEnvelope = {
  headers: Record<string, string>
  expires: number
}

/**
 * Sign a relay envelope. The signature covers version, canonical destination,
 * expiry, request ID, and the sha256 of the raw body — the original webhook
 * headers travel alongside and are verified end-to-end by the destination via
 * its own webhook signature.
 */
export function buildRelayEnvelope(args: {
  destination: string
  body: string
  requestId: string
  secret: string
  now?: Date
}): WebhookRelayEnvelope {
  const expires =
    Math.floor((args.now ?? new Date()).getTime() / 1000) +
    WEBHOOK_RELAY_EXPIRY_SECONDS
  const bodyHash = createHash('sha256').update(args.body, 'utf8').digest('hex')
  const signed = [
    WEBHOOK_RELAY_VERSION,
    args.destination,
    String(expires),
    args.requestId,
    bodyHash,
  ].join('\n')
  const signature = createHmac('sha256', args.secret)
    .update(signed, 'utf8')
    .digest('base64url')
  return {
    expires,
    headers: {
      [WEBHOOK_RELAY_HEADER_VERSION]: WEBHOOK_RELAY_VERSION,
      [WEBHOOK_RELAY_HEADER_DESTINATION]: Buffer.from(
        args.destination,
        'utf8',
      ).toString('base64url'),
      [WEBHOOK_RELAY_HEADER_EXPIRES]: String(expires),
      [WEBHOOK_RELAY_HEADER_REQUEST_ID]: args.requestId,
      [WEBHOOK_RELAY_HEADER_SIGNATURE]: `v1,${signature}`,
    },
  }
}

/**
 * POST the original webhook body to the relay. Returns the relay's status code:
 * the destination status verbatim on a successful forward, or a 5xx (relay-side
 * failure) that the existing response classifier retries. Transport errors
 * throw into the caller's transient network-error path.
 */
export function sendWebhookRelayRequest(args: {
  relayUrl: string
  headers: Record<string, string>
  body: string
}): Promise<number> {
  let url: URL
  try {
    url = new URL(args.relayUrl)
  } catch {
    return Promise.reject(new Error('Webhook relay URL is invalid'))
  }
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<number>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          ...args.headers,
          'content-length': Buffer.byteLength(args.body).toString(),
        },
      },
      (response) => {
        clearTimeout(timeout)
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    timeout = setTimeout(() => {
      req.destroy(new Error('Webhook relay request timed out'))
    }, WEBHOOK_TIMEOUT_MS)
    req.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    req.end(args.body)
  })
}

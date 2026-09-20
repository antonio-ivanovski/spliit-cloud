// Spliit webhook relay (Cloudflare Worker).
//
// Forwards validated webhook deliveries to their final destination so the
// destination only ever sees the Cloudflare source IP. The relay owns no
// retries, history, or webhook signatures — it only forwards.
//
// Envelope protocol (all values sent as request headers alongside the
// unchanged webhook body):
//   X-Spliit-Relay-Version:      1
//   X-Spliit-Relay-Destination:  base64url(canonical-destination-url)
//   X-Spliit-Relay-Expires:      unix seconds (60s window, 30s skew grace)
//   X-Spliit-Relay-Request-Id:   delivery attempt ID (for log correlation)
//   X-Spliit-Relay-Signature:    v1,<base64url HMAC-SHA256> over
//     "1\ndestination\nexpires\nrequestId\nsha256hex(rawBody)"
//
// Responses: the destination status is returned verbatim with an empty body
// (Spliit maps it with its existing delivery classifier). Any relay-side
// failure returns 502 with a small JSON error, which Spliit retries. Relay
// logs and error responses carry only the request ID and outcome — never
// destinations, bodies, or secrets.

export type RelayWorkerEnv = {
  RELAY_SECRET?: string
}

const RELAY_VERSION = '1'
const SIGNATURE_PREFIX = 'v1,'
const UPSTREAM_TIMEOUT_MS = 9_000
const EXPIRY_LEEWAY_SECONDS = 30

// Original webhook headers forwarded to the destination. Everything else —
// including all X-Spliit-Relay-* envelope headers — is stripped.
const FORWARDED_HEADERS = [
  'content-type',
  'user-agent',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
] as const

function decodeBase64Url(value: string): Uint8Array {
  let padded = value.replaceAll('-', '+').replaceAll('_', '/')
  while (padded.length % 4 !== 0) {
    padded += '='
  }
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function toStrictBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Keep in sync with `isIpLiteralHostname` in
// `apps/api/src/lib/webhooks/security.ts`.
function isIpLiteralHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  // Brackets are stripped above, so any remaining colon means IPv6 (a
  // reg-name cannot contain a colon — it is the port delimiter).
  if (host.includes(':')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

// Second-layer destination check. Spliit already validates (and DNS-checks)
// destinations before relaying; the worker cannot do pre-resolution DNS, so it
// enforces the structural rules: public-shape HTTPS, no credentials, no IP
// literals.
function parseRelayDestination(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.hash) return null
  if (isIpLiteralHostname(url.hostname)) return null
  return url
}

function relayFailure(
  requestId: string | null,
  code: string,
  message: string,
): Response {
  console.log(
    JSON.stringify({
      component: 'webhook-relay',
      requestId: requestId ?? 'unknown',
      outcome: code,
    }),
  )
  return Response.json({ error: code, message }, { status: 502 })
}

async function verifyRelaySignature(args: {
  secret: string
  destination: string
  expires: string
  requestId: string
  signature: string
  body: ArrayBuffer
}): Promise<boolean> {
  if (!args.signature.startsWith(SIGNATURE_PREFIX)) return false
  let signatureBytes: Uint8Array
  try {
    signatureBytes = decodeBase64Url(
      args.signature.slice(SIGNATURE_PREFIX.length),
    )
  } catch {
    return false
  }
  if (signatureBytes.byteLength !== 32) return false
  const bodyDigest = await crypto.subtle.digest('SHA-256', args.body)
  const signed = [
    RELAY_VERSION,
    args.destination,
    args.expires,
    args.requestId,
    toHex(toStrictBytes(new Uint8Array(bodyDigest))),
  ].join('\n')
  const key = await crypto.subtle.importKey(
    'raw',
    toStrictBytes(new TextEncoder().encode(args.secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'HMAC',
    key,
    toStrictBytes(signatureBytes),
    toStrictBytes(new TextEncoder().encode(signed)),
  )
}

export async function handleRelayRequest(
  request: Request,
  relaySecret: string,
): Promise<Response> {
  const requestId = request.headers.get('x-spliit-relay-request-id')
  try {
    if (request.method !== 'POST') {
      return relayFailure(
        requestId,
        'invalid_method',
        'Relay only accepts POST requests',
      )
    }
    if (new URL(request.url).pathname !== '/forward') {
      return relayFailure(
        requestId,
        'invalid_path',
        'Relay only forwards /forward requests',
      )
    }
    const version = request.headers.get('x-spliit-relay-version')
    const destinationValue = request.headers.get('x-spliit-relay-destination')
    const expiresValue = request.headers.get('x-spliit-relay-expires')
    const signatureValue = request.headers.get('x-spliit-relay-signature')
    if (
      !version ||
      !destinationValue ||
      !expiresValue ||
      !requestId ||
      !signatureValue
    ) {
      return relayFailure(
        requestId,
        'missing_envelope',
        'Missing relay envelope headers',
      )
    }
    if (version !== RELAY_VERSION) {
      return relayFailure(
        requestId,
        'unsupported_version',
        'Unsupported relay version',
      )
    }
    const expires = Number(expiresValue)
    if (!Number.isInteger(expires)) {
      return relayFailure(requestId, 'invalid_expiry', 'Invalid relay expiry')
    }
    if (expires + EXPIRY_LEEWAY_SECONDS < Math.floor(Date.now() / 1000)) {
      return relayFailure(
        requestId,
        'expired_envelope',
        'Relay envelope expired',
      )
    }
    let destination: string
    try {
      destination = new TextDecoder().decode(decodeBase64Url(destinationValue))
    } catch {
      return relayFailure(
        requestId,
        'invalid_destination',
        'Relay destination is not decodable',
      )
    }
    const target = parseRelayDestination(destination)
    if (!target) {
      return relayFailure(
        requestId,
        'invalid_destination',
        'Relay destination must be an HTTPS URL without credentials or IP literals',
      )
    }
    const rawBody = await request.arrayBuffer()
    const verified = await verifyRelaySignature({
      secret: relaySecret,
      destination,
      expires: expiresValue,
      requestId,
      signature: signatureValue,
      body: rawBody,
    })
    if (!verified) {
      return relayFailure(
        requestId,
        'invalid_signature',
        'Relay signature verification failed',
      )
    }
    const forwardHeaders = new Headers()
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name)
      if (value !== null) {
        forwardHeaders.set(name, value)
      }
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, UPSTREAM_TIMEOUT_MS)
    try {
      const upstream = await fetch(target.toString(), {
        method: 'POST',
        headers: forwardHeaders,
        body: rawBody,
        redirect: 'manual',
        signal: controller.signal,
      })
      if (
        !Number.isInteger(upstream.status) ||
        upstream.status < 200 ||
        upstream.status > 599
      ) {
        return relayFailure(
          requestId,
          'invalid_upstream_status',
          'Relay received an invalid destination status',
        )
      }
      if (upstream.status >= 400) {
        console.log(
          JSON.stringify({
            component: 'webhook-relay',
            requestId,
            outcome: `upstream_${upstream.status}`,
          }),
        )
      }
      return new Response(null, { status: upstream.status })
    } catch {
      return relayFailure(
        requestId,
        'forward_failed',
        'Relay could not reach the destination',
      )
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return relayFailure(requestId, 'internal', 'Relay failed unexpectedly')
  }
}

export default {
  async fetch(request: Request, env: RelayWorkerEnv): Promise<Response> {
    if (!env.RELAY_SECRET) {
      return Response.json(
        { error: 'misconfigured', message: 'Relay secret is not configured' },
        { status: 502 },
      )
    }
    return handleRelayRequest(request, env.RELAY_SECRET)
  },
}

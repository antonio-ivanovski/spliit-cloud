import { Context, Effect, Layer } from 'effect'

/**
 * Generate a high-entropy, URL-safe raw token for a link invitation.
 *
 * The token is the join credential: it is handed to the inviter once (or stored
 * in plaintext for copy-anytime shared links) and only its SHA-256 hash is used
 * for accept/dedupe.
 */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** SHA-256 hash of a link token. */
export async function hashLinkToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Token minting and hashing behind a service boundary, so the invite domain
 * never touches the platform crypto API directly.
 */
export class InviteTokens extends Context.Service<
  InviteTokens,
  {
    readonly generate: Effect.Effect<string>
    readonly hash: (token: string) => Effect.Effect<string>
  }
>()('@spliit/api/invitations/Tokens') {}

/** Live tokens: real randomness and the platform SHA-256. */
export const InviteLiveTokens = Layer.succeed(
  InviteTokens,
  InviteTokens.of({
    generate: Effect.sync(generateLinkToken),
    hash: (token) => Effect.promise(() => hashLinkToken(token)),
  }),
)

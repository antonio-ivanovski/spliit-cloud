/**
 * Challenge token for OpenAI plugin domain verification.
 *
 * The OpenAI Platform dashboard issues a fresh token per plugin submission. It
 * must be served verbatim as plain text from
 * `/.well-known/openai-apps-challenge` on the MCP hostname. Keep the previous
 * submission's token as the fallback so existing deployments keep verifying
 * until the new value is configured.
 */
export const DEFAULT_OPENAI_APPS_CHALLENGE =
  'DSr2UeKW2yP07bHAMUvyidOy8MV3q0i9xe_C2GTZ3lY'

export function createOpenAiAppsChallengeResponse(challenge?: string) {
  const token = challenge?.trim() || DEFAULT_OPENAI_APPS_CHALLENGE
  return new Response(token, {
    headers: {
      'content-type': 'text/plain; charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
}

export const SIGNUP_INVITE_HEADER = 'X-Spliit-Invite-Token'

const AUTH_RETURN_MAX_DEPTH = 4
const LOCAL_URL_BASE = 'http://spliit.invalid'

export type AuthReturnContext = {
  redirectTo: string
  destination: string
  linkInviteToken?: string
  emailInvitationId?: string
}

/** Keep auth callbacks on this web origin and preserve the complete local URL. */
export function safeLocalReturnPath(
  value: string | undefined,
  fallback = '/',
): string {
  const trimmed = value?.trim()
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback
  }
  try {
    const url = new URL(trimmed, LOCAL_URL_BASE)
    if (url.origin !== LOCAL_URL_BASE || url.pathname.startsWith('//')) {
      return fallback
    }
    stripStrayNestedRedirectParam(url)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/**
 * Strip a stray nested `redirect` bounce from a destination URL so a re-gated
 * target cannot nest (`/groups/abc?redirect=/foo` → `/groups/abc`). Wrapper
 * paths (`/` and `/auth/complete-profile`) keep their `redirect` param: the
 * bounded, deduped {@link authReturnChain} resolves those to a destination
 * without rewriting the preserved `redirectTo`.
 */
function stripStrayNestedRedirectParam(url: URL): void {
  if (url.pathname === '/' || url.pathname === '/auth/complete-profile') {
    return
  }
  url.searchParams.delete('redirect')
  url.searchParams.delete('redirectTo')
}

function authReturnChain(value: string | undefined): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current = safeLocalReturnPath(value)

  for (let depth = 0; depth < AUTH_RETURN_MAX_DEPTH; depth += 1) {
    chain.push(current)
    seen.add(current)
    const url = new URL(current, LOCAL_URL_BASE)
    if (url.pathname !== '/' && url.pathname !== '/auth/complete-profile') break
    const nested =
      url.searchParams.get('redirect') ??
      url.searchParams.get('redirectTo') ??
      undefined
    const next = safeLocalReturnPath(nested)
    if (!nested || next === '/' || seen.has(next)) break
    current = next
  }

  return chain
}

export function extractLinkInviteTokenFromRedirect(
  redirect: string | undefined,
): string | undefined {
  for (const path of authReturnChain(redirect)) {
    const invite = new URL(path, LOCAL_URL_BASE).searchParams
      .get('invite')
      ?.trim()
    if (invite) return invite
  }
  return undefined
}

export function resolveAuthReturnContext(input: {
  redirect?: string
  redirectTo?: string
  invitation?: string
}): AuthReturnContext {
  const redirectTo = safeLocalReturnPath(input.redirectTo ?? input.redirect)
  const chain = authReturnChain(redirectTo)
  return {
    redirectTo,
    destination: chain.at(-1) ?? '/',
    linkInviteToken: extractLinkInviteTokenFromRedirect(redirectTo),
    emailInvitationId: input.invitation?.trim() || undefined,
  }
}

export function hasSignupInviteProof(search: {
  redirect?: string
  redirectTo?: string
  invitation?: string
}): boolean {
  const context = resolveAuthReturnContext(search)
  return Boolean(context.emailInvitationId || context.linkInviteToken)
}

export function signupInviteFetchOptions(linkInviteToken: string | undefined): {
  headers?: Record<string, string>
} {
  if (!linkInviteToken) return {}
  return { headers: { [SIGNUP_INVITE_HEADER]: linkInviteToken } }
}

export const SIGNUP_INVITE_HEADER = 'X-Spliit-Invite-Token'

const LOCAL_URL_BASE = 'http://spliit.invalid'

/**
 * Structured auth-return search params. Bearer tokens (`invite`, `viewKey`) and
 * the email `invitation` id travel as first-class params on every bounce hop;
 * `redirect` carries only the destination pathname plus non-credential search
 * (never another nested `redirect=`).
 */
export type AuthBounceSearch = {
  redirect?: string
  invite?: string
  viewKey?: string
  invitation?: string
  invitationAction?: 'accept'
}

export type AuthReturnContext = {
  /** Destination path with credentials re-attached (post-auth navigation). */
  redirectTo: string
  /** Bearer tokens + email invitation id, trimmed. */
  linkInviteToken?: string
  viewKey?: string
  emailInvitationId?: string
  invitationAction?: 'accept'
}

function trimmedParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Invite tokens are hex (`generateLinkToken`); anything else inside the value
 * is provably nested query syntax from a mangled hop, never a real token.
 */
function sanitizeInviteToken(value: unknown): string | undefined {
  const trimmed = trimmedParam(value)
  if (!trimmed) return undefined
  // A mangled hop embeds an already-resolved destination into the value
  // (`T?invite=T?invite=T…`, plus `%3F`/`%26`/`%3D` variants once decoded by
  // different serializers). Cut at the first nesting marker and keep the
  // leading run: repeated mangling collapses to a fixed point.
  const cut = trimmed.search(/[?&=]|%3[fF]|%2[56]|%3[dD]/)
  const candidate = cut === -1 ? trimmed : trimmed.slice(0, cut)
  const token = candidate.trim()
  return token ? token : undefined
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
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/**
 * Parse one opaque legacy bounce (`/groups/abc?invite=…`, or a nested
 * `?redirect=` bounce minted before structured returns). A `redirect` param
 * unwraps one level wherever it appears — a stray one on a destination page
 * carries the true bearer context, and dropping it (the old behavior) is
 * exactly how invite tokens were lost. Recursion is bounded; each level must
 * still be a safe local path.
 */
function parseLegacyRedirect(
  value: string | undefined,
  depth = 0,
): {
  pathname: string
  search: URLSearchParams
  hash: string
} | null {
  if (depth > 4) return null
  const safe = safeLocalReturnPath(value, '')
  if (!safe) return null
  const url = new URL(safe, LOCAL_URL_BASE)
  if (url.searchParams.has('redirect')) {
    const target = parseLegacyRedirect(
      url.searchParams.get('redirect') ?? undefined,
      depth + 1,
    )
    if (!target) return null
    for (const key of ['invite', 'viewKey', 'invitation', 'invitationAction']) {
      const value = url.searchParams.get(key)
      if (value?.trim()) target.search.set(key, value)
    }
    return target
  }
  return { pathname: url.pathname, search: url.searchParams, hash: url.hash }
}

/**
 * Single owner for every auth-guard bounce. Takes the full current location
 * (path + search + hash) and optional explicit credentials, and returns the
 * search to put on `/` (or `/auth/complete-profile`).
 *
 * A bounce whose target is `/` emits a bare `/` with no `redirect` search — a
 * self-bounce (`/?redirect=%2F`) is inexpressible. Credentials ride as
 * first-class params with one precedence rule: explicit (structured) wins, the
 * location's own params and a legacy nested `redirect=` fill gaps only.
 * Non-credential search on the destination survives on `redirect`.
 */
export function buildAuthBounceSearch(input: {
  writer: string
  from: string
  invite?: string
  viewKey?: string
  invitation?: string
  invitationAction?: 'accept'
}): Record<string, string> {
  const safe = safeLocalReturnPath(input.from, '')
  if (!safe) {
    return {}
  }
  const url = new URL(safe, LOCAL_URL_BASE)
  // A legacy nested bounce carries the true bearer context: unwrap it and
  // bounce to its destination, never re-nest it.
  const inner = url.searchParams.has('redirect')
    ? parseLegacyRedirect(url.searchParams.get('redirect') ?? undefined)
    : null
  const target = inner ?? {
    pathname: url.pathname,
    search: url.searchParams,
    hash: '',
  }
  // Merge, don't pick one source: a nested legacy bounce and the outer
  // location can each carry proof (the outer token is the live one when a
  // lap re-bounces an already-structured URL). Precedence: explicit input,
  // then the outer location, then the inner legacy search. Every invite
  // read goes through the mangling sanitizer so an already-doubled value
  // collapses instead of growing.
  const credentialSource = inner ? inner.search : url.searchParams
  const invite =
    sanitizeInviteToken(input.invite) ??
    sanitizeInviteToken(url.searchParams.get('invite')) ??
    sanitizeInviteToken(credentialSource.get('invite'))
  const viewKey =
    trimmedParam(input.viewKey) ??
    trimmedParam(url.searchParams.get('viewKey')) ??
    trimmedParam(credentialSource.get('viewKey'))
  const invitation =
    trimmedParam(input.invitation) ??
    trimmedParam(url.searchParams.get('invitation')) ??
    trimmedParam(credentialSource.get('invitation'))
  const invitationAction =
    input.invitationAction ??
    (url.searchParams.get('invitationAction') === 'accept' ||
    credentialSource.get('invitationAction') === 'accept'
      ? 'accept'
      : undefined)
  // Non-credential search survives on the destination pathname.
  const extra = new URLSearchParams()
  for (const [key, value] of target.search) {
    if (
      key === 'redirect' ||
      key === 'invite' ||
      key === 'viewKey' ||
      key === 'invitation' ||
      key === 'invitationAction'
    ) {
      continue
    }
    extra.append(key, value)
  }
  const extraStr = extra.toString()
  // The destination hash survives inside the `redirect` value (encoded on
  // serialize): tab deep-links like `#members` must outlive the bounce.
  const hash = inner ? target.hash : url.hash
  // `/` is not a joinable destination, so it takes no `redirect` — but its
  // credentials still ride along (`/?invite=…` resolves proof without a
  // destination). A self-bounce (`/?redirect=%2F`) collapses to bare `/`, and
  // so does a nested bounce onto bare `/` (a stray `redirect` param on the
  // outer page is that page's own param, not a bounce of `/`).
  if (target.pathname === '/') {
    const search: Record<string, string> = {}
    if (invite) search.invite = invite
    if (viewKey) search.viewKey = viewKey
    if (invitation) search.invitation = invitation
    if (invitationAction) search.invitationAction = invitationAction
    return search
  }
  const redirect = `${target.pathname}${extraStr ? `?${extraStr}` : ''}${hash}`
  const search: Record<string, string> = { redirect }
  if (invite) search.invite = invite
  if (viewKey) search.viewKey = viewKey
  if (invitation) search.invitation = invitation
  if (invitationAction) search.invitationAction = invitationAction
  return search
}

/**
 * Resolve the post-auth destination from a bounce hop's search. `redirect`
 * carries the destination pathname plus non-credential search; credentials
 * arrive as first-class params, with a legacy opaque `redirect=` filling gaps
 * only.
 */
export function resolveAuthReturnContext(
  input: AuthBounceSearch,
): AuthReturnContext {
  // An unparseable `redirect` (off-origin nesting, over-deep chain)
  // collapses the whole bounce to bare `/` — keeping the raw value would
  // preserve the attacker's URL as a live param and risk a self-loop.
  // Explicit structured proof still survives the collapse: the destination
  // is untrusted, but the credential is not, and dropping it would strand
  // an invite-bearing bounce with no way to recover.
  const legacy = parseLegacyRedirect(input.redirect)
  if (input.redirect != null && legacy == null) {
    return {
      redirectTo: '/',
      linkInviteToken: sanitizeInviteToken(input.invite),
      viewKey: trimmedParam(input.viewKey),
      emailInvitationId: trimmedParam(input.invitation),
      invitationAction: input.invitationAction,
    }
  }
  const legacyQuery = legacy?.search.toString()
  const base = legacy
    ? `${legacy.pathname}${legacyQuery ? `?${legacyQuery}` : ''}${legacy.hash}`
    : '/'
  const url = new URL(safeLocalReturnPath(base, '/'), LOCAL_URL_BASE)
  const invite =
    sanitizeInviteToken(input.invite) ??
    sanitizeInviteToken(url.searchParams.get('invite'))
  const viewKey =
    trimmedParam(input.viewKey) ?? trimmedParam(url.searchParams.get('viewKey'))
  const emailInvitationId =
    trimmedParam(input.invitation) ??
    trimmedParam(url.searchParams.get('invitation'))
  const invitationAction =
    input.invitationAction ??
    (url.searchParams.get('invitationAction') === 'accept'
      ? 'accept'
      : undefined)
  // `/` is not a joinable destination: attaching credentials to it builds a
  // self-referential `/?invite=…` that a signed-in landing page would bounce
  // on forever. The proof is still extracted (the panel sends the header),
  // but the destination stays bare `/`.
  if (url.pathname !== '/') {
    if (invite) url.searchParams.set('invite', invite)
    if (viewKey) url.searchParams.set('viewKey', viewKey)
    if (emailInvitationId) url.searchParams.set('invitation', emailInvitationId)
    if (invitationAction)
      url.searchParams.set('invitationAction', invitationAction)
  }
  return {
    redirectTo: `${url.pathname}${url.search}${url.hash}`,
    linkInviteToken: invite,
    viewKey,
    emailInvitationId,
    ...(invitationAction ? { invitationAction } : {}),
  }
}

/**
 * Split a resolved destination into TanStack-safe `to` (pathname only),
 * `search` object, and `hash`. `redirectTo` embeds its query
 * (`/groups/X?invite=T`), and passing query-in-`to` to `<Navigate>`/
 * `navigate()` serializes it verbatim instead of encoding it — each lap appends
 * another `?invite=T` to the value (the `T%3Finvite%3DT?invite%3DT…` mangling).
 * Every post-auth navigation must go through this split.
 */
export function splitAuthDestination(redirectTo: string): {
  to: string
  search: Record<string, string>
  hash: string | undefined
} {
  const url = new URL(safeLocalReturnPath(redirectTo, '/'), LOCAL_URL_BASE)
  const search: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    search[key] = value
  }
  return {
    to: url.pathname,
    search,
    hash: url.hash ? url.hash.slice(1) : undefined,
  }
}

export function hasSignupInviteProof(search: AuthBounceSearch): boolean {
  const context = resolveAuthReturnContext(search)
  return Boolean(context.emailInvitationId || context.linkInviteToken)
}

export function signupInviteFetchOptions(linkInviteToken: string | undefined): {
  headers?: Record<string, string>
} {
  if (!linkInviteToken) return {}
  return { headers: { [SIGNUP_INVITE_HEADER]: linkInviteToken } }
}

/** Every authentication method lands at the same authoritative setup gate. */
export function buildCompleteProfilePath(redirectTo: string): string {
  const search = buildAuthBounceSearch({
    writer: 'auth-completion',
    from: redirectTo,
  })
  const query = new URLSearchParams(search).toString()
  return `/auth/complete-profile${query ? `?${query}` : ''}`
}

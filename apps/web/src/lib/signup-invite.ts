export const SIGNUP_INVITE_HEADER = 'X-Spliit-Invite-Token'

export function extractLinkInviteTokenFromRedirect(
  redirect: string | undefined,
): string | undefined {
  if (!redirect) return undefined
  try {
    const url = new URL(redirect, 'http://spliit.invalid')
    const invite = url.searchParams.get('invite')?.trim()
    return invite || undefined
  } catch {
    return undefined
  }
}

export function hasSignupInviteProof(search: {
  redirect?: string
  invitation?: string
}): boolean {
  return Boolean(
    search.invitation?.trim() ||
    extractLinkInviteTokenFromRedirect(search.redirect),
  )
}

export function signupInviteFetchOptions(linkInviteToken: string | undefined): {
  headers?: Record<string, string>
} {
  if (!linkInviteToken) return {}
  return { headers: { [SIGNUP_INVITE_HEADER]: linkInviteToken } }
}

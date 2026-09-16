export type ParsedInviteLink = {
  groupId: string
  token: string
  url: string
}

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/**
 * Parse scanned QR / pasted text into a Spliit group invite. Accepts any
 * http(s) origin (nearby hosts may run another instance) as long as the path
 * holds `/groups/<groupId>` and `?invite=` carries a well-formed token. Returns
 * null for anything else — never navigate blindly to a scanned URL.
 */
export function parseScannedInviteLink(text: string): ParsedInviteLink | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const segments = url.pathname.split('/').filter(Boolean)
  const groupsIndex = segments.lastIndexOf('groups')
  const groupId = groupsIndex >= 0 ? segments[groupsIndex + 1] : undefined
  const token = url.searchParams.get('invite')
  if (!groupId || !token || !INVITE_TOKEN_PATTERN.test(token)) return null
  return { groupId, token, url: url.toString() }
}

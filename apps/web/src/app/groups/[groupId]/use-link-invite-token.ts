import { useSearch } from '@tanstack/react-router'

/**
 * Read the raw link-invite token from the group route's `?invite=`
 * search param. Returns `undefined` when the URL has no invite param,
 * which the server treats as "no link-invite credential". The token is
 * forwarded to read procedures so pending link-invitees can browse the
 * group before accepting.
 */
export function useLinkInviteToken(): string | undefined {
  const { invite } = useSearch({
    from: '/groups/$groupId',
  })
  return invite
}

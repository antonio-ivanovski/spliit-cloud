import { useSearch } from '@tanstack/react-router'

/**
 * Bearer tokens from the group route search params. `?invite=` is a pending
 * link invitation; `?viewKey=` is public view-only access. Both are forwarded
 * to group read procedures. `undefined` means "no credential of that kind".
 */
export function useGroupAccessSearch(): {
  linkInviteToken: string | undefined
  viewKey: string | undefined
} {
  const search = useSearch({
    from: '/groups/$groupId',
    shouldThrow: false,
  })
  return {
    linkInviteToken: search?.invite,
    viewKey: search?.viewKey,
  }
}

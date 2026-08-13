import { getApiBaseUrl } from './api-url'

export type GroupViewerFragmentCredential = {
  kind: 'PUBLIC_VIEW' | 'PENDING_INVITEE'
  key: string
}

export function readGroupViewerFragment(): GroupViewerFragmentCredential | null {
  if (typeof window === 'undefined') return null
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const viewKey = fragment.get('view')
  if (viewKey) return { kind: 'PUBLIC_VIEW', key: viewKey }
  const inviteKey = fragment.get('invite')
  return inviteKey ? { kind: 'PENDING_INVITEE', key: inviteKey } : null
}

export async function exchangeGroupViewerFragment(
  groupId: string,
  credential: GroupViewerFragmentCredential,
) {
  const response = await fetch(
    `${getApiBaseUrl()}/groups/${groupId}/view-session`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    },
  )
  return response.ok
}

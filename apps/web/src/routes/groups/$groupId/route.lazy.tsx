import {
  createLazyFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect } from 'react'

import { GroupLayoutClient } from '@/app/groups/[groupId]/layout.client'

const groupRouteApi = getRouteApi('/groups/$groupId')

function GroupLayoutRoute() {
  const { groupId } = groupRouteApi.useParams()
  const legacyHref = getLegacyGroupAliasHref(groupId)
  if (legacyHref) return <LegacyGroupAliasRedirect href={legacyHref} />
  return <GroupLayoutClient groupId={groupId} />
}

function LegacyGroupAliasRedirect({ href }: { href: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    void navigate({ href, replace: true })
  }, [href, navigate])
  return null
}

export function getLegacyGroupAliasHref(groupId: string) {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const alias =
    fragment.get('view')?.trim() ||
    fragment.get('invite')?.trim() ||
    url.searchParams.get('invite')?.trim()
  if (!alias) return null

  const prefix = `/groups/${encodeURIComponent(groupId)}`
  if (!url.pathname.startsWith(prefix)) return null
  url.pathname = `/groups/${encodeURIComponent(alias)}${url.pathname.slice(prefix.length)}`
  url.searchParams.delete('invite')
  url.hash = ''
  return `${url.pathname}${url.search}`
}

export const Route = createLazyFileRoute('/groups/$groupId')({
  component: GroupLayoutRoute,
})

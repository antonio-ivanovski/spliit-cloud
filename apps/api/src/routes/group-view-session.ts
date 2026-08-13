import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'

import { webOrigins } from '../lib/env'
import {
  GROUP_VIEW_COOKIE,
  GROUP_VIEW_SESSION_SECONDS,
  fingerprintGroupViewKey,
  groupViewKeysMatch,
  isGroupViewKey,
  signGroupViewerSession,
} from '../lib/group-view'
import { hashLinkToken } from '../lib/invitations'

const cookieAttributes = () =>
  `Path=/; HttpOnly; SameSite=Lax; Max-Age=${GROUP_VIEW_SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`

export async function exchangeGroupViewerSession(
  request: Request,
  groupId: string,
) {
  const origin = request.headers.get('origin')
  if (origin && !webOrigins.includes(origin)) {
    return Response.json({ error: 'invalid_credential' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: unknown
    key?: unknown
  } | null
  if (!body || typeof body.key !== 'string') {
    return Response.json({ error: 'invalid_credential' }, { status: 400 })
  }

  if (body.kind === 'PUBLIC_VIEW' && isGroupViewKey(body.key)) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { groupType: true, publicViewKey: true },
    })
    if (
      group?.groupType === 'GROUP' &&
      group.publicViewKey &&
      groupViewKeysMatch(group.publicViewKey, body.key)
    ) {
      const token = await signGroupViewerSession({
        kind: 'PUBLIC_VIEW',
        groupId,
        keyFingerprint: fingerprintGroupViewKey(group.publicViewKey),
      })
      return Response.json(
        { ok: true },
        {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': `${GROUP_VIEW_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes()}`,
          },
        },
      )
    }
  }

  if (body.kind === 'PENDING_INVITEE') {
    const invitation = await prisma.groupInvitation.findFirst({
      where: {
        groupId,
        type: GroupInvitationType.LINK,
        status: GroupInvitationStatus.PENDING,
        tokenHash: await hashLinkToken(body.key),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    })
    if (invitation) {
      const token = await signGroupViewerSession({
        kind: 'PENDING_INVITEE',
        groupId,
        invitationId: invitation.id,
      })
      return Response.json(
        { ok: true },
        {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': `${GROUP_VIEW_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes()}`,
          },
        },
      )
    }
  }

  return Response.json({ error: 'invalid_credential' }, { status: 404 })
}

export function clearGroupViewerSession() {
  return Response.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `${GROUP_VIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      },
    },
  )
}

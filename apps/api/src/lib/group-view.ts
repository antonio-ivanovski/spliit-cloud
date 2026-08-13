import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { jwtVerify, SignJWT } from 'jose'

import { env } from './env'

export const GROUP_VIEW_KEY_PREFIX = 'spliit_group_view_v1_'
export const GROUP_VIEW_COOKIE = 'spliit.group_view'
export const GROUP_VIEW_SESSION_SECONDS = 30 * 24 * 60 * 60

export type GroupViewerSession =
  | {
      kind: 'PUBLIC_VIEW'
      groupId: string
      keyFingerprint: string
    }
  | {
      kind: 'PENDING_INVITEE'
      groupId: string
      invitationId: string
    }

function secret() {
  const value =
    env.BETTER_AUTH_SECRET ??
    (env.NODE_ENV === 'production'
      ? null
      : 'spliit-development-group-view-secret')
  if (!value) throw new Error('BETTER_AUTH_SECRET is required')
  return value
}

function deriveKey(label: string) {
  return createHash('sha256')
    .update(secret())
    .update('\0')
    .update(label)
    .digest()
}

export function generateGroupViewKey() {
  return `${GROUP_VIEW_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function fingerprintGroupViewKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

export function groupViewKeysMatch(currentKey: string, candidateKey: string) {
  const current = Buffer.from(fingerprintGroupViewKey(currentKey), 'hex')
  const candidate = Buffer.from(fingerprintGroupViewKey(candidateKey), 'hex')
  return timingSafeEqual(current, candidate)
}

export function isGroupViewKey(key: string) {
  return new RegExp(`^${GROUP_VIEW_KEY_PREFIX}[A-Za-z0-9_-]{43}$`).test(key)
}

/** Prevent pending invitation email addresses from becoming display labels. */
export function redactViewerDisplayName(name: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name) ? 'Pending participant' : name
}

export async function signGroupViewerSession(session: GroupViewerSession) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience('spliit:group-view')
    .setIssuedAt()
    .setExpirationTime(`${GROUP_VIEW_SESSION_SECONDS}s`)
    .sign(deriveKey('group-view-session'))
}

export async function verifyGroupViewerSession(
  token: string,
): Promise<GroupViewerSession | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      deriveKey('group-view-session'),
      { audience: 'spliit:group-view' },
    )
    if (
      payload.kind === 'PUBLIC_VIEW' &&
      typeof payload.groupId === 'string' &&
      typeof payload.keyFingerprint === 'string'
    ) {
      return {
        kind: payload.kind,
        groupId: payload.groupId,
        keyFingerprint: payload.keyFingerprint,
      }
    }
    if (
      payload.kind === 'PENDING_INVITEE' &&
      typeof payload.groupId === 'string' &&
      typeof payload.invitationId === 'string'
    ) {
      return {
        kind: payload.kind,
        groupId: payload.groupId,
        invitationId: payload.invitationId,
      }
    }
  } catch {
    // Invalid, tampered, or expired cookies are treated as absent.
  }
  return null
}

export function readCookie(headers: Headers, name: string) {
  const cookie = headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return null
}

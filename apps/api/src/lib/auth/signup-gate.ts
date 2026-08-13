import { APIError } from 'better-auth/api'

import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'

import { env } from '../env'
import { getLinkInvitationPreview } from '../invitations/link-invitations'

export const SIGNUP_INVITE_REQUIRED = 'SIGNUP_INVITE_REQUIRED'
export const SIGNUP_INVITE_HEADER = 'x-spliit-invite-token'
export const SIGNUP_INVITE_COOKIE = 'spliit.signup_invite'
export const SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS = 15 * 60

const SIGNUP_GATE_PATHS = new Set([
  '/sign-up/email',
  '/sign-in/magic-link',
  '/sign-in/social',
  '/sign-in/oauth2',
])

export type SignupGateRequest = {
  path?: string
  body?: { email?: unknown } | null
  headers?: {
    get?: (name: string) => string | null
  }
  getCookie?: (name: string) => string | null
  setCookie?: (
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean
      sameSite?: 'lax' | 'strict' | 'none'
      secure?: boolean
      maxAge?: number
      path?: string
    },
  ) => void
}

export function isInviteOnlySignup(): boolean {
  return env.SIGNUP_MODE === 'invite_only'
}

export async function allowUninvitedSignup(): Promise<boolean> {
  if (!isInviteOnlySignup()) return true
  return (await prisma.account.count()) === 0
}

export async function hasPendingEmailInvitationForEmail(
  email: string,
): Promise<boolean> {
  const normalized = email.trim()
  if (!normalized) return false
  const invitation = await prisma.groupInvitation.findFirst({
    where: {
      type: GroupInvitationType.EMAIL,
      status: GroupInvitationStatus.PENDING,
      email: { equals: normalized, mode: 'insensitive' },
    },
    select: { id: true },
  })
  return invitation != null
}

export async function isUsableLinkInviteToken(
  token: string | null | undefined,
): Promise<boolean> {
  const trimmed = token?.trim()
  if (!trimmed || trimmed.length < 16) return false
  const preview = await getLinkInvitationPreview(trimmed)
  return preview?.usable === true
}

export async function canCreateAccount(opts: {
  email?: string | null
  linkInviteToken?: string | null
}): Promise<boolean> {
  if (await allowUninvitedSignup()) return true
  if (opts.email && (await hasPendingEmailInvitationForEmail(opts.email))) {
    return true
  }
  return isUsableLinkInviteToken(opts.linkInviteToken)
}

export function throwSignupInviteRequired(): never {
  throw new APIError('FORBIDDEN', {
    message:
      'This instance is invite-only. Use an invitation link or ask to be invited.',
    code: SIGNUP_INVITE_REQUIRED,
  })
}

export function readLinkInviteToken(
  ctx: SignupGateRequest | null | undefined,
): string | undefined {
  if (!ctx) return undefined
  const header = ctx.headers?.get?.(SIGNUP_INVITE_HEADER)?.trim()
  if (header) return header
  const cookie = ctx.getCookie?.(SIGNUP_INVITE_COOKIE)?.trim()
  return cookie || undefined
}

function readBodyEmail(ctx: SignupGateRequest): string | undefined {
  const email = ctx.body?.email
  return typeof email === 'string' ? email : undefined
}

export async function persistSignupInviteCookie(
  ctx: SignupGateRequest,
): Promise<void> {
  if (!ctx.path || !SIGNUP_GATE_PATHS.has(ctx.path) || !ctx.setCookie) return
  const headerToken = ctx.headers?.get?.(SIGNUP_INVITE_HEADER)?.trim()
  if (!headerToken) return
  if (!(await isUsableLinkInviteToken(headerToken))) return
  ctx.setCookie(SIGNUP_INVITE_COOKIE, headerToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}

export async function enforceSignupGate(ctx: SignupGateRequest): Promise<void> {
  if (!isInviteOnlySignup()) return

  if (ctx.path === '/sign-up/email') {
    const allowed = await canCreateAccount({
      email: readBodyEmail(ctx),
      linkInviteToken: readLinkInviteToken(ctx),
    })
    if (!allowed) throwSignupInviteRequired()
    return
  }

  if (ctx.path === '/sign-in/magic-link') {
    const email = readBodyEmail(ctx)
    if (email) {
      const existing = await prisma.account.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) return
    }
    const allowed = await canCreateAccount({
      email,
      linkInviteToken: readLinkInviteToken(ctx),
    })
    if (!allowed) throwSignupInviteRequired()
  }
}

export async function assertCanCreateAccount(opts: {
  email?: string | null
  context?: SignupGateRequest | null
}): Promise<void> {
  const allowed = await canCreateAccount({
    email: opts.email,
    linkInviteToken: readLinkInviteToken(opts.context),
  })
  if (!allowed) throwSignupInviteRequired()
}

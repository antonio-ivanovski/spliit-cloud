import { addOAuthServerContext, APIError, getOAuthState } from 'better-auth/api'

import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'

import { env, webOrigins } from '../env'
import { getLinkInvitationPreview } from '../invitations/link-invitations'

export const SIGNUP_INVITE_REQUIRED = 'SIGNUP_INVITE_REQUIRED'
export const SIGNUP_INVITE_HEADER = 'x-spliit-invite-token'
const SIGNUP_INVITE_OAUTH_STATE_KEY = 'signupInviteToken'
const AUTH_RETURN_MAX_DEPTH = 4
const allowedWebOrigins = new Set(webOrigins)

export type SignupGateRequest = {
  path?: string
  body?: { email?: unknown } | null
  query?: Record<string, unknown> | null
  headers?: {
    get?: (name: string) => string | null
  }
}

export function isInviteOnlySignup(): boolean {
  return env.SIGNUP_MODE === 'invite_only'
}

export async function allowUninvitedSignup(): Promise<boolean> {
  if (!isInviteOnlySignup()) return true
  return (await prisma.user.count()) === 0
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

function readHeaderLinkInviteToken(
  ctx: SignupGateRequest | null | undefined,
): string | undefined {
  return ctx?.headers?.get?.(SIGNUP_INVITE_HEADER)?.trim() || undefined
}

function readBodyEmail(ctx: SignupGateRequest): string | undefined {
  const email = ctx.body?.email
  return typeof email === 'string' ? email : undefined
}

function extractLinkInviteTokenFromReturnUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  let current = value.trim()

  for (let depth = 0; depth < AUTH_RETURN_MAX_DEPTH; depth += 1) {
    let url: URL
    try {
      url = new URL(current, webOrigins[0])
    } catch {
      return undefined
    }
    if (!allowedWebOrigins.has(url.origin)) return undefined
    const token = url.searchParams.get('invite')?.trim()
    if (token) return token
    if (url.pathname !== '/auth/complete-profile') return undefined
    const nested = url.searchParams.get('redirect')
    if (!nested) return undefined
    current = nested
  }

  return undefined
}

function readMagicLinkCallbackToken(
  ctx: SignupGateRequest,
): string | undefined {
  if (ctx.path !== '/magic-link/verify') return undefined
  return (
    extractLinkInviteTokenFromReturnUrl(ctx.query?.newUserCallbackURL) ??
    extractLinkInviteTokenFromReturnUrl(ctx.query?.callbackURL)
  )
}

export async function readLinkInviteToken(
  ctx: SignupGateRequest | null | undefined,
): Promise<string | undefined> {
  const header = readHeaderLinkInviteToken(ctx)
  if (header) return header
  if (!ctx) return undefined

  const callbackToken = readMagicLinkCallbackToken(ctx)
  if (callbackToken) return callbackToken

  if (!ctx.path?.startsWith('/callback/')) return undefined
  const state = await getOAuthState()
  const stateToken = state?.serverContext?.[SIGNUP_INVITE_OAUTH_STATE_KEY]
  return typeof stateToken === 'string'
    ? stateToken.trim() || undefined
    : undefined
}

export async function captureOAuthSignupInvite(
  ctx: SignupGateRequest,
): Promise<void> {
  if (ctx.path !== '/sign-in/social' && ctx.path !== '/sign-in/oauth2') return
  const token = readHeaderLinkInviteToken(ctx)
  if (!token || !(await isUsableLinkInviteToken(token))) return
  await addOAuthServerContext({ [SIGNUP_INVITE_OAUTH_STATE_KEY]: token })
}

export async function enforceSignupGate(ctx: SignupGateRequest): Promise<void> {
  if (!isInviteOnlySignup()) return

  if (ctx.path === '/sign-up/email') {
    const allowed = await canCreateAccount({
      email: readBodyEmail(ctx),
      linkInviteToken: await readLinkInviteToken(ctx),
    })
    if (!allowed) throwSignupInviteRequired()
    return
  }

  if (ctx.path === '/sign-in/magic-link') {
    const email = readBodyEmail(ctx)
    if (email) {
      const existing = await prisma.user.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) return
    }
    const allowed = await canCreateAccount({
      email,
      linkInviteToken: await readLinkInviteToken(ctx),
    })
    if (!allowed) throwSignupInviteRequired()
  }
}

export async function assertCanCreateAccount(opts: {
  email?: string | null
  context?: SignupGateRequest | null
  anonymous?: boolean
}): Promise<void> {
  if (opts.anonymous && isInviteOnlySignup()) {
    const linkInviteToken = await readLinkInviteToken(opts.context)
    if (!(await isUsableLinkInviteToken(linkInviteToken))) {
      throwSignupInviteRequired()
    }
    return
  }
  const linkInviteToken = await readLinkInviteToken(opts.context)
  const allowed = await canCreateAccount({
    email: opts.email,
    linkInviteToken,
  })
  if (!allowed) throwSignupInviteRequired()
}

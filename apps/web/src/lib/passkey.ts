import { getTrpcClient } from '@/trpc/client'

import { authClient } from './auth'
import { replaceBrowserLocation } from './browser-navigation'
import { clearLastAccount } from './last-account'
import { safeLocalReturnPath } from './signup-invite'

export type PasskeyInfo = {
  id: string
  name?: string | null
  createdAt: string | Date
  deviceType?: string | null
  backedUp?: boolean | null
}

export class PasskeyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
  }
}

function toPasskeyError(
  error: { code?: string; message?: string; status?: number } | null,
  fallbackCode: string,
): PasskeyError {
  return new PasskeyError(
    error?.code ?? error?.message ?? fallbackCode,
    error?.status ?? 0,
  )
}

/**
 * Whether this browser can use WebAuthn passkeys at all. Conditional UI
 * (autofill) support is probed separately at the call site.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  )
}

type PasskeyRow = {
  id: string
  name?: string | null
  createdAt: string | Date
  deviceType?: string | null
  backedUp?: boolean | null
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const result = await authClient.passkey.listUserPasskeys()
  if (result.error) {
    throw toPasskeyError(result.error, 'PASSKEY_LIST_FAILED')
  }
  // The endpoint returns full credential rows (including publicKey). Pick
  // only what the UI renders so key material never sits in client state.
  return ((result.data ?? []) as PasskeyRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? null,
    createdAt: row.createdAt,
    deviceType: row.deviceType ?? null,
    backedUp: row.backedUp ?? null,
  }))
}

export async function addPasskey(name?: string): Promise<PasskeyInfo> {
  const trimmed = name?.trim()
  const result = await authClient.passkey.addPasskey(
    trimmed ? { name: trimmed } : undefined,
  )
  if (result.error || !result.data) {
    // Backstop for the proactive freshness check below (clock skew, or the
    // session aging past the window between the check and verification):
    // a stale session fails mid-ceremony with SESSION_NOT_FRESH.
    if (
      typeof result.error === 'object' &&
      result.error !== null &&
      'code' in result.error &&
      result.error.code === 'SESSION_NOT_FRESH'
    ) {
      const status =
        'status' in result.error && typeof result.error.status === 'number'
          ? result.error.status
          : 403
      throw new PasskeyError('PASSKEY_SESSION_STALE', status)
    }
    throw toPasskeyError(result.error, 'PASSKEY_ADD_FAILED')
  }
  return result.data as PasskeyInfo
}

/**
 * Mirrors the server's `freshSessionMiddleware` rule (`now - createdAt <
 * freshAge`) so the settings page can offer a re-auth roundtrip before the
 * WebAuthn ceremony instead of failing it midway. Unknown, missing, or
 * unparseable session timestamps count as fresh — the server is the source of
 * truth and `addPasskey` maps its verdict.
 */
export function isSessionFreshForPasskeyRegistration(
  sessionCreatedAt: string | Date | null | undefined,
  freshAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  // Fail open: without a usable window (e.g. web newer than the API during
  // a rolling deploy, so `passkeyFreshAgeSeconds` is undefined) the probe
  // must not block — the server verdict decides. `0` disables the server
  // check, so it counts as always fresh here too.
  if (!Number.isFinite(freshAgeSeconds) || freshAgeSeconds <= 0) return true
  if (sessionCreatedAt == null) return true
  const createdAt = new Date(sessionCreatedAt).getTime()
  if (Number.isNaN(createdAt)) return true
  return nowMs - createdAt < freshAgeSeconds * 1000
}

/**
 * One-shot freshness probe for the "Add a passkey" entry point. Never throws:
 * any failure (offline, no session payload) resolves fresh so the attempt
 * proceeds and the server verdict decides.
 */
export async function getPasskeySessionFreshness(
  freshAgeSeconds: number,
): Promise<boolean> {
  try {
    const { data } = await authClient.getSession()
    return isSessionFreshForPasskeyRegistration(
      data?.session?.createdAt,
      freshAgeSeconds,
    )
  } catch {
    return true
  }
}

/**
 * Re-authentication roundtrip for stale sessions: sign the old session out (it
 * must die, or the sign-in page sees a live session and never shows the form)
 * and hard-navigate to `/` with the current page preserved as `redirect` — the
 * same pattern as `RequireAuth`. After sign-in the user lands back and retries
 * with a fresh session.
 */
export async function signOutAndReturnToSignIn(): Promise<void> {
  const result = await authClient.signOut()
  if (result?.error) {
    throw new PasskeyError('PASSKEY_SIGN_OUT_FAILED', 0)
  }
  // The last-account snapshot survives reloads: clear it before navigating
  // or the landing page renders signed-in from cache and ping-pongs through
  // RequireAuth. In-memory query caches die with the hard navigation below,
  // so they need no explicit clearing. Push is intentionally kept: this is a
  // re-auth roundtrip on the same device, not a logout — disconnecting would
  // orphan the endpoint while the per-account onboarding flag stays set.
  clearLastAccount()
  try {
    const current =
      typeof window === 'undefined'
        ? '/'
        : `${window.location.pathname}${window.location.search}${window.location.hash}`
    replaceBrowserLocation(
      `/?redirect=${encodeURIComponent(safeLocalReturnPath(current))}`,
    )
  } catch {
    // The session is already dead at this point: report the navigation, not
    // the sign-out, so the caller does not claim the sign-out failed.
    throw new PasskeyError('PASSKEY_REAUTH_NAVIGATE_FAILED', 0)
  }
}

/**
 * Delete a passkey through the `account.deletePasskey` tRPC mutation — never
 * through `authClient.passkey.deletePasskey`. Only the mutation enforces the
 * last-sign-in-method guard (the plugin endpoint deletes through the raw
 * adapter and cannot run the check). CONFLICT maps to PASSKEY_LAST_METHOD.
 */
export async function removePasskey(id: string): Promise<void> {
  try {
    await getTrpcClient().account.deletePasskey.mutate({ id })
  } catch (error) {
    throw toDeletePasskeyError(error)
  }
}

function toDeletePasskeyError(error: unknown): PasskeyError {
  const code =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data?.code
      : undefined
  if (code === 'CONFLICT') {
    return new PasskeyError('PASSKEY_LAST_METHOD', 409)
  }
  return new PasskeyError('PASSKEY_REMOVE_FAILED', 0)
}

/**
 * Cookie name the better-auth `lastLoginMethod` plugin reads through
 * `getLastUsedLoginMethod()` (`lastLoginMethodClient()` with no custom config).
 * The plugin only writes it on sign-in responses, so registering a passkey
 * during anonymous onboarding leaves the login-screen hint stuck at `anonymous`
 * — the account's actual credential is the passkey.
 */
const LAST_USED_LOGIN_METHOD_COOKIE = 'better-auth.last_used_login_method'
const LAST_USED_LOGIN_METHOD_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Record `passkey` as the last used login method so the login screen shows its
 * "Last used" hint on the passkey button. Mirrors the plugin's cookie
 * attributes (root path, 30d max-age, JS-readable). Scoped to the anonymous
 * onboarding flow — settings-flow additions leave the hint alone.
 */
export function markPasskeyAsLastUsedLoginMethod(): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${LAST_USED_LOGIN_METHOD_COOKIE}=passkey; path=/; max-age=${LAST_USED_LOGIN_METHOD_MAX_AGE}; samesite=lax${secure}`
}

/**
 * Tell the API a passkey was added (or removed) outside tRPC so the 30s account
 * cache is busted and the anonymous gate flips immediately. Best-effort: the
 * credential change already succeeded — never fail the caller's success flow
 * when only this ping fails.
 */
export function notifyPasskeyChanged(): Promise<void> {
  return getTrpcClient()
    .account.afterPasskeyChange.mutate()
    .then(() => undefined)
    .catch(() => undefined)
}
